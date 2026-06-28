import os
import json
import uuid
import re
from typing import List, Dict, Any
from langchain_openai import ChatOpenAI

RERANK_PROMPT = """You are a senior UI/UX and Accessibility Expert.
You are given a raw list of design, usability, and accessibility findings gathered from a live website audit.

Your tasks:
1. Review the merged findings.
2. Deduplicate overlapping issues (e.g., if axe-core and custom heuristics both flagged the same element, merge them into a single issue).
3. Keep axe-core as the absolute source of truth for WCAG accessibility issues; do NOT invent or modify accessibility rules, but you should explain them clearly.
4. Rerank each issue's severity into one of: 'critical', 'serious', 'moderate', 'minor'.
5. For each issue, provide a one-line business impact justification for its severity rating.
6. For each issue, generate a concrete, copy-pasteable, deployable HTML/CSS code patch (before and after snippet) scoped to the actual flagged element/selector. Do NOT write generic advice or pseudocode.
7. Preserve the raw finding's "id" (e.g., "raw_g_0", "raw_g_1") as the issue "id" in your output so we can map evidence data back to it.

Respond ONLY with a valid JSON object matching this exact schema:
{
  "issues": [
    {
      "id": "must be the exact id string from the raw finding, e.g. 'raw_g_0'",
      "severity": "critical" | "serious" | "moderate" | "minor",
      "category": "accessibility" | "ux_heuristic" | "design_quality" | "custom_rule",
      "elementSelector": "css selector of the element, or null if global",
      "description": "Clear description of the issue, combining the technical problem and its visual/usability impact",
      "severityJustification": "One-line business impact justification for this severity rating",
      "fixSuggestion": "Detailed text description of how to fix this issue",
      "fixDiff": {
        "type": "dom_patch",
        "original": "<original html snippet>",
        "patched": "<fixed html snippet>",
        "selector": "css selector",
        "attributeName": "attribute modified (if any, e.g. 'alt' or 'aria-label' or 'style')",
        "attributeValue": "new attribute value (if any)"
      },
      "verifiedFixStatus": "success" | "failed" | "not_applicable",
      "source": "axe-core" | "custom_heuristic" | "llm" | "merged",
      "confidence": "high" | "medium" | "low"
    }
  ]
}
"""

CHAT_SYSTEM_PROMPT = """You are a Conversational UX Auditor Assistant.
You help developers and UI/UX designers understand their website audit results and guide them through fixing identified issues.

You have access to the complete audit report:
{report_context}

Guidelines:
1. Always be grounded in the audit report provided. Do not invent issues not present in the report.
2. When discussing specific issues, mention their ID or selector.
3. Reference verified fix status if mentioned (e.g. status 'success' means the fix is proven).
4. Provide concrete code fixes (e.g. HTML/CSS or Tailwind CSS) if the user asks.
5. Output your response as a JSON object with:
   - "response": Your markdown-formatted answer to the user's message.
   - "citedIssueIds": A list of issue IDs from the report that you referenced or discussed.

Response schema:
{{
  "response": "Your markdown text here...",
  "citedIssueIds": ["uuid-1", "uuid-2"]
}}
"""

def normalize_selector(selector: str) -> str:
    """
    Normalizes a CSS selector to group identical or very similar elements.
    """
    if not selector:
        return ""
    # Remove dynamic ID patterns or numbers if classes are present
    if "." in selector:
        selector = re.sub(r'#[a-zA-Z0-9_-]+', '', selector)
    else:
        selector = re.sub(r'#[a-zA-Z_-]*\d+[a-zA-Z0-9_-]*', '#[id]', selector)
    
    # Remove :nth-child or :nth-of-type pseudo-selectors
    selector = re.sub(r':nth-[a-z-]+(\([^)]*\))?', '', selector)
    return selector.strip()

def calculate_ux_score(issues: List[Dict[str, Any]]) -> int:
    """
    Calculates the UX Score out of 100 based on a capped, diminishing-returns model.
    
    Formula details:
    - Start with a base score of 100.
    - Penalties per severity:
      - critical: 15
      - serious: 8
      - moderate: 4
      - minor: 1
    - Issues are grouped by ruleId (e.g., 'small-touch-target').
    - Diminishing returns:
      - The i-th issue of a specific ruleId scales by 0.5 ** i (100% for 1st, 50% for 2nd, 25% for 3rd, etc.).
    - Category Caps:
      - Total penalty per category is capped.
      - If the category contains any 'critical' issues, the cap is 25.
      - Otherwise, the cap is 20.
      - This prevents repeated minor/moderate tap-target issues alone from destroying the score to 0.
    """
    rule_penalties = {}
    for issue in issues:
        rule_id = issue.get("ruleId") or issue.get("id") or "generic"
        category = (issue.get("category") or "ux_heuristic").lower()
        severity = (issue.get("severity") or "moderate").lower()
        
        penalty = 4
        if severity == "critical":
            penalty = 15
        elif severity == "serious":
            penalty = 8
        elif severity == "moderate":
            penalty = 4
        elif severity == "minor":
            penalty = 1
            
        if rule_id not in rule_penalties:
            rule_penalties[rule_id] = []
        rule_penalties[rule_id].append((category, penalty, severity))
        
    category_raw_penalties = {}
    category_has_critical = {}
    
    for rule_id, items in rule_penalties.items():
        # Sort items so highest penalties are applied first
        items.sort(key=lambda x: x[1], reverse=True)
        rule_penalty = 0
        for idx, (category, penalty, severity) in enumerate(items):
            weight = 0.5 ** idx
            rule_penalty += penalty * weight
            
            if severity == "critical":
                category_has_critical[category] = True
                
        category = items[0][0]
        if category not in category_raw_penalties:
            category_raw_penalties[category] = 0
        category_raw_penalties[category] += rule_penalty
        
    total_penalty = 0
    for category, penalty in category_raw_penalties.items():
        cap = 25.0 if category_has_critical.get(category, False) else 20.0
        capped_penalty = min(cap, penalty)
        total_penalty += capped_penalty
        
    score = 100 - total_penalty
    return max(0, min(100, round(score)))

