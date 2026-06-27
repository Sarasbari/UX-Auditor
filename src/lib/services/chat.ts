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
  source: "deterministic" | "llm" | "merged" | "axe-core" | "custom_heuristic";
  confidence?: "high" | "medium" | "low";
  actualValue?: string;
  expectedValue?: string;
  viewport?: string;
  ruleId?: string;
  pageUrl?: string;
  sampleElements?: any[];
}

const CHAT_SYSTEM_PROMPT = `You are a senior UX auditor and accessibility engineer.
You help developers and UI/UX designers understand their website audit results and guide them through fixing identified issues.
You must answer only from the audit report provided. Prioritize issues by severity, confidence, user impact, and fix effort. Cite issue IDs. Do not invent findings.
If code fixes are requested, produce practical, clean HTML/CSS/React/Tailwind examples when possible.

You MUST respond in JSON format matching this schema:
{
  "response": "markdown string summarizing findings, prioritize recommendations, and explain next steps",
  "citedIssueIds": ["uuid-1", "uuid-2"],
  "suggestedFollowUps": ["Question 1?", "Question 2?"]
}`;

export async function chatWithAuditReport(
  messages: ChatMessage[],
  issues: MergedIssue[],
  userMessage: string,
  auditScore: number | null = null,
  selectedIssueId: string | null = null
): Promise<{ response: string; citedIssueIds: string[]; suggestedFollowUps?: string[] }> {
  const openaiKey = process.env.OPENAI_API_KEY;

  // ── Graceful Fallback if OpenAI Key is missing or invalid ──
  if (!openaiKey || openaiKey.startsWith("sk-...")) {
    return runDeterministicFallback(issues, userMessage, auditScore, selectedIssueId);
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
      confidence: issue.confidence || "medium",
      ruleId: issue.ruleId || "",
      actualValue: issue.actualValue || "",
      expectedValue: issue.expectedValue || "",
    }));

    const chatHistory = messages.map(msg => ({
      role: msg.role,
      content: msg.content,
    }));

    const systemPromptContext = `${CHAT_SYSTEM_PROMPT}

Current Audit Summary Context:
- Score: ${auditScore !== null ? auditScore + "/100" : "N/A"}
- Total Issues: ${issues.length}
- Selected/Expanded Issue ID: ${selectedIssueId || "None"}

Current Audit Issues List:
${JSON.stringify(issueContext, null, 2)}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: systemPromptContext,
        },
        ...chatHistory,
        {
          role: "user",
          content: userMessage,
        },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
      max_tokens: 1024,
    });

    const content = response.choices[0]?.message?.content || "";
    try {
      const parsed = JSON.parse(content);
      return {
        response: parsed.response || "I couldn't generate a proper response.",
        citedIssueIds: parsed.citedIssueIds || [],
        suggestedFollowUps: parsed.suggestedFollowUps || [],
      };
    } catch (parseErr) {
      console.warn("Failed to parse LLM response as JSON. Extracting parameters manually.", parseErr);
      const citedIds = extractCitedIssueIds(content, issues);
      return {
        response: content || "I couldn't process that question.",
        citedIssueIds: citedIds,
        suggestedFollowUps: generateDefaultFollowUps(userMessage, issues, selectedIssueId),
      };
    }
  } catch (err) {
    console.error("OpenAI chat completions call failed. Falling back to deterministic intent matcher.", err);
    return runDeterministicFallback(issues, userMessage, auditScore, selectedIssueId);
  }
}

function extractCitedIssueIds(responseContent: string, issues: MergedIssue[]): string[] {
  const cited: string[] = [];
  const contentLower = responseContent.toLowerCase();

  issues.forEach(issue => {
    const idMatch = contentLower.includes(issue.id.toLowerCase());
    const shortIdMatch = contentLower.includes(issue.id.substring(0, 8).toLowerCase());
    const selectorMatch = issue.elementSelector ? contentLower.includes(issue.elementSelector.toLowerCase()) : false;

    if (idMatch || shortIdMatch || selectorMatch) {
      cited.push(issue.id);
    }
  });

  return cited;
}

export function rankIssuesForAction(issues: MergedIssue[]): MergedIssue[] {
  return [...issues].sort((a, b) => {
    const severityWeight = { critical: 4, serious: 3, moderate: 2, minor: 1 };
    const sevA = severityWeight[a.severity] || 0;
    const sevB = severityWeight[b.severity] || 0;
    if (sevA !== sevB) return sevB - sevA;

    const confidenceWeight = { high: 3, medium: 2, low: 1 };
    const confA = confidenceWeight[a.confidence || "medium"] || 0;
    const confB = confidenceWeight[b.confidence || "medium"] || 0;
    if (confA !== confB) return confB - confA;

    const sourceWeight: Record<string, number> = { "axe-core": 3, "custom_heuristic": 2, "llm": 1, "merged": 2, "deterministic": 2 };
    const srcA = sourceWeight[a.source] || 0;
    const srcB = sourceWeight[b.source] || 0;
    if (srcA !== srcB) return srcB - srcA;

    const countA = a.sampleElements?.length || 1;
    const countB = b.sampleElements?.length || 1;
    if (countA !== countB) return countB - countA;

    return 0;
  });
}

function getIssueTitle(issue: MergedIssue): string {
  const ruleId = issue.ruleId || "";
  const description = issue.description || "";
  
  if (ruleId === "color-contrast") return "Text contrast is too low";
  if (ruleId === "small-touch-target" || ruleId === "target-size") return "Touch target is too small";
  if (ruleId === "missing-label") return "Form field is missing a label";
  if (ruleId === "broken-link") return "Broken link detected";
  if (ruleId === "slow-load-time") return "Page load time is slow";
  if (ruleId === "button-name") return "Buttons need accessible names";
  if (ruleId === "image-alt") return "Images need alternative text";
  if (ruleId === "link-name") return "Links need discernible text";
  if (ruleId === "label") return "Form elements need labels";
  if (ruleId === "document-title") return "Document must have a title";
  
  const descLower = description.toLowerCase();
  if (descLower.includes("contrast")) return "Text contrast is too low";
  if (descLower.includes("tap target") || descLower.includes("touch target") || descLower.includes("size")) return "Touch target is too small";
  if (descLower.includes("label")) return "Form field is missing a label";
  
  if (ruleId) {
    return ruleId.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  }
  return description.substring(0, 50) + (description.length > 50 ? "..." : "");
}

function getIssueImpact(issue: MergedIssue): string {
  const ruleId = issue.ruleId || "";
  const description = issue.description || "";
  
  if (ruleId === "color-contrast") return "Low contrast makes text extremely difficult to read for visually impaired users.";
  if (ruleId === "small-touch-target" || ruleId === "target-size") return "Small touch areas can lead to frustrating mis-taps on mobile viewports.";
  if (ruleId === "missing-label" || ruleId === "label") return "Lacking form labels creates critical barriers for screen reader users.";
  if (ruleId === "broken-link") return "Dead links disrupt user journeys and generate dead ends.";
  
  const descLower = description.toLowerCase();
  if (descLower.includes("contrast")) return "Low contrast makes text extremely difficult to read for visually impaired users.";
  if (descLower.includes("tap target") || descLower.includes("touch target") || descLower.includes("size")) return "Small touch areas can lead to frustrating mis-taps on mobile viewports.";
  
  return "This issue directly impacts standard usability or accessibility compliance.";
}

function detectChatIntent(message: string): string {
  const msgLower = message.toLowerCase();
  
  if (msgLower.includes("improve") || msgLower.includes("score")) {
    return "improve_score";
  }
  if (msgLower.includes("fix first") || msgLower.includes("priorit") || msgLower.includes("what to fix")) {
    return "fix_first";
  }
  if (msgLower.includes("summar") || msgLower.includes("overview")) {
    return "summary";
  }
  if (msgLower.includes("why is this") || msgLower.includes("why matters") || msgLower.includes("why serious") || msgLower.includes("explain why")) {
    return "why_serious";
  }
  if (msgLower.includes("contrast") || msgLower.includes("color")) {
    return "fix_contrast";
  }
  if (msgLower.includes("target") || msgLower.includes("tap") || msgLower.includes("touch") || msgLower.includes("size")) {
    return "fix_touch";
  }
  if (msgLower.includes("wcag") || msgLower.includes("accessib")) {
    return "wcag_issues";
  }
  if (msgLower.includes("code fix") || msgLower.includes("give code") || msgLower.includes("how to fix this") || msgLower.includes("how do i fix this") || msgLower.includes("give me code")) {
    return "code_fix";
  }
  if (msgLower.includes("quick win") || msgLower.includes("easy")) {
    return "quick_wins";
  }
  if (msgLower.includes("business") || msgLower.includes("impact") || msgLower.includes("revenue")) {
    return "business_impact";
  }
  if (msgLower.includes("confidence") || msgLower.includes("certain")) {
    return "confidence_issues";
  }
  
  return "generic";
}

function runDeterministicFallback(
  issues: MergedIssue[],
  message: string,
  auditScore: number | null,
  selectedIssueId: string | null
): { response: string; citedIssueIds: string[]; suggestedFollowUps: string[] } {
  const intent = detectChatIntent(message);
  const ranked = rankIssuesForAction(issues);
  
  let responseText = "";
  let citedIds: string[] = [];
  let followUps: string[] = [];

  switch (intent) {
    case "improve_score": {
      const currentScore = auditScore !== null ? auditScore : 68;
      responseText = `### How to Improve Your UX Score (Current: **${currentScore}/100**)

