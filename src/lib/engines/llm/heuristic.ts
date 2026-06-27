import OpenAI from "openai";
import type { LLMFinding } from "@/types";

function getOpenAI() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

const HEURISTIC_PROMPT = `You are a UX expert auditing a webpage. Analyze the screenshot and DOM context using Nielsen's 10 Usability Heuristics combined with modern design principles.

For each heuristic, score 1-5 (1=terrible, 5=excellent) and provide specific findings.

Nielsen's 10 Heuristics:
1. Visibility of system status
2. Match between system and real world
3. User control and freedom
4. Consistency and standards
5. Error prevention
6. Recognition rather than recall
7. Flexibility and efficiency of use
8. Aesthetic and minimalist design
9. Help users recognize, diagnose, and recover from errors
10. Help and documentation

Additional Design Quality Checks:
- Typography: Are fonts distinctive or generic? Is hierarchy clear?
- Color: Is palette cohesive? Any harsh contrasts or dull grays?
- Spacing: Is padding generous or cramped? Consistent rhythm?
- Layout: Is it balanced? Any awkward whitespace or alignment issues?
- Visual hierarchy: Is the most important element visually dominant?
- CTA clarity: Is the primary action obvious?
- Mobile readiness: Would this work on smaller screens?

Respond with ONLY valid JSON in this exact format:
{
  "findings": [
    {
      "heuristicId": "visibility|real_world|user_control|consistency|error_prevention|recognition|efficiency|aesthetics|error_recovery|help|typography|color|spacing|layout|hierarchy|cta|mobile",
      "score": 1-5,
      "severity": "critical|serious|moderate|minor",
      "justification": "Specific observation with element reference",
      "affectedElements": ["selector1", "selector2"],
      "suggestedImprovement": "Concrete actionable fix"
    }
  ],
  "overallScore": 0-100,
  "summary": "One sentence overall assessment"
}`;

export async function analyzeWithLLM(
  screenshotBase64: string,
  html: string,
  url: string
): Promise<{ findings: LLMFinding[]; overallScore: number; summary: string }> {
  const domExcerpt = html.substring(0, 15000);

  const openai = getOpenAI();
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "system",
        content: HEURISTIC_PROMPT,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Analyze this webpage. URL: ${url}\n\nDOM excerpt (first 15k chars):\n${domExcerpt}`,
          },
          {
            type: "image_url",
            image_url: {
              url: `data:image/png;base64,${screenshotBase64}`,
              detail: "high",
            },
          },
        ],
      },
    ],
    max_tokens: 4096,
    temperature: 0,
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No response from LLM");
  }

  const parsed = JSON.parse(content);

  const findings: LLMFinding[] = (parsed.findings || []).map((f: Record<string, unknown>) => ({
    heuristicId: f.heuristicId as string,
    severity: mapScoreToSeverity(f.score as number),
    category: "ux_heuristic" as const,
    score: f.score as number,
    justification: f.justification as string,
    affectedElements: (f.affectedElements as string[]) || [],
    suggestedImprovement: f.suggestedImprovement as string,
  }));

  return {
    findings,
    overallScore: parsed.overallScore || 50,
    summary: parsed.summary || "Analysis complete",
  };
}

function mapScoreToSeverity(score: number): "critical" | "serious" | "moderate" | "minor" {
  if (score <= 1) return "critical";
  if (score <= 2) return "serious";
  if (score <= 3) return "moderate";
  return "minor";
}
