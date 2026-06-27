"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { SeverityBadge, FixBadge, SourceBadge, ConfidenceBadge, ScoreDisplay, StatusIndicator } from "@/components/ui/badges";
import type { GitHubRepoInfo, GitHubBranchInfo, RemediationResponse, RemediationStep, UpgradedRemediationPlan, PatchPlanItem } from "@/types";

interface Issue {
  id: string;
  severity: string;
  category: string;
  elementSelector: string | null;
  description: string;
  fixSuggestion: string | null;
  fixDiff: Record<string, unknown> | null;
  verifiedFixStatus: string;
  source: string;
  confidence: string;
  actualValue?: string | null;
  expectedValue?: string | null;
  viewport?: string | null;
  ruleId?: string | null;
  sampleElements?: Array<{ selector: string; text?: string; width?: number; height?: number; html?: string; url?: string }> | null;
  pageUrl?: string | null;
  screenshots?: Array<{ id: string; url: string; type: string }> | null;
}

interface AuditData {
  id: string;
  url: string;
  status: string;
  errorMessage: string | null;
  score: number | null;
  issues: Issue[];
  chatMessages: ChatMessage[];
  createdAt: string;
  completedAt: string | null;
  progress?: string[];
}

interface ChatMessage {
  id: string;
  role: string;
  content: string;
  citedIssueIds: string[];
  suggestedFollowUps?: string[];
}

// ── FIX ELIGIBILITY (client-side, mirrors server planner.ts) ─────────────────
const FIXABLE_SOURCES = ["axe-core", "custom_heuristic", "merged", "deterministic"];
const FIXABLE_CONFIDENCE = ["high", "medium"];

function isIssueFixable(issue: Issue): boolean {
  const source = (issue.source || "").toLowerCase();
  const confidence = (issue.confidence || "medium").toLowerCase();
  if (!FIXABLE_SOURCES.includes(source)) return false;
  if (!FIXABLE_CONFIDENCE.includes(confidence)) return false;
  return !!(issue.fixSuggestion || (issue.fixDiff && issue.fixDiff.original && issue.fixDiff.patched) || issue.ruleId);
}

function getUnsupportedReasonClient(issue: Issue): string {
  const source = (issue.source || "").toLowerCase();
  const confidence = (issue.confidence || "medium").toLowerCase();
  if (source === "llm" || !FIXABLE_SOURCES.includes(source)) return "AI-only suggestion — manual review required";
  if (!FIXABLE_CONFIDENCE.includes(confidence)) return "Low confidence — manual verification needed";
  if (!issue.fixSuggestion && !issue.fixDiff && !issue.ruleId) return "No fix suggestion available";
  return "Not eligible for automated remediation";
}

// ── HELPER FUNCTIONS ────────────────────────────────────────────────────────
function getConfidenceLabel(confidence: string): string {
  const clean = (confidence || "medium").toLowerCase();
  if (clean === "high") return "High confidence";
  if (clean === "medium") return "Medium confidence";
  return "Low confidence";
}

function getConfidenceColor(confidence: string): string {
  const clean = (confidence || "medium").toLowerCase();
  if (clean === "high") return "text-emerald-700 bg-emerald-50 border-emerald-250";
  if (clean === "medium") return "text-amber-700 bg-amber-50 border-amber-250";
  return "text-blue-700 bg-blue-50 border-blue-250";
}

function getSourceLabel(source: string): string {
  if (source === "axe-core") return "WCAG / axe-core";
  if (source === "custom_heuristic") return "Custom UX Rule";
  if (source === "llm") return "AI Suggestion";
  if (source === "merged") return "Merged Findings";
  return source;
}

function shouldShowTechnicalField(value: any): boolean {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value) && value.length === 0) return false;
  if (typeof value === "object" && Object.keys(value).length === 0) return false;
  return true;
}

function hasFixDiff(issue: any): boolean {
  return !!(issue.fixDiff && issue.fixDiff.original && issue.fixDiff.patched);
}

function hasScreenshots(issue: any): boolean {
  return !!(issue.screenshots && issue.screenshots.length > 0);
}

