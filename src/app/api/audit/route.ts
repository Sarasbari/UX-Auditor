import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    const userId = session?.user?.id || "anonymous";

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

    startAuditJob(auditRun.id, parsedUrl.href);

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

async function startAuditJob(auditRunId: string, url: string) {
  try {
    await prisma.auditRun.update({
      where: { id: auditRunId },
      data: { status: "PROCESSING", startedAt: new Date() },
    });

    const { runFullAudit } = await import("@/lib/jobs/audit-orchestrator");
    const result = await runFullAudit(url);

    await prisma.$transaction(async (tx) => {
      await tx.auditRun.update({
        where: { id: auditRunId },
        data: {
          status: "COMPLETED",
          score: result.score,
          completedAt: new Date(),
        },
      });

      for (const issue of result.issues) {
        await tx.issue.create({
          data: {
            auditRunId,
            severity: issue.severity.toUpperCase() as "CRITICAL" | "SERIOUS" | "MODERATE" | "MINOR",
            category: issue.category.toUpperCase() as "ACCESSIBILITY" | "UX_HEURISTIC" | "DESIGN_QUALITY" | "CUSTOM_RULE",
            elementSelector: issue.elementSelector,
            description: issue.description,
            fixSuggestion: issue.fixSuggestion,
            fixDiff: issue.fixDiff ? JSON.stringify(issue.fixDiff) : null,
            verifiedFixStatus: issue.verifiedFixStatus.toUpperCase() as "PENDING" | "SUCCESS" | "FAILED" | "NOT_APPLICABLE",
            source: issue.source.toUpperCase() as "DETERMINISTIC" | "LLM" | "MERGED",
          },
        });
      }
    });
  } catch (error) {
    console.error("Audit job failed:", error);
    await prisma.auditRun.update({
      where: { id: auditRunId },
      data: { status: "FAILED" },
    });
  }
}

export async function GET() {
  try {
    const session = await auth();
    const userId = session?.user?.id || "anonymous";

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
