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
