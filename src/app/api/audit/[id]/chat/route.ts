import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/services/auth";
import { prisma } from "@/lib/db/prisma";
import type { FixDiff } from "@/types";
import { chatWithAuditReport } from "@/lib/services/chat";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { message, selectedIssueId } = body;

    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const auditRun = await prisma.auditRun.findUnique({
      where: { id },
      include: {
        issues: true,
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

    const issues = auditRun.issues.map(issue => {
      let parsedSample: any[] = [];
      try {
        if (issue.sampleElements) {
          parsedSample = JSON.parse(issue.sampleElements);
        }
      } catch (e) {
        console.error("Failed to parse sample elements for issue:", issue.id, e);
      }

      return {
        id: issue.id,
        severity: issue.severity.toLowerCase() as "critical" | "serious" | "moderate" | "minor",
        category: issue.category.toLowerCase() as "accessibility" | "ux_heuristic" | "design_quality" | "custom_rule",
        elementSelector: issue.elementSelector,
        description: issue.description,
        fixSuggestion: issue.fixSuggestion || "",
        fixDiff: issue.fixDiff ? JSON.parse(issue.fixDiff as string) as FixDiff : null,
        verifiedFixStatus: issue.verifiedFixStatus.toLowerCase() as "pending" | "success" | "failed" | "not_applicable",
        source: issue.source.toLowerCase() as "deterministic" | "llm" | "merged" | "axe-core" | "custom_heuristic",
        confidence: (issue.confidence || "MEDIUM").toLowerCase() as "high" | "medium" | "low",
        actualValue: issue.actualValue || "",
        expectedValue: issue.expectedValue || "",
        viewport: issue.viewport || "",
        ruleId: issue.ruleId || "",
        pageUrl: issue.pageUrl || "",
        sampleElements: parsedSample,
      };
    });

    const chatHistory = auditRun.chatMessages.map(msg => ({
      id: msg.id,
      role: msg.role.toLowerCase() as "user" | "assistant",
      content: msg.content,
      citedIssueIds: JSON.parse(msg.citedIssueIds || "[]"),
      createdAt: msg.createdAt.toISOString(),
    }));

    const result = await chatWithAuditReport(
      chatHistory.map(h => ({
        id: h.id,
        role: h.role as "user" | "assistant",
        content: h.content,
        citedIssueIds: h.citedIssueIds
      })),
      issues,
      message,
      auditRun.score,
      selectedIssueId || null
    );

    await prisma.$transaction([
      prisma.chatMessage.create({
        data: {
          auditRunId: id,
          role: "USER",
          content: message,
          citedIssueIds: JSON.stringify([]),
        },
      }),
      prisma.chatMessage.create({
        data: {
          auditRunId: id,
          role: "ASSISTANT",
          content: result.response,
          citedIssueIds: JSON.stringify(result.citedIssueIds),
        },
      }),
    ]);

    return NextResponse.json({
      response: result.response,
      citedIssueIds: result.citedIssueIds,
      suggestedFollowUps: result.suggestedFollowUps || [],
    });
  } catch (error) {
    console.error("Chat error:", error);
    return NextResponse.json({ error: "Chat failed" }, { status: 500 });
  }
}

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
      select: { userId: true },
    });

    if (!auditRun) {
      return NextResponse.json({ error: "Audit not found" }, { status: 404 });
    }

    if (auditRun.userId !== session.user.id) {
      return NextResponse.json({ error: "You do not have access to this audit" }, { status: 403 });
    }

    const messages = await prisma.chatMessage.findMany({
      where: { auditRunId: id },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json(messages);
  } catch (error) {
    console.error("Failed to fetch messages:", error);
    return NextResponse.json({ error: "Failed to fetch messages" }, { status: 500 });
  }
}
