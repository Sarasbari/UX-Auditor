import { NextResponse } from "next/server";
import { auth } from "@/lib/services/auth";
import { getGitHubTokenForUser, listUserRepositories } from "@/lib/github/client";
import { GitHubTokenMissingError, GitHubPermissionError } from "@/lib/github/errors";

/**
 * GET /api/github/repos
 * Returns repositories the authenticated user has push access to.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const token = await getGitHubTokenForUser(session.user.id);
    const repos = await listUserRepositories(token);

    // Map to safe response shape (no token info)
    const result = repos.map((repo) => ({
      id: repo.id,
      name: repo.name,
      fullName: repo.full_name,
      owner: repo.owner.login,
      private: repo.private,
      defaultBranch: repo.default_branch,
    }));

    return NextResponse.json(result);
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
    console.error("Failed to list repos:", error);
    return NextResponse.json({ error: "Failed to fetch repositories" }, { status: 500 });
  }
}
