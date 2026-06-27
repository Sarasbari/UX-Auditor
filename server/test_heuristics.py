import unittest
import uuid
from server.llm_layer import (
    normalize_selector,
    calculate_ux_score,
    rerank_and_generate_fixes
)

class TestHeuristicsAndScoring(unittest.TestCase):
    def test_normalize_selector(self):
        # 1. Strip IDs when classes exist
        self.assertEqual(normalize_selector("button#btn-123.login_btn"), "button.login_btn")
        self.assertEqual(normalize_selector("div#menu-item-5.active.link"), "div.active.link")
        
        # 2. Convert specific numeric IDs when no classes exist
        self.assertEqual(normalize_selector("div#card-105"), "div#[id]")
        self.assertEqual(normalize_selector("section#section123"), "section#[id]")
        
        # 3. Strip nth-child pseudo classes
        self.assertEqual(normalize_selector("div > ul > li:nth-child(2) > a"), "div > ul > li > a")
        self.assertEqual(normalize_selector("tr:nth-of-type(odd) > td"), "tr > td")

    def test_calculate_ux_score_diminishing_and_cap(self):
        # Base case: no issues -> score 100
        self.assertEqual(calculate_ux_score([]), 100)

        # Repeated moderate issues (e.g. tap target)
        # Without cap/diminishing returns, 15 moderate issues * 4 penalty = 60 deduction -> score 40
        # With diminishing returns, penalties are 4 * (0.5^i) = 4 + 2 + 1 + 0.5 + 0.25... = ~8
        # Category cap for no critical issues is 20
        issues = []
        for i in range(15):
            issues.append({
                "id": f"issue-{i}",
                "ruleId": "small-touch-target",
                "severity": "moderate",
                "category": "ux_heuristic"
            })
            
        score = calculate_ux_score(issues)
        # Diminishing returns: 4 + 2 + 1 + 0.5 + 0.25... sum is slightly under 8.0
        # Capped at category cap (20). So penalty should be ~8. Score should be ~92.
        self.assertGreaterEqual(score, 90)
        self.assertLessEqual(score, 95)

        # Massive number of minor issues
        issues_minor = []
        for i in range(100):
            issues_minor.append({
                "id": f"issue-{i}",
                "ruleId": "minor-issue",
                "severity": "minor",
                "category": "ux_heuristic"
            })
        score_minor = calculate_ux_score(issues_minor)
        # 1 + 0.5 + 0.25 + 0.125... = ~2.0 penalty. Score should be ~98.
        self.assertGreaterEqual(score_minor, 97)
        self.assertLessEqual(score_minor, 99)

        # Repeated serious issues in the same category without critical
        # 10 serious issues of different ruleIds (each start at 8 penalty)
        # Capped at category cap (20)
        issues_serious = []
        for i in range(10):
            issues_serious.append({
                "id": f"issue-{i}",
                "ruleId": f"rule-{i}",
                "severity": "serious",
                "category": "ux_heuristic"
            })
        score_serious = calculate_ux_score(issues_serious)
        # Each rule has 1 issue, so no diminishing returns within ruleId.
        # But category total is capped at 20. So score is 100 - 20 = 80.
        self.assertEqual(score_serious, 80)

    def test_calculate_ux_score_with_critical(self):
        # 1 critical issue (15 penalty) -> score 85
        self.assertEqual(calculate_ux_score([{"id": "c1", "severity": "critical", "category": "accessibility"}]), 85)

        # 2 critical issues (15 + 7.5 = 22.5 penalty) in same category
        # Capped at 25.0 -> score 75
        issues = [
            {"id": "c1", "ruleId": "access-rule", "severity": "critical", "category": "accessibility"},
            {"id": "c2", "ruleId": "access-rule", "severity": "critical", "category": "accessibility"}
        ]
        self.assertEqual(calculate_ux_score(issues), 78) # 15 + 7.5 = 22.5 -> score 78

    def test_rerank_and_generate_fixes_grouping_and_severity(self):
        # Mock raw findings representing 3 small tap targets on desktop, and 2 on mobile
        raw_findings = [
            {
                "step_index": 0,
                "url": "https://unstop.com/",
                "axe_results": {"violations": []},
                "heuristic_results": {
                    "load_time_ms": 1500,
                    "contrast_violations": [],
                    "tap_target_violations": [
                        # Desktop tap targets: non-CTA, non-form control
                        {"selector": "button#btn-1.login_btn", "width": 30, "height": 30, "viewport": "desktop", "isMobile": False, "isPrimaryCTA": False, "isFormControl": False},
                        {"selector": "button#btn-2.login_btn", "width": 32, "height": 32, "viewport": "desktop", "isMobile": False, "isPrimaryCTA": False, "isFormControl": False},
                        # Desktop tap target: CTA
                        {"selector": "button#btn-cta.cta-button", "width": 35, "height": 35, "viewport": "desktop", "isMobile": False, "isPrimaryCTA": True, "isFormControl": False},
                    ]
                }
            },
            {
                "step_index": 1,
                "url": "https://unstop.com/register",
                "axe_results": {
                    "violations": [
                        # Axe-core issue
                        {
                            "id": "color-contrast",
                            "help": "Ensure contrast ratio meets minimums",
                            "nodes": [{"target": ["div.text-low-contrast"], "failureSummary": "Contrast is 2.5:1", "html": "<div class='text-low-contrast'>Hello</div>"}]
                        }
                    ]
                },
                "heuristic_results": {
                    "load_time_ms": 2000,
                    "contrast_violations": [],
                    "tap_target_violations": [
                        # Mobile tap targets: non-CTA, non-form control
                        {"selector": "a#link-1.nav-link", "width": 28, "height": 28, "viewport": "mobile", "isMobile": True, "isPrimaryCTA": False, "isFormControl": False},
                        # Mobile tap target: Form control
                        {"selector": "input#input-name", "width": 40, "height": 30, "viewport": "mobile", "isMobile": True, "isPrimaryCTA": False, "isFormControl": True},
                    ]
                }
            }
        ]

        # Run deterministic fallback processing to test the grouping & metadata mapping
        import asyncio
        report = asyncio.run(rerank_and_generate_fixes(raw_findings, "https://unstop.com/"))
        issues = report["issues"]

        # We expect:
        # 1. button.login_btn (desktop, non-CTA, non-form): grouped (2 instances), severity: minor, confidence: medium, source: custom_heuristic
        # 2. button.cta-button (desktop, CTA): 1 instance, severity: serious, confidence: medium, source: custom_heuristic
        # 3. a.nav-link (mobile, non-CTA): 1 instance, severity: moderate, confidence: medium, source: custom_heuristic
        # 4. input#input-name (mobile, form control): 1 instance, severity: serious, confidence: medium, source: custom_heuristic
        # 5. color-contrast (axe-core): 1 instance, severity: serious, confidence: high, source: axe-core

        # Verify issue count
        self.assertEqual(len(issues), 5)

        # Check axe-core issue details
        axe_issue = next(i for i in issues if i["source"] == "axe-core")
        self.assertEqual(axe_issue["confidence"], "high")
        self.assertEqual(axe_issue["ruleId"], "color-contrast")

        # Check grouped login_btn details
        login_btn_issue = next(i for i in issues if i["elementSelector"] == "button.login_btn")
        self.assertEqual(login_btn_issue["severity"], "minor") # non-CTA non-form on desktop is minor
        self.assertEqual(len(login_btn_issue["sampleElements"]), 2)
        self.assertEqual(login_btn_issue["confidence"], "medium")
        self.assertEqual(login_btn_issue["source"], "custom_heuristic")
        self.assertIn("2 elements using button.login_btn", login_btn_issue["description"])

        # Check desktop CTA details
        cta_issue = next(i for i in issues if "cta-button" in i["elementSelector"])
        self.assertEqual(cta_issue["severity"], "serious") # CTA is serious even on desktop
        self.assertEqual(cta_issue["viewport"], "desktop")

        # Check mobile non-CTA details
        mobile_nav_issue = next(i for i in issues if "nav-link" in i["elementSelector"])
        self.assertEqual(mobile_nav_issue["severity"], "moderate") # mobile non-CTA is moderate

        # Check mobile form control details
        form_issue = next(i for i in issues if "input-name" in i["elementSelector"])
        self.assertEqual(form_issue["severity"], "serious") # mobile form control is serious

if __name__ == "__main__":
    unittest.main()
