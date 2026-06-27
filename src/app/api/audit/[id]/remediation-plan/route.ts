import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/services/auth";
import { prisma } from "@/lib/db/prisma";
import { getGitHubTokenForUser } from "@/lib/github/client";
import {
  buildCodeRemediationPlan,
  type PlannerIssue,
  type PlannerAudit,
} from "@/lib/remediation/planner";
import {
  GitHubTokenMissingError,
  GitHubPermissionError,
  GitHubNotFoundError,
} from "@/lib/github/errors";

/**
 * POST /api/audit/[id]/remediation-plan
 * Computes a framework-aware code patch plan without applying it.
 * Used to preview planned changes in the UI before submitting a PR.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let branchName = "main";
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { id: auditId } = await params;
    const body = await request.json();
    const { repo, branch = "main", issueIds } = body;
    branchName = branch;

    if (!repo || typeof repo !== "string" || !repo.includes("/")) {
      return NextResponse.json(
        { error: "Invalid repo format. Expected 'owner/name'." },
        { status: 400 }
      );
    }

    if (!Array.isArray(issueIds) || issueIds.length === 0) {
      return NextResponse.json(
        { error: "At least one issue must be selected." },
        { status: 400 }
      );
    }

    // Verify audit exists and belongs to user
    const auditRun = await prisma.auditRun.findUnique({
      where: { id: auditId },
      include: { issues: true },
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

    // Get GitHub token
    const token = await getGitHubTokenForUser(session.user.id);

    const [owner, repoName] = repo.split("/");

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

    // Build the plan
    const plan = await buildCodeRemediationPlan(
      token,
      owner,
      repoName,
      branch,
      plannerAudit,
      selectedIssues
    );

    return NextResponse.json(plan);
  } catch (error) {
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
        { error: `Repository not found or branch not found: ${branchName}` },
        { status: 404 }
      );
    }

    console.error("Remediation planning failed:", error);
    return NextResponse.json(
      { error: "Failed to generate remediation plan" },
      { status: 500 }
    );
  }
}
