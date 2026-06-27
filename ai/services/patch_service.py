"""
services/patch_service.py
-------------------------
Service responsible for selecting patch strategies and generating patch templates.

Sprint 5 — Patch Generation & Verification.
"""

from typing import Optional
from ai.schemas.patch import Patch, PatchStrategy, PatchStatus
from ai.schemas.issue import Issue


class PatchService:
    """
    Coordinates patch generation by delegating to specific strategy templates.
    """

    def generate_patch(self, issue: Issue) -> Patch:
        """
        Generates a patch for the given issue.
        In Sprint 5, this uses stub templates.
        """
        strategy = self._select_strategy(issue.category)
        
        # Stub strategy execution
        original_code = f"<!-- Stub original code for {issue.selector} -->"
        patched_code = f"<!-- Stub patched code for {issue.selector} via {strategy.value} -->"
        
        return Patch(
            issue_id=issue.id,
            strategy=strategy,
            target=issue.selector or "unknown",
            original_code=original_code,
            patched_code=patched_code,
            confidence=0.85,
            status=PatchStatus.GENERATED,
            evidence_ids=issue.evidence_ids
        )

    def _select_strategy(self, category: str) -> PatchStrategy:
        """
        Maps an issue category to a PatchStrategy enum.
        """
        category_lower = category.lower()
        if "accessibility" in category_lower:
            return PatchStrategy.ACCESSIBILITY
        elif "design" in category_lower or "visual" in category_lower:
            return PatchStrategy.VISUAL
        elif "semantic" in category_lower:
            return PatchStrategy.SEMANTIC
        elif "layout" in category_lower or "structural" in category_lower:
            return PatchStrategy.STRUCTURAL
        elif "performance" in category_lower:
            return PatchStrategy.PERFORMANCE
        return PatchStrategy.STRUCTURAL