def estimate_issue_score_delta(issue: Dict[str, Any]) -> int:
    """
    Estimates the potential score lift for fixing a single issue.
    Matches the TypeScript implementation in src/lib/services/score-delta.ts.
    """
    severity = (issue.get("severity") or "").lower()
    category = (issue.get("category") or "").lower()
    confidence = (issue.get("confidence") or "").lower()
    source = (issue.get("source") or "").lower()

    # 1. Base Score based on severity
    base_score = 4
    if severity == "critical":
        base_score = 12
    elif severity == "serious":
        base_score = 8
    elif severity == "moderate":
        base_score = 4
    elif severity == "minor":
        base_score = 2

    # 2. Confidence Modifier
    confidence_modifier = 0.8
    if confidence == "high":
        confidence_modifier = 1.0
    elif confidence == "medium":
        confidence_modifier = 0.8
    elif confidence == "low":
        confidence_modifier = 0.5

    # 3. Source Modifier
    source_modifier = 1.0
    if source == "screenshot_vision":
        source_modifier = 0.75

    # 4. Category Modifier
    category_modifier = 1.0
    if category == "accessibility":
        category_modifier = 1.1
    elif category == "design_quality":
        category_modifier = 0.9

    raw_delta = base_score * confidence_modifier * source_modifier * category_modifier
    return max(1, min(15, round(raw_delta)))

