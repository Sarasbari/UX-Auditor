from datetime import datetime
from typing import Any, Dict

from ai.agents.base import BaseAgent
from ai.runtime.mission import Mission
from ai.schemas.execution_result import ExecutionResult


class ReportAgent(BaseAgent):
    """
    Placeholder for the Report Agent.
    Future implementation will compile Evidence Graph data into
    a structured, user-facing markdown/JSON audit report.

    Capabilities served: REPORT_WRITING, DB_STORAGE
    Routing is registered externally in AgentRegistry — not defined here.
    """

    def __init__(self) -> None:
        super().__init__(agent_id="report_agent_01", agent_name="Report Agent")

    async def execute(self, mission: Mission, task_params: Dict[str, Any]) -> ExecutionResult:
        task = task_params.get("task")
        shared_context = task_params.get("shared_context", {})
        start = datetime.utcnow().timestamp()

        # Pull upstream analysis output from shared_context if available.
        findings = []
        for key, val in shared_context.items():
            if isinstance(val, dict) and "findings" in val:
                findings.extend(val["findings"])

        stub_report = {
            "mission_id": mission.id,
            "goal": mission.schema.goal,
            "total_issues": len(findings),
            "score": max(0, 100 - len(findings) * 10),
            "summary": f"Stub report for mission '{mission.schema.goal}'. "
                       f"Found {len(findings)} issue(s).",
            "issues": findings,
        }

        return ExecutionResult(
            task_id=task.task_id if task else "unknown",
            agent_id=self.agent_id,
            success=True,
            output=stub_report,
            logs=[f"[{self.agent_name}] Stub report compiled with {len(findings)} issue(s)."],
            duration_ms=int((datetime.utcnow().timestamp() - start) * 1000),
        )

    async def validate(self, result: Any) -> bool:
        return isinstance(result, ExecutionResult) and result.success

    async def rollback(self, mission: Mission) -> None:
        mission.log(f"[{self.agent_name}] Rollback: stub report discarded.")

    async def health(self) -> Dict[str, Any]:
        return {"agent_id": self.agent_id, "status": "healthy", "mode": "stub"}
