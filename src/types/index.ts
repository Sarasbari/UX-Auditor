export type Severity = "critical" | "serious" | "moderate" | "minor";
export type IssueCategory = "accessibility" | "ux_heuristic" | "design_quality" | "custom_rule";
export type FixStatus = "pending" | "success" | "failed" | "not_applicable";
export type IssueSource = "deterministic" | "llm" | "merged";
export type AuditStatus = "queued" | "processing" | "capturing" | "analyzing" | "merging" | "verifying_fixes" | "completed" | "failed";

export interface DeterministicFinding {
  ruleId: string;
  engine: "axe-core" | "impeccable";
  severity: Severity;
  category: IssueCategory;
  elementSelector: string;
  description: string;
  fixSuggestion: string;
  domSnippet?: string;
}

export interface LLMFinding {
  heuristicId: string;
  severity: Severity;
  category: IssueCategory;
  score: number;
  justification: string;
  affectedElements: string[];
  suggestedImprovement: string;
}

export interface MergedIssue {
  id: string;
  severity: Severity;
  category: IssueCategory;
  elementSelector: string | null;
  description: string;
  fixSuggestion: string;
  fixDiff: FixDiff | null;
  verifiedFixStatus: FixStatus;
  source: IssueSource;
  sources: string[];
  screenshots: {
    original?: string;
    patched?: string;
    highlighted?: string;
  };
}

export interface FixDiff {
  type: "dom_patch" | "code_patch";
  original: string;
  patched: string;
  selector: string;
  attributeName?: string;
  attributeValue?: string;
}

export interface AuditReport {
  id: string;
  url: string;
  status: AuditStatus;
  score: number | null;
  issues: MergedIssue[];
  screenshots: Record<string, string>;
  domSnapshotUrl: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citedIssueIds: string[];
  createdAt: string;
}

export interface AuditRequest {
  url: string;
  projectId?: string;
}

export interface AuditJobData {
  auditRunId: string;
  url: string;
  userId: string;
}

// ── GitHub Remediation Types ─────────────────────────────────────────────────

export interface GitHubRepoInfo {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  private: boolean;
  defaultBranch: string;
}

export interface GitHubBranchInfo {
  name: string;
  protected: boolean;
}

export interface RemediationRequest {
  repo: string;
  baseBranch: string;
  issueIds: string[];
  mode: "safe" | "direct_if_possible";
}

export interface RemediationResponse {
  prUrl: string;
  prNumber: number;
  branchName: string;
  commitSha: string;
  includedIssues: string[];
  skippedIssues: Array<{ id: string; reason: string }>;
  patchedResults?: Array<{
    issueId: string;
    ruleId: string;
    filePath: string;
    originalSnippet: string;
    patchedSnippet: string;
    explanation: string;
    success: boolean;
    error?: string;
  }>;
}

export interface PatchPlanItem {
  issueId: string;
  ruleId: string | null;
  targetFile: string | null;
  confidence: "high" | "medium" | "low";
  action: "direct_patch_ready" | "report_only";
  reason: string;
}

export interface UpgradedRemediationPlan {
  framework: string;
  usesTailwind: boolean;
  candidateFiles: string[];
  confidence: string;
  patches: PatchPlanItem[];
}

export type RemediationStep =
  | "connecting"
  | "loading_repos"
  | "loading_plan"
  | "creating_branch"
  | "committing"
  | "opening_pr"
  | "complete"
  | "error";