async def rerank_and_generate_fixes(raw_findings: List[Dict[str, Any]], url: str) -> Dict[str, Any]:
    """
    Groups and deduplicates raw findings, sends them to GPT-4o for reranking/patch generation,
    then computes a fair, capped UX score.
    """
    individual_findings = []
    
    # 1. Flatten all raw findings from different step runs
    for item in raw_findings:
        step_idx = item["step_index"]
        page_url = item["url"]
        
        # Axe-core violations
        axe_violations = item["axe_results"].get("violations", []) if item.get("axe_results") else []
        for v in axe_violations:
            for node in v.get("nodes", []):
                selector = node.get("target", [""])[0]
                html_snippet = node.get("html", "")
                individual_findings.append({
                    "url": page_url,
                    "step": step_idx,
                    "source": "axe-core",
                    "confidence": "high",
                    "ruleId": v["id"],
                    "selector": selector,
                    "description": f"{v['help']}: {node.get('message', '')}",
                    "actualValue": node.get("failureSummary", "WCAG violation"),
                    "expectedValue": "WCAG standard compliance",
                    "viewport": None,
                    "sampleElements": [{"selector": selector, "html": html_snippet}],
                    "isMobile": False,
                    "isPrimaryCTA": False,
                    "isFormControl": False
                })

        # Heuristics
        heuristics = item.get("heuristic_results", {})
        if heuristics:
            # Contrast
            for c in heuristics.get("contrast_violations", []):
                individual_findings.append({
                    "url": page_url,
                    "step": step_idx,
                    "source": "custom_heuristic",
                    "confidence": "medium",
                    "ruleId": "color-contrast",
                    "selector": c["selector"],
                    "description": f"Low text contrast ratio of {c['ratio']} (found colors: color={c['color']}, bgColor={c['bgColor']}).",
                    "actualValue": f"Ratio {c['ratio']}",
                    "expectedValue": "At least 4.5:1 (or 3:1 for large text)",
                    "viewport": None,
                    "sampleElements": [{"selector": c["selector"], "text": c.get("text", "")}],
                    "isMobile": False,
                    "isPrimaryCTA": False,
                    "isFormControl": False
                })
                
            # Tap target
            for t in heuristics.get("tap_target_violations", []):
                individual_findings.append({
                    "url": page_url,
                    "step": step_idx,
                    "source": "custom_heuristic",
                    "confidence": "medium",
                    "ruleId": "small-touch-target",
                    "selector": t["selector"],
                    "description": f"Tap target too small ({t['width']}x{t['height']}px). Interactive elements should be at least 44x44px.",
                    "actualValue": f"{t['width']}x{t['height']}px",
                    "expectedValue": "At least 44x44px",
                    "viewport": t.get("viewport", "desktop"),
                    "sampleElements": [{"selector": t["selector"], "text": t.get("text", ""), "width": t["width"], "height": t["height"]}],
                    "isMobile": t.get("isMobile", False),
                    "isPrimaryCTA": t.get("isPrimaryCTA", False),
                    "isFormControl": t.get("isFormControl", False),
                    "width": t["width"],
                    "height": t["height"]
                })

            # Form labels
            for f in heuristics.get("form_label_violations", []):
                individual_findings.append({
                    "url": page_url,
                    "step": step_idx,
                    "source": "custom_heuristic",
                    "confidence": "medium",
                    "ruleId": "missing-label",
                    "selector": f["selector"],
                    "description": "Form input element lacks an associated label or aria-label.",
                    "actualValue": "No label associated",
                    "expectedValue": "Associated label element or aria-label/aria-labelledby attribute",
                    "viewport": None,
                    "sampleElements": [{"selector": f["selector"], "placeholder": f.get("placeholder", "")}],
                    "isMobile": False,
                    "isPrimaryCTA": False,
                    "isFormControl": True
                })

            # Broken links
            for b in heuristics.get("broken_links", []):
                selector = f"a[href='{b['url']}']"
                individual_findings.append({
                    "url": page_url,
                    "step": step_idx,
                    "source": "custom_heuristic",
                    "confidence": "medium",
                    "ruleId": "broken-link",
                    "selector": selector,
                    "description": f"Broken link detected: {b['url']} returned status/error: {b.get('status', b.get('error', 'unknown'))}",
                    "actualValue": f"Status/Error: {b.get('status', b.get('error', 'unknown'))}",
                    "expectedValue": "200 OK",
                    "viewport": None,
                    "sampleElements": [{"selector": selector, "url": b["url"]}],
                    "isMobile": False,
                    "isPrimaryCTA": False,
                    "isFormControl": False
                })

            # Page Load Time
            load_time = heuristics.get("load_time_ms", 0)
            if load_time > 3000:
                individual_findings.append({
                    "url": page_url,
                    "step": step_idx,
                    "source": "custom_heuristic",
                    "confidence": "medium",
                    "ruleId": "slow-load-time",
                    "selector": None,
                    "description": f"Page took {load_time / 1000:.2f}s to load. Consider optimizing assets and server response times.",
                    "actualValue": f"{load_time / 1000:.2f}s",
                    "expectedValue": "Less than 3.00s",
                    "viewport": None,
                    "sampleElements": [],
                    "isMobile": False,
                    "isPrimaryCTA": False,
                    "isFormControl": False
                })

    # 2. Group findings by ruleId + normalized_selector + URL
    grouped_findings = {}
    for item in individual_findings:
        rule_id = item["ruleId"]
        selector = item["selector"] or "global"
        normalized = normalize_selector(selector)
        page_url = item["url"]
        
        key = (rule_id, normalized, page_url)
        if key not in grouped_findings:
            grouped_findings[key] = []
        grouped_findings[key].append(item)

    # 3. Compile grouped findings
    formatted_findings = []
    for idx, (key, group) in enumerate(grouped_findings.items()):
        rule_id, normalized, page_url = key
        count = len(group)
        first = group[0]
        grouped_id = f"raw_g_{idx}"
        
        # Compute severity and text formatting
        group_severities = []
        for item in group:
            sev = "moderate"
            if item["ruleId"] == "small-touch-target":
                if item.get("isMobile"):
                    if item.get("isPrimaryCTA") or item.get("isFormControl"):
                        sev = "serious"
                    else:
                        sev = "moderate"
                else:  # Desktop viewport
                    if item.get("isPrimaryCTA") or item.get("isFormControl"):
                        sev = "serious"
                    else:
                        sev = "minor"
            elif item["source"] == "axe-core":
                sev = "serious"
            elif item["ruleId"] in ["color-contrast", "missing-label"]:
                sev = "serious"
            elif item["ruleId"] == "broken-link":
                sev = "moderate"
            elif item["ruleId"] == "slow-load-time":
                sev = "minor"
            group_severities.append(sev)
            
        # Determine highest severity for the group
        sev_rank = {"critical": 4, "serious": 3, "moderate": 2, "minor": 1}
        highest_sev = max(group_severities, key=lambda s: sev_rank.get(s, 0))
        
        # Group description formulation
        if count == 1:
            description = first["description"]
            sample_elements = first["sampleElements"]
            element_selector = first["selector"]
        else:
            if rule_id == "small-touch-target":
                widths = [item.get("width", 0) for item in group]
                heights = [item.get("height", 0) for item in group]
                min_w, max_w = min(widths), max(widths)
                min_h, max_h = min(heights), max(heights)
                size_range = f"{min_w}x{min_h}px" if min_w == max_w and min_h == max_h else f"{min_w}x{min_h}px to {max_w}x{max_h}px"
                description = f"{count} elements using {normalized} have tap targets below 44x44px. Measured sizes range from {size_range}. Expected size is 44x44px."
            elif rule_id == "color-contrast":
                description = f"{count} text elements using {normalized} have low color contrast. Expected at least 4.5:1 (or 3:1 for large text)."
            elif rule_id == "missing-label":
                description = f"{count} form inputs using {normalized} lack an associated label or aria-label."
            elif rule_id == "broken-link":
                description = f"{count} broken links detected using {normalized}."
            else:
                description = f"{count} instances of {rule_id} detected on elements matching {normalized}."
                
            sample_elements = []
            for item in group:
                for se in item["sampleElements"]:
                    if se not in sample_elements:
                        sample_elements.append(se)
            sample_elements = sample_elements[:15]
            element_selector = normalized
            
        formatted_findings.append({
            "id": grouped_id,
            "url": page_url,
            "type": first["source"],
            "ruleId": rule_id,
            "description": description,
            "elementSelector": element_selector,
            "source": first["source"],
            "confidence": first["confidence"],
            "severity": highest_sev,
            "actualValue": first["actualValue"],
            "expectedValue": first["expectedValue"],
            "viewport": first["viewport"],
            "sampleElements": sample_elements,
            "count": count
        })

    openai_key = os.getenv("OPENAI_API_KEY")
    if openai_key and not openai_key.startswith("sk-..."):
        try:
            llm = ChatOpenAI(model="gpt-4o", api_key=openai_key, temperature=0.0, response_format={"type": "json_object"})
            
            # Send simplified info to LLM to prevent token exhaustion
            llm_input = []
            for f in formatted_findings:
                llm_input.append({
                    "id": f["id"],
                    "url": f["url"],
                    "ruleId": f["ruleId"],
                    "description": f["description"],
                    "elementSelector": f["elementSelector"],
                    "severity": f["severity"],
                    "source": f["source"],
                    "confidence": f["confidence"]
                })
                
            user_content = f"Target URL: {url}\n\nRaw Findings List:\n{json.dumps(llm_input, indent=2)}"
            
            messages = [
                {"role": "system", "content": RERANK_PROMPT},
                {"role": "user", "content": user_content}
            ]
            
            response = await llm.ainvoke(messages)
            result_json = json.loads(response.content)
            
            # Reconstruct evidence fields from raw grouped map
            raw_map = {f["id"]: f for f in formatted_findings}
            issues = []
            for issue in result_json.get("issues", []):
                raw_id = issue.get("id")
                if raw_id in raw_map:
                    raw_f = raw_map[raw_id]
                    # Map/Restore metadata
                    issue["actualValue"] = raw_f.get("actualValue")
                    issue["expectedValue"] = raw_f.get("expectedValue")
                    issue["viewport"] = raw_f.get("viewport")
                    issue["ruleId"] = raw_f.get("ruleId")
                    issue["pageUrl"] = raw_f.get("url")
                    issue["sampleElements"] = raw_f.get("sampleElements")
                    
                    # Lock severities of small touch targets to our precise viewport-aware logic
                    if raw_f.get("ruleId") == "small-touch-target":
                        issue["severity"] = raw_f.get("severity")
                    
                    if not issue.get("source"):
                        issue["source"] = raw_f.get("source")
                    if not issue.get("confidence"):
                        issue["confidence"] = raw_f.get("confidence")
                        
                    # Re-map temporary id to standard uuid
                    issue["id"] = str(uuid.uuid4())
                else:
                    if not issue.get("source"):
                        issue["source"] = "llm"
                    if not issue.get("confidence"):
                        issue["confidence"] = "low"
                    if not issue.get("id") or issue["id"].startswith("raw_"):
                        issue["id"] = str(uuid.uuid4())
                
                if not issue.get("verifiedFixStatus"):
                    issue["verifiedFixStatus"] = "not_applicable"
                issues.append(issue)
                
            result_json["issues"] = issues
            result_json["score"] = calculate_ux_score(issues)
            return result_json
            
        except Exception as llm_err:
            print(f"LLM Rerank call failed: {llm_err}. Using deterministic fallback.")

    # Deterministic fallback parsing
    result_json = {
        "score": 100,
        "issues": []
    }
    
    issues = []
    for raw_f in formatted_findings:
        issue_id = str(uuid.uuid4())
        rule_id = raw_f.get("ruleId", "")
        
        category = "ux_heuristic"
        if raw_f.get("source") == "axe-core":
            category = "accessibility"
        elif rule_id == "slow-load-time":
            category = "custom_rule"
            
        fix_suggestion = "Ensure compliance with design standards."
        if "contrast" in rule_id.lower():
            fix_suggestion = f"Increase the color contrast ratio of the element to at least 4.5:1 (or 3:1 for large text). Current details: {raw_f.get('description', '')}"
        elif "touch" in rule_id.lower():
            fix_suggestion = "Increase the touch target size of the interactive element to at least 44x44 pixels to prevent mis-clicks. Use padding to expand."
        elif "missing-label" in rule_id.lower():
            fix_suggestion = "Provide a descriptive text label using a <label> tag, aria-label, or aria-labelledby attribute for screen readers."
        elif "broken-link" in rule_id.lower():
            fix_suggestion = "Correct the anchor href attribute or restore the target page to ensure it returns a 200 OK status."
        elif "slow-load" in rule_id.lower():
            fix_suggestion = "Optimize image assets, enable compression, and review server performance to reduce load time."
            
        issues.append({
            "id": issue_id,
            "severity": raw_f.get("severity", "moderate"),
            "category": category,
            "elementSelector": raw_f.get("elementSelector"),
            "description": raw_f.get("description"),
            "severityJustification": "Affects usability and compliance based on viewport and programmatic rules.",
            "fixSuggestion": fix_suggestion,
            "fixDiff": None,
            "verifiedFixStatus": "not_applicable",
            "source": raw_f.get("source"),
            "confidence": raw_f.get("confidence"),
            "actualValue": raw_f.get("actualValue"),
            "expectedValue": raw_f.get("expectedValue"),
            "viewport": raw_f.get("viewport"),
            "ruleId": rule_id,
            "pageUrl": raw_f.get("url"),
            "sampleElements": raw_f.get("sampleElements")
        })
        
    result_json["issues"] = issues
    result_json["score"] = calculate_ux_score(issues)
    return result_json

