import { randomUUID } from "crypto";

export interface RawIssue {
  id: string;
  severity: string;
  category: string;
  elementSelector: string | null;
  description: string;
  fixSuggestion: string | null;
  fixDiff?: any;
  verifiedFixStatus: string;
  source: string;
  confidence?: string;
  actualValue?: string | null;
  expectedValue?: string | null;
  viewport?: string | null;
  ruleId?: string | null;
  sampleElements?: any;
  pageUrl?: string | null;
  scoreDelta?: number | null;
}

/**
 * Normalizes an element selector by removing dynamic class name hashes
 * and collapsing long, redundant paths.
 */
export function normalizeSelector(selector: string | null): string {
  if (!selector) return "";

  return selector
    .split(/\s*>\s*|\s+/)
    .map((part) => {
      // Remove Next.js / CSS modules hashes (e.g. className_12abc_3 or className_xyz12)
      let cleaned = part.replace(/_[a-zA-Z0-9]{5,10}\b/g, "_hash");
      // Remove Emotion / Styled Components dynamic hashes (e.g. .css-1abc123)
      cleaned = cleaned.replace(/\.css-[a-zA-Z0-9]+/g, ".css-hash");
      // Remove Vite/React/JSX hashes (e.g. .jsx-12345)
      cleaned = cleaned.replace(/\.jsx-[0-9]+/g, ".jsx-hash");

      // Replace generic generated/hashed classes (alphanumeric, length 5-10, with mixed case/numbers)
      cleaned = cleaned.replace(/\.([a-zA-Z0-9_-]+)/g, (match, className) => {
        if (className === "css-hash" || className === "jsx-hash" || className === "class-hash") {
          return match;
        }
        const hasNumbers = /[0-9]/.test(className);
        const hasUpperAndLower = /[a-z]/.test(className) && /[A-Z]/.test(className);
        if (hasNumbers || hasUpperAndLower || className.length > 8) {
          return ".class-hash";
        }
        return match;
      });

      return cleaned;
    })
    .join(" > ");
}

/**
 * Normalizes text content for grouping (lowercases and collapses numbers).
 */
function normalizeText(text: string): string {
  return (text || "")
    .toLowerCase()
    .replace(/[0-9]+/g, "N")
    .trim();
}

/**
 * Parses numeric values out of actualValue/contrast ratios (e.g. "3.2:1" or "24px").
 */
function parseNumericValue(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.match(/([0-9.]+)/);
  if (match) {
    const num = parseFloat(match[1]);
    return isNaN(num) ? null : num;
  }
  return null;
}

/**
 * Deduplicates and groups repeated findings into single grouped issues
 * containing all sample elements and summarized descriptions.
 */
