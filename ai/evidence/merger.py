"""
evidence/merger.py
------------------
Merges findings from multiple analysis passes (axe-core, heuristics, vision)
into a deduplicated, priority-sorted list.

In Sprint 4, the Merger performs simple selector-level grouping.
In Sprint 5+, this is the integration point for the UX-Issue-Embedder
(BGE-Micro-v2) semantic deduplication model.

Sprint 4 — Browser Execution & Evidence Pipeline.
"""

from __future__ import annotations

from typing import Dict, List, Tuple

from ai.schemas.finding import Finding, FindingSeverity


# Severity priority: lower index = higher priority.
_SEVERITY_ORDER: List[str] = [
    FindingSeverity.CRITICAL,
    FindingSeverity.SERIOUS,
    FindingSeverity.MODERATE,
    FindingSeverity.MINOR,
    FindingSeverity.INFO,
]


def _severity_rank(severity: FindingSeverity) -> int:
    try:
        return _SEVERITY_ORDER.index(severity)
    except ValueError:
        return len(_SEVERITY_ORDER)


class FindingMerger:
    """
    Stateless utility that deduplicates and merges a list of Findings.

    Deduplication strategy (Sprint 4 — rule-based):
      Two findings are considered duplicates when they share the same
      (selector, category) pair, regardless of source engine.
      When duplicates exist, the one with the highest severity is kept
      and the others are discarded. In a tie, the highest-confidence
      finding wins.

    Extension point (Sprint 5+):
      Replace `_are_duplicates()` with a call to UX-Issue-Embedder to
      compute semantic similarity between finding descriptions and merge
      when similarity ≥ threshold.
    """

    def merge(self, findings: List[Finding]) -> List[Finding]:
        """
        Accept a flat list of Findings from all sources.
        Return a deduplicated, severity-sorted list.

        Parameters
        ----------
        findings:
            Raw findings from all AnalysisAgent passes, potentially containing
            duplicates from overlapping analysis engines.

        Returns
        -------
        List[Finding]
            Deduplicated findings ordered by severity (critical first),
            then confidence (highest first) within the same severity band.
        """
        if not findings:
            return []

        # Group by deduplication key (selector, category)
        groups: Dict[Tuple[str, str], List[Finding]] = {}
        for finding in findings:
            key = (finding.selector or "__page__", finding.category.value)
            groups.setdefault(key, []).append(finding)

        # Within each group, keep the highest-severity, highest-confidence finding.
        merged: List[Finding] = []
        for group_findings in groups.values():
            winner = self._elect_winner(group_findings)
            merged.append(winner)

        # Sort: severity asc (critical=0), then confidence desc.
        merged.sort(
            key=lambda f: (_severity_rank(f.severity), -f.confidence)
        )
        return merged

    @staticmethod
    def _elect_winner(candidates: List[Finding]) -> Finding:
        """
        From a group of duplicate findings, elect the one to keep.

        Priority:
          1. Lowest severity rank (= highest severity, e.g. CRITICAL < MINOR).
          2. Highest confidence score on a tie.

        The winner's metadata is enriched with the IDs of the discarded
        duplicates for full audit traceability.
        """
        sorted_candidates = sorted(
            candidates,
            key=lambda f: (_severity_rank(f.severity), -f.confidence),
        )
        winner = sorted_candidates[0]

        # Record which findings were merged away (traceability).
        discarded_ids = [f.id for f in sorted_candidates[1:]]
        if discarded_ids:
            winner.metadata["merged_finding_ids"] = discarded_ids

        return winner

    # ------------------------------------------------------------------
    # Sprint 5+ extension point
    # ------------------------------------------------------------------

    @staticmethod
    def _are_duplicates(a: Finding, b: Finding) -> bool:
        """
        Determine if two findings refer to the same underlying issue.

        Sprint 4: rule-based selector+category comparison.
        Sprint 5: replace body with UX-Issue-Embedder cosine similarity call.
        """
        same_selector = (a.selector or "") == (b.selector or "")
        same_category = a.category == b.category
        return same_selector and same_category
