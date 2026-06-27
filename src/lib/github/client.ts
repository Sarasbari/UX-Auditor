/**
 * Server-side GitHub REST API client.
 * All functions accept a token parameter — tokens are never logged or exposed.
 */

import { prisma } from "@/lib/db/prisma";
import {
  GitHubTokenMissingError,
  GitHubPermissionError,
  GitHubNotFoundError,
  GitHubConflictError,
  GitHubRateLimitError,
  GitHubApiError,
} from "./errors";

const GITHUB_API = "https://api.github.com";

// ── Types ────────────────────────────────────────────────────────────────────

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  private: boolean;
  default_branch: string;
  permissions?: { push: boolean; admin: boolean };
}

export interface GitHubBranch {
  name: string;
  commit: { sha: string };
  protected: boolean;
}

interface GitHubRef {
  ref: string;
  object: { sha: string; type: string };
}

interface GitHubFileContent {
  name: string;
  path: string;
  sha: string;
  content: string;
  encoding: string;
}

interface GitHubPullRequest {
  number: number;
  html_url: string;
  title: string;
  state: string;
  head: { ref: string; sha: string };
}

interface GitHubCommitResponse {
  content: { sha: string } | null;
  commit: { sha: string };
}

// ── Token retrieval ──────────────────────────────────────────────────────────

export async function getGitHubTokenForUser(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { githubAccessToken: true },
  });

  if (!user?.githubAccessToken) {
    throw new GitHubTokenMissingError(userId);
  }

  return user.githubAccessToken;
}

export async function hasGitHubToken(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { githubAccessToken: true },
  });
  return !!user?.githubAccessToken;
}

// ── Internal fetch helper ────────────────────────────────────────────────────

