import type { RepoContext } from "../github/framework";
import { findCandidateFilesForIssue, type DiscoveryIssue } from "../github/discovery";

export interface PatchPlanItem {
  issueId: string;
  ruleId: string | null;
  targetFile: string | null;
  confidence: "high" | "medium" | "low";
  action: "direct_patch_ready" | "report_only";
  reason: string;
}

export interface PatchAdapter {
  canPatch(issue: DiscoveryIssue, context: RepoContext): boolean;
  planPatch(issue: DiscoveryIssue, context: RepoContext): PatchPlanItem;
}

const SUPPORTED_CODE_RULES = [
  "landmark-one-main",
  "meta-viewport",
  "button-name",
  "link-name",
  "label",
  "missing-label",
  "target-size",
  "small-touch-target",
  "color-contrast",
];

// Helper to find the best candidate file
function getBestCandidate(issue: DiscoveryIssue, context: RepoContext): string | null {
  const files = findCandidateFilesForIssue(issue, context);
  return files.length > 0 ? files[0] : null;
}

// ── Next.js App Router Adapter ───────────────────────────────────────────────

export const nextAppAdapter: PatchAdapter = {
  canPatch(issue, context) {
    if (context.framework !== "next-app") return false;
    const ruleId = issue.ruleId || "";
    return SUPPORTED_CODE_RULES.includes(ruleId);
  },

  planPatch(issue, context) {
    const targetFile = getBestCandidate(issue, context);
    const ruleId = issue.ruleId || "";

    if (!targetFile) {
      return {
        issueId: issue.id,
        ruleId,
        targetFile: null,
        confidence: "low",
        action: "report_only",
        reason: "No target layout or page file found for Next.js App Router.",
      };
    }

    return {
      issueId: issue.id,
      ruleId,
      targetFile,
      confidence: "high",
      action: "direct_patch_ready",
      reason: `Safe patch planned for ${targetFile} (Next.js App Router).`,
    };
  },
};

// ── Next.js Pages Router Adapter ──────────────────────────────────────────────

export const nextPagesAdapter: PatchAdapter = {
  canPatch(issue, context) {
    if (context.framework !== "next-pages") return false;
    const ruleId = issue.ruleId || "";
    return SUPPORTED_CODE_RULES.includes(ruleId);
  },

  planPatch(issue, context) {
    const targetFile = getBestCandidate(issue, context);
    const ruleId = issue.ruleId || "";

    if (!targetFile) {
      return {
        issueId: issue.id,
        ruleId,
        targetFile: null,
        confidence: "low",
        action: "report_only",
        reason: "No document, page, or component file found for Next.js Pages Router.",
      };
    }

    return {
      issueId: issue.id,
      ruleId,
      targetFile,
      confidence: "high",
      action: "direct_patch_ready",
      reason: `Safe patch planned for ${targetFile} (Next.js Pages Router).`,
    };
  },
};

// ── React/Vite Adapter ───────────────────────────────────────────────────────

export const reactAdapter: PatchAdapter = {
  canPatch(issue, context) {
    if (context.framework !== "react-vite") return false;
    const ruleId = issue.ruleId || "";
    return SUPPORTED_CODE_RULES.includes(ruleId);
  },

  planPatch(issue, context) {
    const targetFile = getBestCandidate(issue, context);
    const ruleId = issue.ruleId || "";

    if (!targetFile) {
      return {
        issueId: issue.id,
        ruleId,
        targetFile: null,
        confidence: "low",
        action: "report_only",
        reason: "No index.html or React component file found.",
      };
    }

    return {
      issueId: issue.id,
      ruleId,
      targetFile,
      confidence: "high",
      action: "direct_patch_ready",
      reason: `Safe patch planned for React component or file ${targetFile}.`,
    };
  },
};

// ── Plain HTML Adapter ────────────────────────────────────────────────────────

export const htmlAdapter: PatchAdapter = {
  canPatch(issue, context) {
    if (context.framework !== "html") return false;
    const ruleId = issue.ruleId || "";
    return SUPPORTED_CODE_RULES.includes(ruleId);
  },

  planPatch(issue, context) {
    const targetFile = getBestCandidate(issue, context);
    const ruleId = issue.ruleId || "";

    if (!targetFile) {
      return {
        issueId: issue.id,
        ruleId,
        targetFile: null,
        confidence: "low",
        action: "report_only",
        reason: "No index.html file found for plain HTML project.",
      };
    }

    return {
      issueId: issue.id,
      ruleId,
      targetFile,
      confidence: "high",
      action: "direct_patch_ready",
      reason: `Safe HTML patch planned for ${targetFile}.`,
    };
  },
};

// ── Tailwind Adapter ──────────────────────────────────────────────────────────

export const tailwindAdapter: PatchAdapter = {
  canPatch(issue, context) {
    if (!context.usesTailwind) return false;
    const ruleId = issue.ruleId || "";
    return ["target-size", "small-touch-target", "color-contrast"].includes(ruleId);
  },

  planPatch(issue, context) {
    const targetFile = getBestCandidate(issue, context);
    const ruleId = issue.ruleId || "";

    if (!targetFile) {
      return {
        issueId: issue.id,
        ruleId,
        targetFile: null,
        confidence: "low",
        action: "report_only",
        reason: "No styling or components files found to apply Tailwind classes.",
      };
    }

    return {
      issueId: issue.id,
      ruleId,
      targetFile,
      confidence: "medium",
      action: "direct_patch_ready",
      reason: `Planned Tailwind class adjustment in ${targetFile}.`,
    };
  },
};

// ── Master Adapter Router ────────────────────────────────────────────────────

const ADAPTERS: PatchAdapter[] = [
  nextAppAdapter,
  nextPagesAdapter,
  reactAdapter,
  htmlAdapter,
  tailwindAdapter,
];

/**
 * Routes the issue to the correct adapter and constructs a patch plan item.
 */
export function planIssueRemediation(
  issue: DiscoveryIssue,
  context: RepoContext
): PatchPlanItem {
  // Find an adapter that can patch this issue
  const adapter = ADAPTERS.find((a) => a.canPatch(issue, context));

  if (!adapter) {
    return {
      issueId: issue.id,
      ruleId: issue.ruleId || "",
      targetFile: null,
      confidence: "low",
      action: "report_only",
      reason: "No framework-specific adapter supports this issue type.",
    };
  }

  return adapter.planPatch(issue, context);
}
