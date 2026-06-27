import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/github/link/callback
 * After GitHub OAuth completes via NextAuth, the user is redirected here.
 * This simply redirects back to the page they came from (or dashboard).
 * The actual token persistence happens in the NextAuth jwt callback.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const callbackUrl = url.searchParams.get("callbackUrl") || "/dashboard";

  // Redirect back to the originating page
  return NextResponse.redirect(new URL(callbackUrl, url.origin));
}
