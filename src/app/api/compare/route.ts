import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/services/auth";
import { prisma } from "@/lib/db/prisma";
import { executeAuditJob, executeScreenshotAuditJob } from "@/lib/services/audit-job";
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const userExists = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!userExists) {
      return NextResponse.json({ error: "User not found. Please log out and log in again." }, { status: 401 });
    }

    const contentType = request.headers.get("content-type") || "";

    let primaryAuditId = "";
    let competitorAuditId = "";

    if (contentType.includes("multipart/form-data")) {
      // ── SCREENSHOTS COMPARISON ──
      const formData = await request.formData();
      const primaryFile = formData.get("primaryFile") as File | null;
      const competitorFile = formData.get("competitorFile") as File | null;

      if (!primaryFile || !competitorFile) {
        return NextResponse.json({ error: "Both primary and competitor screenshots are required" }, { status: 400 });
      }

      if (!primaryFile.type.startsWith("image/") || !competitorFile.type.startsWith("image/")) {
        return NextResponse.json({ error: "Both uploaded files must be images" }, { status: 400 });
      }

      const projectUrl = "screenshot://comparison";
      let project = await prisma.project.findFirst({
        where: { url: projectUrl, userId },
      });

      if (!project) {
        project = await prisma.project.create({
          data: {
            userId,
            name: "Comparison Audits",
            url: projectUrl,
          },
        });
      }

      // Save Primary Screenshot
      const primaryAuditRunId = randomUUID();
      const primaryBytes = await primaryFile.arrayBuffer();
      const primaryBuffer = Buffer.from(primaryBytes);
      let pExt = ".png";
      if (primaryFile.type === "image/jpeg" || primaryFile.type === "image/jpg") pExt = ".jpg";
      else if (primaryFile.type === "image/webp") pExt = ".webp";
      const pFilename = `${primaryAuditRunId}${pExt}`;
      const uploadDir = path.join(process.cwd(), "public", "uploads", "audits");
      await fs.mkdir(uploadDir, { recursive: true });
      const pFilePath = path.join(uploadDir, pFilename);
      await fs.writeFile(pFilePath, primaryBuffer);
      const primaryImgUrl = `/uploads/audits/${pFilename}`;

      const primaryRun = await prisma.auditRun.create({
        data: {
          id: primaryAuditRunId,
          projectId: project.id,
          userId,
          url: projectUrl,
          inputType: "SCREENSHOT",
          uploadedImageUrl: primaryImgUrl,
          status: "QUEUED",
        },
      });

      // Save Competitor Screenshot
      const competitorAuditRunId = randomUUID();
      const competitorBytes = await competitorFile.arrayBuffer();
      const competitorBuffer = Buffer.from(competitorBytes);
      let cExt = ".png";
      if (competitorFile.type === "image/jpeg" || competitorFile.type === "image/jpg") cExt = ".jpg";
      else if (competitorFile.type === "image/webp") cExt = ".webp";
      const cFilename = `${competitorAuditRunId}${cExt}`;
      const cFilePath = path.join(uploadDir, cFilename);
      await fs.writeFile(cFilePath, competitorBuffer);
      const competitorImgUrl = `/uploads/audits/${cFilename}`;

      const competitorRun = await prisma.auditRun.create({
        data: {
          id: competitorAuditRunId,
          projectId: project.id,
          userId,
          url: projectUrl,
          inputType: "SCREENSHOT",
          uploadedImageUrl: competitorImgUrl,
          status: "QUEUED",
        },
      });

      // Execute background screenshot audit jobs
      executeScreenshotAuditJob(primaryRun.id, primaryImgUrl);
      executeScreenshotAuditJob(competitorRun.id, competitorImgUrl);

      primaryAuditId = primaryRun.id;
      competitorAuditId = competitorRun.id;
    } else {
      // ── URLS COMPARISON ──
      const body = await request.json();
      const { url1, url2 } = body;

      if (!url1 || !url2) {
        return NextResponse.json({ error: "Both URLs are required for comparison" }, { status: 400 });
      }

      let parsedUrl1: URL;
      let parsedUrl2: URL;
      try {
        parsedUrl1 = new URL(url1);
        parsedUrl2 = new URL(url2);
      } catch {
        return NextResponse.json({ error: "One or both URLs are invalid" }, { status: 400 });
      }

      // Project for URL 1
      let project1 = await prisma.project.findFirst({
        where: { url: parsedUrl1.origin, userId },
      });
      if (!project1) {
        project1 = await prisma.project.create({
          data: {
            userId,
            name: parsedUrl1.hostname,
            url: parsedUrl1.origin,
          },
        });
      }

      // Project for URL 2
      let project2 = await prisma.project.findFirst({
        where: { url: parsedUrl2.origin, userId },
      });
      if (!project2) {
        project2 = await prisma.project.create({
          data: {
            userId,
            name: parsedUrl2.hostname,
            url: parsedUrl2.origin,
          },
        });
      }

      // Create primary AuditRun
      const primaryRun = await prisma.auditRun.create({
        data: {
          projectId: project1.id,
          userId,
          url: parsedUrl1.href,
          status: "QUEUED",
        },
      });

      // Create competitor AuditRun
      const competitorRun = await prisma.auditRun.create({
        data: {
          projectId: project2.id,
          userId,
          url: parsedUrl2.href,
          status: "QUEUED",
        },
      });

      // Execute both jobs in background
      executeAuditJob(primaryRun.id, parsedUrl1.href);
      executeAuditJob(competitorRun.id, parsedUrl2.href);

      primaryAuditId = primaryRun.id;
      competitorAuditId = competitorRun.id;
    }

    // Create ComparisonRun in PROCESSING status
    const comparisonRun = await prisma.comparisonRun.create({
      data: {
        userId,
        primaryAuditId,
        competitorAuditId,
        status: "PROCESSING",
      },
    });

    return NextResponse.json({
      id: comparisonRun.id,
      primaryAuditId,
      competitorAuditId,
      status: comparisonRun.status,
    });
  } catch (error) {
    console.error("Comparison submission error:", error);
    return NextResponse.json({ error: "Failed to submit comparison" }, { status: 500 });
  }
}