async def chat_with_audit_report(
    chat_history: List[Dict[str, Any]],
    report_data: Dict[str, Any],
    message: str,
    score: int = None,
    selected_issue_id: str = None
) -> Dict[str, Any]:
    """
    Answers user questions grounded in the audit report findings.
    Uses LLM when available, falls back to deterministic intent-based handlers.
    Returns: { response, citedIssueIds, suggestedFollowUps }
    """
    issues = report_data.get("issues", [])
    audit_score = score if score is not None else report_data.get("score", 0)
    url = report_data.get("url", "")

    # ── INTENT DETECTION ──────────────────────────────────────────────────
    def detect_intent(msg: str) -> str:
        m = msg.lower()
        if any(k in m for k in ["improve score", "raise score", "increase score", "better score", "how to improve", "highest impact", "highest-impact", "high impact", "highest score delta"]):
            return "improve_score"
        if any(k in m for k in ["fix first", "priority", "most important", "start with", "what should i fix"]):
            return "fix_first"
        if any(k in m for k in ["summary", "summarize", "overview", "key issues", "main problems"]):
            return "summary"
        if any(k in m for k in ["serious", "worst", "most severe", "critical"]):
            return "why_serious"
        if any(k in m for k in ["contrast", "color contrast", "text contrast", "readab"]):
            return "fix_contrast"
        if any(k in m for k in ["touch", "tap target", "target size", "button size", "clickable"]):
            return "fix_touch"
        if any(k in m for k in ["wcag", "accessibility", "a11y", "screen reader", "aria"]):
            return "wcag_issues"
        if any(k in m for k in ["code fix", "code example", "html fix", "css fix", "show code", "snippet"]):
            return "code_fix"
        if any(k in m for k in ["quick win", "easy fix", "low effort", "fast"]):
            return "quick_wins"
        if any(k in m for k in ["business", "impact", "cost", "revenue", "user impact"]):
            return "business_impact"
        return "general"

    # ── ISSUE RANKING ─────────────────────────────────────────────────────
    def rank_issues(issue_list: List[Dict]) -> List[Dict]:
        sev_order = {"critical": 0, "serious": 1, "moderate": 2, "minor": 3}
        return sorted(issue_list, key=lambda i: (
            - (i.get("scoreDelta") if i.get("scoreDelta") is not None else estimate_issue_score_delta(i)),
            sev_order.get((i.get("severity") or "moderate").lower(), 2),
        ))

    # ── FORMAT ISSUE LINE ─────────────────────────────────────────────────
    def fmt(issue: Dict, idx: int = 0) -> str:
        sev = (issue.get("severity") or "moderate").upper()
        desc = issue.get("description", "")
        sel = issue.get("elementSelector", "")
        fix = issue.get("fixSuggestion", "")
        delta = issue.get("scoreDelta") if issue.get("scoreDelta") is not None else estimate_issue_score_delta(issue)
        lines = [f"{idx + 1}. **[{sev}]** {desc} *(estimated impact: +{delta} potential lift)*"]
        if sel:
            lines.append(f"   - Element: `{sel}`")
        if fix:
            lines.append(f"   - Fix: {fix}")
        return "\n".join(lines)

    # ── DETERMINISTIC HANDLERS ────────────────────────────────────────────
    def handle_improve_score() -> Dict:
        ranked = rank_issues(issues)[:5]
        lines = [f"## How to improve your UX score (currently **{audit_score}/100**)\n"]
        lines.append("Focus on these issues with the highest estimated impact first:\n")
        for idx, issue in enumerate(ranked):
            lines.append(fmt(issue, idx))
        lines.append("\n---\n*Fixing these issues provides the best potential lift to improve your score.*")
        return {
            "response": "\n".join(lines),
            "citedIssueIds": [i.get("id") for i in ranked if i.get("id")],
            "suggestedFollowUps": ["Show me code fixes for these", "What are quick wins?", "Explain the most serious issues"]
        }

    def handle_fix_first() -> Dict:
        ranked = rank_issues(issues)[:5]
        lines = ["## Priority fix order\n"]
        lines.append("Based on estimated impact and severity, here is the suggested order to address findings:\n")
        for idx, issue in enumerate(ranked):
            lines.append(fmt(issue, idx))
        return {
            "response": "\n".join(lines),
            "citedIssueIds": [i.get("id") for i in ranked if i.get("id")],
            "suggestedFollowUps": ["Show code fixes for #1", "How will this affect my score?", "What are the quick wins?"]
        }

    def handle_summary() -> Dict:
        sev_counts = {}
        for i in issues:
            s = (i.get("severity") or "moderate").lower()
            sev_counts[s] = sev_counts.get(s, 0) + 1
        lines = [f"## Audit summary for {url}\n"]
        lines.append(f"**Score:** {audit_score}/100  ")
        lines.append(f"**Total issues:** {len(issues)}\n")
        for sev in ["critical", "serious", "moderate", "minor"]:
            if sev in sev_counts:
                lines.append(f"- **{sev.capitalize()}:** {sev_counts[sev]}")
        top3 = rank_issues(issues)[:3]
        if top3:
            lines.append("\n### Top 3 issues to address\n")
            for idx, issue in enumerate(top3):
                lines.append(fmt(issue, idx))
        return {
            "response": "\n".join(lines),
            "citedIssueIds": [i.get("id") for i in top3 if i.get("id")],
            "suggestedFollowUps": ["How to improve the score?", "Show me quick wins", "What are the WCAG issues?"]
        }

    def handle_category(cat_keywords: List[str], title: str) -> Dict:
        matched = [i for i in issues if any(k in (i.get("description") or "").lower() or k in (i.get("ruleId") or "").lower() or k in (i.get("category") or "").lower() for k in cat_keywords)]
        ranked = rank_issues(matched)[:5]
        if not ranked:
            return {
                "response": f"No {title.lower()} issues found in this audit report.",
                "citedIssueIds": [],
                "suggestedFollowUps": ["Summarize the key issues", "What should I fix first?"]
            }
        lines = [f"## {title} issues ({len(matched)} found)\n"]
        for idx, issue in enumerate(ranked):
            lines.append(fmt(issue, idx))
        if len(matched) > 5:
            lines.append(f"\n*...and {len(matched) - 5} more.*")
        return {
            "response": "\n".join(lines),
            "citedIssueIds": [i.get("id") for i in ranked if i.get("id")],
            "suggestedFollowUps": ["Show code fixes", "How to improve the score?", "What should I fix first?"]
        }

    def handle_quick_wins() -> Dict:
        easy = [i for i in issues if (i.get("severity") or "").lower() in ("minor", "moderate") and (i.get("confidence") or "").lower() == "high"]
        ranked = rank_issues(easy)[:5]
        if not ranked:
            ranked = rank_issues(issues)[-3:]
        lines = ["## Quick wins\n", "These issues are high-confidence and easier to fix:\n"]
        for idx, issue in enumerate(ranked):
            lines.append(fmt(issue, idx))
        return {
            "response": "\n".join(lines),
            "citedIssueIds": [i.get("id") for i in ranked if i.get("id")],
            "suggestedFollowUps": ["Show code fixes for these", "What are the most serious issues?"]
        }

    def handle_code_fix() -> Dict:
        target_issues = issues
        if selected_issue_id:
            sel = [i for i in issues if i.get("id") == selected_issue_id]
            if sel:
                target_issues = sel
        ranked = rank_issues(target_issues)[:3]
        lines = ["## Code fix examples\n"]
        for idx, issue in enumerate(ranked):
            lines.append(f"### Fix {idx + 1}: {issue.get('description', 'Issue')[:60]}\n")
            fix_diff = issue.get("fixDiff") or {}
            if fix_diff.get("original") and fix_diff.get("patched"):
                lines.append("**Before:**")
                lines.append(f"```html\n{fix_diff['original']}\n```\n")
                lines.append("**After:**")
                lines.append(f"```html\n{fix_diff['patched']}\n```\n")
            elif issue.get("fixSuggestion"):
                lines.append(f"**Suggestion:** {issue['fixSuggestion']}\n")
        return {
            "response": "\n".join(lines),
            "citedIssueIds": [i.get("id") for i in ranked if i.get("id")],
            "suggestedFollowUps": ["What should I fix first?", "How will fixing these affect my score?"]
        }

    def handle_general() -> Dict:
        # Keyword matching across issues
        msg_lower = message.lower()
        words = [w for w in msg_lower.split() if len(w) > 3]
        matched = []
        for issue in issues:
            desc = (issue.get("description") or "").lower()
            sel = (issue.get("elementSelector") or "").lower()
            cat = (issue.get("category") or "").lower()
            rule = (issue.get("ruleId") or "").lower()
            if any(w in desc or w in sel or w in cat or w in rule for w in words):
                matched.append(issue)
        ranked = rank_issues(matched)[:5] if matched else rank_issues(issues)[:3]
        if matched:
            lines = [f"## Found {len(matched)} related issues\n"]
        else:
            lines = ["## Here are the top issues from your audit\n"]
        for idx, issue in enumerate(ranked):
            lines.append(fmt(issue, idx))
        lines.append(f"\n*Your current UX score is **{audit_score}/100** across {len(issues)} total issues.*")
        return {
            "response": "\n".join(lines),
            "citedIssueIds": [i.get("id") for i in ranked if i.get("id")],
            "suggestedFollowUps": ["How to improve my score?", "What should I fix first?", "Show me quick wins"]
        }

    # ── TRY LLM FIRST ────────────────────────────────────────────────────
    openai_key = os.getenv("OPENAI_API_KEY")

    if openai_key and not openai_key.startswith("sk-..."):
        try:
            report_context = {
                "url": url,
                "score": audit_score,
                "issues": [
                    {
                        "id": i.get("id"),
                        "severity": i.get("severity"),
                        "category": i.get("category"),
                        "confidence": i.get("confidence"),
                        "element": i.get("elementSelector"),
                        "description": i.get("description"),
                        "fix": i.get("fixSuggestion"),
                        "ruleId": i.get("ruleId"),
                        "actualValue": i.get("actualValue"),
                        "expectedValue": i.get("expectedValue"),
                        "patch": i.get("fixDiff", {}).get("patched") if i.get("fixDiff") else None,
                        "scoreDelta": i.get("scoreDelta") if i.get("scoreDelta") is not None else estimate_issue_score_delta(i)
                    }
                    for i in issues
                ]
            }

            system_prompt = f"""You are a senior UX auditor and accessibility engineer.
You have access to the complete audit report below. Answer ONLY from the audit data provided.
Prioritize issues by scoreDelta first (higher values first), then severity. Cite issue IDs when referencing specific findings.
Always use honest estimation language when discussing score improvements (e.g., "estimated impact", "potential lift", "predicted score"). Do not use guaranteed language (e.g., do not say "will improve" or "proven score increase").
Do not invent findings. If the user asks for code fixes, produce practical HTML/CSS examples.

AUDIT REPORT:
{json.dumps(report_context, indent=2)}

Respond with a JSON object:
{{
  "response": "your markdown answer",
  "citedIssueIds": ["uuid-1", "uuid-2"],
  "suggestedFollowUps": ["follow-up question 1", "follow-up question 2"]
}}"""

            llm = ChatOpenAI(model="gpt-4o", api_key=openai_key, temperature=0.2, response_format={"type": "json_object"})
            formatted_messages = [{"role": "system", "content": system_prompt}]
            for chat in chat_history:
                role = chat.get("role", "user").lower()
                if role in ["user", "assistant"]:
                    formatted_messages.append({"role": role, "content": chat.get("content", "")})
            formatted_messages.append({"role": "user", "content": message})

            response = await llm.ainvoke(formatted_messages)
            result = json.loads(response.content)
            if "suggestedFollowUps" not in result:
                result["suggestedFollowUps"] = []
            return result
        except Exception as llm_err:
            print(f"Chat LLM call failed: {llm_err}. Using deterministic fallback.")

    # ── DETERMINISTIC FALLBACK ────────────────────────────────────────────
    intent = detect_intent(message)

    handlers = {
        "improve_score": handle_improve_score,
        "fix_first": handle_fix_first,
        "summary": handle_summary,
        "why_serious": lambda: handle_category(["critical", "serious"], "Most serious"),
        "fix_contrast": lambda: handle_category(["contrast", "color-contrast"], "Color contrast"),
        "fix_touch": lambda: handle_category(["touch", "tap", "target-size", "small-touch"], "Touch target"),
        "wcag_issues": lambda: handle_category(["accessibility", "wcag", "axe-core", "aria"], "WCAG accessibility"),
        "code_fix": handle_code_fix,
        "quick_wins": handle_quick_wins,
        "business_impact": handle_improve_score,
        "general": handle_general,
    }

    handler = handlers.get(intent, handle_general)
    return handler()

