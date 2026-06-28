import { buildExecutiveReport } from "./executive-report";

/**
 * Build a concise spoken summary string from audit data for TTS playback.
 * Kept under ~800 characters to avoid overly long audio and API costs.
 */
export function buildVoiceSummaryText(audit: {
  score: number | null;
  inputType?: string | null;
  url?: string | null;
  issues: Array<any>;
}): string {
  const report = buildExecutiveReport(audit);
  const score = audit.score;
  const issueCount = audit.issues?.length ?? 0;

  const auditType =
    (audit.inputType || "").toUpperCase() === "SCREENSHOT"
      ? "screenshot-based visual audit"
      : "live URL audit";

  const parts: string[] = [];

  // Opening
  parts.push(
    `UX Auditor report summary. This ${auditType} scored ${score !== null ? `${score} out of 100` : "could not determine a score"}, with ${issueCount} ${issueCount === 1 ? "issue" : "issues"} found.`
  );

  // Verdict
  if (report.oneLineSummary) {
    parts.push(report.oneLineSummary);
  }

  // Top risks (max 3)
  if (report.topRisks.length > 0) {
    const riskNames = report.topRisks
      .map((r) => `${r.title}, rated ${r.severity}`)
      .join(". ");
    parts.push(`Top risks: ${riskNames}.`);
  }

  // Top fixes
  if (report.topImpactFixes.length > 0) {
    const fixNames = report.topImpactFixes
      .map((f) => `${f.title}, estimated plus ${f.scoreDelta} points`)
      .join(". ");
    parts.push(`Highest impact fixes: ${fixNames}.`);
  }

  // Predicted score
  if (
    report.predictedScoreAfterTopFixes !== null &&
    score !== null &&
    report.predictedScoreAfterTopFixes > score
  ) {
    parts.push(
      `Applying the top fixes could raise the score to ${report.predictedScoreAfterTopFixes}.`
    );
  }

  // Keep the final text under 900 chars
  let text = parts.join(" ");
  if (text.length > 900) {
    text = text.substring(0, 897) + "...";
  }

  return text;
}
