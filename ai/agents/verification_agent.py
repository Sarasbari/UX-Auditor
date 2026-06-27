"""
agents/verification_agent.py
----------------------------
Autonomous agent responsible for verifying generated patches.

Sprint 5 — Patch Generation & Verification.
"""

from datetime import datetime
from typing import Any, Dict
from ai.agents.base import BaseAgent
from ai.runtime.mission import Mission
from ai.schemas.execution_result import ExecutionResult
from ai.schemas.patch import Patch
from ai.services.verification_service import VerificationService


class VerificationAgent(BaseAgent):
    """
    Consumes a Patch and produces a VerificationResult using VerificationService.
    """

    def __init__(self) -> None:
        super().__init__(agent_id="verification_agent_01", agent_name="Verification Agent")
        self.verification_service = VerificationService()

    async def execute(self, mission: Mission, task_params: Dict[str, Any]) -> ExecutionResult:
        task = task_params.get("task")
        shared_context = task_params.get("shared_context", {})
        start = datetime.utcnow().timestamp()

        # Extract patch to verify from shared_context
        patch_data = shared_context.get("target_patch")
        if not patch_data:
            return ExecutionResult(
                task_id=task.task_id if task else "unknown",
                agent_id=self.agent_id,
                success=False,
                errors=["No target_patch found in shared_context."],
                duration_ms=int((datetime.utcnow().timestamp() - start) * 1000),
            )

        try:
            patch = Patch(**patch_data)
        except Exception as e:
            return ExecutionResult(
                task_id=task.task_id if task else "unknown",
                agent_id=self.agent_id,
                success=False,
                errors=[f"Failed to parse Patch: {str(e)}"],
                duration_ms=int((datetime.utcnow().timestamp() - start) * 1000),
            )

        # Verify patch
        verification_result = self.verification_service.verify_patch(patch)

        return ExecutionResult(
            task_id=task.task_id if task else "unknown",
            agent_id=self.agent_id,
            success=verification_result.resolved,
            output={
                "verification_result": verification_result.model_dump(),
                "updated_patch": patch.model_dump()
            },
            logs=[
                f"[{self.agent_name}] Verified patch '{patch.patch_id}'. "
                f"Resolved: {verification_result.resolved}, "
                f"Regressions: {verification_result.regression_count}"
            ],
            duration_ms=int((datetime.utcnow().timestamp() - start) * 1000),
        )

    async def validate(self, result: Any) -> bool:
        return isinstance(result, ExecutionResult)

    async def rollback(self, mission: Mission) -> None:
        mission.log(f"[{self.agent_name}] Rollback: verification cancelled.")

    async def health(self) -> Dict[str, Any]:
        return {"agent_id": self.agent_id, "status": "healthy"}
