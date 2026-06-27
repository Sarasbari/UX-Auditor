import type { DeterministicFinding, LLMFinding, MergedIssue, Severity, IssueSource } from "@/types";
import { randomUUID } from "crypto";

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 4,
  serious: 3,
  moderate: 2,
  minor: 1,
};

export function mergeFindings(
  deterministicFindings: DeterministicFinding[],
  llmFindings: LLMFinding[]
): MergedIssue[] {
  const issues: MergedIssue[] = [];
  const usedLLMIndices = new Set<number>();

  deterministicFindings.forEach(det => {
    const matchingLLM = findMatchingLLMFinding(det, llmFindings);
    if (matchingLLM !== null) {
      usedLLMIndices.add(matchingLLM.index);
      const llm = matchingLLM.finding;
      issues.push({
        id: randomUUID(),
        severity: higherSeverity(det.severity, llm.severity),
        category: det.category,
        elementSelector: det.elementSelector,
        description: mergeDescription(det, llm),
        fixSuggestion: det.fixSuggestion || llm.suggestedImprovement,
        fixDiff: null,
        verifiedFixStatus: "not_applicable",
        source: "merged",
        sources: [`${det.engine}:${det.ruleId}`, `llm:${llm.heuristicId}`],
        screenshots: {},
      });
    } else {
      issues.push({
        id: randomUUID(),
        severity: det.severity,
        category: det.category,
        elementSelector: det.elementSelector,
        description: det.description,
        fixSuggestion: det.fixSuggestion,
        fixDiff: null,
        verifiedFixStatus: "not_applicable",
        source: "deterministic",
        sources: [`${det.engine}:${det.ruleId}`],
        screenshots: {},
      });
    }
  });

  llmFindings.forEach((llm, index) => {
    if (usedLLMIndices.has(index)) return;
    if (llm.score >= 4) return;

    issues.push({
      id: randomUUID(),
      severity: llm.severity,
      category: llm.category,
      elementSelector: llm.affectedElements[0] || null,
      description: llm.justification,
      fixSuggestion: llm.suggestedImprovement,
      fixDiff: null,
      verifiedFixStatus: "not_applicable",
      source: "llm",
      sources: [`llm:${llm.heuristicId}`],
      screenshots: {},
    });
  });

  return issues.sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]);
}

function findMatchingLLMFinding(
  det: DeterministicFinding,
  llmFindings: LLMFinding[]
): { finding: LLMFinding; index: number } | null {
  const detLower = det.description.toLowerCase();
  const detSelector = det.elementSelector.toLowerCase();

  for (let i = 0; i < llmFindings.length; i++) {
    const llm = llmFindings[i];
    const llmJustification = llm.justification.toLowerCase();
    const hasElementOverlap = llm.affectedElements.some(
      el => detSelector.includes(el.toLowerCase()) || el.toLowerCase().includes(detSelector)
    );
    const hasKeywordOverlap = hasOverlappingKeywords(detLower, llmJustification);

    if (hasElementOverlap || hasKeywordOverlap) {
      return { finding: llm, index: i };
    }
  }

  return null;
}

function hasOverlappingKeywords(text1: string, text2: string): boolean {
  const keywords = [
    "contrast", "alt", "aria", "label", "heading", "color", "font",
    "spacing", "padding", "margin", "button", "link", "form", "input",
    "image", "text", "navigation", "menu", "modal", "dialog",
  ];

  const matches = keywords.filter(kw => text1.includes(kw) && text2.includes(kw));
  return matches.length >= 2;
}

function higherSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_ORDER[a] >= SEVERITY_ORDER[b] ? a : b;
}

function mergeDescription(det: DeterministicFinding, llm: LLMFinding): string {
  return `${det.description}\n\nAI Insight: ${llm.justification}`;
}

export function calculateOverallScore(issues: MergedIssue[]): number {
  if (issues.length === 0) return 100;

  let score = 100;
  issues.forEach(issue => {
    switch (issue.severity) {
      case "critical": score -= 15; break;
      case "serious": score -= 8; break;
      case "moderate": score -= 4; break;
      case "minor": score -= 1; break;
    }
  });

  return Math.max(0, Math.min(100, score));
}