To maximize your score improvement, you must address the critical and serious accessibility barriers first. Our diminishing-returns scoring engine penalizes repeated findings, meaning resolving these high-impact groups will give you the biggest score boost.

Here are the top 3 actions to take right now:
`;
      const drivers = ranked.slice(0, 3);
      drivers.forEach((issue, idx) => {
        const title = getIssueTitle(issue);
        responseText += `\n${idx + 1}. **Fix "${title}"** (${issue.severity.toUpperCase()})\n   - **Element Selector:** \`${issue.elementSelector || "global"}\`\n   - **Impact:** ${getIssueImpact(issue)}\n`;
        citedIds.push(issue.id);
      });
      
      responseText += `\nOnce you apply these fixes and run a new audit, your score will increase significantly.`;
      followUps = ["What should I fix first?", "Show quick wins", "What is the business impact?"];
      break;
    }
    
    case "fix_first": {
      responseText = `### Prioritized Action Plan

Based on severity, confidence, and frequency, here are the top issues you should resolve immediately:
`;
      const topIssues = ranked.slice(0, 3);
      topIssues.forEach((issue, idx) => {
        const title = getIssueTitle(issue);
        responseText += `\n${idx + 1}. **${title}**\n   - **Severity:** ${issue.severity.toUpperCase()}\n   - **Confidence:** ${issue.confidence || "medium"}\n   - **Selector:** \`${issue.elementSelector || "global"}\`\n   - **Fix suggestion:** ${issue.fixSuggestion || "Verify element dimensions or attributes."}\n`;
        citedIds.push(issue.id);
      });
      followUps = ["Give me code fixes", "Show quick wins", "Explain WCAG issues"];
      break;
    }

    case "summary": {
      const wcagCount = issues.filter(i => i.source === "axe-core").length;
      const heuristicCount = issues.filter(i => i.source === "custom_heuristic" || i.source === "llm").length;
      const criticalCount = issues.filter(i => i.severity === "critical").length;
      const seriousCount = issues.filter(i => i.severity === "serious").length;
      
      responseText = `### Audit Executive Summary

We conducted a comprehensive automated usability and accessibility audit. 

- **Overall Issues Found:** ${issues.length}
  - **Critical Severities:** ${criticalCount}
  - **Serious Severities:** ${seriousCount}
- **Categorization:**
  - **WCAG / axe-core accessibility failures:** ${wcagCount}
  - **UX Heuristic / AI suggestions:** ${heuristicCount}

**Key Areas of Concern:**
The main issues detected relate to ${wcagCount > heuristicCount ? "accessibility compliance (low contrast, missing form labels)" : "mobile usability (small touch target sizes, layout spacing)"}. Readability and interactive hit-targets present the largest barriers.`;
      
      ranked.slice(0, 2).forEach(issue => citedIds.push(issue.id));
      followUps = ["How to improve the UX score?", "What should I fix first?", "What are quick wins?"];
      break;
    }

    case "why_serious": {
      let targetIssue = issues.find(i => i.id === selectedIssueId);
      if (!targetIssue && ranked.length > 0) {
        targetIssue = ranked[0];
      }
      
      if (targetIssue) {
        const title = getIssueTitle(targetIssue);
        responseText = `### Why this issue is marked as ${targetIssue.severity.toUpperCase()}

The issue **"${title}"** on \`${targetIssue.elementSelector || "global"}\` is categorized as **${targetIssue.severity}** because:

1. **User Impact:** ${getIssueImpact(targetIssue)}
2. **Standard Compliance:** It violates core WCAG guidelines or fundamental usability heuristics.
3. **Accessibility Blockers:** Users relying on screen readers, keyboard-only controls, or small touch devices will experience immediate friction or be unable to complete primary actions.`;
        citedIds.push(targetIssue.id);
      } else {
        responseText = "Please select/expand an issue card on the left panel first to review its severity and context.";
      }
      followUps = ["Give me code fixes", "What should I fix first?"];
      break;
    }

    case "fix_contrast": {
      const contrastIssues = issues.filter(i => (i.ruleId === "color-contrast" || i.description.toLowerCase().includes("contrast")));
      responseText = `### Resolving Color Contrast Issues

Color contrast issues prevent low-vision users and readers in bright light environments from reading your site's text. 

**Recommended Action:**
1. **Increase Contrast Ratio:** WCAG 2.1 AA requires a contrast ratio of at least **4.5:1** for normal text, and **3:1** for large text (18pt / 24px or bold 14pt / 18.67px).
2. **Apply CSS Fixes:** Ensure your text colors are sufficiently dark on light backgrounds, or sufficiently light on dark backgrounds.
`;
      if (contrastIssues.length > 0) {
        responseText += `\nWe detected **${contrastIssues.length}** contrast issues in this report:\n`;
        contrastIssues.slice(0, 3).forEach(issue => {
          responseText += `- \`${issue.elementSelector}\` (Current values: ${issue.actualValue || "low contrast"})\n`;
          citedIds.push(issue.id);
        });
      } else {
        responseText += "\nNo active color contrast violations were found in this audit.";
      }
      followUps = ["Give me code fixes", "How to improve the UX score?"];
      break;
    }

    case "fix_touch": {
      const touchIssues = issues.filter(i => (i.ruleId === "small-touch-target" || i.ruleId === "target-size" || i.description.toLowerCase().includes("target") || i.description.toLowerCase().includes("size")));
      responseText = `### Resolving Touch Target Size Issues

Touch targets that are too small or too close together make mobile interactions extremely difficult, leading to accidental taps.

**Best Practices:**
1. **Minimum Dimensions:** Ensure all interactive elements (buttons, links, form fields) are at least **48px wide by 48px high** (per Google Lighthouse/WCAG 2.2) or **44px by 44px** (per Apple HIG).
2. **Adequate Padding:** Add extra padding around small elements rather than scaling them up visually if design dictates. For example, use CSS padding or \`min-width: 48px; min-height: 48px;\`.
`;
      if (touchIssues.length > 0) {
        responseText += `\nWe found **${touchIssues.length}** small touch targets in this report:\n`;
        touchIssues.slice(0, 3).forEach(issue => {
          responseText += `- \`${issue.elementSelector}\` (Measured size: ${issue.actualValue || "under 48px"})\n`;
          citedIds.push(issue.id);
        });
      } else {
        responseText += "\nNo active touch target violations were found in this audit.";
      }
      followUps = ["Give me code fixes", "What should I fix first?"];
      break;
    }

    case "wcag_issues": {
      const wcagIssues = issues.filter(i => i.source === "axe-core");
      responseText = `### WCAG Accessibility Audit Overview

We found **${wcagIssues.length}** strict WCAG compliance violations. WCAG (Web Content Accessibility Guidelines) outlines requirements to make the web accessible to users with disabilities.

**Primary Failures Detected:**
`;
      if (wcagIssues.length > 0) {
        wcagIssues.slice(0, 3).forEach(issue => {
          const title = getIssueTitle(issue);
          responseText += `- **${title}** on \`${issue.elementSelector || "global"}\`: ${issue.description}\n`;
          citedIds.push(issue.id);
        });
      } else {
        responseText += "\nExcellent! Zero strict WCAG/axe-core failures were detected.";
      }
      followUps = ["How to improve the UX score?", "What should I fix first?"];
      break;
    }

    case "code_fix": {
      let targetIssue = issues.find(i => i.id === selectedIssueId);
      if (!targetIssue && ranked.length > 0) {
        targetIssue = ranked[0];
      }
      
      if (targetIssue) {
        const title = getIssueTitle(targetIssue);
        responseText = `### Suggested Code Fix for: "${title}"
**Affected Selector:** \`${targetIssue.elementSelector || "global"}\`
`;
        if (targetIssue.fixDiff && targetIssue.fixDiff.original && targetIssue.fixDiff.patched) {
          responseText += `\n**Side-by-side patch details:**\n\n\`\`\`html\n// ORIGINAL:\n${targetIssue.fixDiff.original}\n\n// PATCHED SUGGESTION:\n${targetIssue.fixDiff.patched}\n\`\`\``;
        } else {
          responseText += `\n**Fix Recommendation:**\n${targetIssue.fixSuggestion || "Check attributes and styling to ensure compatibility."}`;
        }
        citedIds.push(targetIssue.id);
      } else {
        responseText = "Please select/expand an issue card on the left panel first, then ask for a code fix so I can show the code context.";
      }
      followUps = ["What should I fix first?", "Show quick wins"];
      break;
    }

    case "quick_wins": {
      const wins = ranked.filter(i => i.fixDiff || i.confidence === "high").slice(0, 3);
      responseText = `### Quick Wins

These issues have automated code patches or are high-confidence findings that are straightforward to resolve:
`;
      if (wins.length > 0) {
        wins.forEach((issue, idx) => {
          const title = getIssueTitle(issue);
          responseText += `\n${idx + 1}. **${title}** (${issue.severity.toUpperCase()})\n   - **Selector:** \`${issue.elementSelector || "global"}\`\n   - **Fix action:** ${issue.fixDiff ? "Drop-in code fix available." : issue.fixSuggestion}\n`;
          citedIds.push(issue.id);
        });
      } else {
        responseText += "\nNo quick wins available. Review findings individually for manual implementation.";
      }
      followUps = ["Give me code fixes", "What should I fix first?"];
      break;
    }

    case "business_impact": {
      responseText = `### Business Impact of UX Improvements

Fixing these audit findings isn't just about compliance — it has direct business benefits:

1. **Higher Mobile Conversions:** Resolving small touch target sizes reduces friction, resulting in fewer accidental taps and higher form success rates.
2. **SEO Benefits:** Search engines index accessibility properties and rank sites with better page usability higher.
3. **Legal Compliance:** Resolving WCAG / axe-core failures significantly reduces the risk of legal demands regarding ADA compliance.`;
      
      ranked.slice(0, 2).forEach(issue => citedIds.push(issue.id));
      followUps = ["How to improve the UX score?", "Explain WCAG issues"];
      break;
    }

    case "confidence_issues": {
      const highConf = issues.filter(i => i.confidence === "high");
      responseText = `### High Confidence Findings

We found **${highConf.length}** high-confidence findings. These are high-certainty issues backed by strict WCAG code criteria:
`;
      if (highConf.length > 0) {
        highConf.slice(0, 3).forEach(issue => {
          const title = getIssueTitle(issue);
          responseText += `- **${title}** on \`${issue.elementSelector}\` (${issue.severity})\n`;
          citedIds.push(issue.id);
        });
      } else {
        responseText += "\nNo high-confidence issues flagged in this report.";
      }
      followUps = ["What should I fix first?", "Show quick wins"];
      break;
    }

    default: {
      let targetIssue = issues.find(i => i.id === selectedIssueId);
      if (targetIssue) {
        const title = getIssueTitle(targetIssue);
        responseText = `### Selected Issue Context: "${title}"

I noticed you have this issue selected. Here is what we know about it:
- **Severity:** ${targetIssue.severity.toUpperCase()}
- **Category:** ${targetIssue.category.replace("_", " ")}
- **Description:** ${targetIssue.description}
- **Recommended Fix:** ${targetIssue.fixSuggestion || "Verify coordinates or markup attributes."}

How else can I help you resolve this?`;
        citedIds.push(targetIssue.id);
        followUps = ["Give me code fixes", "Why is this issue serious?"];
      } else {
        responseText = `Hello! I am your Conversational UX Auditor. I have analyzed your report containing **${issues.length}** issues and a score of **${auditScore !== null ? auditScore : "N/A"}/100**.

You can ask me questions such as:
- *"What should I fix first?"*
- *"How to improve the UX score?"*
- *"What are the quick wins?"*

Let me know what you want to focus on!`;
        followUps = ["How to improve the UX score?", "What should I fix first?", "Show quick wins"];
      }
    }
  }

  return {
    response: responseText,
    citedIssueIds: citedIds,
    suggestedFollowUps: followUps,
  };
}

function generateDefaultFollowUps(userMessage: string, issues: MergedIssue[], selectedIssueId: string | null): string[] {
  const followUps = ["How to improve the UX score?", "What should I fix first?", "Show quick wins"];
  if (selectedIssueId) {
    followUps.push("Give me code fixes");
  }
  return followUps.slice(0, 3);
}
