import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const auditRun = await prisma.auditRun.findUnique({
      where: { id },
      include: {
        project: true,
        issues: {
          orderBy: { severity: "asc" },
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

    // Parse JSON string fields and convert uppercase DB values to lowercase for the frontend
    const response = {
      ...auditRun,
      status: auditRun.status.toLowerCase(),
      errorMessage: auditRun.errorMessage,
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
