import json
from typing import Dict, Optional

from ai.runtime.mission import Mission
from ai.runtime.state import MissionState


class MissionRuntime:
    """
    The central orchestrator for the UX-Auditor Agentic Runtime.

    Responsibilities (Runtime owns):
      - Mission registration and storage.
      - Mission state transitions (only the runtime touches state).
      - Delegating planning to PlannerAgent via plan_mission().
      - Delegating execution to ExecutionService via execute_mission().

    The Runtime is a thin orchestrator. It does NOT contain business logic.
    """

    def __init__(self) -> None:
        self.active_missions: Dict[str, Mission] = {}

        # Injected dependencies — set externally before calling plan/execute.
        self.planner_agent = None        # Injected: PlannerAgent instance
        self.execution_service = None    # Injected: ExecutionService instance

    # ------------------------------------------------------------------
    # Mission management
    # ------------------------------------------------------------------

    def register_mission(self, goal: str, user_info: Optional[Dict] = None) -> Mission:
        """Register a new Mission and transition it to CREATED."""
        mission = Mission(goal=goal, user_info=user_info)
        self.active_missions[mission.id] = mission
        mission.log("Mission registered in runtime.")
        return mission

    def update_mission_state(self, mission_id: str, new_state: MissionState) -> None:
        """Apply a state transition. Only the Runtime calls this method."""
        if mission_id not in self.active_missions:
            raise ValueError(f"Mission '{mission_id}' not found in active missions.")
        self.active_missions[mission_id].transition_state(new_state)

    def get_mission(self, mission_id: str) -> Optional[Mission]:
        return self.active_missions.get(mission_id)

    # ------------------------------------------------------------------
    # Planning (Sprint 2)
    # ------------------------------------------------------------------

    async def plan_mission(self, mission_id: str):
        """
        Transition mission to PLANNING, invoke PlannerAgent, store the
        ExecutionPlan inside the Mission schema, then transition to WAITING.
        """
        mission = self._require_mission(mission_id)

        if not self.planner_agent:
            raise RuntimeError("PlannerAgent is not injected. Cannot plan mission.")

        self.update_mission_state(mission_id, MissionState.PLANNING)
        mission.log("Planning phase started.")

        try:
            execution_plan = await self.planner_agent.execute(mission)
            mission.schema.execution_plan = execution_plan.model_dump_json()
            mission.schema.planned_tasks = [t.task_id for t in execution_plan.tasks]
            mission.log(f"Planning complete. {execution_plan.total_tasks} task(s) generated.")
            self.update_mission_state(mission_id, MissionState.WAITING)
            return execution_plan
        except Exception as exc:
            mission.log(f"Planning failed: {exc}")
            self.update_mission_state(mission_id, MissionState.FAILED)
            raise

    # ------------------------------------------------------------------
    # Execution (Sprint 3)
    # ------------------------------------------------------------------

    async def execute_mission(self, mission_id: str):
        """
        Transition mission to RUNNING and delegate the full execution loop
        to ExecutionService. Apply the terminal state returned by the service.

        Flow:
          WAITING → RUNNING → ExecutionService.run() → COMPLETED / FAILED
        """
        mission = self._require_mission(mission_id)

        if mission.schema.state != MissionState.WAITING.value:
            raise RuntimeError(
                f"Mission must be in WAITING state to execute. "
                f"Current state: {mission.schema.state}"
            )

        if not self.execution_service:
            raise RuntimeError("ExecutionService is not injected. Cannot execute mission.")

        if not mission.schema.execution_plan:
            raise RuntimeError("Mission has no execution plan. Call plan_mission() first.")

        # Deserialize the stored plan
        from ai.schemas.execution_plan import ExecutionPlan
        plan = ExecutionPlan.model_validate_json(mission.schema.execution_plan)

        self.update_mission_state(mission_id, MissionState.RUNNING)
        mission.log("Execution phase started.")

        try:
            terminal_state = await self.execution_service.run(mission, plan)
            self.update_mission_state(mission_id, terminal_state)
            mission.log(f"Mission execution finished with state: {terminal_state.value}")
        except Exception as exc:
            mission.log(f"Execution service raised unhandled exception: {exc}")
            self.update_mission_state(mission_id, MissionState.FAILED)
            raise

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _require_mission(self, mission_id: str) -> Mission:
        mission = self.active_missions.get(mission_id)
        if not mission:
            raise ValueError(f"Mission '{mission_id}' not found.")
        return mission
