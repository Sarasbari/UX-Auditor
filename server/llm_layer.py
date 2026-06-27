import os
import json
import uuid
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

Respond ONLY with a valid JSON object matching this exact schema:
{
  "score": 85, // Overall UX score from 0-100 (start from 100, deduct: critical=15, serious=8, moderate=4, minor=1)
  "issues": [
    {
      "id": "uuid-like-string",
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
      "source": "deterministic" | "llm" | "merged"
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

async def rerank_and_generate_fixes(raw_findings: List[Dict[str, Any]], url: str) -> Dict[str, Any]:
    """
    Sends raw findings to GPT-4o to rerank by severity, generate HTML/CSS fixes, and deduplicate.
    """
    # Prepare inputs for LLM
    formatted_findings = []
    for item in raw_findings:
        step_idx = item["step_index"]
        page_url = item["url"]
        
        # Format axe violations
        axe_violations = item["axe_results"].get("violations", [])
        for v in axe_violations:
            for node in v.get("nodes", []):
                formatted_findings.append({
                    "step": step_idx,
                    "url": page_url,
                    "type": "axe-core (WCAG)",
                    "ruleId": v["id"],
                    "description": f"{v['help']}: {node.get('message', '')}",
                    "elementSelector": node.get("target", [""])[0],
                    "html": node.get("html", ""),
                    "helpUrl": v.get("helpUrl", "")
                })

        # Format heuristics
        heuristics = item["heuristic_results"]
        for c in heuristics.get("contrast_violations", []):
            formatted_findings.append({
                "step": step_idx,
                "url": page_url,
                "type": "heuristics (contrast)",
                "ruleId": "color-contrast",
                "description": f"Low text contrast ratio of {c['ratio']} (found colors: color={c['color']}, bgColor={c['bgColor']}).",
                "elementSelector": c["selector"],
                "html": c.get("html", "")
            })
            
        for t in heuristics.get("tap_target_violations", []):
            formatted_findings.append({
                "step": step_idx,
                "url": page_url,
                "type": "heuristics (usability)",
                "ruleId": "small-touch-target",
                "description": f"Tap target too small ({t['width']}x{t['height']}px). Interactive elements should be at least 44x44px.",
                "elementSelector": t["selector"],
                "text": t.get("text", "")
            })

        for f in heuristics.get("form_label_violations", []):
            formatted_findings.append({
                "step": step_idx,
                "url": page_url,
                "type": "heuristics (usability)",
                "ruleId": "missing-label",
                "description": f"Form input element lacks an associated label or aria-label.",
                "elementSelector": f["selector"]
            })

        for b in heuristics.get("broken_links", []):
            formatted_findings.append({
                "step": step_idx,
                "url": page_url,
                "type": "heuristics (technical)",
                "ruleId": "broken-link",
                "description": f"Broken link detected: {b['url']} returned error or status: {b.get('status', b.get('error', 'unknown'))}",
                "elementSelector": f"a[href='{b['url']}']"
            })

    # Add load time to findings if slow
    for item in raw_findings:
        load_time = item["heuristic_results"].get("load_time_ms", 0)
        if load_time > 3000:
            formatted_findings.append({
                "step": item["step_index"],
                "url": item["url"],
                "type": "heuristics (performance)",
                "ruleId": "slow-load-time",
                "description": f"Page took {load_time / 1000:.2f}s to load. Consider optimizing assets and server response times.",
                "elementSelector": None
            })

    openai_key = os.getenv("OPENAI_API_KEY")
    if openai_key and not openai_key.startswith("sk-..."):
        try:
            llm = ChatOpenAI(model="gpt-4o", api_key=openai_key, temperature=0.0, response_format={"type": "json_object"})
            user_content = f"Target URL: {url}\n\nRaw Findings List:\n{json.dumps(formatted_findings, indent=2)}"
            
            messages = [
                {"role": "system", "content": RERANK_PROMPT},
                {"role": "user", "content": user_content}
            ]
            
            response = await llm.ainvoke(messages)
            result_json = json.loads(response.content)
            
            # Ensure every issue has a UUID
            for issue in result_json.get("issues", []):
                if not issue.get("id"):
                    issue["id"] = str(uuid.uuid4())
                if not issue.get("verifiedFixStatus"):
                    issue["verifiedFixStatus"] = "not_applicable"
            return result_json
        except Exception as llm_err:
            print(f"LLM Rerank call failed: {llm_err}. Using deterministic fallback.")
            
    # Deterministic fallback parsing
    result_json = {
        "score": 100,
        "issues": []
    }
    
    # Deduplicate raw findings
    seen_keys = set()
    deduped_findings = []
    for f in formatted_findings:
        key = (f.get("elementSelector") or "global", f.get("ruleId"))
        if key not in seen_keys:
            seen_keys.add(key)
            deduped_findings.append(f)
            
    issues = []
    deduct_sum = 0
    for f in deduped_findings:
        issue_id = str(uuid.uuid4())
        rule_id = f.get("ruleId", "")
        finding_type = f.get("type", "")
        
        # Map severity
        severity = "moderate"
        if "axe" in finding_type.lower():
            severity = "serious"
        elif "contrast" in rule_id.lower() or "missing-label" in rule_id.lower():
            severity = "serious"
        elif "touch" in rule_id.lower() or "broken" in rule_id.lower():
            severity = "moderate"
        elif "slow-load" in rule_id.lower():
            severity = "minor"
            
        # Score deduction
        if severity == "critical":
            deduct_sum += 15
        elif severity == "serious":
            deduct_sum += 8
        elif severity == "moderate":
            deduct_sum += 4
        elif severity == "minor":
            deduct_sum += 1
            
        # Category
        category = "ux_heuristic"
        if "axe" in finding_type.lower():
            category = "accessibility"
        elif "performance" in finding_type.lower():
            category = "custom_rule"
            
        # Simple text fixes
        fix_suggestion = "Ensure compliance with design standards."
        if "contrast" in rule_id.lower():
            fix_suggestion = f"Increase the color contrast ratio of the element to at least 4.5:1 (or 3:1 for large text). Current details: {f.get('description', '')}"
        elif "touch" in rule_id.lower():
            fix_suggestion = "Increase the touch target size of the interactive element to at least 44x44 pixels to prevent mis-clicks."
        elif "missing-label" in rule_id.lower():
            fix_suggestion = "Provide a descriptive text label using a <label> tag, aria-label, or aria-labelledby attribute for screen readers."
        elif "broken-link" in rule_id.lower():
            fix_suggestion = "Correct the anchor href attribute or restore the target page to ensure it returns a 200 OK status."
        elif "slow-load" in rule_id.lower():
            fix_suggestion = "Optimize image assets, enable compression, and review server performance to reduce load time."
            
        issues.append({
            "id": issue_id,
            "severity": severity,
            "category": category,
            "elementSelector": f.get("elementSelector"),
            "description": f.get("description"),
            "severityJustification": "Affects accessibility standards and visual hierarchy on mobile/desktop displays.",
            "fixSuggestion": fix_suggestion,
            "fixDiff": None,
            "verifiedFixStatus": "not_applicable",
            "source": "deterministic"
        })
        
    result_json["issues"] = issues
    result_json["score"] = max(0, 100 - deduct_sum)
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
            
            # Format messages for LLM
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
        
        # Match keywords
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
