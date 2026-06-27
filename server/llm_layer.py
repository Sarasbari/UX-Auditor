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

async def chat_with_audit_report(chat_history: List[Dict[str, Any]], report_data: Dict[str, Any], message: str) -> Dict[str, Any]:
    """
    Answers user questions grounded in the audit report findings, returning chat text response and cited issues.
    """
    openai_key = os.getenv("OPENAI_API_KEY")
    
    # Prepare context
    report_context = {
        "url": report_data.get("url"),
        "score": report_data.get("score"),
        "issues": [
            {
                "id": i.get("id"),
                "severity": i.get("severity"),
                "category": i.get("category"),
                "element": i.get("elementSelector"),
                "description": i.get("description"),
                "fix": i.get("fixSuggestion"),
                "patch": i.get("fixDiff", {}).get("patched") if i.get("fixDiff") else None
            }
            for i in report_data.get("issues", [])
        ]
    }

    if openai_key and not openai_key.startswith("sk-..."):
        try:
            llm = ChatOpenAI(model="gpt-4o", api_key=openai_key, temperature=0.2, response_format={"type": "json_object"})
            system_msg = CHAT_SYSTEM_PROMPT.format(report_context=json.dumps(report_context, indent=2))
            
            formatted_messages = [{"role": "system", "content": system_msg}]
            for chat in chat_history:
                role = chat.get("role", "user").lower()
                if role in ["user", "assistant"]:
                    formatted_messages.append({"role": role, "content": chat.get("content", "")})
                    
            formatted_messages.append({"role": "user", "content": message})

            response = await llm.ainvoke(formatted_messages)
            return json.loads(response.content)
        except Exception as llm_err:
            print(f"Chat LLM call failed: {llm_err}. Using deterministic search fallback.")

    # Fallback keyword matching
    message_lower = message.lower()
    matched_issues = []
    response_text = "*(Assistant in Local Resilient Mode)*\n\n"
    
    for issue in report_data.get("issues", []):
        desc = (issue.get("description") or "").lower()
        selector = (issue.get("elementSelector") or "").lower()
        category = (issue.get("category") or "").lower()
        
        if any(keyword in desc or keyword in selector or keyword in category for keyword in message_lower.split() if len(keyword) > 3):
            matched_issues.append(issue)
            
    if matched_issues:
        response_text += "Based on your audit findings, here are the related issues I located:\n\n"
        for issue in matched_issues:
            response_text += f"- **[{issue.get('severity').upper()}]** on `{issue.get('elementSelector')}`:\n  {issue.get('description')}\n  *Recommended Fix:* {issue.get('fixSuggestion')}\n\n"
    else:
        response_text += "I searched the audit report but couldn't find any specific matching issues for your query. Here is a summary of the audit findings:\n\n"
        response_text += f"- **Audited Website**: {report_data.get('url')}\n"
        response_text += f"- **UX Audit Score**: {report_data.get('score')}/100\n"
        response_text += f"- **Total Issues Flagged**: {len(report_data.get('issues', []))}\n"
        response_text += "\nIf you want details on specific issues, try entering words like 'contrast', 'touch', 'label', or 'broken'."
        
    return {
        "response": response_text,
        "citedIssueIds": [issue.get("id") for issue in matched_issues]
    }
