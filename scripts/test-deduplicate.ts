import assert from "assert";
import { normalizeSelector, deduplicateIssues, calculateDiminishingScore, type RawIssue } from "../src/lib/remediation/deduplicate";

console.log("Running deduplication and scoring tests...");

// ── TEST 1: Selector Normalization ───────────────────────────────────────────
console.log("\nTest 1: Selector Normalization");
const selector1 = "div > .css-1a2b3c > .className_abc123_4 > button.FqfRa";
const selector2 = "div > .css-xyz987 > .className_xyz987_9 > button.abc123";
const norm1 = normalizeSelector(selector1);
const norm2 = normalizeSelector(selector2);

console.log(`  Original 1: ${selector1}`);
console.log(`  Normalized 1: ${norm1}`);
console.log(`  Original 2: ${selector2}`);
console.log(`  Normalized 2: ${norm2}`);

assert.strictEqual(norm1, norm2, "Normalized selectors with dynamic hashes should be identical");
console.log("  ✅ Selector normalization matches correctly.");

// ── TEST 2: Deduplication and Grouping ───────────────────────────────────────
console.log("\nTest 2: Deduplication and Grouping");
const testIssues: RawIssue[] = [];

// Add 10 color-contrast issues (similar expected/actual values, same rule)
for (let i = 0; i < 10; i++) {
  testIssues.push({
    id: `issue-cc-${i}`,
    severity: "serious",
    category: "accessibility",
    elementSelector: `div.content > p.text-${i}`,
    description: "Text contrast ratio is insufficient.",
    fixSuggestion: "Increase text contrast.",
    verifiedFixStatus: "not_applicable",
    source: "axe-core",
    confidence: "high",
    actualValue: `${3.0 + i * 0.1}:1`, // contrast ratios
    expectedValue: "4.5:1",
    ruleId: "color-contrast",
    pageUrl: "http://localhost:3000/page1",
  });
}

// Add 1 target-size issue (different rule, shouldn't group with color-contrast)
testIssues.push({
  id: "issue-ts-1",
  severity: "moderate",
  category: "usability",
  elementSelector: "button.small-btn",
  description: "Touch target size is too small.",
  fixSuggestion: "Increase target size to 44x44px.",
  verifiedFixStatus: "not_applicable",
  source: "custom_heuristic",
  confidence: "medium",
  actualValue: "24x24",
  expectedValue: "44x44",
  ruleId: "target-size",
  pageUrl: "http://localhost:3000/page1",
});

const deduped = deduplicateIssues(testIssues);

console.log(`  Original issues count: ${testIssues.length}`);
console.log(`  Deduplicated issues count: ${deduped.length}`);

// We expect exactly 2 issues (1 grouped color-contrast, 1 target-size)
assert.strictEqual(deduped.length, 2, "Should group 10 color-contrast issues into 1, and keep target-size separate");

const ccGroup = deduped.find(i => i.ruleId === "color-contrast")!;
assert.ok(ccGroup, "Should find the grouped color-contrast issue");
assert.strictEqual(ccGroup.sampleElements.length, 10, "Grouped issue should contain all 10 sample elements");

// Check the summarized description format
assert.ok(ccGroup.description.includes("10 text elements"), "Description should summarize the grouped count");
assert.ok(ccGroup.description.includes("Worst ratio:"), "Description should display the worst ratio");
console.log(`  Grouped description: "${ccGroup.description}"`);
console.log("  ✅ Issues deduplicated and grouped correctly.");

// ── TEST 3: Scoring with Diminishing Returns ───────────────────────────────
console.log("\nTest 3: Scoring with Diminishing Returns");

// If we had 10 individual serious issues under the old system:
// Penalty would be 10 * 8 = 80 points. Score would be 20.
// Under our diminishing returns:
// First serious: 8 points. 9 additional serious: 9 * 0.8 = 7.2 points.
// Total serious penalty = 8 + 7.2 = 15.2 points.
// First moderate: 4 points.
// Total penalty = 19.2 points. Rounded score: 100 - 19 = 81.
const score = calculateDiminishingScore(deduped);
console.log(`  Calculated overall score: ${score}/100`);

assert.strictEqual(score, 81, "Score should reflect diminishing returns and match exactly 81/100");
console.log("  ✅ Scoring matches expected diminishing returns penalty.");

console.log("\n🎉 All tests passed successfully!");
