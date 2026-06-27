"""
agents/analysis_agent.py
------------------------
Consumes BrowserCapture and produces Finding objects.

Sprint 4 — Browser Execution & Evidence Pipeline.
"""

from datetime import datetime
from typing import Any, Dict

from ai.agents.base import BaseAgent
from ai.runtime.mission import Mission
from ai.schemas.execution_result import ExecutionResult
from ai.schemas.finding import Finding, FindingCategory, FindingSeverity, FindingSource


class AnalysisAgent(BaseAgent):
    """
    Consumes BrowserCapture and produces Finding objects.
    Sprint 4: Mocks the analysis.
    Future sprints will integrate axe-core, heuristics, and vision model.
    """

    def __init__(self) -> None:
        super().__init__(agent_id="analysis_agent_01", agent_name="Analysis Agent")

    async def execute(self, mission: Mission, task_params: Dict[str, Any]) -> ExecutionResult:
        task = task_params.get("task")
        shared_context = task_params.get("shared_context", {})
        start = datetime.utcnow().timestamp()

        # Extract BrowserCapture from dependencies in shared_context
        capture_data = None
        for key, val in shared_context.items():
            if isinstance(val, dict) and "viewport" in val and "dom" in val:
                capture_data = val
                break
        
        if not capture_data:
            return ExecutionResult(
                task_id=task.task_id if task else "unknown",
                agent_id=self.agent_id,
                success=False,
                errors=["No BrowserCapture found in shared_context dependencies."],
                duration_ms=int((datetime.utcnow().timestamp() - start) * 1000),
            )

        # In Sprint 4, we mock findings based on the capture
        stub_finding = Finding(
            category=FindingCategory.ACCESSIBILITY,
            severity=FindingSeverity.SERIOUS,
            title="Mock Low Contrast",
            description="The text contrast is insufficient.",
            selector="h1",
            source=FindingSource.MOCK,
            confidence=1.0
        )

        return ExecutionResult(
            task_id=task.task_id if task else "unknown",
            agent_id=self.agent_id,
            success=True,
            output={"findings": [stub_finding.model_dump()], "capture": capture_data},
            logs=[f"[{self.agent_name}] Analysis produced 1 mock finding."],
            duration_ms=int((datetime.utcnow().timestamp() - start) * 1000),
        )

    async def validate(self, result: Any) -> bool:
        return isinstance(result, ExecutionResult) and result.success

    async def rollback(self, mission: Mission) -> None:
        mission.log(f"[{self.agent_name}] Rollback: clearing analysis state.")

    async def health(self) -> Dict[str, Any]:
        return {"agent_id": self.agent_id, "status": "healthy"}
