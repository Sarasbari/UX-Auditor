import { estimateIssueScoreDelta } from "./score-delta";
import { getIssueTitle, getIssueImpact } from "./executive-report";

export interface SimulatedFix {
  issueId: string;
  title: string;
  severity: string;
  scoreDelta: number;
  beforeSummary: string;
  afterSummary: string;
  implementationHint: string;
  visualChangeType: "contrast" | "spacing" | "cta" | "label" | "layout" | "readability" | "navigation" | "generic";
  beforeCode?: string | null;
  afterCode?: string | null;
}

export function buildSimulatedFixes(
  audit: {
    inputType?: string | null;
    uploadedImageUrl?: string | null;
    issues: Array<any>;
  },
  issueIds: string[]
): SimulatedFix[] {
  const issues = audit.issues || [];
  const selectedIssues = issues.filter(i => issueIds.includes(i.id));
  const isScreenshot = audit.inputType === "SCREENSHOT";

  return selectedIssues.map(issue => {
    const title = getIssueTitle(issue);
    const scoreDelta = typeof issue.scoreDelta === "number" ? issue.scoreDelta : estimateIssueScoreDelta(issue);
    const beforeSummary = issue.description || "No description available.";
    
    let afterSummary = "No proposed fix details available.";
    if (issue.fixSuggestion) {
      afterSummary = issue.fixSuggestion.startsWith("After:") 
        ? issue.fixSuggestion 
        : `After: ${issue.fixSuggestion}`;
    }

    let implementationHint = "";
    const hasFixDiff = !!(issue.fixDiff && issue.fixDiff.original && issue.fixDiff.patched);
    if (!isScreenshot) {
      if (hasFixDiff) {
        implementationHint = "Use the suggested code patch below.";
      } else {
        implementationHint = "Apply this UI/accessibility change in the component that renders the affected element.";
      }
    } else {
      implementationHint = "Use this as visual design guidance; connect a URL/repository to generate verified code changes.";
    }

    const ruleId = (issue.ruleId || "").toLowerCase();
    const description = (issue.description || "").toLowerCase();
    
    let visualChangeType: SimulatedFix["visualChangeType"] = "generic";
    if (ruleId.includes("contrast") || description.includes("contrast")) {
      visualChangeType = "contrast";
    } else if (ruleId.includes("target-size") || ruleId.includes("touch-target") || ruleId.includes("spacing") || description.includes("target") || description.includes("size")) {
      visualChangeType = "spacing";
    } else if (ruleId.includes("cta") || description.includes("cta") || description.includes("call to action") || description.includes("call-to-action")) {
      visualChangeType = "cta";
    } else if (ruleId.includes("label") || description.includes("label")) {
      visualChangeType = "label";
    } else if (ruleId.includes("layout") || ruleId.includes("hierarchy") || description.includes("layout") || description.includes("hierarchy")) {
      visualChangeType = "layout";
    } else if (ruleId.includes("readability") || description.includes("readability") || description.includes("font") || description.includes("text")) {
      visualChangeType = "readability";
    } else if (ruleId.includes("navigation") || ruleId.includes("link") || description.includes("navigation") || description.includes("link")) {
      visualChangeType = "navigation";
    }

    const beforeCode = hasFixDiff ? issue.fixDiff.original : null;
    const afterCode = hasFixDiff ? issue.fixDiff.patched : null;

    return {
      issueId: issue.id,
      title,
      severity: issue.severity || "moderate",
      scoreDelta,
      beforeSummary,
      afterSummary,
      implementationHint,
      visualChangeType,
      beforeCode,
      afterCode
    };
  });
}
