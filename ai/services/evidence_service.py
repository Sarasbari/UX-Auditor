"""
services/evidence_service.py
----------------------------
Orchestrates the conversion of Findings into Evidence, manages the EvidenceGraph,
and persists structured findings to the Mission schema.

Sprint 4 — Browser Execution & Evidence Pipeline.
"""

from typing import List, Dict

from ai.evidence.graph import EvidenceGraph, EvidenceNode
from ai.evidence.extractor import EvidenceExtractor
from ai.evidence.merger import FindingMerger
from ai.runtime.mission import Mission
from ai.schemas.browser_capture import BrowserCapture
from ai.schemas.finding import Finding
from ai.schemas.issue import Issue


class EvidenceService:
    """
    Coordinates the Evidence Pipeline.
    """

    def __init__(self) -> None:
        self.extractor = EvidenceExtractor()
        self.merger = FindingMerger()
        self._graphs: Dict[str, EvidenceGraph] = {}

    def get_graph(self, mission_id: str) -> EvidenceGraph:
        """Retrieve or create an EvidenceGraph for a mission."""
        if mission_id not in self._graphs:
            self._graphs[mission_id] = EvidenceGraph(mission_id)
        return self._graphs[mission_id]

    def process_findings(
        self,
        mission: Mission,
        findings: List[Finding],
        capture: BrowserCapture
    ) -> None:
        """
        Process raw Findings into structured Evidence, update the EvidenceGraph,
        and synchronize with the Mission schema.
        """
        if not findings:
            return

        graph = self.get_graph(mission.id)

        # 1. Merge and deduplicate raw findings
        merged_findings = self.merger.merge(findings)

        # 2. Extract Evidence and build Issues
        for finding in merged_findings:
            # Skip if already in graph
            if graph.get_node(finding.id):
                continue
                
            evidence = self.extractor.extract(finding, capture)
            
            # Create a corresponding Issue
            issue = Issue(
                id=finding.id,
                title=finding.title,
                description=finding.description,
                severity=finding.severity.value,
                category=finding.category.value,
                selector=finding.selector or "",
                evidence_ids=[evidence.id],
                confidence=finding.confidence,
            )

            # Build and store EvidenceNode
            node = EvidenceNode(finding, evidence)
            node.attach_issue(issue)
            graph.add_node(node)

        # 3. Sync Graph state back to MissionSchema
        mission.schema.evidence = graph.all_evidence()
        mission.schema.findings = graph.all_issues()
        
        mission.log(
            f"EvidenceService: Processed {len(findings)} raw finding(s) "
            f"into {len(graph.all_issues())} unique issue(s)."
        )
