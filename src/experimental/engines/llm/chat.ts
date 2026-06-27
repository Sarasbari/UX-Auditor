import OpenAI from "openai";
import type { MergedIssue, ChatMessage } from "@/types";

function getOpenAI() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

const CHAT_SYSTEM_PROMPT = `You are a UX expert assistant helping users understand their website audit results. You have access to the full audit report with specific issues, severities, and fix suggestions.

Guidelines:
- Answer questions about specific issues by citing issue IDs
- Explain why something was flagged and how to fix it
- Prioritize critical and serious issues in recommendations
- Be concise and actionable
- If asked about something not in the report, say so clearly
- Reference the verified fix status when relevant (✓ means proven fix, ✗ means fix attempted but failed)`;

export async function chatWithAuditReport(
  messages: ChatMessage[],
  issues: MergedIssue[],
  userMessage: string
): Promise<{ response: string; citedIssueIds: string[] }> {
  const issueContext = issues.map(issue => ({
    id: issue.id,
    severity: issue.severity,
    category: issue.category,
    element: issue.elementSelector,
    description: issue.description,
    fix: issue.fixSuggestion,
    verified: issue.verifiedFixStatus,
    source: issue.source,
  }));

  const chatHistory = messages.map(msg => ({
    role: msg.role as "user" | "assistant",
    content: msg.content,
  }));

  const openai = getOpenAI();
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: `${CHAT_SYSTEM_PROMPT}\n\nCurrent audit issues:\n${JSON.stringify(issueContext, null, 2)}`,
      },
      ...chatHistory,
      {
        role: "user",
        content: userMessage,
      },
    ],
    max_tokens: 2048,
    temperature: 0.3,
  });

  const content = response.choices[0]?.message?.content || "I couldn't process that question.";

  const citedIds = extractCitedIssueIds(content, issues);

  return {
    response: content,
    citedIssueIds: citedIds,
  };
}

function extractCitedIssueIds(response: string, issues: MergedIssue[]): string[] {
  const cited: string[] = [];
  issues.forEach(issue => {
    if (response.includes(issue.id) || response.includes(issue.id.substring(0, 8))) {
      cited.push(issue.id);
    }
  });
  return cited;
}
