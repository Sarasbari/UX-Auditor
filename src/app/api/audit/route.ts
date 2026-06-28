import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/services/auth";
import { prisma } from "@/lib/db/prisma";
import { executeAuditJob } from "@/lib/services/audit-job";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    // Verify user exists in the database to prevent foreign key errors if the DB was reset
    const userExists = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!userExists) {
      return NextResponse.json({ error: "User not found. Please log out and log in again." }, { status: 401 });
    }

    const body = await request.json();
    const { url, journeySteps } = body;

    if (!url) {
      return NextResponse.json({ error: "URL is required" }, { status: 400 });
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
    }

    let trimmedJourneySteps: string | undefined = undefined;
    if (journeySteps !== undefined && journeySteps !== null) {
      if (typeof journeySteps !== "string") {
        return NextResponse.json({ error: "Journey steps must be a string" }, { status: 400 });
      }
      trimmedJourneySteps = journeySteps.trim().substring(0, 2000);
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
    executeAuditJob(auditRun.id, parsedUrl.href, trimmedJourneySteps);

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
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
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