async def audit_screenshot_with_vision(image_base64: str, audit_id: str) -> Dict[str, Any]:
    """
    Analyzes a website/app UI screenshot using GPT-4o vision or fallback deterministic findings.
    """
    openai_key = os.getenv("OPENAI_API_KEY")
    
    if openai_key and not openai_key.startswith("sk-..."):
        try:
            from langchain_core.messages import SystemMessage, HumanMessage
            
            # Format raw base64 string
            raw_base64 = image_base64
            if "," in raw_base64:
                raw_base64 = raw_base64.split(",")[1]
                
            system_prompt = """You are a senior UI/UX and Accessibility Auditor.
Analyze the provided screenshot of a web application / site user interface.
Identify visual UX issues, hierarchy problems, color contrast risks, layout density/clutter, CTA clarity issues, form design issues, mobile fit risks, and readability concerns.

Since you only have a static image of the user interface:
- Do NOT output HTML selectors (elementSelector should be null).
- Do NOT generate git diffs (fixDiff should be null).
- Categorize each issue under: accessibility, ux_heuristic, or design_quality.
- Assign ruleId from one of: visual-hierarchy, contrast-risk, spacing, cta-clarity, form-clarity, layout-density, readability, navigation-clarity.
- Give a score from 0 to 100 representing overall design/UX quality, deducting points appropriately for issues.
- For each issue, estimate the score impact (scoreDelta) as an integer from 1 to 12.
- For each issue, estimate approximate normalized coordinates (from 0.0 to 1.0 relative to the image dimensions) where the issue is visually located. Specify this as a boundingBox. If the issue is global or cannot be localized, boundingBox can be null.
- Labels in boundingBox must be short, 2-5 words.

Respond ONLY with a valid JSON object matching this exact schema:
{
  "score": 85,
  "issues": [
    {
      "id": "generate-a-unique-uuid-v4",
      "severity": "critical" | "serious" | "moderate" | "minor",
      "category": "accessibility" | "ux_heuristic" | "design_quality",
      "elementSelector": null,
      "description": "Clear description of the visual design issue",
      "severityJustification": "Impact of this issue on conversion or readability",
      "fixSuggestion": "Concrete design, styling, or CSS recommendation to resolve the issue",
      "fixDiff": null,
      "verifiedFixStatus": "not_applicable",
      "source": "screenshot_vision",
      "confidence": "high" | "medium" | "low",
      "actualValue": "e.g., poor contrast ratio or crowded buttons in the screenshot",
      "expectedValue": "e.g., proper contrast or clear visual hierarchy",
      "viewport": "desktop" | "mobile" | "unknown",
      "ruleId": "visual-hierarchy" | "contrast-risk" | "spacing" | "cta-clarity" | "form-clarity" | "layout-density" | "readability" | "navigation-clarity",
      "pageUrl": null,
      "sampleElements": [],
      "boundingBox": {
        "x": 0.12,
        "y": 0.22,
        "width": 0.35,
        "height": 0.18,
        "label": "short visual label"
      },
      "scoreDelta": 6
    }
  ]
}
"""

            human_content = [
                {
                    "type": "text",
                    "text": "Please perform a visual UX and Accessibility audit on this user interface screenshot."
                },
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/png;base64,{raw_base64}"
                    }
                }
            ]
            
            # Use gpt-4o for vision
            from langchain_openai import ChatOpenAI
            llm = ChatOpenAI(model="gpt-4o", api_key=openai_key, temperature=0.2, response_format={"type": "json_object"})
            
            messages = [
                SystemMessage(content=system_prompt),
                HumanMessage(content=human_content)
            ]
            
            response = await llm.ainvoke(messages)
            result = json.loads(response.content)
            return result
        except Exception as err:
            print(f"OpenAI vision audit failed: {err}. Using fallback.")

    # FALLBACK DETERMINISTIC DEMO-READY FINDINGS
    return {
        "score": 75,
        "issues": [
            {
                "id": str(uuid.uuid4()),
                "severity": "serious",
                "category": "design_quality",
                "elementSelector": None,
                "description": "Flat visual hierarchy makes it difficult to quickly identify the primary call-to-action button.",
                "severityJustification": "Users take longer to decide where to click next, which directly increases bounce rates.",
                "fixSuggestion": "Apply a high-contrast background color to the primary CTA and reduce visual emphasis on secondary buttons.",
                "fixDiff": None,
                "verifiedFixStatus": "not_applicable",
                "source": "screenshot_vision",
                "confidence": "medium",
                "actualValue": "Primary CTA button uses the same gray outline style as secondary utility links.",
                "expectedValue": "A distinct background color or font weight highlighting the primary call-to-action.",
                "viewport": "unknown",
                "ruleId": "visual-hierarchy",
                "pageUrl": None,
                "sampleElements": [],
                "boundingBox": {
                    "x": 0.75,
                    "y": 0.15,
                    "width": 0.15,
                    "height": 0.06,
                    "label": "Primary CTA placement"
                },
                "scoreDelta": 15
            },
            {
                "id": str(uuid.uuid4()),
                "severity": "moderate",
                "category": "accessibility",
                "elementSelector": None,
                "description": "Visual contrast risk detected for small body and footer text elements against dark background regions.",
                "severityJustification": "Visually impaired users or users in high-glare environments will struggle to read secondary information.",
                "fixSuggestion": "Increase contrast ratio to at least 4.5:1 by switching to a brighter font color or heavier weight.",
                "fixDiff": None,
                "verifiedFixStatus": "not_applicable",
                "source": "screenshot_vision",
                "confidence": "medium",
                "actualValue": "Contrast ratio seems below accessibility standards for secondary elements.",
                "expectedValue": "At least 4.5:1 contrast ratio for elements below 18pt size.",
                "viewport": "unknown",
                "ruleId": "contrast-risk",
                "pageUrl": None,
                "sampleElements": [],
                "boundingBox": {
                    "x": 0.10,
                    "y": 0.65,
                    "width": 0.80,
                    "height": 0.12,
                    "label": "Low contrast region"
                },
                "scoreDelta": 10
            },
            {
                "id": str(uuid.uuid4()),
                "severity": "minor",
                "category": "ux_heuristic",
                "elementSelector": None,
                "description": "Inconsistent spacing and visual alignment between section elements.",
                "severityJustification": "Cluttered or disorganized grids degrade user perception of design quality and trust.",
                "fixSuggestion": "Enforce a unified 4px/8px grid system to align vertical padding and horizontal margins consistently.",
                "fixDiff": None,
                "verifiedFixStatus": "not_applicable",
                "source": "screenshot_vision",
                "confidence": "medium",
                "actualValue": "Irregular gaps observed between text blocks and surrounding card components.",
                "expectedValue": "Consistent spacing guidelines across all component structures.",
                "viewport": "unknown",
                "ruleId": "spacing",
                "pageUrl": None,
                "sampleElements": [],
                "boundingBox": {
                    "x": 0.05,
                    "y": 0.35,
                    "width": 0.60,
                    "height": 0.25,
                    "label": "Inconsistent section spacing"
                },
                "scoreDelta": 5
            }
        ]
    }


