"""
runtime/verification_runtime.py
-------------------------------
Integration layer that accumulates patch generation and verification outputs
into the Mission schema.

Sprint 5 — Patch Generation & Verification.
"""

from datetime import datetime
from ai.runtime.mission import Mission
from ai.schemas.patch import Patch
from ai.schemas.verification import VerificationResult


class VerificationRuntime:
    """
    Acts as the bridge between the Execution loop's outputs and the Mission's patch lists.
    Similar to EvidenceService, this accumulates Generated Patches, Verified Patches,
    and Verification Results onto the MissionSchema.
    """

    def process_generated_patch(self, mission: Mission, patch: Patch) -> None:
        """
        Record a newly generated patch in the mission schema.
        """
        mission.schema.generated_patches.append(patch.model_dump())
        
        # Add to lightweight audit trail
        mission.schema.patch_history.append({
            "patch_id": patch.patch_id,
            "issue_id": patch.issue_id,
            "verification_status": patch.status.value,
            "timestamp": datetime.utcnow().isoformat()
        })
        
        mission.log(f"VerificationRuntime: Recorded generated patch '{patch.patch_id}'.")

    def process_verification_result(
        self, 
        mission: Mission, 
        patch: Patch, 
        result: VerificationResult
    ) -> None:
        """
        Record the verification result and update the mission state accordingly.
        """
        mission.schema.verification_results.append(result.model_dump())
        
        if result.resolved:
            mission.schema.verified_patches.append(patch.model_dump())
            
        # Update lightweight audit trail
        mission.schema.patch_history.append({
            "patch_id": patch.patch_id,
            "issue_id": patch.issue_id,
            "verification_status": patch.status.value,
            "timestamp": datetime.utcnow().isoformat()
        })
        
        mission.log(
            f"VerificationRuntime: Recorded verification '{result.verification_id}' "
            f"for patch '{patch.patch_id}'. Status: {result.status}."
        )
