import { estimateIssueScoreDelta, estimateSelectedScore } from "./score-delta";

export interface ExecutiveReport {
  verdict: string;
  oneLineSummary: string;
  scoreLabel: string;
  riskLevel: "Low" | "Medium" | "High";
  topRisks: Array<{
    title: string;
    severity: string;
    explanation: string;
  }>;
  topImpactFixes: Array<{
    issueId: string;
    title: string;
    scoreDelta: number;
    reason: string;
  }>;
  predictedScoreAfterTopFixes: number | null;
  businessImpact: string[];
  accessibilityImpact: string[];
  demoNarrative: string;
}

// Replicate or share helper logic from page.tsx to ensure perfect match
export function getIssueTitle(issue: any): string {
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
  if (ruleId === "html-has-lang") return "HTML must have a language attribute";
  
  const descLower = description.toLowerCase();
  if (descLower.includes("contrast")) return "Text contrast is too low";
  if (descLower.includes("tap target") || descLower.includes("touch target") || descLower.includes("size")) return "Touch target is too small";
  if (descLower.includes("label")) return "Form field is missing a label";
  if (descLower.includes("broken link")) return "Broken link detected";
  
  if (ruleId) {
    return ruleId.split("-").map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  }
  return description.substring(0, 50) + (description.length > 50 ? "..." : "");
}

export function getIssueImpact(issue: any): string {
  const ruleId = issue.ruleId || "";
  const description = issue.description || "";
  
  if (ruleId === "color-contrast") return "Low contrast can make this text difficult to read.";
  if (ruleId === "small-touch-target" || ruleId === "target-size") return "Small tap areas can cause mis-taps on mobile.";
  if (ruleId === "missing-label" || ruleId === "label") return "Form field lacks a label, making it hard to fill out.";
  if (ruleId === "broken-link") return "Users will encounter a dead end or error page.";
  if (ruleId === "slow-load-time") return "Page load time is slow";
  
  if (ruleId === "button-name") return "Screen reader users may not understand what this button does.";
  if (ruleId === "image-alt") return "Screen readers cannot describe this image to visually impaired users.";
  if (ruleId === "link-name") return "Screen readers cannot announce where this link goes.";
  
  const descLower = description.toLowerCase();
  if (descLower.includes("contrast")) return "Low contrast can make this text difficult to read.";
  if (descLower.includes("tap target") || descLower.includes("touch target") || descLower.includes("size")) return "Small tap areas can cause mis-taps on mobile.";
  if (descLower.includes("label")) return "Form field lacks a label, making it hard to fill out.";
  if (descLower.includes("broken link")) return "Users will encounter a dead end or error page.";
  
  return "This issue affects usability or accessibility standards.";
}

