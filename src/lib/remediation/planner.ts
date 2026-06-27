/**
 * Upgraded Remediation Planner: determines framework, plans direct code patches,
 * compiles remediation plans, and generates code-aware markdown reports and PR templates.
 */

import { detectFramework, type RepoContext } from "../github/framework";
import { planIssueRemediation, type PatchPlanItem } from "./adapters";

// ── Types ────────────────────────────────────────────────────────────────────

export interface PlannerIssue {
  id: string;
  severity: string;
  category: string;
  elementSelector: string | null;
  description: string;
  fixSuggestion: string | null;
  fixDiff: { original?: string; patched?: string; selector?: string; type?: string } | null;
  verifiedFixStatus: string;
  source: string;
  confidence: string;
  ruleId: string | null;
  actualValue?: string | null;
  expectedValue?: string | null;
  pageUrl?: string | null;
}

export interface PlannerAudit {
  id: string;
  url: string;
  score: number | null;
  createdAt: string;
}

export interface RemediationPlan {
  included: PlannerIssue[];
  skipped: Array<{ issue: PlannerIssue; reason: string }>;
}

export interface CodePatchResult {
  issueId: string;
  ruleId: string;
  filePath: string;
  originalSnippet: string;
  patchedSnippet: string;
  explanation: string;
  success: boolean;
  error?: string;
}

export interface UpgradedRemediationPlan {
  framework: string;
  usesTailwind: boolean;
  candidateFiles: string[];
  confidence: string;
  patches: PatchPlanItem[];
}

// ── Fix eligibility ──────────────────────────────────────────────────────────

const FIXABLE_SOURCES = ["axe-core", "custom_heuristic", "merged", "deterministic"];
const FIXABLE_CONFIDENCE = ["high", "medium"];

export function isIssueAutoFixable(issue: PlannerIssue): boolean {
  const source = (issue.source || "").toLowerCase();
  const confidence = (issue.confidence || "medium").toLowerCase();

  if (!FIXABLE_SOURCES.includes(source)) return false;
  if (!FIXABLE_CONFIDENCE.includes(confidence)) return false;

  return !!(
    issue.fixSuggestion ||
    (issue.fixDiff && issue.fixDiff.original && issue.fixDiff.patched) ||
    issue.ruleId
  );
}

export function getUnsupportedReason(issue: PlannerIssue): string {
  const source = (issue.source || "").toLowerCase();
  const confidence = (issue.confidence || "medium").toLowerCase();

  if (source === "llm" || (!FIXABLE_SOURCES.includes(source) && source !== "")) {
    return "AI-only design suggestion — requires manual review";
  }

  if (!FIXABLE_CONFIDENCE.includes(confidence)) {
    return "Low confidence finding — requires manual verification";
  }

  if (!issue.fixSuggestion && !issue.fixDiff && !issue.ruleId) {
    return "No fix suggestion or rule mapping available";
  }

  return "Unable to generate automated remediation for this issue";
}

// ── Legacy Build Remediation Plan ────────────────────────────────────────────

export function buildRemediationPlan(
  audit: PlannerAudit,
  issues: PlannerIssue[]
): RemediationPlan {
  const included: PlannerIssue[] = [];
  const skipped: Array<{ issue: PlannerIssue; reason: string }> = [];

  for (const issue of issues) {
    if (isIssueAutoFixable(issue)) {
      included.push(issue);
    } else {
      skipped.push({
        issue,
        reason: getUnsupportedReason(issue),
      });
    }
  }

  return { included, skipped };
}

// ── Upgraded Framework-Aware Code Remediation Planner ────────────────────────

export async function buildCodeRemediationPlan(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  audit: PlannerAudit,
  issues: PlannerIssue[]
): Promise<UpgradedRemediationPlan> {
  // 1. Detect Framework
  const context = await detectFramework(token, owner, repo, branch);

  // 2. Route each issue through adapters
  const patches = issues.map((issue) => {
    // Map PlannerIssue to DiscoveryIssue shape
    const discoveryIssue = {
      id: issue.id,
      ruleId: issue.ruleId,
      elementSelector: issue.elementSelector,
      description: issue.description,
    };

    const plannedPatch = planIssueRemediation(discoveryIssue, context);

    // If an issue is fundamentally not eligible, override to report_only
    if (!isIssueAutoFixable(issue)) {
      return {
        ...plannedPatch,
        action: "report_only" as const,
        reason: getUnsupportedReason(issue),
      };
    }

    return plannedPatch;
  });

  return {
    framework: context.framework,
    usesTailwind: context.usesTailwind,
    candidateFiles: context.candidateFiles,
    confidence: context.confidence,
    patches,
  };
}

// ── Markdown Report Generation ───────────────────────────────────────────────