async function githubFetch<T>(
  token: string,
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = path.startsWith("http") ? path : `${GITHUB_API}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...((options.headers as Record<string, string>) || {}),
    },
  });

  if (response.status === 401) {
    throw new GitHubPermissionError("GitHub token is invalid or expired. Please reconnect your GitHub account.", 401);
  }

  if (response.status === 403) {
    const rateLimitRemaining = response.headers.get("x-ratelimit-remaining");
    if (rateLimitRemaining === "0") {
      const resetHeader = response.headers.get("x-ratelimit-reset");
      throw new GitHubRateLimitError(resetHeader ? parseInt(resetHeader, 10) : undefined);
    }
    throw new GitHubPermissionError("You do not have permission to access this resource on GitHub.", 403);
  }

  if (response.status === 404) {
    throw new GitHubNotFoundError("resource");
  }

  if (response.status === 422) {
    const body = await response.json().catch(() => ({}));
    const msg = body?.message || "Validation failed";
    throw new GitHubConflictError("resource", msg);
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new GitHubApiError(response.status, body?.message || response.statusText);
  }

  // Handle 204 No Content
  if (response.status === 204) {
    return {} as T;
  }

  return response.json();
}

// ── Repository operations ────────────────────────────────────────────────────

export async function listUserRepositories(token: string): Promise<GitHubRepo[]> {
  const allRepos: GitHubRepo[] = [];
  let page = 1;
  const perPage = 100;

  // Fetch up to 500 repos (5 pages)
  while (page <= 5) {
    const repos = await githubFetch<GitHubRepo[]>(
      token,
      `/user/repos?per_page=${perPage}&page=${page}&sort=updated&direction=desc&affiliation=owner,collaborator,organization_member`
    );

    allRepos.push(...repos);

    if (repos.length < perPage) break;
    page++;
  }

  // Filter to repos the user can push to
  return allRepos.filter(
    (repo) => repo.permissions?.push || repo.permissions?.admin
  );
}

// ── Branch operations ────────────────────────────────────────────────────────

export async function listRepositoryBranches(
  token: string,
  owner: string,
  repo: string
): Promise<GitHubBranch[]> {
  return githubFetch<GitHubBranch[]>(
    token,
    `/repos/${owner}/${repo}/branches?per_page=100`
  );
}

export async function getDefaultBranch(
  token: string,
  owner: string,
  repo: string
): Promise<string> {
  const repoData = await githubFetch<GitHubRepo>(
    token,
    `/repos/${owner}/${repo}`
  );
  return repoData.default_branch;
}

// ── File operations ──────────────────────────────────────────────────────────

export async function getFileContent(
  token: string,
  owner: string,
  repo: string,
  path: string,
  ref?: string
): Promise<{ content: string; sha: string } | null> {
  try {
    const queryRef = ref ? `?ref=${encodeURIComponent(ref)}` : "";
    const file = await githubFetch<GitHubFileContent>(
      token,
      `/repos/${owner}/${repo}/contents/${path}${queryRef}`
    );
    const content = Buffer.from(file.content, "base64").toString("utf-8");
    return { content, sha: file.sha };
  } catch (error) {
    if (error instanceof GitHubNotFoundError) {
      return null;
    }
    throw error;
  }
}

// ── Branch creation ──────────────────────────────────────────────────────────

export async function createBranch(
  token: string,
  owner: string,
  repo: string,
  baseBranch: string,
  newBranch: string
): Promise<string> {
  // Get the SHA of the base branch
  const ref = await githubFetch<GitHubRef>(
    token,
    `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(baseBranch)}`
  );
  const baseSha = ref.object.sha;

  try {
    await githubFetch<GitHubRef>(token, `/repos/${owner}/${repo}/git/refs`, {
      method: "POST",
      body: JSON.stringify({
        ref: `refs/heads/${newBranch}`,
        sha: baseSha,
      }),
    });
  } catch (error) {
    if (error instanceof GitHubConflictError) {
      // Branch already exists — try with timestamp suffix
      const timestampBranch = `${newBranch}-${Date.now()}`;
      await githubFetch<GitHubRef>(token, `/repos/${owner}/${repo}/git/refs`, {
        method: "POST",
        body: JSON.stringify({
          ref: `refs/heads/${timestampBranch}`,
          sha: baseSha,
        }),
      });
      return timestampBranch;
    }
    throw error;
  }

  return newBranch;
}

// ── File creation/update ─────────────────────────────────────────────────────

export async function createOrUpdateFile(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  path: string,
  content: string,
  message: string
): Promise<{ sha: string; commitSha: string }> {
  // Check if file already exists to get its SHA for update
  const existing = await getFileContent(token, owner, repo, path, branch);

  const body: Record<string, string> = {
    message,
    content: Buffer.from(content, "utf-8").toString("base64"),
    branch,
  };

  if (existing) {
    body.sha = existing.sha;
  }

  const result = await githubFetch<GitHubCommitResponse>(
    token,
    `/repos/${owner}/${repo}/contents/${path}`,
    {
      method: "PUT",
      body: JSON.stringify(body),
    }
  );

  return {
    sha: result.content?.sha || "",
    commitSha: result.commit.sha,
  };
}

// ── Pull request creation ────────────────────────────────────────────────────

export async function createPullRequest(
  token: string,
  owner: string,
  repo: string,
  baseBranch: string,
  headBranch: string,
  title: string,
  body: string
): Promise<{ prUrl: string; prNumber: number }> {
  const pr = await githubFetch<GitHubPullRequest>(
    token,
    `/repos/${owner}/${repo}/pulls`,
    {
      method: "POST",
      body: JSON.stringify({
        title,
        body,
        head: headBranch,
        base: baseBranch,
      }),
    }
  );

  return {
    prUrl: pr.html_url,
    prNumber: pr.number,
  };
}

// ── Recursive Git Tree ───────────────────────────────────────────────────────

export interface GitHubTreeEntry {
  path: string;
  mode: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
  url: string;
}

export interface GitHubTreeResponse {
  sha: string;
  url: string;
  tree: GitHubTreeEntry[];
  truncated: boolean;
}

export async function getRepoTree(
  token: string,
  owner: string,
  repo: string,
  branch: string
): Promise<GitHubTreeEntry[]> {
  try {
    const response = await githubFetch<GitHubTreeResponse>(
      token,
      `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`
    );
    return response.tree || [];
  } catch (error) {
    if (error instanceof GitHubNotFoundError) {
      // Fallback: try default branch ref instead of full name
      const defaultBranch = await getDefaultBranch(token, owner, repo);
      const response = await githubFetch<GitHubTreeResponse>(
        token,
        `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(defaultBranch)}?recursive=1`
      );
      return response.tree || [];
    }
    throw error;
  }
}

