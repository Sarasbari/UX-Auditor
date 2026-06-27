import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/services/auth";
import { prisma } from "@/lib/db/prisma";
import { executeScreenshotAuditJob } from "@/lib/services/audit-job";
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

    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    // Validate type and size
    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "Uploaded file is not an image" }, { status: 400 });
    }

    if (file.size > 8 * 1024 * 1024) {
      return NextResponse.json({ error: "File exceeds 8MB size limit" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Create unique ID for the audit run
    const auditRunId = randomUUID();

    // Determine extension
    let ext = ".png";
    if (file.type === "image/jpeg" || file.type === "image/jpg") ext = ".jpg";
    else if (file.type === "image/webp") ext = ".webp";

    const filename = `${auditRunId}${ext}`;
    const uploadDir = path.join(process.cwd(), "public", "uploads", "audits");
    
    // Ensure upload directory exists
    await fs.mkdir(uploadDir, { recursive: true });

    const filePath = path.join(uploadDir, filename);
    await fs.writeFile(filePath, buffer);

    const relativeImageUrl = `/uploads/audits/${filename}`;

    // Get or create "Screenshot Audit" project
    const projectUrl = "screenshot://uploaded";
    let project = await prisma.project.findFirst({
      where: { url: projectUrl, userId },
    });

    if (!project) {
      project = await prisma.project.create({
        data: {
          userId,
          name: "Screenshot Audits",
          url: projectUrl,
        },
      });
    }

    // Create AuditRun
    const auditRun = await prisma.auditRun.create({
      data: {
        id: auditRunId,
        projectId: project.id,
        userId,
        url: projectUrl,
        inputType: "SCREENSHOT",
        uploadedImageUrl: relativeImageUrl,
        status: "QUEUED",
      },
    });

    // Execute job asynchronously (fire-and-forget)
    executeScreenshotAuditJob(auditRun.id, relativeImageUrl);

    return NextResponse.json({
      id: auditRun.id,
      status: auditRun.status,
      uploadedImageUrl: relativeImageUrl,
    });
  } catch (error) {
    console.error("Screenshot upload error:", error);
    return NextResponse.json({ error: "Failed to submit screenshot audit" }, { status: 500 });
  }
}