export function buildSafeRemediationMarkdown(
  audit: PlannerAudit,
  included: PlannerIssue[],
  skipped: Array<{ issue: PlannerIssue; reason: string }> = [],
  patchedResults: CodePatchResult[] = []
): string {
  const timestamp = new Date().toISOString();
  const shortId = audit.id.substring(0, 8);
  const successPatches = patchedResults.filter((p) => p.success);
  const failedPatches = patchedResults.filter((p) => !p.success);

  let md = `# UX-Auditor Remediation Report

> **Generated by [UX-Auditor](https://github.com/UX-Auditor)** — automated accessibility and UX analysis.

| Field | Value |
|-------|-------|
| **Audited URL** | ${audit.url} |
| **Audit Score** | ${audit.score !== null ? `${audit.score}/100` : "N/A"} |
| **Audit ID** | \`${audit.id}\` |
| **Created** | ${timestamp} |
| **Directly Patched** | ${successPatches.length} file(s) |
| **Manual Review Required** | ${included.length - successPatches.length} issue(s) |
| **Unsupported/Skipped** | ${skipped.length} issue(s) |

---

`;

  // 1. Directly Patched in this PR
  if (successPatches.length > 0) {
    md += `## 🛠️ Directly Patched Code Changes

The following fixes were automatically applied to the repository files:

`;

    for (let i = 0; i < successPatches.length; i++) {
      const patch = successPatches[i];
      const issue = included.find((x) => x.id === patch.issueId);
      const title = issue ? getIssueTitle(issue) : `Fix ${patch.ruleId}`;

      md += `### [Applied] ${i + 1}. ${title}

- **File Path:** \`${patch.filePath}\`
- **Rule ID:** \`${patch.ruleId}\`
- **Change Explanation:** ${patch.explanation}

**Code Difference:**
\`\`\`diff
- ${patch.originalSnippet.split("\n").join("\n- ")}
+ ${patch.patchedSnippet.split("\n").join("\n+ ")}
\`\`\`

`;
    }
    md += "---\n\n";
  }

  // 2. Needs Manual Review
  const manualIssues = included.filter((issue) => !successPatches.some((p) => p.issueId === issue.id));
  
  if (manualIssues.length > 0 || failedPatches.length > 0) {
    md += `## 🔍 Needs Manual Review

The following issues were selected but could not be safely patched automatically. Follow the recommendations below to apply them manually:

`;

    let counter = 1;

    // Show failed patches first
    for (const patch of failedPatches) {
      const issue = included.find((x) => x.id === patch.issueId);
      if (!issue) continue;
      const title = getIssueTitle(issue);
      const emoji = severityEmoji(issue.severity);

      md += `### ${counter++}. ${emoji} ${title} (Patch Skipped)

- **Target File:** \`${patch.filePath}\`
- **Reason Skipped:** *${patch.error || "Exact snippet matching failed"}*
- **Selector:** \`${issue.elementSelector || "Global"}\`

**Recommended Fix:**
${issue.fixSuggestion || "N/A"}

`;
      if (issue.fixDiff?.original) {
        md += `**Suggested Code Change:**
\`\`\`html
${issue.fixDiff.original}
-->
${issue.fixDiff.patched}
\`\`\`

`;
      }
      md += "\n";
    }

    // Show report-only issues
    for (const issue of manualIssues) {
      if (failedPatches.some((p) => p.issueId === issue.id)) continue;
      const title = getIssueTitle(issue);
      const emoji = severityEmoji(issue.severity);

      md += `### ${counter++}. ${emoji} ${title}

- **Severity:** ${issue.severity.toUpperCase()}
- **Selector:** ${issue.elementSelector ? `\`${issue.elementSelector}\`` : "Global"}
- **Source:** ${formatSource(issue.source)}

**Problem:**
${issue.description}

**Recommended Fix:**
${issue.fixSuggestion || "N/A"}

`;
      md += "\n";
    }

    md += "---\n\n";
  }

  // 3. Skipped / Ineligible
  if (skipped.length > 0) {
    md += `## skipped Unsupported Issues

The following findings were skipped because they require fully manual UX design review:

| Issue | Severity | Reason Skipped |
|-------|----------|----------------|
`;
    for (const { issue, reason } of skipped) {
      const title = getIssueTitle(issue);
      md += `| ${title} | ${issue.severity.toUpperCase()} | ${reason} |\n`;
    }
    md += "\n---\n\n";
  }

  // Implementation Checklist
  md += `## Implementation Checklist

- [ ] Review the automatic patches in this PR
- [ ] Apply the recommended manual fixes in your source files
- [ ] Run automated tests
- [ ] Re-run UX-Auditor to verify improvements
- [ ] Confirm WCAG / accessibility compliance

---

*Report generated by UX-Auditor. Audit ID: \`${shortId}\`*
`;

  return md;
}

// ── PR Title & Body ──────────────────────────────────────────────────────────

export function buildPullRequestTitle(
  audit: PlannerAudit,
  included: PlannerIssue[]
): string {
  const domain = extractDomain(audit.url);
  return `UX-Auditor remediation: ${included.length} issue(s) for ${domain}`;
}

export function buildPullRequestBody(
  audit: PlannerAudit,
  included: PlannerIssue[],
  skipped: Array<{ issue: PlannerIssue; reason: string }> = [],
  remediationFilePath: string,
  framework: string,
  patchedResults: CodePatchResult[] = []
): string {
  const successPatches = patchedResults.filter((p) => p.success);
  const manualCount = included.length - successPatches.length;

  let body = `## 🔍 UX-Auditor Framework-Aware Remediation

This PR was generated by **UX-Auditor** to address accessibility and usability issues found on **${audit.url}**.

### Remediation Details

| Metric | Value |
|--------|-------|
| **Audited URL** | ${audit.url} |
| **Audit Score** | ${audit.score !== null ? `${audit.score}/100` : "N/A"} |
| **Detected Framework** | \`${framework.toUpperCase()}\` |
| **Direct Code Patches Applied** | **${successPatches.length}** |
| **Manual Recommendations** | **${manualCount}** |
| **Unsupported Skipped Issues** | **${skipped.length}** |

`;

  // Changed files list
  if (successPatches.length > 0) {
    body += `### 🛠️ Automatically Patched Files

`;
    const files = Array.from(new Set(successPatches.map((p) => p.filePath)));
    for (const file of files) {
      body += `- \`${file}\`\n`;
    }
    body += "\n";
  }

  // Top fixes summary
  body += `### 📦 Included Fixes (${included.length})

`;
  for (const issue of included) {
    const isPatched = successPatches.some((p) => p.issueId === issue.id);
    const statusLabel = isPatched ? "✅ Patched" : "📝 Manual Review";
    body += `- **${getIssueTitle(issue)}** — *${statusLabel}* (${issue.severity.toUpperCase()})\n`;
  }
  body += "\n";

  // Skipped issues
  if (skipped.length > 0) {
    body += `### ⏭️ Skipped Issues (${skipped.length})

These issues require manual design adjustments:

`;
    for (const { issue, reason } of skipped.slice(0, 5)) {
      body += `- **${getIssueTitle(issue)}** — ${reason}\n`;
    }
    if (skipped.length > 5) {
      body += `- ... and ${skipped.length - 5} more\n`;
    }
    body += "\n";
  }

  body += `### 📄 Remediation Report

The complete detailed remediation report with diffs is at:
**\`${remediationFilePath}\`**

### ✅ Review Checklist

- [ ] Review code patches in this PR
- [ ] Apply/verify manual source changes
- [ ] Run tests (ensure build passes)
- [ ] Re-run UX-Auditor to verify improvements
- [ ] Confirm visual/accessibility behavior

---

*Generated by [UX-Auditor](https://github.com/UX-Auditor)*
`;

  return body;
}

// ── Helper functions ─────────────────────────────────────────────────────────

function getIssueTitle(issue: PlannerIssue): string {
  const ruleId = issue.ruleId || "";
  const desc = issue.description || "";

  const ruleMap: Record<string, string> = {
    "color-contrast": "Text contrast is too low",
    "small-touch-target": "Touch target is too small",
    "target-size": "Touch target is too small",
    "missing-label": "Form field is missing a label",
    "broken-link": "Broken link detected",
    "slow-load-time": "Page load time is slow",
    "button-name": "Buttons need accessible names",
    "image-alt": "Images need alternative text",
    "link-name": "Links need discernible text",
    "label": "Form elements need labels",
    "document-title": "Document must have a title",
    "html-has-lang": "HTML must have a language attribute",
  };

  if (ruleId && ruleMap[ruleId]) return ruleMap[ruleId];

  if (ruleId) {
    return ruleId
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  return desc.substring(0, 60) + (desc.length > 60 ? "..." : "");
}

function severityEmoji(severity: string): string {
  switch (severity.toLowerCase()) {
    case "critical": return "🔴";
    case "serious": return "🟠";
    case "moderate": return "🟡";
    case "minor": return "🔵";
    default: return "⚪";
  }
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function formatSource(source: string): string {
  switch (source.toLowerCase()) {
    case "axe-core": return "WCAG / axe-core";
    case "custom_heuristic": return "Custom UX Rule";
    case "llm": return "AI Suggestion";
    case "merged": return "Merged Findings";
    case "deterministic": return "Deterministic";
    default: return source;
  }
}
