import OpenAI from "openai";
import type { FixDiff } from "@/types";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citedIssueIds: string[];
}

export interface MergedIssue {
  id: string;
  severity: "critical" | "serious" | "moderate" | "minor";
  category: "accessibility" | "ux_heuristic" | "design_quality" | "custom_rule";
  elementSelector: string | null;
  description: string;
  fixSuggestion: string;
  fixDiff: FixDiff | null;
  verifiedFixStatus: "pending" | "success" | "failed" | "not_applicable";
  source: "deterministic" | "llm" | "merged";
}

const CHAT_SYSTEM_PROMPT = `You are a Conversational UX Auditor Assistant.
You help developers and UI/UX designers understand their website audit results and guide them through fixing identified issues.

Guidelines:
1. Always be grounded in the audit report provided. Do not invent issues not present in the report.
2. When discussing specific issues, mention their ID or selector.
3. Reference verified fix status if mentioned (e.g. status 'success' means the fix is proven).
4. Provide concrete code fixes (e.g. HTML/CSS or Tailwind CSS) if the user asks.
5. You MUST return citedIssueIds that match existing issues from the report.`;

export async function chatWithAuditReport(
  messages: ChatMessage[],
  issues: MergedIssue[],
  userMessage: string
): Promise<{ response: string; citedIssueIds: string[] }> {
  const openaiKey = process.env.OPENAI_API_KEY;

  // ── Graceful Fallback if OpenAI Key is missing or invalid ──
  if (!openaiKey || openaiKey.startsWith("sk-...")) {
    return runKeywordFallback(issues, userMessage);
  }

  try {
    const openai = new OpenAI({ apiKey: openaiKey });

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
      role: msg.role,
      content: msg.content,
    }));

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `${CHAT_SYSTEM_PROMPT}\n\nCurrent audit issues context:\n${JSON.stringify(issueContext, null, 2)}`,
        },
        ...chatHistory,
        {
          role: "user",
          content: userMessage,
        },
      ],
      temperature: 0.2,
      max_tokens: 1024,
    });

    const content = response.choices[0]?.message?.content || "I couldn't process that question.";
    const citedIds = extractCitedIssueIds(content, issues);

    return {
      response: content,
      citedIssueIds: citedIds,
    };
  } catch (err) {
    console.error("OpenAI chat completions call failed. Falling back to keyword matching.", err);
    return runKeywordFallback(issues, userMessage);
  }
}

function extractCitedIssueIds(responseContent: string, issues: MergedIssue[]): string[] {
  const cited: string[] = [];
  const contentLower = responseContent.toLowerCase();

  issues.forEach(issue => {
    // Check if the LLM referenced the UUID or a short snippet of the element selector / description
    const idMatch = contentLower.includes(issue.id.toLowerCase());
    const shortIdMatch = contentLower.includes(issue.id.substring(0, 8).toLowerCase());
    const selectorMatch = issue.elementSelector ? contentLower.includes(issue.elementSelector.toLowerCase()) : false;

    if (idMatch || shortIdMatch || selectorMatch) {
      cited.push(issue.id);
    }
  });

  return cited;
}

function runKeywordFallback(
  issues: MergedIssue[],
  message: string
): { response: string; citedIssueIds: string[] } {
  const messageLower = message.toLowerCase();
  const matchedIssues: MergedIssue[] = [];

  // Match keyword tokens larger than 3 characters
  const keywords = messageLower.split(/\s+/).filter(k => k.length > 3);

  for (const issue of issues) {
    const desc = (issue.description || "").toLowerCase();
    const selector = (issue.elementSelector || "").toLowerCase();
    const category = (issue.category || "").toLowerCase();

    const hasMatch = keywords.length > 0 
      ? keywords.some(k => desc.includes(k) || selector.includes(k) || category.includes(k))
      : desc.includes(messageLower) || selector.includes(messageLower);

    if (hasMatch) {
      matchedIssues.push(issue);
    }
  }

  let responseText = "*(Assistant in Local Resilient Mode)*\n\n";

  if (matchedIssues.length > 0) {
    responseText += "Based on your audit findings, I located these relevant issues:\n\n";
    matchedIssues.forEach(issue => {
      responseText += `- **[${issue.severity.toUpperCase()}]** on \`${issue.elementSelector || "global"}\`:\n  ${issue.description}\n  *Suggested Fix:* ${issue.fixSuggestion}\n\n`;
    });
  } else {
    responseText += "I searched your audit report but couldn't find any specific matching issues for your query.\n\n";
    responseText += "Try asking about specific keywords like: **contrast**, **touch**, **label**, or **broken**.";
  }

  return {
    response: responseText,
    citedIssueIds: matchedIssues.map(issue => issue.id),
  };
}
