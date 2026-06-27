import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/services/auth";
import { prisma } from "@/lib/db/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { id } = await params;

    const auditRun = await prisma.auditRun.findUnique({
      where: { id },
      include: {
        project: true,
        issues: {
          orderBy: { severity: "asc" },
          include: {
            screenshots: true,
          },
        },
        screenshots: true,
        domSnapshot: true,
        chatMessages: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!auditRun) {
      return NextResponse.json({ error: "Audit not found" }, { status: 404 });
    }

    if (auditRun.userId !== session.user.id) {
      return NextResponse.json({ error: "You do not have access to this audit" }, { status: 403 });
    }

    // Fetch dynamic progress logs from FastAPI if not in terminal state
    let progress: string[] = [];
    if (auditRun.status !== "COMPLETED" && auditRun.status !== "FAILED") {
      try {
        const FASTAPI_URL = process.env.FASTAPI_URL || "http://localhost:8001";
        const pollRes = await fetch(`${FASTAPI_URL}/progress/${id}`);
        if (pollRes.ok) {
          const data = await pollRes.json();
          progress = data.progress || [];
        }
      } catch (e) {
        console.warn(`[route.ts] Could not fetch progress logs for audit ${id}:`, e);
      }
    }

    // Parse JSON string fields and convert uppercase DB values to lowercase for the frontend
    const response = {
      ...auditRun,
      status: auditRun.status.toLowerCase(),
      errorMessage: auditRun.errorMessage,
      progress,
      issues: auditRun.issues.map(issue => ({
        ...issue,
        severity: issue.severity.toLowerCase(),
        category: issue.category.toLowerCase(),
        verifiedFixStatus: issue.verifiedFixStatus.toLowerCase(),
        source: issue.source.toLowerCase(),
        confidence: (issue as any).confidence ? (issue as any).confidence.toLowerCase() : "medium",
        actualValue: (issue as any).actualValue,
        expectedValue: (issue as any).expectedValue,
        viewport: (issue as any).viewport,
        ruleId: (issue as any).ruleId,
        sampleElements: (issue as any).sampleElements ? JSON.parse((issue as any).sampleElements) : null,
        pageUrl: (issue as any).pageUrl,
        fixDiff: issue.fixDiff ? JSON.parse(issue.fixDiff) : null,
        screenshots: issue.screenshots,
      })),
      chatMessages: auditRun.chatMessages.map(msg => ({
        ...msg,
        citedIssueIds: JSON.parse(msg.citedIssueIds || "[]"),
      })),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Failed to fetch audit:", error);
    return NextResponse.json({ error: "Failed to fetch audit" }, { status: 500 });
  }
}
