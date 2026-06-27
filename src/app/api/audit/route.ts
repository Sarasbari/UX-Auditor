import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/services/auth";
import { prisma } from "@/lib/db/prisma";
import { executeAuditJob } from "@/lib/services/audit-job";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    let userId = session?.user?.id;

    if (!userId) {
      const anonymousUser = await prisma.user.upsert({
        where: { email: "anonymous@ux-auditor.local" },
        update: {},
        create: { email: "anonymous@ux-auditor.local", name: "Anonymous" },
      });
      userId = anonymousUser.id;
    }

    const body = await request.json();
    const { url } = body;

    if (!url) {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }

    let project = await prisma.project.findFirst({
      where: { url: parsedUrl.origin, userId },
    });

    if (!project) {
      project = await prisma.project.create({
        data: {
          userId,
          name: parsedUrl.hostname,
          url: parsedUrl.origin,
        },
      });
    }

    const auditRun = await prisma.auditRun.create({
      data: {
        projectId: project.id,
        userId,
        url: parsedUrl.href,
        status: "QUEUED",
      },
    });

    // Fire-and-forget: the service module guarantees a terminal status.
    executeAuditJob(auditRun.id, parsedUrl.href);

    return NextResponse.json({
      id: auditRun.id,
      status: auditRun.status,
      url: auditRun.url,
    });
  } catch (error) {
    console.error("Audit submission error:", error);
    return NextResponse.json({ error: "Failed to submit audit" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const session = await auth();
    let userId = session?.user?.id;

    if (!userId) {
      const anonymousUser = await prisma.user.findUnique({
        where: { email: "anonymous@ux-auditor.local" },
      });
      if (!anonymousUser) {
        return NextResponse.json([]);
      }
      userId = anonymousUser.id;
    }

    const auditRuns = await prisma.auditRun.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        project: true,
        _count: { select: { issues: true } },
      },
    });

    return NextResponse.json(auditRuns);
  } catch (error) {
    console.error("Failed to fetch audits:", error);
    return NextResponse.json({ error: "Failed to fetch audits" }, { status: 500 });
  }
}
