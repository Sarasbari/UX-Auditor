import { captureAndAnalyze } from "../engines/deterministic/capture";
import { runImpeccableAnalysis } from "../engines/deterministic/impeccable-rules";
import { analyzeWithLLM } from "../engines/llm/heuristic";
import { mergeFindings, calculateOverallScore } from "../engines/merge/merge";
import { applyAndVerifyFixes, generateCodePatch } from "../engines/fix/verified-fix";
import type { DeterministicFinding, MergedIssue } from "@/types";

export interface AuditResult {
  url: string;
  score: number;
  issues: MergedIssue[];
  screenshotUrl: string;
  domSnapshotUrl: string;
  summary: string;
}

export async function runFullAudit(url: string): Promise<AuditResult> {
  const capture = await captureAndAnalyze(url);

  const axeFindings: DeterministicFinding[] = capture.axeResults.violations.flatMap(violation =>
    violation.nodes.map(node => ({
      ruleId: violation.id,
      engine: "axe-core" as const,
      severity: mapAxeImpactToSeverity(violation.impact),
      category: "accessibility" as const,
      elementSelector: node.target[0] || "",
      description: `${violation.help}: ${node.message}`,
      fixSuggestion: `See: ${violation.helpUrl}`,
      domSnippet: node.html,
    }))
  );

  const impeccableFindings = runImpeccableAnalysis(capture.html, capture.computedStyles);

  const deterministicFindings = [...axeFindings, ...impeccableFindings];

  const screenshotBase64 = capture.screenshot.toString("base64");
  const llmResult = await analyzeWithLLM(screenshotBase64, capture.html, url);

  const mergedIssues = mergeFindings(deterministicFindings, llmResult.findings);

  let verifiedFixes: Awaited<ReturnType<typeof applyAndVerifyFixes>> = [];
  try {
    if (capture.page) {
      verifiedFixes = await applyAndVerifyFixes(
        capture.page,
        mergedIssues,
        capture.html,
        capture.computedStyles
      );
    }
  } catch (error) {
    console.error("Verified fix pipeline failed:", error);
  }

  verifiedFixes.forEach(fix => {
    const issue = mergedIssues.find(i => i.id === fix.issueId);
    if (issue) {
      issue.verifiedFixStatus = fix.status;
      issue.fixDiff = fix.fixDiff;
      issue.screenshots = {
        original: fix.originalScreenshot.toString("base64"),
        patched: fix.patchedScreenshot.toString("base64"),
      };
    }
  });

  mergedIssues.forEach(issue => {
    if (!issue.screenshots.original) {
      issue.screenshots.original = screenshotBase64;
    }
  });

  const score = calculateOverallScore(mergedIssues);

  if (capture.browser) {
    await capture.browser.close();
  }

  return {
    url,
    score,
    issues: mergedIssues,
    screenshotUrl: "",
    domSnapshotUrl: "",
    summary: llmResult.summary,
  };
}

function mapAxeImpactToSeverity(impact: string): "critical" | "serious" | "moderate" | "minor" {
  switch (impact) {
    case "critical": return "critical";
    case "serious": return "serious";
    case "moderate": return "moderate";
    case "minor": return "minor";
    default: return "moderate";
  }
}
