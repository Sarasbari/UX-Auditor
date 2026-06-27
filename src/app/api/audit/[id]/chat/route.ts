import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { chatWithAuditReport } from "@/lib/engines/llm/chat";
import type { FixDiff } from "@/types";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { message } = body;

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

    const issues = auditRun.issues.map(issue => ({
      id: issue.id,
      severity: issue.severity.toLowerCase() as "critical" | "serious" | "moderate" | "minor",
      category: issue.category.toLowerCase() as "accessibility" | "ux_heuristic" | "design_quality" | "custom_rule",
      elementSelector: issue.elementSelector,
      description: issue.description,
      fixSuggestion: issue.fixSuggestion || "",
      fixDiff: issue.fixDiff as FixDiff | null,
      verifiedFixStatus: issue.verifiedFixStatus.toLowerCase() as "pending" | "success" | "failed" | "not_applicable",
      source: issue.source.toLowerCase() as "deterministic" | "llm" | "merged",
      sources: [],
      screenshots: {},
    }));

    const chatHistory = auditRun.chatMessages.map(msg => ({
      id: msg.id,
      role: msg.role.toLowerCase() as "user" | "assistant",
      content: msg.content,
      citedIssueIds: msg.citedIssueIds,
      createdAt: msg.createdAt.toISOString(),
    }));

    const result = await chatWithAuditReport(chatHistory, issues, message);

    await prisma.$transaction([
      prisma.chatMessage.create({
        data: {
          auditRunId: id,
          role: "USER",
          content: message,
          citedIssueIds: [],
        },
      }),
      prisma.chatMessage.create({
        data: {
          auditRunId: id,
          role: "ASSISTANT",
          content: result.response,
          citedIssueIds: result.citedIssueIds,
        },
      }),
    ]);

    return NextResponse.json({
      response: result.response,
      citedIssueIds: result.citedIssueIds,
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
    const { id } = await params;

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
