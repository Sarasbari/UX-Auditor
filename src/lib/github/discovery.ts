import type { RepoContext } from "./framework";

export interface DiscoveryIssue {
  id: string;
  ruleId: string | null;
  elementSelector: string | null;
  description: string;
}

/**
 * Heuristically finds and ranks the best candidate source files to target for patching an issue.
 */
export function findCandidateFilesForIssue(
  issue: DiscoveryIssue,
  context: RepoContext
): string[] {
  const { framework, candidateFiles } = context;
  const ruleId = issue.ruleId || "";
  const selector = issue.elementSelector || "";

  // 1. Landmark One Main
  if (ruleId === "landmark-one-main") {
    if (framework === "next-app") {
      return candidateFiles.filter((p) =>
        /^(src\/)?app\/page\.(tsx|jsx)$/.test(p) ||
        /^(src\/)?app\/layout\.(tsx|jsx)$/.test(p)
      );
    }
    if (framework === "next-pages") {
      return candidateFiles.filter((p) =>
        /^(src\/)?pages\/index\.(tsx|jsx|ts|js)$/.test(p) ||
        /^(src\/)?pages\/_app\.(tsx|jsx)$/.test(p)
      );
    }
    if (framework === "react-vite") {
      return candidateFiles.filter((p) =>
        /^(src\/)?App\.(tsx|jsx)$/.test(p) ||
        /index\.html$/.test(p)
      );
    }
    return candidateFiles.filter((p) => /index\.html$/.test(p));
  }

  // 2. Meta Viewport
  if (ruleId === "meta-viewport") {
    if (framework === "next-app") {
      return candidateFiles.filter((p) => /^(src\/)?app\/layout\.(tsx|jsx)$/.test(p));
    }
    if (framework === "next-pages") {
      return candidateFiles.filter((p) =>
        /^(src\/)?pages\/_document\.(tsx|jsx|ts|js)$/.test(p) ||
        /^(src\/)?pages\/_app\.(tsx|jsx|ts|js)$/.test(p)
      );
    }
    if (framework === "react-vite") {
      return candidateFiles.filter((p) => /index\.html$/.test(p));
    }
    return candidateFiles.filter((p) => /index\.html$/.test(p));
  }

  // 3. For component-level issues (button-name, link-name, form label, touch target, contrast)
  // We rank candidates based on naming conventions and selector clues.
  const scoredFiles = candidateFiles.map((file) => {
    let score = 0;
    const lowerFile = file.toLowerCase();

    // Prioritize JSX/TSX/HTML files over CSS/JS files
    if (/\.(tsx|jsx|html)$/.test(lowerFile)) {
      score += 10;
    } else if (/\.(ts|js)$/.test(lowerFile)) {
      score += 5;
    } else if (/\.css$/.test(lowerFile)) {
      if (ruleId === "color-contrast") score += 8; // color modifications in CSS
      else score += 1;
    }

    // Prioritize page/main routes
    if (lowerFile.includes("page.tsx") || lowerFile.includes("page.jsx") || lowerFile.includes("index.html") || lowerFile.includes("app.tsx") || lowerFile.includes("app.jsx")) {
      score += 8;
    }

    // Prioritize component directories
    if (lowerFile.includes("components/")) {
      score += 6;
    }

    // If the selector contains clues about component names (e.g. .Navbar, #header)
    if (selector) {
      const parts = selector.split(/[\s\.#:>]+/);
      for (const part of parts) {
        if (part && part.length > 2 && lowerFile.includes(part.toLowerCase())) {
          score += 15; // Strong match if selector part is in filename
        }
      }
    }

    return { file, score };
  });

  // Sort by score descending and return paths with score > 0
  return scoredFiles
    .filter((f) => f.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((f) => f.file)
    .slice(0, 10); // Return top 10 candidate files
}
