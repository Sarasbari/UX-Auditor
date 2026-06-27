import { NextResponse } from "next/server";
import { auth } from "@/lib/services/auth";
import { hasGitHubToken } from "@/lib/github/client";

/**
 * GET /api/github/status
 * Returns whether the current user has a GitHub token stored.
 * Never exposes the token itself.
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const connected = await hasGitHubToken(session.user.id);

    return NextResponse.json({ connected });
  } catch (error) {
    console.error("GitHub status check failed:", error);
    return NextResponse.json({ error: "Failed to check GitHub status" }, { status: 500 });
  }
}
