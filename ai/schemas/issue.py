from typing import List, Optional
from pydantic import BaseModel, Field

class Issue(BaseModel):
    """
    A single design or accessibility issue found during an audit mission.
    """
    id: str
    title: str
    description: str
    severity: str = Field(..., description="e.g., critical, serious, moderate, minor")
    category: str = Field(..., description="e.g., accessibility, design_quality, visual_hierarchy")
    selector: str = Field(description="CSS selector pointing to the root element of the issue.")
    evidence_ids: List[str] = Field(default_factory=list, description="References to Evidence models.")
    status: str = Field(default="open", description="open, fixing, verified, failed")
    verified: bool = Field(default=False, description="True if a patch successfully passed sandbox testing.")
    confidence: float = Field(..., ge=0.0, le=1.0)