export function buildExecutiveReport(audit: {
  score: number | null;
  inputType?: string | null;
  url?: string | null;
  issues: Array<any>;
}): ExecutiveReport {
  const score = audit.score;
  const issues = audit.issues || [];
  const inputType = audit.inputType || "";
  const isScreenshot = inputType === "SCREENSHOT";

  // 1. riskLevel
  const isAccessibility = (issue: any) => (issue.category || "").toLowerCase() === "accessibility";
  const severityLower = (issue: any) => (issue.severity || "").toLowerCase();
  
  const hasCriticalOrSeriousA11y = issues.some(i => 
    isAccessibility(i) && (severityLower(i) === "critical" || severityLower(i) === "serious")
  );
  
  const seriousOrModerateCount = issues.filter(i => 
    severityLower(i) === "critical" || severityLower(i) === "serious" || severityLower(i) === "moderate"
  ).length;

  let riskLevel: "Low" | "Medium" | "High" = "Low";
  if ((score !== null && score < 60) || hasCriticalOrSeriousA11y) {
    riskLevel = "High";
  } else if ((score !== null && score < 80) || seriousOrModerateCount >= 2) {
    riskLevel = "Medium";
  }

  // 2. scoreLabel
  let scoreLabel = "High-risk UX";
  if (score !== null) {
    if (score >= 90) scoreLabel = "Excellent";
    else if (score >= 75) scoreLabel = "Good but improvable";
    else if (score >= 50) scoreLabel = "Needs focused fixes";
    else scoreLabel = "High-risk UX";
  }

  // 3. topRisks
  const severityWeight = (s: string) => {
    const clean = s.toLowerCase();
    if (clean === "critical") return 4;
    if (clean === "serious") return 3;
    if (clean === "moderate") return 2;
    if (clean === "minor") return 1;
    return 0;
  };
  const confidenceWeight = (c: string) => {
    const clean = c.toLowerCase();
    if (clean === "high") return 3;
    if (clean === "medium") return 2;
    if (clean === "low") return 1;
    return 0;
  };

  const sortedForRisks = [...issues].sort((a, b) => {
    const sevA = severityWeight(a.severity || "");
    const sevB = severityWeight(b.severity || "");
    if (sevB !== sevA) return sevB - sevA;

    const deltaA = typeof a.scoreDelta === "number" ? a.scoreDelta : estimateIssueScoreDelta(a);
    const deltaB = typeof b.scoreDelta === "number" ? b.scoreDelta : estimateIssueScoreDelta(b);
    if (deltaB !== deltaA) return deltaB - deltaA;

    const confA = confidenceWeight(a.confidence || "");
    const confB = confidenceWeight(b.confidence || "");
    return confB - confA;
  });

  const topRisks = sortedForRisks.slice(0, 3).map(issue => ({
    title: getIssueTitle(issue),
    severity: (issue.severity || "moderate").charAt(0).toUpperCase() + (issue.severity || "moderate").slice(1).toLowerCase(),
    explanation: issue.description || getIssueImpact(issue)
  }));

  // 4. topImpactFixes
  const sortedForFixes = [...issues].sort((a, b) => {
    const deltaA = typeof a.scoreDelta === "number" ? a.scoreDelta : estimateIssueScoreDelta(a);
    const deltaB = typeof b.scoreDelta === "number" ? b.scoreDelta : estimateIssueScoreDelta(b);
    if (deltaB !== deltaA) return deltaB - deltaA;

    const sevA = severityWeight(a.severity || "");
    const sevB = severityWeight(b.severity || "");
    return sevB - sevA;
  });

  const topImpactFixes = sortedForFixes.slice(0, 3).map(issue => {
    const delta = typeof issue.scoreDelta === "number" ? issue.scoreDelta : estimateIssueScoreDelta(issue);
    let fixDesc = issue.fixSuggestion || "";
    if (!fixDesc) {
      if (isScreenshot) {
        fixDesc = "Apply design adjustments to align with standard web usability guidelines.";
      } else {
        fixDesc = "Remediate DOM attributes and markup configuration to resolve standard conformance check.";
      }
    }
    return {
      issueId: issue.id,
      title: getIssueTitle(issue),
      scoreDelta: delta,
      reason: fixDesc
    };
  });

  // 5. predictedScoreAfterTopFixes
  const predictedScoreAfterTopFixes = estimateSelectedScore(
    score,
    issues,
    topImpactFixes.map(f => f.issueId)
  );

  // 6. verdict, oneLineSummary
  const hasContrast = issues.some(i => (i.ruleId === "color-contrast" || (i.description || "").toLowerCase().includes("contrast")));
  const hasTouch = issues.some(i => (i.ruleId === "small-touch-target" || i.ruleId === "target-size" || (i.description || "").toLowerCase().includes("target") || (i.description || "").toLowerCase().includes("size")));
  const hasA11y = issues.some(i => (i.category || "").toLowerCase() === "accessibility");

  const frictionPoints: string[] = [];
  if (hasContrast) frictionPoints.push("contrast risk");
  if (hasTouch) frictionPoints.push("touch-target sizing");
  if (hasA11y) frictionPoints.push("accessibility friction");
  if (frictionPoints.length === 0) frictionPoints.push("layout hierarchy");

  let oneLineSummary = "";
  let verdict = "";

  if (issues.length === 0) {
    oneLineSummary = "Excellent user experience profile with no detectable usability issues.";
    verdict = "The user experience meets standards. The interface is clean, intuitive, and accessibility-compliant.";
  } else {
    oneLineSummary = `This page is usable, but conversion clarity is weakened by ${frictionPoints.join(", and ")}.`;
    if (isScreenshot) {
      if (riskLevel === "High") {
        verdict = "High-risk visual usability gaps detected. Key design elements are poorly positioned or lack sufficient contrast, threatening user task completion.";
      } else if (riskLevel === "Medium") {
        verdict = "Moderate layout friction present. Visual structure is mostly consistent, but minor design adjustments are recommended to optimize navigation.";
      } else {
        verdict = "Low-risk design layout. Minor visual adjustments will elevate polish, but the page is highly functional.";
      }
    } else {
      if (riskLevel === "High") {
        verdict = "Critical compliance barriers detected in the DOM structure. Keyboard navigability, screen-reader markup, or color ratios require immediate remediation.";
      } else if (riskLevel === "Medium") {
        verdict = "Moderate accessibility and structure gaps found. The interface functions well, but DOM-level details require attention to ensure universal access.";
      } else {
        verdict = "Minor compliance and usability suggestions only. The website has a strong foundation and meets most standard WCAG rules.";
      }
    }
  }

  // 7. businessImpact
  const businessImpact: string[] = [];
  if (hasTouch) {
    businessImpact.push("Tap targets that are too small increase mobile drop-off and form abandonment rates.");
  }
  if (hasContrast) {
    businessImpact.push("Low text contrast increases cognitive fatigue, leading to higher bounce rates and reduced session duration.");
  }
  if (hasA11y) {
    businessImpact.push("Accessibility friction prevents assistive technology users from completing checkout or sign-up flows, limiting market reach.");
  }
  if (businessImpact.length < 2) {
    businessImpact.push("Visual hierarchy misalignment weakens secondary call-to-actions, reducing user engagement with high-value features.");
  }
  if (businessImpact.length < 3) {
    businessImpact.push("Unresolved usability friction increases user frustration, impacting customer retention and brand perception.");
  }

  // 8. accessibilityImpact (Accessibility / Design Risk)
  const accessibilityImpact: string[] = [];
  if (isScreenshot) {
    accessibilityImpact.push("Visual findings are screenshot-based estimates. No DOM structure was verified, so actual screen-reader behavior is unknown.");
    if (hasContrast) {
      accessibilityImpact.push("Low-contrast design elements threaten readability for low-vision and colorblind users.");
    }
    if (hasTouch) {
      accessibilityImpact.push("Under-sized buttons and links create physical navigation barriers for users with motor impairments or those on mobile devices.");
    }
    if (accessibilityImpact.length < 2) {
      accessibilityImpact.push("Visual layout density should be optimized to reduce cognitive load and avoid overwhelming visitors.");
    }
  } else {
    // Live URL Audit
    accessibilityImpact.push("Audit verified with DOM evidence, including custom heuristics and axe-core compliance rules.");
    if (hasA11y) {
      accessibilityImpact.push("Missing form labels or non-discernible interactive element names block assistive technology users completely.");
    }
    if (hasContrast) {
      accessibilityImpact.push("Text contrast ratios fail standard WCAG 2.1 AA benchmarks, creating a readability risk for visually impaired users.");
    }
    if (hasTouch) {
      accessibilityImpact.push("Tap targets are smaller than recommended touch dimensions, affecting mobile responsiveness and navigation safety.");
    }
    if (accessibilityImpact.length < 2) {
      accessibilityImpact.push("Missing landmark attributes slow down keyboard-only navigation users.");
    }
  }

  // 9. demoNarrative
  const auditTypeStr = isScreenshot ? "Visual Screenshot Audit" : "Live URL Audit";
  const liftStr = (score !== null && predictedScoreAfterTopFixes !== null) 
    ? `+${predictedScoreAfterTopFixes - score}` 
    : "+0";
  const topFixesStr = topImpactFixes.map((f, i) => `${i + 1}. ${f.title}`).join(", ");
  
  let typeDisclaimer = "";
  if (isScreenshot) {
    typeDisclaimer = "Visual findings are screenshot-based and represent design recommendations.";
  } else {
    typeDisclaimer = "Findings include direct DOM evidence with verified remediation paths.";
  }

  const demoNarrative = `To demonstrate this interface's user experience to stakeholders, we ran a ${auditTypeStr}. The audit evaluated the layout and returned a usability score of ${score !== null ? score : "N/A"} out of 100, indicating ${scoreLabel.toLowerCase()} with a ${riskLevel.toLowerCase()} risk profile. The primary friction points are centered on ${frictionPoints.join(", and ")}. By focusing engineering resources on our highest-impact recommendations—specifically: ${topFixesStr || "None"}—we can raise the usability score to ${predictedScoreAfterTopFixes !== null ? predictedScoreAfterTopFixes : "N/A"}. This represents a potential lift of ${liftStr} points, turning user friction into a high-converting, compliant experience. ${typeDisclaimer}`;

  return {
    verdict,
    oneLineSummary,
    scoreLabel,
    riskLevel,
    topRisks,
    topImpactFixes,
    predictedScoreAfterTopFixes,
    businessImpact,
    accessibilityImpact,
    demoNarrative
  };
}
