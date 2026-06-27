import type { Page } from "playwright";
import type { MergedIssue, FixDiff, DeterministicFinding } from "@/types";
import { runAxeAnalysis } from "../deterministic/capture";
import { runImpeccableAnalysis } from "../deterministic/impeccable-rules";

export interface VerifiedFix {
  issueId: string;
  status: "success" | "failed";
  fixDiff: FixDiff;
  originalScreenshot: Buffer;
  patchedScreenshot: Buffer;
}

export async function applyAndVerifyFixes(
  page: Page,
  issues: MergedIssue[],
  html: string,
  computedStyles: Record<string, string>[]
): Promise<VerifiedFix[]> {
  const fixes: VerifiedFix[] = [];
  const fixableIssues = issues.filter(issue => isFixable(issue));

  for (const issue of fixableIssues) {
    try {
      const fix = await attemptFix(page, issue, html, computedStyles);
      if (fix) {
        fixes.push(fix);
      }
    } catch (error) {
      console.error(`Failed to fix issue ${issue.id}:`, error);
    }
  }

  return fixes;
}

function isFixable(issue: MergedIssue): boolean {
  if (issue.source === "llm") return false;

  const fixableRules = [
    "color-contrast", "image-alt", "label", "aria-label",
    "heading-order", "html-has-lang", "link-name", "button-name",
    "input-image-alt", "select-name", "textarea-name",
    "overused-font", "pure-black", "gray-text-on-color",
  ];

  return fixableRules.some(rule =>
    issue.sources.some(s => s.includes(rule))
  );
}

async function attemptFix(
  page: Page,
  issue: MergedIssue,
  html: string,
  computedStyles: Record<string, string>[]
): Promise<VerifiedFix | null> {
  const selector = issue.elementSelector;
  if (!selector || selector === "global" || selector === "multiple elements") {
    return null;
  }

  const originalScreenshot = await page.screenshot({ type: "png" });

  const fixApplied = await page.evaluate(({ sel, fixDiff }) => {
    try {
      const el = document.querySelector(sel);
      if (!el) return false;

      if (fixDiff.attributeName && fixDiff.attributeValue !== undefined) {
        el.setAttribute(fixDiff.attributeName, fixDiff.attributeValue);
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }, {
    sel: selector,
    fixDiff: generateFixDiff(issue),
  });

  if (!fixApplied) return null;

  const patchedScreenshot = await page.screenshot({ type: "png" });

  const recheckResults = await recheckIssue(page, issue, html, computedStyles);
  const status = recheckResults ? "success" : "failed";

  return {
    issueId: issue.id,
    status,
    fixDiff: generateFixDiff(issue),
    originalScreenshot,
    patchedScreenshot,
  };
}

function generateFixDiff(issue: MergedIssue): FixDiff {
  const selector = issue.elementSelector || "";

  if (issue.sources.some(s => s.includes("image-alt"))) {
    return {
      type: "dom_patch",
      original: "<img>",
      patched: '<img alt="Descriptive alt text">',
      selector,
      attributeName: "alt",
      attributeValue: "Descriptive alt text",
    };
  }

  if (issue.sources.some(s => s.includes("aria-label"))) {
    return {
      type: "dom_patch",
      original: "<element>",
      patched: '<element aria-label="Accessible label">',
      selector,
      attributeName: "aria-label",
      attributeValue: "Accessible label",
    };
  }

  if (issue.sources.some(s => s.includes("label"))) {
    return {
      type: "dom_patch",
      original: "<input>",
      patched: '<input aria-label="Field label">',
      selector,
      attributeName: "aria-label",
      attributeValue: "Field label",
    };
  }

  if (issue.sources.some(s => s.includes("heading-order"))) {
    return {
      type: "dom_patch",
      original: "<h3>",
      patched: "<h2>",
      selector,
      attributeName: "role",
      attributeValue: "heading",
    };
  }

  if (issue.sources.some(s => s.includes("html-has-lang"))) {
    return {
      type: "dom_patch",
      original: "<html>",
      patched: '<html lang="en">',
      selector: "html",
      attributeName: "lang",
      attributeValue: "en",
    };
  }

  if (issue.sources.some(s => s.includes("color-contrast"))) {
    return {
      type: "dom_patch",
      original: "low contrast text",
      patched: "higher contrast text",
      selector,
      attributeName: "style",
      attributeValue: "color: #1a1a2e",
    };
  }

  return {
    type: "dom_patch",
    original: "original state",
    patched: "fixed state",
    selector,
  };
}

async function recheckIssue(
  page: Page,
  issue: MergedIssue,
  html: string,
  computedStyles: Record<string, string>[]
): Promise<boolean> {
  try {
    if (issue.sources.some(s => s.startsWith("axe-core"))) {
      const axeResults = await runAxeAnalysis(page);
      const stillPresent = axeResults.violations.some(v =>
        v.nodes.some(n =>
          n.target.some(t => t === issue.elementSelector)
        )
      );
      return !stillPresent;
    }

    if (issue.sources.some(s => s.startsWith("impeccable"))) {
      const newHtml = await page.content();
      const newStyles = await page.evaluate(() => {
        const elements = document.querySelectorAll("*");
        const styles: Record<string, string>[] = [];
        elements.forEach((el, i) => {
          if (i > 300) return;
          const computed = window.getComputedStyle(el);
          styles.push({
            selector: el.tagName.toLowerCase() + (el.id ? `#${el.id}` : "") +
              (el.className ? `.${String(el.className).split(" ").join(".")}` : ""),
            "font-family": computed.getPropertyValue("font-family"),
            color: computed.getPropertyValue("color"),
            "background-color": computed.getPropertyValue("background-color"),
          });
        });
        return styles;
      });
      const newFindings = runImpeccableAnalysis(newHtml, newStyles);
      const stillPresent = newFindings.some(f => f.ruleId === issue.sources[0]?.split(":")[1]);
      return !stillPresent;
    }

    return true;
  } catch {
    return false;
  }
}

export function generateCodePatch(fixDiff: FixDiff): string {
  if (fixDiff.type === "dom_patch") {
    if (fixDiff.attributeName && fixDiff.attributeValue) {
      return `<!-- Add ${fixDiff.attributeName}="${fixDiff.attributeValue}" to: -->\n${fixDiff.selector}\n\n<!-- Example: -->\n<element ${fixDiff.attributeName}="${fixDiff.attributeValue}">`;
    }
  }
  return `<!-- Fix for: ${fixDiff.selector} -->\n<!-- ${fixDiff.original} → ${fixDiff.patched} -->`;
}
