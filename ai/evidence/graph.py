"""
evidence/graph.py
-----------------
The EvidenceGraph is an in-memory, mission-scoped graph that links:

  Finding → Evidence → Issue

It provides the structural backbone for the Explainability First principle:
every issue in the final report must be traceable back to a concrete Finding
and a piece of Evidence with a DOM selector and optional screenshot.

Sprint 4 — Browser Execution & Evidence Pipeline.
"""

from __future__ import annotations

from typing import Dict, List, Optional, Set
from datetime import datetime

from ai.schemas.evidence import Evidence
from ai.schemas.finding import Finding
from ai.schemas.issue import Issue


class EvidenceNode:
    """
    A single node in the EvidenceGraph, grouping a Finding with its
    derived Evidence record and the corresponding Issue (once created).
    """

    def __init__(self, finding: Finding, evidence: Evidence) -> None:
        self.finding: Finding = finding
        self.evidence: Evidence = evidence
        self.issue: Optional[Issue] = None
        self.created_at: datetime = datetime.utcnow()

    def attach_issue(self, issue: Issue) -> None:
        """Attach the resolved Issue to this node."""
        self.issue = issue


class EvidenceGraph:
    """
    Mission-scoped, in-memory graph of all EvidenceNodes.

    Responsibilities:
      - Store EvidenceNode objects keyed by finding ID.
      - Provide queries for downstream consumers (MergeEngine, ReportAgent).
      - Track which evidence IDs are already linked to issues (de-duplication
        hook for Sprint 5 UX-Issue-Embedder integration).

    This class is NOT a persistence layer. Serialisation to MissionSchema
    is handled by EvidenceService.
    """

    def __init__(self, mission_id: str) -> None:
        self.mission_id: str = mission_id
        self._nodes: Dict[str, EvidenceNode] = {}  # finding.id → EvidenceNode
        self._deduplicated: Set[str] = set()        # finding IDs flagged as duplicate

    # ------------------------------------------------------------------
    # Mutation
    # ------------------------------------------------------------------

    def add_node(self, node: EvidenceNode) -> None:
        """
        Add a new EvidenceNode to the graph.
        Raises ValueError if a node with the same finding.id already exists.
        """
        finding_id = node.finding.id
        if finding_id in self._nodes:
            raise ValueError(
                f"EvidenceNode for finding '{finding_id}' already exists in graph."
            )
        self._nodes[finding_id] = node

    def mark_duplicate(self, finding_id: str) -> None:
        """
        Mark a finding as a duplicate of an existing node.
        Extension point for Sprint 5 UX-Issue-Embedder deduplication.
        """
        self._deduplicated.add(finding_id)

    # ------------------------------------------------------------------
    # Queries
    # ------------------------------------------------------------------

    def get_node(self, finding_id: str) -> Optional[EvidenceNode]:
        """Return the EvidenceNode for the given finding ID, or None."""
        return self._nodes.get(finding_id)

    def all_nodes(self) -> List[EvidenceNode]:
        """Return all nodes in insertion order."""
        return list(self._nodes.values())

    def unique_nodes(self) -> List[EvidenceNode]:
        """Return only nodes that have NOT been flagged as duplicates."""
        return [
            node
            for fid, node in self._nodes.items()
            if fid not in self._deduplicated
        ]

    def all_evidence(self) -> List[Evidence]:
        """Flat list of Evidence objects across all unique nodes."""
        return [node.evidence for node in self.unique_nodes()]

    def all_findings(self) -> List[Finding]:
        """Flat list of Finding objects across all unique nodes."""
        return [node.finding for node in self.unique_nodes()]

    def all_issues(self) -> List[Issue]:
        """Flat list of Issues that have been attached to nodes."""
        return [
            node.issue
            for node in self.unique_nodes()
            if node.issue is not None
        ]

    # ------------------------------------------------------------------
    # Diagnostics
    # ------------------------------------------------------------------

    def summary(self) -> Dict[str, int]:
        """Quick diagnostic snapshot for mission logs."""
        return {
            "total_nodes": len(self._nodes),
            "unique_nodes": len(self.unique_nodes()),
            "duplicate_nodes": len(self._deduplicated),
            "nodes_with_issues": sum(
                1 for n in self.unique_nodes() if n.issue is not None
            ),
        }

    def __repr__(self) -> str:
        s = self.summary()
        return (
            f"EvidenceGraph(mission={self.mission_id}, "
            f"nodes={s['total_nodes']}, "
            f"unique={s['unique_nodes']}, "
            f"issues={s['nodes_with_issues']})"
        )
