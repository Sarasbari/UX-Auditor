"""
schemas/finding.py
------------------
A Finding is a raw, unverified observation produced by an analysis pass
(axe-core, heuristics, vision model, etc.).

Findings are the intermediate layer between raw BrowserCapture data and
structured Evidence attached to the Mission. EvidenceService converts
Finding objects into Evidence objects and links them to Issues.

Sprint 4 — Browser Execution & Evidence Pipeline.
"""

from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field
import uuid


class FindingSource(str, Enum):
    """
    Which analysis engine produced this finding.
    Kept extensible — new engines (vision, ML) add values here.
    """

    AXE_CORE = "axe_core"
    HEURISTIC = "heuristic"
    VISION = "vision"
    MOCK = "mock"  # Used during Sprint 4 stub analysis; replaced in Sprint 5+.


class FindingSeverity(str, Enum):
    """WCAG-aligned severity levels, ordered by impact."""

    CRITICAL = "critical"
    SERIOUS = "serious"
    MODERATE = "moderate"
    MINOR = "minor"
    INFO = "info"


class FindingCategory(str, Enum):
    """High-level classification of what domain the finding belongs to."""

    ACCESSIBILITY = "accessibility"
    DESIGN_QUALITY = "design_quality"
    VISUAL_HIERARCHY = "visual_hierarchy"
    COLOR_CONTRAST = "color_contrast"
    TYPOGRAPHY = "typography"
    LAYOUT = "layout"
    INTERACTION = "interaction"
    PERFORMANCE = "performance"


class Finding(BaseModel):
    """
    A single raw observation from an analysis pass.

    Lifecycle:
      AnalysisAgent produces Finding objects.
      EvidenceService.extract() converts each Finding → Evidence.
      EvidenceService then links Evidence into the EvidenceGraph and
      appends corresponding Issues to Mission.schema.findings.

    Agents must NOT create Issues directly — only Findings.
    """

    id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        description="Unique identifier for this finding.",
    )
    category: FindingCategory = Field(
        description="Broad classification of the issue domain.",
    )
    severity: FindingSeverity = Field(
        description="Impact level of this finding.",
    )
    title: str = Field(
        description="Short, human-readable title (< 80 chars).",
    )
    description: str = Field(
        description="Detailed explanation of the problem and why it matters.",
    )
    selector: Optional[str] = Field(
        None,
        description=(
            "CSS selector that uniquely identifies the problematic element. "
            "None for page-level findings."
        ),
    )
    source: FindingSource = Field(
        description="Which analysis engine produced this finding.",
    )
    confidence: float = Field(
        ...,
        ge=0.0,
        le=1.0,
        description=(
            "Normalised confidence score [0.0–1.0]. "
            "Rule-based findings are always 1.0; ML-based findings vary."
        ),
    )
    dom_snippet: Optional[str] = Field(
        None,
        description="Verbatim HTML of the affected element (captured at analysis time).",
    )
    computed_styles: Optional[Dict[str, str]] = Field(
        None,
        description="Relevant computed CSS properties for this element.",
    )
    wcag_criteria: List[str] = Field(
        default_factory=list,
        description="Applicable WCAG success criteria, e.g. ['1.4.3', '2.4.7'].",
    )
    rule_id: Optional[str] = Field(
        None,
        description="Source rule identifier (e.g. axe rule ID or heuristic key).",
    )
    metadata: Dict[str, Any] = Field(
        default_factory=dict,
        description="Engine-specific raw output for traceability.",
    )
