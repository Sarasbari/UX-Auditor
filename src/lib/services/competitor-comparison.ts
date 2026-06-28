import { estimateIssueScoreDelta } from "./score-delta";
import { getIssueTitle } from "./executive-report";

export interface CompetitorComparison {
  winner: "primary" | "competitor" | "tie";
  scoreGap: number;
  summary: string;
  wherePrimaryWins: string[];
  whereCompetitorWins: string[];
  topOpportunities: Array<{
    title: string;
    reason: string;
    relatedIssueIds: string[];
  }>;
  categoryBreakdown: Array<{
    category: string;
    primaryCount: number;
    competitorCount: number;
    primaryRisk: "Low" | "Medium" | "High";
    competitorRisk: "Low" | "Medium" | "High";
  }>;
  executiveTakeaway: string;
}

export function buildCompetitorComparison(primaryAudit: any, competitorAudit: any): CompetitorComparison {
  const primaryScore = primaryAudit.score ?? 70;
  const competitorScore = competitorAudit.score ?? 70;

  const scoreGap = Math.abs(primaryScore - competitorScore);
  let winner: "primary" | "competitor" | "tie" = "tie";
  if (primaryScore > competitorScore) winner = "primary";
  else if (competitorScore > primaryScore) winner = "competitor";

  const primaryIssues = primaryAudit.issues || [];
  const competitorIssues = competitorAudit.issues || [];

  // Group issues by category
  const categoriesList = ["accessibility", "design_quality", "ux_heuristic"];
  const getCategoryName = (c: string) => {
    const clean = c.toLowerCase();
    if (clean.includes("access")) return "accessibility";
    if (clean.includes("design")) return "design_quality";
    return "ux_heuristic";
  };

  const getCleanLabel = (cat: string) => {
    if (cat === "accessibility") return "Accessibility";
    if (cat === "design_quality") return "Design Quality";
    return "UX Heuristics";
  };

  const primaryCatCounts: Record<string, number> = { accessibility: 0, design_quality: 0, ux_heuristic: 0 };
  const competitorCatCounts: Record<string, number> = { accessibility: 0, design_quality: 0, ux_heuristic: 0 };

  primaryIssues.forEach((i: any) => {
    const cat = getCategoryName(i.category || "");
    primaryCatCounts[cat] = (primaryCatCounts[cat] || 0) + 1;
  });

  competitorIssues.forEach((i: any) => {
    const cat = getCategoryName(i.category || "");
    competitorCatCounts[cat] = (competitorCatCounts[cat] || 0) + 1;
  });

  const getRiskLevel = (count: number, hasSerious: boolean): "Low" | "Medium" | "High" => {
    if (count === 0) return "Low";
    if (hasSerious || count >= 5) return "High";
    return "Medium";
  };

  const primaryHasSeriousByCat = (cat: string) => {
    return primaryIssues.some((i: any) => 
      getCategoryName(i.category || "") === cat && 
      ["critical", "serious"].includes((i.severity || "").toLowerCase())
    );
  };

  const competitorHasSeriousByCat = (cat: string) => {
    return competitorIssues.some((i: any) => 
      getCategoryName(i.category || "") === cat && 
      ["critical", "serious"].includes((i.severity || "").toLowerCase())
    );
  };

  const categoryBreakdown = categoriesList.map(cat => {
    const pCount = primaryCatCounts[cat] || 0;
    const cCount = competitorCatCounts[cat] || 0;
    return {
      category: getCleanLabel(cat),
      primaryCount: pCount,
      competitorCount: cCount,
      primaryRisk: getRiskLevel(pCount, primaryHasSeriousByCat(cat)),
      competitorRisk: getRiskLevel(cCount, competitorHasSeriousByCat(cat)),
    };
  });

  // Where Primary Wins / Competitor Wins
  const wherePrimaryWins: string[] = [];
  const whereCompetitorWins: string[] = [];

  // Compare categories
  categoriesList.forEach(cat => {
    const pCount = primaryCatCounts[cat] || 0;
    const cCount = competitorCatCounts[cat] || 0;
    const label = getCleanLabel(cat);
    
    if (pCount < cCount) {
      wherePrimaryWins.push(`Fewer issues detected in ${label} compared to competitor.`);
    } else if (cCount < pCount) {
      whereCompetitorWins.push(`Fewer issues detected in ${label} compared to your product.`);
    }
  });

  if (primaryScore > competitorScore) {
    wherePrimaryWins.push(`Higher overall UX score (+${scoreGap} points higher).`);
  } else if (competitorScore > primaryScore) {
    whereCompetitorWins.push(`Higher overall UX score (+${scoreGap} points higher).`);
  }

  // Fallbacks if lists are empty
  if (wherePrimaryWins.length === 0) {
    wherePrimaryWins.push("No significant advantages detected in this run.");
  }
  if (whereCompetitorWins.length === 0) {
    whereCompetitorWins.push("No significant competitor advantages detected.");
  }

  // Top Opportunities: Sort primary fixes by delta, check if competitor has fewer issues of this ruleId or type
  const sortedPrimaryIssues = [...primaryIssues]
    .map(issue => {
      const delta = typeof issue.scoreDelta === "number" ? issue.scoreDelta : estimateIssueScoreDelta(issue);
      return { ...issue, calculatedDelta: delta };
    })
    .sort((a, b) => b.calculatedDelta - a.calculatedDelta);

  const topOpportunities = sortedPrimaryIssues.slice(0, 3).map(issue => {
    const title = getIssueTitle(issue);
    const reason = issue.fixSuggestion || `Resolving this issue would lift your UX score by an estimated +${issue.calculatedDelta} points.`;
    return {
      title,
      reason,
      relatedIssueIds: [issue.id],
    };
  });

  // Summary & Takeaway
  let summary = "";
  let executiveTakeaway = "";

  const primaryName = "Your Product";
  const competitorName = "Competitor";

  if (winner === "primary") {
    summary = `${primaryName} leads ${competitorName} by ${scoreGap} points.`;
    executiveTakeaway = `Your product has a stronger usability profile than the competitor with an overall score of ${primaryScore} vs ${competitorScore}. Focus on wrapping up the remaining top opportunities to widen your competitive lead.`;
  } else if (winner === "competitor") {
    summary = `${competitorName} leads ${primaryName} by ${scoreGap} points.`;
    executiveTakeaway = `The competitor currently leads by ${scoreGap} points due to lower density of high-severity layout and accessibility issues. Remediating your primary risk areas will close the score gap and elevate your product's user experience.`;
  } else {
    summary = `Both products are tied with a score of ${primaryScore}.`;
    executiveTakeaway = `The overall usability is closely matched. Addressing the top opportunities listed below represents a clear path to outperform the competitor.`;
  }

  return {
    winner,
    scoreGap,
    summary,
    wherePrimaryWins,
    whereCompetitorWins,
    topOpportunities,
    categoryBreakdown,
    executiveTakeaway
  };
}
