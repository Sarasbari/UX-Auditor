/**
 * Helper to calculate and estimate the UX score improvements for issues.
 */

export function estimateIssueScoreDelta(issue: {
  severity: string;
  category?: string | null;
  confidence?: string | null;
  ruleId?: string | null;
  source?: string | null;
}): number {
  const severity = (issue.severity || "").toLowerCase();
  const category = (issue.category || "").toLowerCase();
  const confidence = (issue.confidence || "").toLowerCase();
  const source = (issue.source || "").toLowerCase();

  // 1. Base Score based on severity
  let baseScore = 4; // fallback to moderate
  if (severity === "critical") {
    baseScore = 12;
  } else if (severity === "serious") {
    baseScore = 8;
  } else if (severity === "moderate") {
    baseScore = 4;
  } else if (severity === "minor") {
    baseScore = 2;
  }

  // 2. Confidence Modifier
  let confidenceModifier = 0.8; // default to medium
  if (confidence === "high") {
    confidenceModifier = 1.0;
  } else if (confidence === "medium") {
    confidenceModifier = 0.8;
  } else if (confidence === "low") {
    confidenceModifier = 0.5;
  }

  // 3. Source Modifier
  let sourceModifier = 1.0;
  if (source === "screenshot_vision") {
    sourceModifier = 0.75;
  }

  // 4. Category Modifier
  let categoryModifier = 1.0;
  if (category === "accessibility") {
    categoryModifier = 1.1;
  } else if (category === "design_quality") {
    categoryModifier = 0.9;
  }

  const rawDelta = baseScore * confidenceModifier * sourceModifier * categoryModifier;

  // Clamp: each issue delta min 1, max 15
  return Math.max(1, Math.min(15, Math.round(rawDelta)));
}

export function estimateSelectedScore(
  currentScore: number | null,
  issues: Array<{
    id: string;
    scoreDelta?: number | null;
    severity: string;
    category?: string | null;
    confidence?: string | null;
    ruleId?: string | null;
    source?: string | null;
  }>,
  selectedIssueIds: Set<string> | string[]
): number | null {
  if (currentScore === null) return null;

  const selectedIds = selectedIssueIds instanceof Set
    ? selectedIssueIds
    : new Set(selectedIssueIds);

  if (selectedIds.size === 0) return currentScore;

  // Filter selected issues and calculate or fetch their deltas
  const selectedDeltas = issues
    .filter((issue) => selectedIds.has(issue.id))
    .map((issue) => {
      const delta = typeof issue.scoreDelta === "number"
        ? issue.scoreDelta
        : estimateIssueScoreDelta(issue);
      // Ensure delta is clamped between 1 and 15
      return Math.max(1, Math.min(15, delta));
    });

  if (selectedDeltas.length === 0) return currentScore;

  // Sort deltas in descending order to apply diminishing returns starting from highest impact
  selectedDeltas.sort((a, b) => b - a);

  let totalLift = 0;
  for (let i = 0; i < selectedDeltas.length; i++) {
    const delta = selectedDeltas[i];
    let weight = 0.55;
    if (i === 0) {
      weight = 1.0;
    } else if (i === 1) {
      weight = 0.85;
    } else if (i === 2) {
      weight = 0.70;
    }
    totalLift += delta * weight;
  }

  const roundedLift = Math.round(totalLift);

  // Clamp predicted score max 100
  return Math.min(100, currentScore + roundedLift);
}
