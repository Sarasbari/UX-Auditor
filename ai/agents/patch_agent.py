"""
agents/patch_agent.py
---------------------
Autonomous agent responsible for generating patches for identified issues.

Sprint 5 — Patch Generation & Verification.
"""

from datetime import datetime
from typing import Any, Dict
from ai.agents.base import BaseAgent
from ai.runtime.mission import Mission
from ai.schemas.execution_result import ExecutionResult
from ai.schemas.issue import Issue
from ai.services.patch_service import PatchService


class PatchAgent(BaseAgent):
    """
    Consumes an Issue and produces a Patch using PatchService.
    No verification is performed by this agent.
    """

    def __init__(self) -> None:
        super().__init__(agent_id="patch_agent_01", agent_name="Patch Agent")
        self.patch_service = PatchService()

    async def execute(self, mission: Mission, task_params: Dict[str, Any]) -> ExecutionResult:
        task = task_params.get("task")
        shared_context = task_params.get("shared_context", {})
        start = datetime.utcnow().timestamp()

        # Extract issue to patch. This might be passed directly in the task
        # or fetched from the mission state. For this sprint, assume it's in shared_context.
        issue_data = shared_context.get("target_issue")
        if not issue_data:
            return ExecutionResult(
                task_id=task.task_id if task else "unknown",
                agent_id=self.agent_id,
                success=False,
                errors=["No target_issue found in shared_context."],
                duration_ms=int((datetime.utcnow().timestamp() - start) * 1000),
            )

        try:
            issue = Issue(**issue_data)
        except Exception as e:
            return ExecutionResult(
                task_id=task.task_id if task else "unknown",
                agent_id=self.agent_id,
                success=False,
                errors=[f"Failed to parse Issue: {str(e)}"],
                duration_ms=int((datetime.utcnow().timestamp() - start) * 1000),
            )

        # Generate patch
        patch = self.patch_service.generate_patch(issue)

        return ExecutionResult(
            task_id=task.task_id if task else "unknown",
            agent_id=self.agent_id,
            success=True,
            output={"patch": patch.model_dump()},
            logs=[f"[{self.agent_name}] Generated patch for issue '{issue.id}' using {patch.strategy} strategy."],
            duration_ms=int((datetime.utcnow().timestamp() - start) * 1000),
        )

    async def validate(self, result: Any) -> bool:
        return isinstance(result, ExecutionResult) and result.success

    async def rollback(self, mission: Mission) -> None:
        mission.log(f"[{self.agent_name}] Rollback: discarding generated patch.")

    async def health(self) -> Dict[str, Any]:
        return {"agent_id": self.agent_id, "status": "healthy"}