export function deduplicateIssues(issues: RawIssue[]): RawIssue[] {
  if (!issues || issues.length === 0) return [];

  const groups = new Map<string, RawIssue[]>();

  for (const issue of issues) {
    const rule = (issue.ruleId || "").toLowerCase();
    const severity = (issue.severity || "").toLowerCase();
    const category = (issue.category || "").toLowerCase();
    const source = (issue.source || "").toLowerCase();
    const normalizedDesc = normalizeText(issue.description).substring(0, 80);

    // Grouping Key
    const key = `${rule}|${severity}|${category}|${source}|${normalizedDesc}`;

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(issue);
  }

  const result: RawIssue[] = [];

  for (const [key, group] of groups.entries()) {
    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }

    const parent = group[0];

    // Determine worst actual value (minimum ratio/size represents the worst finding)
    let worstActual = parent.actualValue;
    let worstNum: number | null = null;

    // Build merged sample elements list
    const mergedSamples: any[] = [];

    for (const item of group) {
      // Track worst measured value
      const num = parseNumericValue(item.actualValue);
      if (num !== null) {
        if (worstNum === null || num < worstNum) {
          worstNum = num;
          worstActual = item.actualValue;
        }
      }

      // Add to sample elements
      if (item.sampleElements) {
        const parsed = typeof item.sampleElements === "string" 
          ? JSON.parse(item.sampleElements) 
          : item.sampleElements;
        if (Array.isArray(parsed)) {
          mergedSamples.push(...parsed);
          continue;
        }
      }

      mergedSamples.push({
        selector: item.elementSelector || "Unknown Element",
        text: item.description.substring(0, 100),
        html: item.elementSelector || "N/A",
        url: item.pageUrl || "",
      });
    }

    // Generate clean summarized description matching rule guidelines
    let description = parent.description;
    const ruleId = parent.ruleId || "";
    const count = group.length;

    if (ruleId === "color-contrast") {
      description = `${count} text elements have contrast below WCAG recommendation. Worst ratio: ${worstActual || "N/A"}. Expected: at least ${parent.expectedValue || "4.5:1"}.`;
    } else if (ruleId === "target-size" || ruleId === "small-touch-target") {
      description = `${count} interactive elements are smaller than the recommended touch target size of 44x44px.`;
    } else if (ruleId === "button-name") {
      description = `${count} buttons do not have accessible names.`;
    } else if (ruleId === "link-name") {
      description = `${count} links do not have discernible text.`;
    } else if (ruleId === "label" || ruleId === "missing-label") {
      description = `${count} form fields are missing labels.`;
    } else {
      description = `${count} instances of this issue detected: ${parent.description}`;
    }

    // Combine selectors for elements
    const uniqueSelectors = Array.from(new Set(group.map(item => item.elementSelector).filter(Boolean)));
    const elementSelector = uniqueSelectors.length > 0 ? uniqueSelectors[0] : parent.elementSelector;

    // Create the merged issue record
    const mergedIssue: RawIssue = {
      ...parent,
      id: parent.id || randomUUID(),
      elementSelector,
      description,
      actualValue: worstActual,
      sampleElements: mergedSamples,
    };

    result.push(mergedIssue);
  }

  return result;
}

/**
 * Calculates the overall audit score using a diminishing penalty algorithm
 * to prevent duplicate rules from unfairly destroying the score.
 */
export function calculateDiminishingScore(issues: RawIssue[]): number {
  if (!issues || issues.length === 0) return 100;

  let totalPenalty = 0;
  
  // Group issues by Rule/Finding Category to apply limits
  const penaltiesByRule = new Map<string, { count: number; severity: string }>();

  for (const issue of issues) {
    const ruleId = issue.ruleId || "generic-rule";
    const key = `${ruleId}|${issue.severity.toLowerCase()}`;
    
    let count = 1;
    // If the issue was already grouped/deduplicated by us, read the count
    if (issue.sampleElements && Array.isArray(issue.sampleElements)) {
      count = issue.sampleElements.length;
    }

    if (!penaltiesByRule.has(key)) {
      penaltiesByRule.set(key, { count: 0, severity: issue.severity });
    }
    penaltiesByRule.get(key)!.count += count;
  }

  // Calculate diminishing returns penalty per rule
  for (const [key, data] of penaltiesByRule.entries()) {
    const severity = data.severity.toLowerCase();
    const count = data.count;

    let firstPenalty = 0;
    let additionalPenalty = 0;
    let cap = 0;

    switch (severity) {
      case "critical":
        firstPenalty = 15;
        additionalPenalty = 1.5;
        cap = 30;
        break;
      case "serious":
        firstPenalty = 8;
        additionalPenalty = 0.8;
        cap = 18;
        break;
      case "moderate":
        firstPenalty = 4;
        additionalPenalty = 0.4;
        cap = 10;
        break;
      case "minor":
      default:
        firstPenalty = 1;
        additionalPenalty = 0.1;
        cap = 3;
        break;
    }

    // Penalty = firstInstance + (additionalInstances * diminishingFactor)
    const rulePenalty = firstPenalty + (count - 1) * additionalPenalty;
    totalPenalty += Math.min(cap, rulePenalty);
  }

  // Cap total overall penalty to ensure a baseline UX score is possible
  const finalScore = 100 - totalPenalty;

  return Math.max(0, Math.min(100, Math.round(finalScore)));
}
