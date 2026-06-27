import { getRepoTree, getFileContent, type GitHubTreeEntry } from "./client";

export type ProjectFramework = "next-app" | "next-pages" | "react-vite" | "html" | "unknown";

export interface RepoContext {
  framework: ProjectFramework;
  usesTailwind: boolean;
  candidateFiles: string[];
  confidence: "high" | "medium" | "low";
}

/**
 * Detect the target framework and project configuration of a GitHub repository.
 */
export async function detectFramework(
  token: string,
  owner: string,
  repo: string,
  branch: string
): Promise<RepoContext> {
  let tree: GitHubTreeEntry[] = [];
  try {
    tree = await getRepoTree(token, owner, repo, branch);
  } catch (error) {
    console.error("Failed to fetch repository tree for framework detection:", error);
  }

  const paths = tree.map((entry) => entry.path);
  const fileSet = new Set(paths);

  // Helper check for path matching
  const hasFile = (pattern: string | RegExp): boolean => {
    if (typeof pattern === "string") {
      return fileSet.has(pattern);
    }
    return paths.some((p) => pattern.test(p));
  };

  let framework: ProjectFramework = "unknown";
  let usesTailwind = false;
  let confidence: "high" | "medium" | "low" = "low";

  // Check for Tailwind Config
  if (hasFile(/tailwind\.config\.(js|ts|cjs|mjs)$/)) {
    usesTailwind = true;
  }

  // Read package.json if it exists to verify dependencies
  let packageJson: any = null;
  if (hasFile("package.json")) {
    try {
      const fileData = await getFileContent(token, owner, repo, "package.json", branch);
      if (fileData) {
        packageJson = JSON.parse(fileData.content);
      }
    } catch (e) {
      console.warn("Failed to parse package.json for project:", e);
    }
  }

  const deps = {
    ...(packageJson?.dependencies || {}),
    ...(packageJson?.devDependencies || {}),
  };

  // 1. Next.js App Router
  const hasNextDep = !!deps["next"];
  const hasAppLayout = hasFile("app/layout.tsx") || hasFile("src/app/layout.tsx") || hasFile("app/layout.jsx") || hasFile("src/app/layout.jsx");
  
  if (hasNextDep && hasAppLayout) {
    framework = "next-app";
    confidence = "high";
  } 
  // 2. Next.js Pages Router
  else if (hasNextDep && (hasFile("pages/_app.tsx") || hasFile("src/pages/_app.tsx") || hasFile("pages/_document.tsx") || hasFile("src/pages/_document.tsx") || hasFile(/src\/pages\/index\.(tsx|jsx|ts|js)$/) || hasFile(/pages\/index\.(tsx|jsx|ts|js)$/))) {
    framework = "next-pages";
    confidence = "high";
  }
  // 3. React/Vite
  else if ((deps["vite"] || deps["@vitejs/plugin-react"]) && (hasFile("src/App.tsx") || hasFile("src/App.jsx") || hasFile("index.html"))) {
    framework = "react-vite";
    confidence = "high";
  }
  // Fallback checks using tree structure if package.json is missing or incomplete
  else if (hasAppLayout) {
    framework = "next-app";
    confidence = "medium";
  } else if (hasFile("pages/_app.tsx") || hasFile("src/pages/_app.tsx") || hasFile("pages/index.tsx")) {
    framework = "next-pages";
    confidence = "medium";
  } else if (hasFile("src/App.tsx") || hasFile("src/App.jsx")) {
    framework = "react-vite";
    confidence = "medium";
  } else if (hasFile("index.html")) {
    framework = "html";
    confidence = "medium";
  }

  // Detect Tailwind from package dependencies if config wasn't found
  if (deps["tailwindcss"]) {
    usesTailwind = true;
  }

  // Filter out node_modules, build outputs, lock files, images/assets to list candidate src files
  const ignorePatterns = [
    /node_modules\//,
    /\.next\//,
    /dist\//,
    /build\//,
    /out\//,
    /\.git\//,
    /public\//,
    /package-lock\.json$/,
    /yarn\.lock$/,
    /pnpm-lock\.yaml$/,
    /\.(png|jpe?g|gif|svg|ico|webp|woff2?|eot|ttf|otf|mp4|webm|zip|tar\.gz)$/i,
  ];

  const candidateFiles = paths.filter((path) => {
    // Only include actual files (type blob)
    const entry = tree.find((e) => e.path === path);
    if (entry?.type !== "blob") return false;

    return !ignorePatterns.some((pattern) => pattern.test(path));
  });

  return {
    framework,
    usesTailwind,
    candidateFiles,
    confidence,
  };
}
