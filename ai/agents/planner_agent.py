import time
from typing import Any, Dict
from ai.agents.base import BaseAgent
from ai.runtime.mission import Mission
from ai.schemas.execution_plan import ExecutionPlan
from ai.services.planning_service import PlanningService

class PlannerAgent(BaseAgent):
    """
    The Planner Agent acts as the intelligence layer converting a Mission goal
    into a structured, executable Task Graph (Execution Plan).
    It delegating the actual construction and validation to the PlanningService.
    """
    def __init__(self, wrapper: Any = None):
        super().__init__(agent_id="planner_agent_01", agent_name="System Planner")
        # Wrapper is injected to keep the agent provider-agnostic
        self.wrapper = wrapper

    async def execute(self, mission: Mission, task_params: Dict[str, Any] = None) -> ExecutionPlan:
        """
        Analyze the mission and generate an execution plan.
        In Sprint 2, this returns the default template from PlanningService.
        """
        start_time = time.time()
        
        # Future: plan = await self.wrapper.plan(mission.schema.goal, mission.context.metadata)
        # For Sprint 2, we delegate to the Service layer for the template.
        plan = PlanningService.create_default_audit_plan(
            mission_id=mission.id, 
            objective=mission.schema.goal
        )
        
        # Validate the generated plan strictly
        PlanningService.validate_plan(plan)
        
        # Measure duration
        plan.planning_duration_ms = int((time.time() - start_time) * 1000)
        
        # Return the ExecutionPlan (DO NOT execute it)
        return plan

    async def validate(self, result: Any) -> bool:
        if not isinstance(result, ExecutionPlan):
            return False
        try:
            return PlanningService.validate_plan(result)
        except ValueError:
            return False

    async def rollback(self, mission: Mission) -> None:
        """Clear any corrupted planning state."""
        mission.schema.execution_plan = None
        mission.schema.planned_tasks = []

    async def health(self) -> Dict[str, Any]:
        return {
            "agent_id": self.agent_id,
            "status": "healthy",
            "wrapper_attached": self.wrapper is not None
        }
