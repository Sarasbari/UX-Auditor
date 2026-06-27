/**
 * Custom error classes for GitHub API interactions.
 * These provide structured error handling for the GitHub client.
 */

export class GitHubTokenMissingError extends Error {
  constructor(userId?: string) {
    super("GitHub access token not found. Please connect your GitHub account.");
    this.name = "GitHubTokenMissingError";
  }
}

export class GitHubPermissionError extends Error {
  public status: number;
  constructor(message: string = "Insufficient GitHub permissions", status: number = 403) {
    super(message);
    this.name = "GitHubPermissionError";
    this.status = status;
  }
}

export class GitHubNotFoundError extends Error {
  public resource: string;
  constructor(resource: string = "resource") {
    super(`GitHub ${resource} not found`);
    this.name = "GitHubNotFoundError";
    this.resource = resource;
  }
}

export class GitHubConflictError extends Error {
  public resource: string;
  constructor(resource: string = "resource", message?: string) {
    super(message || `GitHub ${resource} already exists`);
    this.name = "GitHubConflictError";
    this.resource = resource;
  }
}

export class GitHubRateLimitError extends Error {
  public resetAt: Date | null;
  constructor(resetTimestamp?: number) {
    const resetAt = resetTimestamp ? new Date(resetTimestamp * 1000) : null;
    super(
      resetAt
        ? `GitHub API rate limit exceeded. Resets at ${resetAt.toISOString()}`
        : "GitHub API rate limit exceeded"
    );
    this.name = "GitHubRateLimitError";
    this.resetAt = resetAt;
  }
}

export class GitHubApiError extends Error {
  public status: number;
  public githubMessage: string;
  constructor(status: number, githubMessage: string) {
    super(`GitHub API error (${status}): ${githubMessage}`);
    this.name = "GitHubApiError";
    this.status = status;
    this.githubMessage = githubMessage;
  }
}
