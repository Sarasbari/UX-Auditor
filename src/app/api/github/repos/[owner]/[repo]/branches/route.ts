import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/services/auth";
import { getGitHubTokenForUser, listRepositoryBranches } from "@/lib/github/client";
import { GitHubTokenMissingError, GitHubPermissionError, GitHubNotFoundError } from "@/lib/github/errors";

/**
 * GET /api/github/repos/[owner]/[repo]/branches
 * Returns branches for the specified repository.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { owner, repo } = await params;

    if (!owner || !repo) {
      return NextResponse.json({ error: "Owner and repo are required" }, { status: 400 });
    }

    const token = await getGitHubTokenForUser(session.user.id);
    const branches = await listRepositoryBranches(token, owner, repo);

    const result = branches.map((branch) => ({
      name: branch.name,
      protected: branch.protected,
    }));

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof GitHubTokenMissingError) {
      return NextResponse.json(
        { error: "GitHub account not connected" },
        { status: 403 }
      );
    }
    if (error instanceof GitHubNotFoundError) {
      return NextResponse.json(
        { error: "Repository not found or you don't have access" },
        { status: 404 }
      );
    }
    if (error instanceof GitHubPermissionError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }
    console.error("Failed to list branches:", error);
    return NextResponse.json({ error: "Failed to fetch branches" }, { status: 500 });
  }
}
