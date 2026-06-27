"""
evidence/extractor.py
---------------------
Converts raw Finding objects into structured Evidence records.

The Extractor is a pure transformation layer — no IO, no state, no side effects.
It reads a Finding and the BrowserCapture context it came from, and produces
a single Evidence record that can be stored in the EvidenceGraph.

Sprint 4 — Browser Execution & Evidence Pipeline.
"""

from __future__ import annotations

import uuid
from typing import Optional

from ai.schemas.browser_capture import BrowserCapture
from ai.schemas.evidence import Evidence
from ai.schemas.finding import Finding


class EvidenceExtractor:
    """
    Stateless converter: Finding + BrowserCapture → Evidence.

    Design rules:
      - No IO — accepts already-captured data.
      - No LLM calls — pure data transformation.
      - Returns a new Evidence object; never mutates inputs.
      - Called by EvidenceService once per Finding.
    """

    def extract(
        self,
        finding: Finding,
        capture: BrowserCapture,
        screenshot_path: Optional[str] = None,
    ) -> Evidence:
        """
        Build an Evidence record from a Finding and the BrowserCapture
        that was active when the finding was produced.

        Parameters
        ----------
        finding:
            The raw Finding produced by an AnalysisAgent.
        capture:
            The BrowserCapture from which this finding was derived.
            Used to populate dom_snippet and css_computed if the finding
            did not supply them directly.
        screenshot_path:
            Override screenshot path. Falls back to finding.metadata or
            capture.screenshot_path in that order.

        Returns
        -------
        Evidence
            A fully-populated Evidence record ready for the EvidenceGraph.
        """
        # Resolve DOM snippet: finding-level takes priority, then lookup
        # the element in capture.computed_styles if selector is known.
        dom_snippet = finding.dom_snippet or self._resolve_dom_snippet(
            finding.selector, capture
        )

        # Resolve computed CSS: finding-level takes priority, then lookup.
        css_computed = None
        if finding.computed_styles:
            css_computed = str(finding.computed_styles)
        elif finding.selector:
            css_computed = self._resolve_css(finding.selector, capture)

        # Screenshot: explicit override → finding metadata → capture screenshot.
        resolved_screenshot = (
            screenshot_path
            or finding.metadata.get("screenshot_path")
            or capture.screenshot_path
        )

        return Evidence(
            id=str(uuid.uuid4()),
            source_url=capture.url,
            dom_snippet=dom_snippet or f"<!-- selector: {finding.selector} -->",
            css_computed=css_computed,
            screenshot_path=resolved_screenshot,
            confidence=finding.confidence,
            metadata={
                "finding_id": finding.id,
                "rule_id": finding.rule_id,
                "source": finding.source.value,
                "wcag_criteria": finding.wcag_criteria,
                "capture_metadata": capture.metadata,
            },
        )

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _resolve_dom_snippet(
        selector: Optional[str], capture: BrowserCapture
    ) -> Optional[str]:
        """
        Look up the best-matching ComputedStyle for a selector and return
        a synthetic HTML snippet for evidence traceability.
        Returns None if no matching element is found.
        """
        if not selector:
            return None

        for cs in capture.computed_styles:
            # Simple substring match — sufficient for CSS selectors like
            # 'button.submit', '#nav-link', 'h1'. A full CSS-match engine
            # can be plugged in here for Sprint 5+.
            if cs.selector == selector or selector in cs.selector:
                text_attr = f' aria-label="{cs.aria_label}"' if cs.aria_label else ""
                role_attr = f' role="{cs.role}"' if cs.role else ""
                text_content = cs.text or ""
                return (
                    f"<{cs.tag}{role_attr}{text_attr}>"
                    f"{text_content}"
                    f"</{cs.tag}>"
                )
        return None

    @staticmethod
    def _resolve_css(
        selector: Optional[str], capture: BrowserCapture
    ) -> Optional[str]:
        """
        Look up computed CSS properties for a selector from the capture.
        Returns a formatted string of key-value CSS declarations, or None.
        """
        if not selector:
            return None

        for cs in capture.computed_styles:
            if cs.selector == selector or (selector and selector in cs.selector):
                props = {}
                if cs.color:
                    props["color"] = cs.color
                if cs.background_color:
                    props["background-color"] = cs.background_color
                if cs.font_size:
                    props["font-size"] = cs.font_size
                if cs.font_family:
                    props["font-family"] = cs.font_family
                if cs.line_height:
                    props["line-height"] = cs.line_height
                if props:
                    return "; ".join(f"{k}: {v}" for k, v in props.items())
        return None
