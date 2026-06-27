"""
schemas/verification.py
-----------------------
Schema for patch verification results.

Sprint 5 — Patch Generation & Verification.
"""

import uuid
from typing import Optional
from pydantic import BaseModel, Field


class VerificationResult(BaseModel):
    """
    The output of a VerificationAgent evaluating a Patch.
    """
    verification_id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        description="Unique identifier for this verification attempt."
    )
    patch_id: str = Field(description="The ID of the patch being verified.")
    status: str = Field(description="Success, Failed, Error.")
    before_score: int = Field(default=0, description="Heuristic or axe score prior to patching.")
    after_score: int = Field(default=0, description="Score after patch applied.")
    resolved: bool = Field(description="True if the target issue is resolved.")
    remaining_issues: int = Field(default=0)
    new_issues: int = Field(default=0)
    confidence: float = Field(..., ge=0.0, le=1.0)
    failure_reason: Optional[str] = Field(None, description="Reason if status is failed or error.")
    resolved_issue_count: int = Field(default=0, description="Total number of issues resolved.")
    regression_count: int = Field(default=0, description="Number of new issues introduced.")
    verification_duration_ms: int = Field(default=0, description="Time taken to verify in ms.")
