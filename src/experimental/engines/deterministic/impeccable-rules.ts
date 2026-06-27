import type { DeterministicFinding } from "@/types";

export interface ImpeccableRule {
  id: string;
  name: string;
  description: string;
  category: "design_quality" | "custom_rule";
  severity: "critical" | "serious" | "moderate" | "minor";
  check: (html: string, computedStyles: Record<string, string>[]) => ImpeccableViolation[];
}

export interface ImpeccableViolation {
  ruleId: string;
  elementSelector: string;
  description: string;
  fixSuggestion: string;
  domSnippet?: string;
}

const OVERUSED_FONTS = [
  "inter", "arial", "helvetica", "roboto", "open sans", "lato",
  "montserrat", "poppins", "nunito", "raleway",
];

const BOUNCE_EASINGS = [
  "cubic-bezier(0.68, -0.55, 0.265, 1.55)",
  "cubic-bezier(0.175, 0.885, 0.32, 1.275)",
  "ease-in-out-back",
  "bounce",
];

export const impeccableRules: ImpeccableRule[] = [
  {
    id: "overused-font",
    name: "Overused Font",
    description: "Using generic, overused fonts that make the design feel AI-generated",
    category: "design_quality",
    severity: "moderate",
    check: (html, styles) => {
      const violations: ImpeccableViolation[] = [];
      styles.forEach(style => {
        const fontFamily = style["font-family"]?.toLowerCase() || "";
        if (OVERUSED_FONTS.some(font => fontFamily.includes(font))) {
          violations.push({
            ruleId: "overused-font",
            elementSelector: style.selector,
            description: `Using overused font: ${style["font-family"]}`,
            fixSuggestion: "Consider using a distinctive font like Geist, Satoshi, General Sans, or a system font stack with intentional fallbacks",
          });
        }
      });
      return violations;
    },
  },
  {
    id: "gray-text-on-color",
    name: "Gray Text on Colored Background",
    description: "Gray text on colored backgrounds reduces readability",
    category: "design_quality",
    severity: "serious",
    check: (html, styles) => {
      const violations: ImpeccableViolation[] = [];
      styles.forEach(style => {
        const bgColor = style["background-color"] || "";
        const color = style["color"] || "";
        if (bgColor !== "rgba(0, 0, 0, 0)" && bgColor !== "rgb(255, 255, 255)" && bgColor !== "#ffffff" && bgColor !== "#fff") {
          if (color.includes("rgb(128") || color.includes("rgb(107") || color.includes("#808080") || color.includes("gray")) {
            violations.push({
              ruleId: "gray-text-on-color",
              elementSelector: style.selector,
              description: "Gray text on a colored background",
              fixSuggestion: "Use white, near-white, or a tinted light color that matches the background hue",
            });
          }
        }
      });
      return violations;
    },
  },
  {
    id: "pure-black",
    name: "Pure Black Text",
    description: "Pure black (#000, rgb(0,0,0)) creates harsh contrast. Always tint.",
    category: "design_quality",
    severity: "minor",
    check: (html, styles) => {
      const violations: ImpeccableViolation[] = [];
      styles.forEach(style => {
        const color = style["color"] || "";
        if (color === "rgb(0, 0, 0)" || color === "#000" || color === "#000000") {
          violations.push({
            ruleId: "pure-black",
            elementSelector: style.selector,
            description: "Pure black text creates harsh contrast",
            fixSuggestion: "Use a dark tinted color like #1a1a2e, #0f172a, or #18181b",
          });
        }
      });
      return violations;
    },
  },
  {
    id: "bounce-easing",
    name: "Bounce/Elastic Easing",
    description: "Bounce easing feels dated and unprofessional",
    category: "design_quality",
    severity: "moderate",
    check: (html) => {
      const violations: ImpeccableViolation[] = [];
      BOUNCE_EASINGS.forEach(easing => {
        const regex = new RegExp(easing.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
        const matches = html.match(regex);
        if (matches) {
          violations.push({
            ruleId: "bounce-easing",
            elementSelector: "global",
            description: `Found bounce/elastic easing: ${easing}`,
            fixSuggestion: "Use smooth easing like cubic-bezier(0.4, 0, 0.2, 1) or spring physics",
          });
        }
      });
      return violations;
    },
  },
  {
    id: "nested-cards",
    name: "Nested Cards",
    description: "Cards nested inside cards create visual noise",
    category: "design_quality",
    severity: "moderate",
    check: (html) => {
      const violations: ImpeccableViolation[] = [];
      const cardPatterns = [
        /class="[^"]*card[^"]*card[^"]*"/gi,
        /class="[^"]*rounded[^"]*shadow[^"]*rounded[^"]*shadow[^"]*"/gi,
      ];
      cardPatterns.forEach(pattern => {
        const matches = html.match(pattern);
        if (matches && matches.length > 0) {
          violations.push({
            ruleId: "nested-cards",
            elementSelector: "multiple elements",
            description: "Detected nested card patterns",
            fixSuggestion: "Remove inner card styling. Use spacing and subtle dividers instead of nesting visual containers.",
          });
        }
      });
      return violations;
    },
  },
  {
    id: "purple-gradient",
    name: "Purple-to-Blue Gradient",
    description: "The purple-to-blue gradient is the most common AI-generated pattern",
    category: "design_quality",
    severity: "minor",
    check: (html) => {
      const violations: ImpeccableViolation[] = [];
      const gradientPatterns = [
        /linear-gradient[^)]*purple[^)]*blue/gi,
        /linear-gradient[^)]*#7c3aed[^)]*#3b82f6/gi,
        /linear-gradient[^)]*rgb\(124,\s*58,\s*237\)[^)]*rgb\(59,\s*130,\s*246\)/gi,
        /linear-gradient[^)]*#8b5cf6[^)]*#06b6d4/gi,
      ];
      gradientPatterns.forEach(pattern => {
        if (pattern.test(html)) {
          violations.push({
            ruleId: "purple-gradient",
            elementSelector: "global",
            description: "Detected the overused purple-to-blue gradient pattern",
            fixSuggestion: "Choose gradients that match your brand. Use subtle, tinted gradients or solid colors.",
          });
        }
      });
      return violations;
    },
  },
  {
    id: "small-touch-target",
    name: "Small Touch Target",
    description: "Touch targets should be at least 44x44px for mobile accessibility",
    category: "design_quality",
    severity: "serious",
    check: (html, styles) => {
      const violations: ImpeccableViolation[] = [];
      styles.forEach(style => {
        const selector = style.selector || "";
        if (selector.includes("button") || selector.includes("a.") || selector.includes("input") || selector.includes("[role=")) {
          const width = parseInt(style.width) || 0;
          const height = parseInt(style.height) || 0;
          const padding = parseInt(style.padding) || 0;
          if ((width > 0 && width < 44) || (height > 0 && height < 44)) {
            violations.push({
              ruleId: "small-touch-target",
              elementSelector: selector,
              description: `Touch target is too small (${width}x${height}px)`,
              fixSuggestion: "Increase size to at least 44x44px. Use padding to expand clickable area.",
            });
          }
        }
      });
      return violations;
    },
  },
  {
    id: "cramped-padding",
    name: "Cramped Padding",
    description: "Elements with insufficient padding feel claustrophobic",
    category: "design_quality",
    severity: "minor",
    check: (html, styles) => {
      const violations: ImpeccableViolation[] = [];
      styles.forEach(style => {
        const selector = style.selector || "";
        if (selector.includes("card") || selector.includes("panel") || selector.includes("section")) {
          const padding = parseInt(style.padding) || 0;
          if (padding > 0 && padding < 12) {
            violations.push({
              ruleId: "cramped-padding",
              elementSelector: selector,
              description: `Padding is too tight (${padding}px)`,
              fixSuggestion: "Use at least 16px padding for content containers, 24px+ for cards",
            });
          }
        }
      });
      return violations;
    },
  },
  {
    id: "skipped-heading",
    name: "Skipped Heading Level",
    description: "Heading levels should not skip (e.g., h1 to h3)",
    category: "design_quality",
    severity: "serious",
    check: (html) => {
      const violations: ImpeccableViolation[] = [];
      const headingRegex = /<h([1-6])[^>]*>/gi;
      const headings: number[] = [];
      let match;
      while ((match = headingRegex.exec(html)) !== null) {
        headings.push(parseInt(match[1]));
      }
      for (let i = 1; i < headings.length; i++) {
        if (headings[i] > headings[i - 1] + 1) {
          violations.push({
            ruleId: "skipped-heading",
            elementSelector: `h${headings[i]}`,
            description: `Heading level skipped from h${headings[i - 1]} to h${headings[i]}`,
            fixSuggestion: `Use h${headings[i - 1] + 1} instead, or restructure heading hierarchy`,
          });
        }
      }
      return violations;
    },
  },
  {
    id: "dark-glow",
    name: "Dark Glow Effect",
    description: "Dark glow/shadow effects are a common AI-generated pattern",
    category: "design_quality",
    severity: "minor",
    check: (html) => {
      const violations: ImpeccableViolation[] = [];
      const glowPatterns = [
        /box-shadow[^;]*rgba\(0,\s*0,\s*0,\s*0\.[5-9]/gi,
        /box-shadow[^;]*rgba\(0,\s*0,\s*0,\s*1/gi,
        /0\s+0\s+\d+px\s+rgba\(0,\s*0,\s*0/gi,
      ];
      glowPatterns.forEach(pattern => {
        if (pattern.test(html)) {
          violations.push({
            ruleId: "dark-glow",
            elementSelector: "global",
            description: "Detected heavy dark glow/shadow effects",
            fixSuggestion: "Use subtle shadows with low opacity (0.1-0.2) and slight color tinting",
          });
        }
      });
      return violations;
    },
  },
];

export function runImpeccableAnalysis(
  html: string,
  computedStyles: Record<string, string>[]
): DeterministicFinding[] {
  const findings: DeterministicFinding[] = [];

  impeccableRules.forEach(rule => {
    const violations = rule.check(html, computedStyles);
    violations.forEach(violation => {
      findings.push({
        ruleId: violation.ruleId,
        engine: "impeccable",
        severity: rule.severity,
        category: rule.category,
        elementSelector: violation.elementSelector,
        description: violation.description,
        fixSuggestion: violation.fixSuggestion,
        domSnippet: violation.domSnippet,
      });
    });
  });

  return findings;
}