function getIssueTitle(issue: any): string {
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

function getIssueImpact(issue: any): string {
  const ruleId = issue.ruleId || "";
  const description = issue.description || "";
  
  if (ruleId === "color-contrast") return "Low contrast can make this text difficult to read.";
  if (ruleId === "small-touch-target" || ruleId === "target-size") return "Small touch areas can cause mis-taps on mobile.";
  if (ruleId === "missing-label" || ruleId === "label") return "Form field lacks a label, making it hard to fill out.";
  if (ruleId === "broken-link") return "Users will encounter a dead end or error page.";
  if (ruleId === "slow-load-time") return "Slow loading increases bounce rates and harms user experience.";
  
  if (ruleId === "button-name") return "Screen reader users may not understand what this button does.";
  if (ruleId === "image-alt") return "Screen readers cannot describe this image to visually impaired users.";
  if (ruleId === "link-name") return "Screen readers cannot announce where this link goes.";
  
  const descLower = description.toLowerCase();
  if (descLower.includes("contrast")) return "Low contrast can make this text difficult to read.";
  if (descLower.includes("tap target") || descLower.includes("touch target") || descLower.includes("size")) return "Small touch areas can cause mis-taps on mobile.";
  if (descLower.includes("label")) return "Form field lacks a label, making it hard to fill out.";
  if (descLower.includes("broken link")) return "Users will encounter a dead end or error page.";
  
  return "This issue affects usability or accessibility standards.";
}

function shouldShowFixBadge(status: string): boolean {
  return ["success", "failed", "pending"].includes(status.toLowerCase());
}

function formatSelector(selector: string | null): string {
  if (!selector) return "";
  if (selector.length > 50) return selector.substring(0, 50) + "...";
  return selector;
}

function getScoreLabel(score: number): { label: string; color: string; desc: string } {
  if (score >= 90) return { label: "Excellent", color: "text-emerald-700 bg-emerald-50 border-emerald-200", desc: "The site meets standard usability and accessibility requirements with minimal issues." };
  if (score >= 75) return { label: "Good", color: "text-amber-700 bg-amber-50 border-amber-200", desc: "The site is generally usable but has several areas for improvement." };
  if (score >= 50) return { label: "Needs work", color: "text-orange-700 bg-orange-50 border-orange-200", desc: "Usability is compromised. Multiple serious accessibility barriers found." };
  return { label: "High risk", color: "text-red-700 bg-red-50 border-red-200", desc: "Severe critical failures detected. The interface is difficult to navigate." };
}

function getSummarySentence(issues: any[]): string {
  if (issues.length === 0) {
    return "Great job! No usability or accessibility issues were detected on this page.";
  }
  const wcagCount = issues.filter(i => i.source === "axe-core").length;
  const customCount = issues.filter(i => i.source === "custom_heuristic").length;
  
  if (wcagCount > customCount) {
    return `Most findings are high-confidence WCAG accessibility issues related to contrast or screen-reader usability.`;
  } else if (customCount > wcagCount) {
    return `Most findings are custom UX suggestions to improve visual structure and touch target sizes.`;
  } else {
    return `Findings are split between WCAG accessibility issues and custom UX suggestions.`;
  }
}

// ── PROGRESS TIMELINE HELPERS ────────────────────────────────────────────────
const STEPS = [
  { id: "queued", label: "Queued in system" },
  { id: "opening", label: "Opening website in browser" },
  { id: "capturing", label: "Capturing screenshot and DOM" },
  { id: "wcag", label: "Running WCAG / axe-core checks" },
  { id: "heuristics", label: "Running custom UX heuristic rules" },
  { id: "grouping", label: "Grouping duplicate findings" },
  { id: "score", label: "Calculating UX score" },
  { id: "fixes", label: "Generating fix suggestions" },
  { id: "preparing", label: "Preparing final report" }
];

const STEP_HELPERS: Record<string, string> = {
  "queued": "Waiting for an audit runner to pick up this job.",
  "opening": "Launching headless Chrome, setting viewport size, and loading the target URL.",
  "capturing": "Taking page screenshots and dumping the full interactive DOM tree.",
  "wcag": "Checking color contrast, aria labels, landmarks, keyboard focus, and accessibility trees.",
  "heuristics": "Measuring touch targets, verifying anchor link destinations, and tracking page load speeds.",
  "grouping": "Stripping dynamic class IDs, normalising CSS selectors, and merging repeated layout issues.",
  "score": "Applying capped category weights and diminishing-returns formulas to compute UX Score.",
  "fixes": "Analyzing broken elements and generating drop-in HTML/CSS patch suggestions.",
  "preparing": "Writing report metrics, uploading screenshots, and preparing the interactive dashboard."
};

function getActiveStepId(status: string, progress: string[] = []): string {
  if (status === "queued") return "queued";
  if (status === "failed") {
    const lastLogs = progress.slice(-3).join("\n").toLowerCase();
    if (lastLogs.includes("saving") || lastLogs.includes("saved") || lastLogs.includes("prepare")) return "preparing";
    if (lastLogs.includes("suggestion") || lastLogs.includes("patch") || lastLogs.includes("fix")) return "fixes";
    if (lastLogs.includes("calculating") || lastLogs.includes("score")) return "score";
    if (lastLogs.includes("grouping") || lastLogs.includes("deduplicat")) return "grouping";
    if (lastLogs.includes("heuristic")) return "heuristics";
    if (lastLogs.includes("axe-core") || lastLogs.includes("wcag")) return "wcag";
    if (lastLogs.includes("capturing") || lastLogs.includes("screenshot") || lastLogs.includes("dom")) return "capturing";
    if (lastLogs.includes("navigating") || lastLogs.includes("opening") || lastLogs.includes("browser")) return "opening";
  }
  
  const logsStr = progress.join("\n").toLowerCase();
  if (logsStr.includes("saved report") || logsStr.includes("completed successfully")) return "preparing";
  if (logsStr.includes("generating fix suggestions") || logsStr.includes("generating patches")) return "fixes";
  if (logsStr.includes("calculating ux score") || logsStr.includes("score calculated")) return "score";
  if (logsStr.includes("grouping duplicate findings") || logsStr.includes("deduplicating")) return "grouping";
  if (logsStr.includes("running custom ux heuristic") || logsStr.includes("custom_heuristic")) return "heuristics";
  if (logsStr.includes("running wcag") || logsStr.includes("axe-core")) return "wcag";
  if (logsStr.includes("capturing screenshot") || logsStr.includes("dom snapshot")) return "capturing";
  if (logsStr.includes("navigating to") || logsStr.includes("opening website") || logsStr.includes("browser-use")) return "opening";
  
  if (progress.length > 3) return "capturing";
  if (progress.length > 1) return "opening";
  return "queued";
}

function getStepStatus(stepId: string, status: string, progress: string[] = []): "completed" | "active" | "pending" | "failed" {
  const activeId = getActiveStepId(status, progress);
  
  const stepOrder = ["queued", "opening", "capturing", "wcag", "heuristics", "grouping", "score", "fixes", "preparing"];
  const stepIdx = stepOrder.indexOf(stepId);
  const activeIdx = stepOrder.indexOf(activeId);
  
  if (status === "completed") return "completed";
  
  if (stepIdx < activeIdx) return "completed";
  if (stepIdx === activeIdx) return status === "failed" ? "failed" : "active";
  return "pending";
}

// ── SIMPLE MARKDOWN RENDERER ─────────────────────────────────────────────────
function simpleMarkdown(text: string): string {
  if (!text) return "";
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br/>');
  if (!html.startsWith('<h') && !html.startsWith('<ul') && !html.startsWith('<pre')) {
    html = `<p>${html}</p>`;
  }
  return html;
}

export default function AuditPage() {
  const params = useParams();
  const router = useRouter();
  const [audit, setAudit] = useState<AuditData | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [expandedIssueId, setExpandedIssueId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "evidence" | "fix">("overview");
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [filter, setFilter] = useState<string>("all");

  // ── Remediation state ──────────────────────────────────────────────────────
  const [selectedIssueIds, setSelectedIssueIds] = useState<Set<string>>(new Set());
  const [showRemediationModal, setShowRemediationModal] = useState(false);
  const [githubConnected, setGithubConnected] = useState<boolean | null>(null);
  const [repos, setRepos] = useState<GitHubRepoInfo[]>([]);
  const [branches, setBranches] = useState<GitHubBranchInfo[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string>("");
  const [selectedBranch, setSelectedBranch] = useState<string>("");
  const [repoSearch, setRepoSearch] = useState("");
  const [remediationStep, setRemediationStep] = useState<RemediationStep | null>(null);
  const [remediationResult, setRemediationResult] = useState<RemediationResponse | null>(null);
  const [remediationError, setRemediationError] = useState<string | null>(null);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [loadingBranches, setLoadingBranches] = useState(false);

  // Upgraded remediation plan states
  const [remediationPlan, setRemediationPlan] = useState<UpgradedRemediationPlan | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);

  const highlightIssue = (issueId: string) => {
    setExpandedIssueId(issueId);
    setActiveTab("overview");
    setTimeout(() => {
      const el = document.getElementById(`issue-card-${issueId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("ring-2", "ring-blue-400");
        setTimeout(() => el.classList.remove("ring-2", "ring-blue-400"), 2000);
      }
    }, 100);
  };

  useEffect(() => {
    if (errorStatus === 401) {
      router.push(`/login?callbackUrl=/audit/${params.id}`);
    }
  }, [errorStatus, params.id, router]);

  useEffect(() => {
    let active = true;
    let timerId: NodeJS.Timeout;

    const fetchAudit = async () => {
      try {
        const response = await fetch(`/api/audit/${params.id}`);
        if (!active) return;
        
        if (!response.ok) {
          setErrorStatus(response.status);
          setLoading(false);
          return;
        }

        const data = await response.json();
        setAudit(data);
        
        // Stop polling if we reached a terminal status
        if (data.status === "completed" || data.status === "failed") {
          setLoading(false);
          return;
        }
      } catch (error) {
        console.error("Failed to fetch audit:", error);
      } finally {
        if (active) {
          setLoading(false);
        }
      }

      // Schedule next poll
      timerId = setTimeout(fetchAudit, 3000);
    };

    fetchAudit();

    return () => {
      active = false;
      clearTimeout(timerId);
    };
  }, [params.id, errorStatus]);

  // ── Check GitHub connection status ─────────────────────────────────────────
  useEffect(() => {
    async function checkGitHub() {
      try {
        const res = await fetch("/api/github/status");
        if (res.ok) {
          const data = await res.json();
          setGithubConnected(data.connected);
        }
      } catch {
        setGithubConnected(false);
      }
    }
    checkGitHub();
  }, []);

  // ── Issue selection handlers ───────────────────────────────────────────────
  const toggleIssueSelection = useCallback((issueId: string) => {
    setSelectedIssueIds(prev => {
      const next = new Set(prev);
      if (next.has(issueId)) next.delete(issueId);
      else next.add(issueId);
      return next;
    });
  }, []);

  const selectAllFixable = useCallback(() => {
    if (!audit) return;
    const fixableIds = audit.issues.filter(isIssueFixable).map(i => i.id);
    setSelectedIssueIds(new Set(fixableIds));
  }, [audit]);

  const clearSelection = useCallback(() => {
    setSelectedIssueIds(new Set());
  }, []);

  // ── Load repos ─────────────────────────────────────────────────────────────
  const loadRepos = useCallback(async () => {
    setLoadingRepos(true);
    try {
      const res = await fetch("/api/github/repos");
      if (res.ok) {
        const data = await res.json();
        setRepos(data);
      } else {
        const err = await res.json().catch(() => ({}));
        setRemediationError(err.error || "Failed to load repositories");
      }
    } catch {
      setRemediationError("Failed to load repositories");
    } finally {
      setLoadingRepos(false);
    }
  }, []);

  // ── Load branches when repo selected ───────────────────────────────────────
  const loadBranches = useCallback(async (repoFullName: string) => {
    setLoadingBranches(true);
    setBranches([]);
    setSelectedBranch("");
    try {
      const [owner, repo] = repoFullName.split("/");
      const res = await fetch(`/api/github/repos/${owner}/${repo}/branches`);
      if (res.ok) {
        const data = await res.json();
        setBranches(data);
        // Auto-select default branch
        const repoInfo = repos.find(r => r.fullName === repoFullName);
        if (repoInfo) setSelectedBranch(repoInfo.defaultBranch);
      }
    } catch {
      // silently fail, branches list stays empty
    } finally {
      setLoadingBranches(false);
    }
  }, [repos]);

  // ── Fetch patch plan preview ───────────────────────────────────────────────
  const fetchRemediationPlan = useCallback(async (repoFullName: string, branchName: string) => {
    if (!audit || !repoFullName || !branchName || selectedIssueIds.size === 0) return;
    setLoadingPlan(true);
    setRemediationPlan(null);
    try {
      const res = await fetch(`/api/audit/${audit.id}/remediation-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo: repoFullName,
          branch: branchName,
          issueIds: Array.from(selectedIssueIds),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setRemediationPlan(data);
      }
    } catch (e) {
      console.error("Failed to fetch plan preview:", e);
    } finally {
      setLoadingPlan(false);
    }
  }, [audit, selectedIssueIds]);

  // Auto-fetch plan preview when selections change
  useEffect(() => {
    if (showRemediationModal && selectedRepo && selectedBranch && selectedIssueIds.size > 0) {
      fetchRemediationPlan(selectedRepo, selectedBranch);
    }
  }, [showRemediationModal, selectedRepo, selectedBranch, selectedIssueIds, fetchRemediationPlan]);

  // ── Open remediation modal ─────────────────────────────────────────────────
  const openRemediationModal = useCallback(() => {
    setRemediationError(null);
    setRemediationResult(null);
    setRemediationStep(null);
    setShowRemediationModal(true);
    if (githubConnected) loadRepos();
  }, [githubConnected, loadRepos]);

  // ── Generate PR ────────────────────────────────────────────────────────────
  const generatePR = useCallback(async () => {
    if (!audit || !selectedRepo || !selectedBranch || selectedIssueIds.size === 0) return;

    setRemediationError(null);
    setRemediationStep("creating_branch");

    try {
      setRemediationStep("committing");
      const res = await fetch(`/api/audit/${audit.id}/github-remediation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo: selectedRepo,
          baseBranch: selectedBranch,
          issueIds: Array.from(selectedIssueIds),
          mode: "direct_if_possible",
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Failed to create PR");
      }

      setRemediationStep("opening_pr");
      const result: RemediationResponse = await res.json();
      setRemediationResult(result);
      setRemediationStep("complete");
    } catch (error) {
      setRemediationStep("error");
      setRemediationError(error instanceof Error ? error.message : "Failed to create PR");
    }
  }, [audit, selectedRepo, selectedBranch, selectedIssueIds]);


  const handleChat = async (e?: React.FormEvent, customText?: string) => {
    if (e) e.preventDefault();
    const textToSend = customText || chatInput;
    if (!textToSend.trim() || !audit || chatLoading) return;

    setChatLoading(true);
    try {
      const response = await fetch(`/api/audit/${audit.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: textToSend,
          selectedIssueId: expandedIssueId,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        setAudit(prev => prev ? {
          ...prev,
          chatMessages: [
            ...prev.chatMessages,
            { id: "user-" + Date.now(), role: "user", content: textToSend, citedIssueIds: [] },
            {
              id: "assistant-" + Date.now(),
              role: "assistant",
              content: data.response,
              citedIssueIds: data.citedIssueIds || [],
              suggestedFollowUps: data.suggestedFollowUps || [],
            },
          ],
        } : null);
        if (!customText) {
          setChatInput("");
        }
      }
    } catch (error) {
      console.error("Chat failed:", error);
    } finally {
      setChatLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-600">Loading audit...</p>
        </div>
      </div>
    );
  }

  if (!audit) {
    if (errorStatus === 403) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="text-center bg-white p-8 rounded-2xl shadow-sm border border-gray-150 max-w-md w-full">
            <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Access Denied</h2>
            <p className="text-gray-600 mb-6 font-sans">You do not have access to this audit.</p>
            <a href="/" className="inline-flex items-center justify-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition active:scale-95 duration-150 text-sm">
              Go Home
            </a>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center bg-white p-8 rounded-2xl shadow-sm border border-gray-150 max-w-md w-full">
          <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Audit Not Found</h2>
          <p className="text-gray-600 mb-6 font-sans">Audit not found.</p>
          <a href="/" className="inline-flex items-center justify-center px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition active:scale-95 duration-150 text-sm">
            Go Home
          </a>
        </div>
      </div>
    );
  }

  // ── IN-PROGRESS / FAILURE STATES (PROGRESS TIMELINE) ──────────────────────
  if (audit.status !== "completed") {
    const activeStepId = getActiveStepId(audit.status, audit.progress);

    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <nav className="border-b bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between h-16 items-center">
              <a href="/" className="flex items-center gap-2">
                <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold text-sm">UX</span>
                </div>
                <span className="font-semibold text-gray-900">UX-Auditor</span>
              </a>
              <div className="flex items-center gap-2">
                <StatusIndicator status={audit.status} />
              </div>
            </div>
          </div>
        </nav>

        <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-16 flex flex-col">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight mb-2">
              {audit.status === "failed" ? "Audit Execution Failed" : "Auditing Website"}
            </h1>
            <p className="text-gray-500 break-all max-w-lg mx-auto text-sm">
              Analyzing <span className="font-semibold text-blue-600">{audit.url}</span>
            </p>
          </div>

          <div className="bg-white rounded-2xl p-8 shadow-sm border border-gray-150 flex-1">
            <div className="flex items-center justify-between border-b pb-4 mb-6">
              <h2 className="text-sm font-bold text-gray-700 uppercase tracking-wider">Audit Pipeline Progress</h2>
              {audit.status !== "failed" && (
                <div className="flex items-center gap-2 text-xs font-semibold text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full animate-pulse">
                  <div className="w-1.5 h-1.5 bg-blue-600 rounded-full" />
                  Active: {STEPS.find(s => s.id === activeStepId)?.label}
                </div>
              )}
            </div>

            <div className="relative pl-8 border-l-2 border-gray-250 ml-3 space-y-6">
              {STEPS.map((step) => {
                const stepStatus = getStepStatus(step.id, audit.status, audit.progress);
                
                let iconEl;
                if (stepStatus === "completed") {
                  iconEl = (
                    <div className="absolute -left-[41px] top-0 w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center border-2 border-white shadow-sm">
                      <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  );
                } else if (stepStatus === "active") {
                  iconEl = (
                    <div className="absolute -left-[41px] top-0 w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center border-2 border-white shadow-sm">
                      <div className="w-2.5 h-2.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    </div>
                  );
                } else if (stepStatus === "failed") {
                  iconEl = (
                    <div className="absolute -left-[41px] top-0 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center border-2 border-white shadow-sm">
                      <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </div>
                  );
                } else {
                  iconEl = (
                    <div className="absolute -left-[41px] top-0 w-6 h-6 bg-gray-100 rounded-full flex items-center justify-center border-2 border-gray-200">
                      <div className="w-1.5 h-1.5 bg-gray-400 rounded-full" />
                    </div>
                  );
                }

                return (
                  <div key={step.id} className="relative transition duration-200">
                    {iconEl}
                    <div className={stepStatus === "pending" ? "opacity-45" : "opacity-100"}>
                      <h3 className={`text-sm font-bold ${
                        stepStatus === "active" ? "text-blue-700" :
                        stepStatus === "failed" ? "text-red-700 font-extrabold" : "text-gray-800"
                      }`}>
                        {step.label}
                      </h3>
                      {stepStatus === "active" && (
                        <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                          {STEP_HELPERS[step.id]}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {audit.status === "failed" && (
              <div className="mt-8 border-t pt-6">
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-left">
                  <h4 className="text-xs font-bold text-red-800 uppercase tracking-wider mb-2">Error Details</h4>
                  <p className="font-mono text-xs text-red-900 bg-white p-3 rounded-lg border border-red-100 whitespace-pre-wrap break-all leading-relaxed">
                    {audit.errorMessage || "An unknown error occurred during the audit execution."}
                  </p>
                </div>
                <div className="mt-6 flex justify-center">
                  <a
                    href="/"
                    className="inline-flex items-center px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg shadow-sm transition active:scale-95 duration-150 text-sm"
                  >
                    ← Try Another URL
                  </a>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    );
  }

  const filteredIssues = filter === "all"
    ? audit.issues
    : audit.issues.filter(i => i.severity === filter);

  const severityCounts = {
    critical: audit.issues.filter(i => i.severity === "critical").length,
    serious: audit.issues.filter(i => i.severity === "serious").length,
    moderate: audit.issues.filter(i => i.severity === "moderate").length,
    minor: audit.issues.filter(i => i.severity === "minor").length,
  };

  const wcagIssuesCount = audit.issues.filter(i => i.source === "axe-core").length;
  const uxSuggestionsCount = audit.issues.filter(i => i.source === "custom_heuristic" || i.source === "llm").length;
  const verifiedCount = audit.issues.filter(i => i.verifiedFixStatus === "success").length;
  const groupedFindingsCount = audit.issues.filter(i => i.sampleElements && i.sampleElements.length > 1).length;

  const scoreLabelInfo = audit.score !== null ? getScoreLabel(audit.score) : { label: "N/A", color: "bg-gray-100 text-gray-500", desc: "" };

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="border-b bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-4">
              <a href="/" className="flex items-center gap-2">
                <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold text-sm">UX</span>
                </div>
                <span className="font-semibold text-gray-900">UX-Auditor</span>
              </a>
              <span className="text-gray-400">|</span>
              <span className="text-sm text-gray-600 truncate max-w-md">{audit.url}</span>
            </div>
            <StatusIndicator status={audit.status} />
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* ── REPORT SUMMARY DASHBOARD ── */}
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-150 mb-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-center">
            <div className="md:col-span-1 border-r border-gray-100 pr-6 flex flex-col items-center md:items-start">
              <span className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Usability Score</span>
              {audit.score !== null ? (
                <div className="flex items-baseline gap-2">
                  <span className="text-5xl font-black text-gray-900">{audit.score}</span>
                  <span className="text-sm font-semibold text-gray-400">/ 100</span>
                </div>
              ) : (
                <span className="text-3xl font-bold text-gray-400">N/A</span>
              )}
              {audit.score !== null && (
                <span className={`mt-2 inline-flex items-center px-3 py-1 rounded-full text-xs font-bold border ${scoreLabelInfo.color}`}>
                  {scoreLabelInfo.label}
                </span>
              )}
            </div>

            <div className="md:col-span-3 space-y-4">
              <div>
                <h2 className="text-lg font-bold text-gray-900">Executive Summary</h2>
                <p className="text-sm text-gray-600 mt-1 leading-relaxed">
                  {getSummarySentence(audit.issues)} {scoreLabelInfo.desc}
                </p>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2">
                <div className="bg-gray-50 border border-gray-100 rounded-xl p-3 text-center md:text-left">
                  <span className="block text-xs font-semibold text-gray-400 uppercase">WCAG Issues</span>
                  <span className="text-lg font-bold text-blue-700">{wcagIssuesCount}</span>
                </div>
                <div className="bg-gray-50 border border-gray-100 rounded-xl p-3 text-center md:text-left">
                  <span className="block text-xs font-semibold text-gray-400 uppercase">UX Rules</span>
                  <span className="text-lg font-bold text-teal-700">{uxSuggestionsCount}</span>
                </div>
                <div className="bg-gray-50 border border-gray-100 rounded-xl p-3 text-center md:text-left">
                  <span className="block text-xs font-semibold text-gray-400 uppercase">Grouped Groups</span>
                  <span className="text-lg font-bold text-indigo-700">{groupedFindingsCount}</span>
                </div>
                <div className="bg-gray-50 border border-gray-100 rounded-xl p-3 text-center md:text-left">
                  <span className="block text-xs font-semibold text-gray-400 uppercase">Verified Fixes</span>
                  <span className="text-lg font-bold text-emerald-700">✓ {verifiedCount}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* ── LEFT COLUMN: ISSUES LIST ── */}
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-150">
              <div className="flex items-center justify-between mb-4 pb-2 border-b">
                <h2 className="font-bold text-gray-900">Usability Issues &amp; Suggestions</h2>
                <span className="text-xs text-gray-500 font-semibold">{filteredIssues.length} issues listed</span>
              </div>

              <div className="flex gap-2.5 flex-wrap">
                <button
                  onClick={() => setFilter("all")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition border ${
                    filter === "all" ? "bg-gray-900 text-white border-gray-950" : "bg-gray-50 text-gray-600 hover:bg-gray-100 border-gray-200"
                  }`}
                >
                  All ({audit.issues.length})
                </button>
                {Object.entries(severityCounts).map(([severity, count]) => (
                  <button
                    key={severity}
                    onClick={() => setFilter(filter === severity ? "all" : severity)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition border ${
                      filter === severity ? "bg-gray-900 text-white border-gray-950" : "bg-gray-50 text-gray-600 hover:bg-gray-100 border-gray-200"
                    }`}
                  >
                    <SeverityBadge severity={severity} />
                    <span className="ml-1 text-[11px] text-gray-500">{count}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              {filteredIssues.map((issue) => {
                const issueTitle = getIssueTitle(issue);
                const issueImpact = getIssueImpact(issue);
                const showFixBadge = shouldShowFixBadge(issue.verifiedFixStatus);
                const isExpanded = expandedIssueId === issue.id;

                const fixable = isIssueFixable(issue);
                const isSelected = selectedIssueIds.has(issue.id);

                return (
                  <div
                    key={issue.id}
                    id={`issue-card-${issue.id}`}
                    role="button"
                    tabIndex={0}
                    aria-expanded={isExpanded}
                    onClick={() => {
                      setExpandedIssueId(isExpanded ? null : issue.id);
                      setActiveTab("overview");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setExpandedIssueId(isExpanded ? null : issue.id);
                        setActiveTab("overview");
                      }
                    }}
                    className={`bg-white rounded-xl p-5 shadow-sm border text-left cursor-pointer transition-all duration-200 ${
                      isExpanded ? "ring-2 ring-blue-500 border-blue-500" : isSelected ? "ring-1 ring-emerald-400 border-emerald-300" : "border-gray-150 hover:shadow-md"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      {/* Remediation checkbox */}
                      <div className="flex-shrink-0 pt-0.5" onClick={(e) => e.stopPropagation()}>
                        {fixable ? (
                          <label className="flex items-center cursor-pointer" title="Include in GitHub remediation">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleIssueSelection(issue.id)}
                              className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                            />
                          </label>
                        ) : (
                          <div className="w-4 h-4 rounded border border-gray-200 bg-gray-50 cursor-not-allowed" title={getUnsupportedReasonClient(issue)} />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                          <SeverityBadge severity={issue.severity} />
                          <SourceBadge source={issue.source} />
                          <ConfidenceBadge confidence={issue.confidence} />
                          {showFixBadge && <FixBadge status={issue.verifiedFixStatus} />}
                          {issue.sampleElements && issue.sampleElements.length > 1 && (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-100 uppercase">
                              Grouped ({issue.sampleElements.length})
                            </span>
                          )}
                        </div>
                        <h3 className="text-sm font-extrabold text-gray-900 leading-snug">{issueTitle}</h3>
                        <p className="text-xs text-gray-500 mt-1 leading-normal">{issueImpact}</p>
                      </div>

                      <div className="text-gray-400 mt-1 flex-shrink-0">
                        <svg
                          className={`w-4 h-4 transform transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2.5}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="mt-4 pt-4 border-t border-gray-100 space-y-4" onClick={(e) => e.stopPropagation()}>
                        {/* Tab Headers */}
                        <div className="flex gap-2 border-b border-gray-100 pb-2">
                          <button
                            type="button"
                            onClick={() => setActiveTab("overview")}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                              activeTab === "overview" ? "bg-blue-600 text-white shadow-sm" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                            }`}
                          >
                            Overview
                          </button>
                          <button
                            type="button"
                            onClick={() => setActiveTab("evidence")}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                              activeTab === "evidence" ? "bg-blue-600 text-white shadow-sm" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                            }`}
                          >
                            Evidence
                          </button>
                          <button
                            type="button"
                            onClick={() => setActiveTab("fix")}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                              activeTab === "fix" ? "bg-blue-600 text-white shadow-sm" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                            }`}
                          >
                            Fix Suggestion
                          </button>
                        </div>

                        {/* Tab Content */}
                        {activeTab === "overview" && (
                          <div className="space-y-4 animate-fadeIn">
                            {/* PROBLEM */}
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Problem</label>
                              <p className="text-xs text-gray-700 leading-relaxed font-sans">{issue.description}</p>
                            </div>

                            {/* WHY IT MATTERS */}
                            <div className="space-y-1">
                              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Why It Matters</label>
                              <p className="text-xs text-gray-600 bg-gray-50 border border-gray-150 rounded-lg p-3 leading-relaxed font-sans italic">
                                {getIssueImpact(issue)}
                              </p>
                            </div>

                            {/* RECOMMENDED FIX */}
                            {issue.fixSuggestion && (
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Recommended Fix</label>
                                <p className="text-xs text-gray-700 leading-relaxed font-sans">{issue.fixSuggestion}</p>
                              </div>
                            )}
                          </div>
                        )}

                        {activeTab === "evidence" && (
                          <div className="space-y-4 animate-fadeIn">
                            {/* EVIDENCE DETAILS TABLE */}
                            <div className="space-y-2">
                              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Evidence Details</label>
                              <div className="border border-gray-150 rounded-xl overflow-hidden bg-white text-xs">
                                <div className="grid grid-cols-3 border-b border-gray-100 p-2.5">
                                  <span className="text-gray-400 font-semibold col-span-1 flex flex-col">
                                    <span>Selector</span>
                                    <span className="text-[9px] text-gray-300 font-normal normal-case leading-tight">The CSS path of the affected page element.</span>
                                  </span>
                                  <span className="text-gray-700 col-span-2 font-mono break-all bg-gray-50 p-1.5 rounded border border-gray-100 mt-1 sm:mt-0 text-[10px] select-all">
                                    {issue.elementSelector || "Global"}
                                  </span>
                                </div>
                                <div className="grid grid-cols-3 border-b border-gray-100 p-2.5">
                                  <span className="text-gray-400 font-semibold col-span-1">Rule ID</span>
                                  <span className="text-gray-700 col-span-2 font-mono">{issue.ruleId || "N/A"}</span>
                                </div>
                                <div className="grid grid-cols-3 border-b border-gray-100 p-2.5">
                                  <span className="text-gray-400 font-semibold col-span-1">Source</span>
                                  <span className="text-gray-700 col-span-2 capitalize">{getSourceLabel(issue.source)}</span>
                                </div>
                                <div className="grid grid-cols-3 border-b border-gray-100 p-2.5">
                                  <span className="text-gray-400 font-semibold col-span-1 flex flex-col">
                                    <span>Confidence</span>
                                    <span className="text-[9px] text-gray-300 font-normal normal-case leading-tight">How certain the system is based on rule source and available evidence.</span>
                                  </span>
                                  <span className="text-gray-700 col-span-2 capitalize font-semibold">{getConfidenceLabel(issue.confidence)}</span>
                                </div>
                                {shouldShowTechnicalField(issue.viewport) && (
                                  <div className="grid grid-cols-3 border-b border-gray-100 p-2.5">
                                    <span className="text-gray-400 font-semibold col-span-1">Viewport</span>
                                    <span className="text-gray-700 col-span-2 capitalize font-semibold">{issue.viewport}</span>
                                  </div>
                                )}
                                {shouldShowTechnicalField(issue.pageUrl) && (
                                  <div className="grid grid-cols-3 border-b border-gray-100 p-2.5">
                                    <span className="text-gray-400 font-semibold col-span-1">Page URL</span>
                                    <a href={issue.pageUrl!} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline break-all col-span-2">{issue.pageUrl}</a>
                                  </div>
                                )}
                                {shouldShowTechnicalField(issue.actualValue) && (
                                  <div className="grid grid-cols-3 p-2.5">
                                    <span className="text-gray-400 font-semibold col-span-1">Measured values</span>
                                    <div className="text-gray-700 col-span-2 font-sans space-y-0.5">
                                      <div><strong>Actual:</strong> {issue.actualValue}</div>
                                      {issue.expectedValue && <div><strong>Expected:</strong> {issue.expectedValue}</div>}
                                    </div>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* AFFECTED ELEMENTS LIST */}
                            {shouldShowTechnicalField(issue.sampleElements) && (
                              <div className="space-y-2">
                                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
                                  Affected HTML Elements ({issue.sampleElements!.length})
                                </label>
                                <div className="max-h-40 overflow-y-auto space-y-2 border border-gray-150 rounded-xl p-2.5 bg-gray-50">
                                  {issue.sampleElements!.map((el, i) => (
                                    <div key={i} className="text-xs font-mono bg-white p-2.5 border border-gray-200 rounded-lg shadow-sm">
                                      <span className="text-purple-755 block break-all font-semibold">{el.selector}</span>
                                      {el.text && <span className="text-gray-500 block mt-1 font-sans">InnerText: "{el.text}"</span>}
                                      {(el.width || el.height) && (
                                        <span className="text-gray-500 block mt-0.5 font-sans">Size: {el.width}x{el.height}px</span>
                                      )}
                                      {el.html && (
                                        <pre className="text-[10px] text-gray-500 bg-gray-50 p-1.5 mt-2 border border-gray-100 rounded overflow-x-auto whitespace-pre-wrap break-all">
                                          {el.html}
                                        </pre>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {activeTab === "fix" && (
                          <div className="space-y-4 animate-fadeIn">
                            {/* CODE SUGGESTION OR MANUAL */}
                            {hasFixDiff(issue) ? (
                              <div className="space-y-2">
                                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Suggested Code Fix (Original vs Patched)</label>
                                <div className="flex flex-col gap-3">
                                  <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                                    <span className="text-[9px] font-bold text-red-700 uppercase tracking-wider block mb-1">Original HTML</span>
                                    <pre className="text-[10px] text-red-900 font-mono overflow-auto max-h-32 p-2 bg-white rounded-lg border border-red-100 whitespace-pre-wrap break-all">
                                      {issue.fixDiff!.original as string}
                                    </pre>
                                  </div>
                                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3">
                                    <span className="text-[9px] font-bold text-emerald-700 uppercase tracking-wider block mb-1">Suggested Patch</span>
                                    <pre className="text-[10px] text-emerald-900 font-mono overflow-auto max-h-32 p-2 bg-white rounded-lg border border-emerald-100 whitespace-pre-wrap break-all">
                                      {issue.fixDiff!.patched as string}
                                    </pre>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Suggested Fix</label>
                                <div className="bg-blue-50 border border-blue-150 rounded-xl p-4 text-xs text-blue-900 leading-relaxed font-sans">
                                  <p className="font-bold mb-1 uppercase tracking-wider text-[9px] text-blue-800">Manual Fix Recommended</p>
                                  <p>{issue.fixSuggestion || "No automated code fix patch is available for this issue. Inspect the HTML elements and resolve manually."}</p>
                                </div>
                              </div>
                            )}

                            {/* SCREENSHOTS */}
                            {hasScreenshots(issue) && (
                              <div className="space-y-2 mt-4 pt-4 border-t border-gray-100">
                                <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">Visual Proof (Screenshots)</label>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                  {issue.screenshots!.map((shot) => (
                                    <div key={shot.id} className="border border-gray-150 rounded-xl overflow-hidden bg-white shadow-sm flex flex-col">
                                      <span className="text-[9px] font-bold text-gray-500 block p-2 bg-gray-50 border-b uppercase tracking-wider">
                                        {shot.type.toLowerCase()} Screen
                                      </span>
                                      <div className="p-2 flex items-center justify-center bg-gray-100 flex-1 min-h-32">
                                        <img src={shot.url} alt={`${shot.type} Screenshot`} className="max-h-48 max-w-full object-contain rounded" />
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {filteredIssues.length === 0 && (
                <div className="bg-white rounded-xl p-8 border border-gray-150 text-center">
                  <p className="text-gray-500 text-sm">No issues found matching this filter</p>
                </div>
              )}
            </div>
          </div>

          {/* ── RIGHT COLUMN: CHAT ASSISTANT ONLY ── */}
          <div className="space-y-6">
            {/* CHAT ASSISTANT PANEL */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-150 overflow-hidden lg:sticky lg:top-4 flex flex-col" style={{ maxHeight: "calc(100vh - 2rem)" }}>
              <div className="p-4 border-b bg-gradient-to-r from-blue-50 to-indigo-50 flex-shrink-0">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-sm">🤖</div>
                  <div>
                    <h2 className="font-bold text-gray-900 text-sm">UX Audit Assistant</h2>
                    <p className="text-[11px] text-gray-500">Ask about your audit findings, score, and how to fix issues</p>
                  </div>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-white min-h-[300px] max-h-[500px]" id="chat-messages-container">
                {audit.chatMessages.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-8 gap-4">
                    <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center text-2xl">💬</div>
                    <p className="text-sm text-gray-400 text-center">
                      Ask me anything about your audit results
                    </p>
                    <div className="flex flex-wrap gap-2 justify-center px-2">
                      {[
                        "How can I improve my UX score?",
                        "What should I fix first?",
                        "Summarize the key issues",
                        "Show me quick wins",
                        "Explain the most serious issues",
                      ].map((prompt) => (
                        <button
                          key={prompt}
                          type="button"
                          onClick={() => handleChat(undefined, prompt)}
                          className="text-[11px] px-3 py-1.5 rounded-full border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 hover:border-blue-300 transition-colors cursor-pointer"
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {audit.chatMessages.map((msg, msgIdx) => (
                  <div key={msg.id} className="space-y-1.5">
                    <div className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[90%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed shadow-sm ${
                          msg.role === "user"
                            ? "bg-blue-600 text-white rounded-br-sm"
                            : "bg-gray-50 text-gray-800 border border-gray-200 rounded-bl-sm"
                        }`}
                      >
                        {msg.role === "assistant" ? (
                          <div
                            className="prose prose-xs prose-gray max-w-none [&_h1]:text-sm [&_h2]:text-[13px] [&_h3]:text-[12px] [&_p]:text-[13px] [&_li]:text-[13px] [&_code]:text-[11px] [&_code]:bg-gray-100 [&_code]:px-1 [&_code]:rounded [&_pre]:text-[11px] [&_pre]:bg-gray-900 [&_pre]:text-gray-100 [&_pre]:rounded-lg [&_pre]:p-2 [&_strong]:font-semibold [&_ul]:pl-4 [&_ol]:pl-4"
                            dangerouslySetInnerHTML={{ __html: simpleMarkdown(msg.content) }}
                          />
                        ) : (
                          msg.content
                        )}
                      </div>
                    </div>

                    {/* Cited issue chips */}
                    {msg.role === "assistant" && msg.citedIssueIds && msg.citedIssueIds.length > 0 && (
                      <div className="flex flex-wrap gap-1 pl-1">
                        {msg.citedIssueIds.slice(0, 5).map((issueId) => {
                          const cited = audit.issues.find((i) => i.id === issueId);
                          if (!cited) return null;
                          return (
                            <button
                              key={issueId}
                              type="button"
                              onClick={() => highlightIssue(issueId)}
                              className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors cursor-pointer truncate max-w-[200px]"
                              title={cited.description}
                            >
                              📌 {getIssueTitle(cited).slice(0, 35)}
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Suggested follow-ups after last assistant message */}
                    {msg.role === "assistant" && msg.suggestedFollowUps && msg.suggestedFollowUps.length > 0 && msgIdx === audit.chatMessages.length - 1 && (
                      <div className="flex flex-wrap gap-1.5 pl-1 pt-1">
                        {msg.suggestedFollowUps.map((followUp) => (
                          <button
                            key={followUp}
                            type="button"
                            onClick={() => handleChat(undefined, followUp)}
                            disabled={chatLoading}
                            className="text-[11px] px-2.5 py-1 rounded-full border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors cursor-pointer disabled:opacity-50"
                          >
                            {followUp}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}

                {chatLoading && (
                  <div className="flex justify-start">
                    <div className="bg-gray-50 border border-gray-200 rounded-2xl rounded-bl-sm px-4 py-3 text-xs text-gray-500">
                      <span className="inline-flex gap-1">
                        <span className="animate-bounce" style={{ animationDelay: "0ms" }}>●</span>
                        <span className="animate-bounce" style={{ animationDelay: "150ms" }}>●</span>
                        <span className="animate-bounce" style={{ animationDelay: "300ms" }}>●</span>
                      </span>
                    </div>
                  </div>
                )}
              </div>

              <form onSubmit={handleChat} className="p-3 border-t bg-gray-50 flex-shrink-0">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Ask about your audit findings..."
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    disabled={chatLoading}
                  />
                  <button
                    type="submit"
                    disabled={chatLoading || !chatInput.trim()}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50 font-semibold transition-colors"
                  >
                    {chatLoading ? "..." : "Send"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </main>

      {/* ── STICKY REMEDIATION BAR ── */}
      {selectedIssueIds.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 shadow-lg z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-emerald-100 rounded-full flex items-center justify-center">
                  <span className="text-emerald-700 font-bold text-sm">{selectedIssueIds.size}</span>
                </div>
                <span className="text-sm font-semibold text-gray-700">
                  {selectedIssueIds.size === 1 ? "1 issue" : `${selectedIssueIds.size} issues`} selected
                </span>
              </div>
              <button
                onClick={selectAllFixable}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium"
              >
                Select all fixable
              </button>
              <button
                onClick={clearSelection}
                className="text-xs text-gray-500 hover:text-gray-700 font-medium"
              >
                Clear
              </button>
            </div>
            <button
              onClick={openRemediationModal}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg shadow-sm transition active:scale-95 duration-150 text-sm"
            >
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
              </svg>
              Create GitHub PR
            </button>
          </div>
        </div>
      )}

      {/* ── REMEDIATION MODAL ── */}
      {showRemediationModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => !remediationStep && setShowRemediationModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            {/* Modal header */}
            <div className="p-6 border-b">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
                    <svg className="w-5 h-5 text-emerald-700" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900">Create GitHub PR</h3>
                    <p className="text-xs text-gray-500">{selectedIssueIds.size} issue(s) selected for remediation</p>
                  </div>
                </div>
                {!remediationStep && (
                  <button onClick={() => setShowRemediationModal(false)} className="text-gray-400 hover:text-gray-600">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            </div>

            <div className="p-6 space-y-5">
              {/* ── SUCCESS STATE ── */}
              {remediationStep === "complete" && remediationResult && (
                <div className="text-center py-4">
                  <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h4 className="text-lg font-bold text-gray-900 mb-1">Pull Request Created!</h4>
                  <p className="text-sm text-gray-500 mb-4">Branch: <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">{remediationResult.branchName}</code></p>
                  
                  {remediationResult.patchedResults && remediationResult.patchedResults.filter(p => p.success).length > 0 ? (
                    <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3.5 mb-4 text-left max-h-32 overflow-y-auto">
                      <p className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider mb-1">Patched Source Files</p>
                      <ul className="space-y-0.5 text-xs text-emerald-700 list-disc pl-4 font-mono">
                        {Array.from(new Set(remediationResult.patchedResults.filter(p => p.success).map(p => p.filePath))).map(file => (
                          <li key={file}>{file}</li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500 mb-4 italic">No safe direct code patches found; generated remediation report only.</p>
                  )}

                  {remediationResult.skippedIssues.length > 0 && (
                    <p className="text-xs text-amber-600 mb-4">{remediationResult.skippedIssues.length} issue(s) skipped — see PR for details</p>
                  )}
                  <a
                    href={remediationResult.prUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-lg shadow-sm transition text-sm"
                  >
                    <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
                    </svg>
                    Open Pull Request
                  </a>
                  <button
                    onClick={() => { setShowRemediationModal(false); setRemediationStep(null); setRemediationResult(null); clearSelection(); }}
                    className="block mx-auto mt-3 text-sm text-gray-500 hover:text-gray-700"
                  >
                    Close
                  </button>
                </div>
              )}

              {/* ── ERROR STATE ── */}
              {remediationStep === "error" && (
                <div className="text-center py-4">
                  <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <svg className="w-8 h-8 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </div>
                  <h4 className="text-lg font-bold text-gray-900 mb-1">PR Creation Failed</h4>
                  <p className="text-sm text-red-600 mb-4">{remediationError}</p>
                  <button
                    onClick={() => { setRemediationStep(null); setRemediationError(null); }}
                    className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg text-sm transition"
                  >
                    Try Again
                  </button>
                </div>
              )}

              {/* ── LOADING STATE ── */}
              {remediationStep && remediationStep !== "complete" && remediationStep !== "error" && (
                <div className="text-center py-8">
                  <div className="animate-spin h-10 w-10 border-4 border-emerald-600 border-t-transparent rounded-full mx-auto mb-4" />
                  <p className="text-sm font-semibold text-gray-700">
                    {remediationStep === "creating_branch" && "Creating branch..."}
                    {remediationStep === "committing" && "Committing remediation report..."}
                    {remediationStep === "opening_pr" && "Opening pull request..."}
                    {remediationStep === "connecting" && "Connecting to GitHub..."}
                    {remediationStep === "loading_repos" && "Loading repositories..."}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">This may take a few seconds</p>
                </div>
              )}

              {/* ── FORM STATE ── */}
              {!remediationStep && (
                <>
                  {/* GitHub connection */}
                  {githubConnected === false && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                      <h4 className="text-sm font-bold text-amber-800 mb-1">GitHub Not Connected</h4>
                      <p className="text-xs text-amber-700 mb-3">Connect your GitHub account to create pull requests.</p>
                      <button
                        onClick={() => signIn("github", { callbackUrl: window.location.href })}
                        className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 hover:bg-gray-800 text-white font-medium rounded-lg text-sm transition"
                      >
                        <svg className="w-4 h-4" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
                        </svg>
                        Connect GitHub
                      </button>
                    </div>
                  )}

                  {/* Repo selector */}
                  {githubConnected && (
                    <>
                      <div>
                        <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Repository</label>
                        {loadingRepos ? (
                          <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
                            <div className="animate-spin h-4 w-4 border-2 border-gray-300 border-t-gray-600 rounded-full" />
                            Loading repositories...
                          </div>
                        ) : (
                          <>
                            <input
                              type="text"
                              placeholder="Search repositories..."
                              value={repoSearch}
                              onChange={(e) => setRepoSearch(e.target.value)}
                              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 mb-2"
                            />
                            <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg">
                              {repos
                                .filter(r => r.fullName.toLowerCase().includes(repoSearch.toLowerCase()))
                                .map((repo) => (
                                  <button
                                    key={repo.id}
                                    onClick={() => { setSelectedRepo(repo.fullName); loadBranches(repo.fullName); }}
                                    className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-100 last:border-0 flex items-center justify-between ${
                                      selectedRepo === repo.fullName ? "bg-emerald-50 text-emerald-800" : "text-gray-700"
                                    }`}
                                  >
                                    <span className="font-medium truncate">{repo.fullName}</span>
                                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                      repo.private ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"
                                    }`}>
                                      {repo.private ? "PRIVATE" : "PUBLIC"}
                                    </span>
                                  </button>
                                ))}
                              {repos.filter(r => r.fullName.toLowerCase().includes(repoSearch.toLowerCase())).length === 0 && (
                                <p className="text-sm text-gray-400 text-center py-4">No repositories found</p>
                              )}
                            </div>
                          </>
                        )}
                      </div>

                      {/* Branch selector */}
                      {selectedRepo && (
                        <div>
                          <label className="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Base Branch</label>
                          {loadingBranches ? (
                            <div className="flex items-center gap-2 text-sm text-gray-400 py-2">
                              <div className="animate-spin h-4 w-4 border-2 border-gray-300 border-t-gray-600 rounded-full" />
                              Loading branches...
                            </div>
                          ) : (
                            <select
                              value={selectedBranch}
                              onChange={(e) => setSelectedBranch(e.target.value)}
                              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
                            >
                              <option value="">Select a branch</option>
                              {branches.map((branch) => (
                                <option key={branch.name} value={branch.name}>
                                  {branch.name} {branch.protected ? "(protected)" : ""}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      )}

                      {/* Upgraded Remediation Plan Preview */}
                      {selectedRepo && selectedBranch && (
                        <div className="bg-gray-50 border border-gray-250 rounded-xl p-3.5 space-y-3">
                          <div className="flex items-center justify-between border-b pb-2">
                            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Remediation Plan Preview</span>
                            {loadingPlan ? (
                              <span className="text-[10px] font-semibold text-gray-400 flex items-center gap-1">
                                <div className="animate-spin h-2.5 w-2.5 border border-gray-300 border-t-gray-600 rounded-full" />
                                Planning...
                              </span>
                            ) : remediationPlan ? (
                              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 uppercase">
                                Framework: {remediationPlan.framework.replace("-", " ")}
                              </span>
                            ) : null}
                          </div>

                          {loadingPlan && (
                            <p className="text-xs text-gray-400 py-2 italic text-center">Analyzing project files to plan code patches...</p>
                          )}

                          {!loadingPlan && remediationPlan && (
                            <div className="space-y-2">
                              {/* Direct patches list */}
                              {remediationPlan.patches.some(p => p.action === "direct_patch_ready") ? (
                                <div>
                                  <h5 className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider mb-1">Code Patches (Will Modify Files)</h5>
                                  <div className="space-y-1.5 max-h-28 overflow-y-auto pr-1">
                                    {remediationPlan.patches
                                      .filter(p => p.action === "direct_patch_ready")
                                      .map(p => {
                                        const issue = audit?.issues.find(i => i.id === p.issueId);
                                        return (
                                          <div key={p.issueId} className="text-xs text-gray-700 bg-emerald-50/50 border border-emerald-100 rounded p-1.5 flex flex-col gap-0.5">
                                            <div className="flex items-center justify-between">
                                              <span className="font-semibold">{issue ? getIssueTitle(issue) : p.ruleId}</span>
                                              <span className="text-[9px] font-bold text-emerald-700 uppercase bg-emerald-50 px-1 rounded">DIRECT FIX</span>
                                            </div>
                                            <span className="text-[10px] text-gray-500 font-mono truncate">Target: {p.targetFile}</span>
                                          </div>
                                        );
                                      })}
                                  </div>
                                </div>
                              ) : null}

                              {/* Report only list */}
                              {remediationPlan.patches.some(p => p.action === "report_only") ? (
                                <div>
                                  <h5 className="text-[10px] font-bold text-amber-800 uppercase tracking-wider mb-1">Report-Only (Requires Manual Review)</h5>
                                  <div className="space-y-1.5 max-h-24 overflow-y-auto pr-1">
                                    {remediationPlan.patches
                                      .filter(p => p.action === "report_only")
                                      .map(p => {
                                        const issue = audit?.issues.find(i => i.id === p.issueId);
                                        return (
                                          <div key={p.issueId} className="text-xs text-gray-700 bg-amber-50/50 border border-amber-100 rounded p-1.5 flex flex-col gap-0.5">
                                            <div className="flex items-center justify-between">
                                              <span className="font-semibold truncate max-w-[280px]">{issue ? getIssueTitle(issue) : p.ruleId}</span>
                                              <span className="text-[9px] font-bold text-amber-700 uppercase bg-amber-50 px-1 rounded">MANUAL</span>
                                            </div>
                                            <span className="text-[10px] text-gray-500">{p.reason}</span>
                                          </div>
                                        );
                                      })}
                                  </div>
                                </div>
                              ) : null}

                              <div className="text-[10px] text-gray-400 bg-white border border-gray-200 rounded p-2 italic leading-relaxed">
                                💡 <strong>Safety note:</strong> UX-Auditor only applies safe, high-confidence patches. Some issues may require manual review.
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Generate PR button */}
                      <button
                        onClick={generatePR}
                        disabled={!selectedRepo || !selectedBranch || selectedIssueIds.size === 0}
                        className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold rounded-lg shadow-sm transition text-sm"
                      >
                        Generate Pull Request
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
