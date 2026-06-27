"""
services/report_service.py
--------------------------
Generates dual-view reports (Executive and Developer) from Mission state.

Sprint 6 — Intelligent Report Generation & Conversational UX Expert.
"""

from typing import Dict, List
from ai.runtime.mission import Mission
from ai.schemas.recommendation import Recommendation
from ai.schemas.report_section import ReportSection, ReportSectionType


class ReportService:
    """
    Orchestrates the generation of Executive and Developer reports.
    """

    def generate_executive_report(self, mission: Mission, recommendations: List[Recommendation]) -> List[ReportSection]:
        """
        Builds a report focused on business impact and high-level summaries.
        """
        sections = []
        
        sections.append(ReportSection(
            section_type=ReportSectionType.EXECUTIVE_SUMMARY,
            title="Executive Summary",
            content=f"Audit completed for **{mission.schema.goal}**. Found {len(mission.schema.findings)} issues.",
            metadata={"mission_id": mission.id}
        ))
        
        sections.append(ReportSection(
            section_type=ReportSectionType.METRICS,
            title="Audit Metrics",
            content="High-level execution metrics.",
            metadata=mission.schema.mission_metrics
        ))
        
        # Recommendations summary focusing on Business Impact
        rec_text = "\n".join([f"- **{r.business_impact.value.title()}**: {r.suggested_action}" for r in recommendations])
        sections.append(ReportSection(
            section_type=ReportSectionType.RECOMMENDATIONS,
            title="Business Recommendations",
            content=rec_text or "No critical recommendations at this time."
        ))

        return sections

    def generate_developer_report(self, mission: Mission) -> List[ReportSection]:
        """
        Builds a report focused on code-level issues and verified patches.
        """
        sections = []
        
        sections.append(ReportSection(
            section_type=ReportSectionType.VERIFIED_FIXES,
            title="Verified Patches",
            content=f"Successfully verified {len(mission.schema.verified_patches)} patches.",
            metadata={"patches": mission.schema.verified_patches}
        ))
        
        issue_text = "\n".join([f"- {i.selector}: {i.description}" for i in mission.schema.findings])
        sections.append(ReportSection(
            section_type=ReportSectionType.ACCESSIBILITY,
            title="Technical Issues",
            content=issue_text or "No issues found."
        ))

        return sections
