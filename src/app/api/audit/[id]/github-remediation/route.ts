import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/services/auth";
import { prisma } from "@/lib/db/prisma";
import {
  getGitHubTokenForUser,
  createBranch,
  createOrUpdateFile,
  createPullRequest,
  getFileContent,
} from "@/lib/github/client";
import {
  GitHubTokenMissingError,
  GitHubPermissionError,
  GitHubNotFoundError,
  GitHubConflictError,
  GitHubRateLimitError,
} from "@/lib/github/errors";
import {
  buildCodeRemediationPlan,
  buildSafeRemediationMarkdown,
  buildPullRequestTitle,
  buildPullRequestBody,
  type PlannerIssue,
  type PlannerAudit,
  type CodePatchResult,
} from "@/lib/remediation/planner";
import { generateCodePatch } from "@/lib/remediation/llm-patcher";

/**
 * POST /api/audit/[id]/github-remediation
 * Creates a GitHub PR with framework-aware code patches and a safe markdown report.
 *
 * Body: {
 *   repo: "owner/name",
 *   baseBranch: "main",
 *   issueIds: ["id1", "id2"],
 *   mode: "safe" | "direct_if_possible"
 * }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { id: auditId } = await params;
    const body = await request.json();

    // ── Validate input ───────────────────────────────────────────────────────
    const { repo, baseBranch, issueIds, mode = "direct_if_possible" } = body;

    if (!repo || typeof repo !== "string" || !repo.includes("/")) {
      return NextResponse.json(
        { error: "Invalid repo format. Expected 'owner/name'." },
        { status: 400 }
      );
    }

    if (!baseBranch || typeof baseBranch !== "string") {
      return NextResponse.json(
        { error: "Base branch is required." },
        { status: 400 }
      );
    }

    if (!Array.isArray(issueIds) || issueIds.length === 0) {
      return NextResponse.json(
        { error: "At least one issue must be selected." },
        { status: 400 }
      );
    }

    // ── Verify audit ownership ───────────────────────────────────────────────
    const auditRun = await prisma.auditRun.findUnique({
      where: { id: auditId },
      include: {
        issues: true,
      },
    });

    if (!auditRun) {
      return NextResponse.json({ error: "Audit not found" }, { status: 404 });
    }

    if (auditRun.userId !== session.user.id) {
      return NextResponse.json(
        { error: "You do not have access to this audit" },
        { status: 403 }
      );
    }

    // ── Verify issue IDs belong to this audit ────────────────────────────────
    const auditIssueIds = new Set(auditRun.issues.map((i) => i.id));
    const invalidIssueIds = issueIds.filter((id: string) => !auditIssueIds.has(id));

    if (invalidIssueIds.length > 0) {
      return NextResponse.json(
        { error: `Issues not found in this audit: ${invalidIssueIds.join(", ")}` },
        { status: 400 }
      );
    }

    // ── Get GitHub token ─────────────────────────────────────────────────────
    const token = await getGitHubTokenForUser(session.user.id);

    // ── Map issues to PlannerIssue ───────────────────────────────────────────
    const selectedIssues: PlannerIssue[] = auditRun.issues
      .filter((i) => issueIds.includes(i.id))
      .map((issue) => ({
        id: issue.id,
        severity: issue.severity.toLowerCase(),
        category: issue.category.toLowerCase(),
        elementSelector: issue.elementSelector,
        description: issue.description,
        fixSuggestion: issue.fixSuggestion,
        fixDiff: issue.fixDiff ? JSON.parse(issue.fixDiff as string) : null,
        verifiedFixStatus: issue.verifiedFixStatus.toLowerCase(),
        source: issue.source.toLowerCase(),
        confidence: (issue.confidence || "MEDIUM").toLowerCase(),
        ruleId: issue.ruleId || null,
        actualValue: issue.actualValue,
        expectedValue: issue.expectedValue,
        pageUrl: issue.pageUrl,
      }));

    const plannerAudit: PlannerAudit = {
      id: auditRun.id,
      url: auditRun.url,
      score: auditRun.score,
      createdAt: auditRun.createdAt.toISOString(),
    };

    // ── Build code remediation plan ──────────────────────────────────────────
    const [owner, repoName] = repo.split("/");
    const shortAuditId = auditRun.id.substring(0, 8);

    const plan = await buildCodeRemediationPlan(
      token,
      owner,
      repoName,
      baseBranch,
      plannerAudit,
      selectedIssues
    );

    // Filter included vs skipped issues
    const included = selectedIssues.filter((issue) => {
      const patch = plan.patches.find((p) => p.issueId === issue.id);
      return patch?.action !== "report_only" || patch?.reason !== "AI-only design suggestion — requires manual review";
    });
    
    const skipped = selectedIssues
      .filter((issue) => {
        const patch = plan.patches.find((p) => p.issueId === issue.id);
        return patch?.action === "report_only";
      })
      .map((issue) => {
        const patch = plan.patches.find((p) => p.issueId === issue.id)!;
        return {
          issue,
          reason: patch.reason,
        };
      });

    // ── Perform code patching if requested ───────────────────────────────────
    const patchedResults: CodePatchResult[] = [];
    const filesToCommit: Map<string, string> = new Map();

    const directPatchIssues = plan.patches.filter((p) => p.action === "direct_patch_ready" && p.targetFile);

    if (mode === "direct_if_possible" && directPatchIssues.length > 0) {
      // Group patches by target file path
      const patchesByFile: Record<string, typeof directPatchIssues> = {};
      for (const p of directPatchIssues) {
        const path = p.targetFile!;
        if (!patchesByFile[path]) patchesByFile[path] = [];
        patchesByFile[path].push(p);
      }

      for (const filePath of Object.keys(patchesByFile)) {
        try {
          // Fetch file content
          const fileData = await getFileContent(token, owner, repoName, filePath, baseBranch);
          if (!fileData) {
            // File not found in repo
            for (const p of patchesByFile[filePath]) {
              patchedResults.push({
                issueId: p.issueId,
                ruleId: p.ruleId || "",
                filePath,
                originalSnippet: "",
                patchedSnippet: "",
                explanation: "",
                success: false,
                error: "Target file not found in repository branch.",
              });
            }
            continue;
          }

          let currentContent = fileData.content;
          const originalContent = fileData.content;
          let fileHasSuccessPatches = false;

          for (const p of patchesByFile[filePath]) {
            const issue = selectedIssues.find((x) => x.id === p.issueId)!;
            const patchResult = await generateCodePatch(
              filePath,
              currentContent,
              issue,
              plan.framework,
              plan.usesTailwind
            );

            if (patchResult.success && patchResult.patchedContent) {
              currentContent = patchResult.patchedContent;
              fileHasSuccessPatches = true;
              patchedResults.push({
                issueId: p.issueId,
                ruleId: p.ruleId || "",
                filePath,
                originalSnippet: patchResult.originalSnippet,
                patchedSnippet: patchResult.patchedSnippet,
                explanation: patchResult.explanation,
                success: true,
              });
            } else {
              patchedResults.push({
                issueId: p.issueId,
                ruleId: p.ruleId || "",
                filePath,
                originalSnippet: patchResult.originalSnippet,
                patchedSnippet: patchResult.patchedSnippet,
                explanation: "",
                success: false,
                error: patchResult.error || "Snippet patch failed validation checks.",
              });
            }
          }

          if (fileHasSuccessPatches && currentContent !== originalContent) {
            filesToCommit.set(filePath, currentContent);
          }
        } catch (e) {
          console.error(`Failed to apply patches to file ${filePath}:`, e);
          for (const p of patchesByFile[filePath]) {
            patchedResults.push({
              issueId: p.issueId,
              ruleId: p.ruleId || "",
              filePath,
              originalSnippet: "",
              patchedSnippet: "",
              explanation: "",
              success: false,
              error: `API error while accessing file: ${e instanceof Error ? e.message : e}`,
            });
          }
        }
      }
    }

    // ── Create remediation record ────────────────────────────────────────────
    const remediation = await prisma.gitHubRemediation.create({
      data: {
        auditRunId: auditRun.id,
        userId: session.user.id,
        repoFullName: repo,
        baseBranch,
        headBranch: "", // will update after branch creation
        status: "IN_PROGRESS",
        selectedIssueIds: JSON.stringify(issueIds),
        includedIssueIds: JSON.stringify(included.map((i) => i.id)),
        skippedIssueIds: JSON.stringify(skipped.map((s) => s.issue.id)),
      },
    });

    try {
      // ── Create branch ────────────────────────────────────────────────────
      const branchName = await createBranch(
        token,
        owner,
        repoName,
        baseBranch,
        `ux-auditor/audit-${shortAuditId}`
      );

      // Update remediation with actual branch name
      await prisma.gitHubRemediation.update({
        where: { id: remediation.id },
        data: { headBranch: branchName },
      });

      // ── Commit modified source files ─────────────────────────────────────
      let lastCommitSha = "";
      for (const [filePath, content] of filesToCommit.entries()) {
        const { commitSha } = await createOrUpdateFile(
          token,
          owner,
          repoName,
          branchName,
          filePath,
          content,
          `fix(ux-auditor): remediate accessibility issues in ${filePath}`
        );
        lastCommitSha = commitSha;
      }

      // ── Create and commit remediation markdown report ────────────────────
      const remediationFilePath = `.ux-auditor/remediations/audit-${shortAuditId}.md`;
      const markdownContent = buildSafeRemediationMarkdown(
        plannerAudit,
        included,
        skipped,
        patchedResults
      );

      const { commitSha: reportCommitSha } = await createOrUpdateFile(
        token,
        owner,
        repoName,
        branchName,
        remediationFilePath,
        markdownContent,
        `chore(ux-auditor): add remediation report for ${included.length} issue(s)`
      );

      if (!lastCommitSha) {
        lastCommitSha = reportCommitSha;
      }

      // ── Create pull request ──────────────────────────────────────────────
      const prTitle = buildPullRequestTitle(plannerAudit, included);
      const prBody = buildPullRequestBody(
        plannerAudit,
        included,
        skipped,
        remediationFilePath,
        plan.framework,
        patchedResults
      );

      const { prUrl, prNumber } = await createPullRequest(
        token,
        owner,
        repoName,
        baseBranch,
        branchName,
        prTitle,
        prBody
      );

      // ── Update remediation record ────────────────────────────────────────
      await prisma.gitHubRemediation.update({
        where: { id: remediation.id },
        data: {
          status: "COMPLETED",
          prUrl,
          prNumber,
        },
      });

      return NextResponse.json({
        prUrl,
        prNumber,
        branchName,
        commitSha: lastCommitSha,
        includedIssues: included.map((i) => i.id),
        skippedIssues: skipped.map((s) => ({
          id: s.issue.id,
          reason: s.reason,
        })),
        patchedResults,
      });
    } catch (innerError) {
      // Mark remediation as failed
      await prisma.gitHubRemediation.update({
        where: { id: remediation.id },
        data: {
          status: "FAILED",
        },
      });
      throw innerError;
    }
  } catch (error) {
    // ── Map GitHub errors to HTTP responses ─────────────────────────────────
    if (error instanceof GitHubTokenMissingError) {
      return NextResponse.json(
        { error: "GitHub account not connected. Please link your GitHub account." },
        { status: 403 }
      );
    }
    if (error instanceof GitHubPermissionError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }
    if (error instanceof GitHubNotFoundError) {
      return NextResponse.json(
        { error: `Repository or branch not found: ${error.resource}` },
        { status: 404 }
      );
    }
    if (error instanceof GitHubConflictError) {
      return NextResponse.json(
        { error: error.message },
        { status: 409 }
      );
    }
    if (error instanceof GitHubRateLimitError) {
      return NextResponse.json(
        { error: error.message },
        { status: 429 }
      );
    }

    console.error("GitHub remediation failed:", error);
    return NextResponse.json(
      { error: "Failed to create GitHub remediation PR" },
      { status: 500 }
    );
  }
}
