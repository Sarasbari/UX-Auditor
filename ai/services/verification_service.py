"""
services/verification_service.py
--------------------------------
Service responsible for evaluating patches and determining resolution status.

Sprint 5 — Patch Generation & Verification.
"""

import time
from ai.schemas.patch import Patch, PatchStatus
from ai.schemas.verification import VerificationResult


class VerificationService:
    """
    Coordinates patch verification by comparing findings before and after
    the patch is applied (mocked for Sprint 5).
    """

    def verify_patch(self, patch: Patch) -> VerificationResult:
        """
        Applies the patch in a sandbox and returns the verification result.
        In Sprint 5, this is a mock implementation.
        """
        start_time = time.time()
        
        # Mocking browser replay and validation
        resolved = True
        before_score = 75
        after_score = 90
        resolved_count = 1
        regression_count = 0
        new_issues = 0
        remaining_issues = 0
        status = "Success"
        
        # We can update the patch status based on the mock verification
        patch.status = PatchStatus.VERIFIED if resolved else PatchStatus.REJECTED

        duration_ms = int((time.time() - start_time) * 1000)

        return VerificationResult(
            patch_id=patch.patch_id,
            status=status,
            before_score=before_score,
            after_score=after_score,
            resolved=resolved,
            remaining_issues=remaining_issues,
            new_issues=new_issues,
            confidence=0.92,
            failure_reason=None,
            resolved_issue_count=resolved_count,
            regression_count=regression_count,
            verification_duration_ms=duration_ms
        )
