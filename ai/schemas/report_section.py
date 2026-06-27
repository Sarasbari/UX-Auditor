"""
schemas/report_section.py
-------------------------
Schema for a structured section of the generated UX report.

Sprint 6 — Intelligent Report Generation & Conversational UX Expert.
"""

from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class ReportSectionType(str, Enum):
    EXECUTIVE_SUMMARY = "executive_summary"
    ACCESSIBILITY = "accessibility"
    VISUAL_DESIGN = "visual_design"
    USABILITY = "usability"
    VERIFIED_FIXES = "verified_fixes"
    RECOMMENDATIONS = "recommendations"
    METRICS = "metrics"
    APPENDIX = "appendix"


class ReportSection(BaseModel):
    """
    A single section of a UX Audit Report.
    """
    section_type: ReportSectionType = Field(description="The type of this report section.")
    title: str = Field(description="Display title for the section.")
    content: str = Field(description="Markdown formatted text content for the section.")
    metadata: Dict[str, Any] = Field(
        default_factory=dict,
        description="Optional structured data (e.g., specific metrics or issue counts)."
    )
