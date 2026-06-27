"""
agents/report_agent.py
----------------------
Autonomous agent responsible for compiling structured UX reports.

Sprint 6 — Intelligent Report Generation & Conversational UX Expert.
"""

from datetime import datetime
from typing import Any, Dict
from ai.agents.base import BaseAgent
from ai.runtime.mission import Mission
from ai.schemas.execution_result import ExecutionResult
from ai.services.report_service import ReportService
from ai.services.recommendation_service import RecommendationService


class ReportAgent(BaseAgent):
    """
    Consumes a Mission and generates dual-view reports (Executive and Developer).
    """

    def __init__(self) -> None:
        super().__init__(agent_id="report_agent_02", agent_name="Report Agent v2")
        self.report_service = ReportService()
        self.recommendation_service = RecommendationService()

    async def execute(self, mission: Mission, task_params: Dict[str, Any]) -> ExecutionResult:
        task = task_params.get("task")
        start = datetime.utcnow().timestamp()

        # Update mission timeline
        mission.schema.timeline.append("Report Generation Started")

        # Generate business recommendations
        recommendations = self.recommendation_service.generate_recommendations(mission.schema.findings)

        # Generate reports
        executive_report = self.report_service.generate_executive_report(mission, recommendations)
        developer_report = self.report_service.generate_developer_report(mission)

        mission.schema.timeline.append("Report Generation Completed")

        return ExecutionResult(
            task_id=task.task_id if task else "unknown",
            agent_id=self.agent_id,
            success=True,
            output={
                "executive_report": [section.model_dump() for section in executive_report],
                "developer_report": [section.model_dump() for section in developer_report],
                "recommendations": [rec.model_dump() for rec in recommendations]
            },
            logs=[f"[{self.agent_name}] Generated Executive and Developer reports."],
            duration_ms=int((datetime.utcnow().timestamp() - start) * 1000),
        )

    async def validate(self, result: Any) -> bool:
        return isinstance(result, ExecutionResult) and result.success

    async def rollback(self, mission: Mission) -> None:
        mission.log(f"[{self.agent_name}] Rollback: discarded generated reports.")

    async def health(self) -> Dict[str, Any]:
        return {"agent_id": self.agent_id, "status": "healthy"}
