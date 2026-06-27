"""
schemas/recommendation.py
-------------------------
Schema for a structured UX recommendation.

Sprint 6 — Intelligent Report Generation & Conversational UX Expert.
"""

import uuid
from enum import Enum
from pydantic import BaseModel, Field


class BusinessImpactCategory(str, Enum):
    ACCESSIBILITY = "accessibility"
    CONVERSION = "conversion"
    TRUST = "trust"
    COMPLIANCE = "compliance"
    USER_EXPERIENCE = "user_experience"


class PriorityLevel(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class DeveloperEffort(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"


class Recommendation(BaseModel):
    """
    Actionable recommendation derived from an Issue.
    """
    recommendation_id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        description="Unique identifier for this recommendation."
    )
    issue_id: str = Field(description="The ID of the issue this recommendation addresses.")
    priority: PriorityLevel = Field(description="Priority of the recommendation.")
    business_impact: BusinessImpactCategory = Field(description="Primary business impact area.")
    developer_effort: DeveloperEffort = Field(description="Estimated effort to implement.")
    suggested_action: str = Field(description="Clear, actionable instruction to resolve the issue.")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Confidence in the recommendation.")
