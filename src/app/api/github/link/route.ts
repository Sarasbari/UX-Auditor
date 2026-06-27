import { NextResponse } from "next/server";
import { auth } from "@/lib/services/auth";
import { prisma } from "@/lib/db/prisma";

/**
 * POST /api/github/link
 * Initiates GitHub OAuth flow specifically for linking a GitHub account
 * to an existing user session. Returns the OAuth URL to redirect to.
 *
 * This uses the same NextAuth GitHub provider but with a specific callback
 * that links the token to the existing user rather than creating a new session.
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    // Build the GitHub OAuth authorization URL with the required scopes
    const clientId = process.env.GITHUB_ID;
    if (!clientId) {
      return NextResponse.json(
        { error: "GitHub OAuth is not configured" },
        { status: 500 }
      );
    }

    // Use NextAuth's built-in signin URL with the github provider
    // The callback will handle token persistence via the jwt callback in auth.ts
    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
    const signInUrl = `${baseUrl}/api/auth/signin/github?callbackUrl=${encodeURIComponent(baseUrl + "/api/github/link/callback")}`;

    return NextResponse.json({ signInUrl });
  } catch (error) {
    console.error("GitHub link initiation failed:", error);
    return NextResponse.json({ error: "Failed to initiate GitHub linking" }, { status: 500 });
  }
}

/**
 * DELETE /api/github/link
 * Disconnects the user's GitHub account by removing the stored token.
 */
export async function DELETE() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    await prisma.user.update({
      where: { id: session.user.id },
      data: { githubAccessToken: null },
    });

    return NextResponse.json({ disconnected: true });
  } catch (error) {
    console.error("GitHub disconnect failed:", error);
    return NextResponse.json({ error: "Failed to disconnect GitHub" }, { status: 500 });
  }
}
