"""
schemas/patch.py
----------------
Schema for autonomous patch generation.

Sprint 5 — Patch Generation & Verification.
"""

import uuid
from datetime import datetime
from enum import Enum
from typing import List, Optional
from pydantic import BaseModel, Field


class PatchStatus(str, Enum):
    GENERATED = "generated"
    VALIDATED = "validated"
    VERIFIED = "verified"
    REJECTED = "rejected"
    FAILED = "failed"


class PatchStrategy(str, Enum):
    ACCESSIBILITY = "accessibility"
    VISUAL = "visual"
    SEMANTIC = "semantic"
    STRUCTURAL = "structural"
    PERFORMANCE = "performance"


class Patch(BaseModel):
    """
    Structured code patch generated to resolve a specific Issue.
    """
    patch_id: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        description="Unique identifier for this patch."
    )
    issue_id: str = Field(description="The ID of the issue this patch attempts to resolve.")
    strategy: PatchStrategy = Field(description="The strategy used to generate the patch.")
    target: str = Field(description="CSS selector or file path for the target element.")
    original_code: str = Field(description="The code snippet before modification.")
    patched_code: str = Field(description="The generated code snippet intended to fix the issue.")
    confidence: float = Field(..., ge=0.0, le=1.0, description="Generation confidence score.")
    status: PatchStatus = Field(default=PatchStatus.GENERATED)
    evidence_ids: List[str] = Field(
        default_factory=list,
        description="Source evidence IDs providing context for the generation."
    )
    created_at: datetime = Field(default_factory=datetime.utcnow)
