import { chromium, type Page, type Browser } from "playwright";
import AxeBuilder from "@axe-core/playwright";

export interface PageCapture {
  url: string;
  screenshot: Buffer;
  html: string;
  computedStyles: Record<string, string>[];
  viewport: { width: number; height: number };
}

export interface AxeResult {
  violations: AxeViolation[];
  passes: AxePass[];
  incomplete: AxeIncomplete[];
}

export interface AxeViolation {
  id: string;
  impact: "minor" | "moderate" | "serious" | "critical";
  description: string;
  help: string;
  helpUrl: string;
  nodes: AxeNode[];
}

export interface AxePass {
  id: string;
  description: string;
  nodes: AxeNode[];
}

export interface AxeIncomplete {
  id: string;
  impact: string;
  description: string;
  nodes: AxeNode[];
}

export interface AxeNode {
  html: string;
  target: string[];
  impact: string;
  message: string;
}

export async function capturePage(url: string): Promise<PageCapture> {
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();

    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);

    const screenshot = await page.screenshot({ fullPage: true, type: "png" });
    const html = await page.content();

    const computedStyles = await page.evaluate(() => {
      const elements = document.querySelectorAll("*");
      const styles: Record<string, string>[] = [];
      const importantProps = [
        "font-family", "font-size", "color", "background-color",
        "padding", "margin", "border-radius", "line-height",
        "letter-spacing", "text-align", "display", "position",
      ];

      elements.forEach((el, i) => {
        if (i > 500) return;
        const computed = window.getComputedStyle(el);
        const style: Record<string, string> = {
          selector: el.tagName.toLowerCase() + (el.id ? `#${el.id}` : "") +
            (el.className ? `.${String(el.className).split(" ").join(".")}` : ""),
        };
        importantProps.forEach(prop => {
          style[prop] = computed.getPropertyValue(prop);
        });
        styles.push(style);
      });
      return styles;
    });

    const viewport = page.viewportSize() || { width: 1440, height: 900 };

    return { url, screenshot, html, computedStyles, viewport };
  } finally {
    if (browser) await browser.close();
  }
}

export async function runAxeAnalysis(page: Page): Promise<AxeResult> {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"])
    .analyze();

  return {
    violations: results.violations.map(v => ({
      id: v.id,
      impact: v.impact as "minor" | "moderate" | "serious" | "critical",
      description: v.description,
      help: v.help,
      helpUrl: v.helpUrl,
      nodes: v.nodes.map(n => ({
        html: n.html,
        target: n.target as string[],
        impact: n.impact as string,
        message: n.failureSummary || "",
      })),
    })),
    passes: results.passes.map(p => ({
      id: p.id,
      description: p.description,
      nodes: p.nodes.map(n => ({
        html: n.html,
        target: n.target as string[],
        impact: "minor",
        message: "",
      })),
    })),
    incomplete: results.incomplete.map(i => ({
      id: i.id,
      impact: i.impact as string,
      description: i.description,
      nodes: i.nodes.map(n => ({
        html: n.html,
        target: n.target as string[],
        impact: n.impact as string,
        message: "",
      })),
    })),
  };
}

export async function captureAndAnalyze(url: string) {
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();

    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(2000);

    const screenshot = await page.screenshot({ fullPage: true, type: "png" });
    const html = await page.content();
    const axeResults = await runAxeAnalysis(page);
    const viewport = page.viewportSize() || { width: 1440, height: 900 };

    const computedStyles = await page.evaluate(() => {
      const elements = document.querySelectorAll("*");
      const styles: Record<string, string>[] = [];
      const importantProps = [
        "font-family", "font-size", "color", "background-color",
        "padding", "margin", "border-radius", "line-height",
      ];

      elements.forEach((el, i) => {
        if (i > 300) return;
        const computed = window.getComputedStyle(el);
        const style: Record<string, string> = {
          selector: el.tagName.toLowerCase() + (el.id ? `#${el.id}` : "") +
            (el.className ? `.${String(el.className).split(" ").join(".")}` : ""),
        };
        importantProps.forEach(prop => {
          style[prop] = computed.getPropertyValue(prop);
        });
        styles.push(style);
      });
      return styles;
    });

    return {
      url,
      screenshot,
      html,
      computedStyles,
      viewport,
      axeResults,
      page,
      browser,
    };
  } catch (error) {
    if (browser) await browser.close();
    throw error;
  }
}
