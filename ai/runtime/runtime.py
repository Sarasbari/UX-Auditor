from typing import Dict, Optional
from .mission import Mission
from .state import MissionState

class MissionRuntime:
    """
    The main execution orchestrator for Agentic UX-Auditor.
    Manages missions, injects dependencies, and delegates planning to the Planner.
    """
    def __init__(self):
        self.active_missions: Dict[str, Mission] = {}
        
        # Dependency placeholders (Agents & Wrappers) will be injected here
        self.planner_agent = None
        self.executor_agent = None

    def register_mission(self, goal: str, user_info: Optional[Dict] = None) -> Mission:
        """Register a new mission and set state to CREATED."""
        mission = Mission(goal=goal, user_info=user_info)
        self.active_missions[mission.id] = mission
        mission.log("Mission registered in runtime.")
        return mission

    def update_mission_state(self, mission_id: str, new_state: MissionState):
        """Update and persist the state of an existing mission."""
        if mission_id not in self.active_missions:
            raise ValueError(f"Mission {mission_id} not found.")
            
        mission = self.active_missions[mission_id]
        mission.transition_state(new_state)

    async def plan_mission(self, mission_id: str):
        """
        Transitions the mission to PLANNING, invokes the PlannerAgent to generate
        an ExecutionPlan, saves it in the mission schema, and transitions to WAITING.
        """
        if mission_id not in self.active_missions:
            raise ValueError(f"Mission {mission_id} not found.")
            
        mission = self.active_missions[mission_id]
        
        if not self.planner_agent:
            mission.log("Planner Agent not injected. Aborting planning.")
            raise RuntimeError("Planner Agent is required for plan_mission()")
            
        self.update_mission_state(mission.id, MissionState.PLANNING)
        mission.log("Beginning planning phase.")
        
        try:
            # Planner Agent generates the Execution Plan
            execution_plan = await self.planner_agent.execute(mission)
            
            # Store in the mission object
            mission.schema.execution_plan = execution_plan.model_dump_json()
            mission.schema.planned_tasks = [t.task_id for t in execution_plan.tasks]
            
            mission.log(f"Planning complete. Generated {execution_plan.total_tasks} tasks.")
            self.update_mission_state(mission.id, MissionState.WAITING)
            
        except Exception as e:
            mission.log(f"Planning failed: {str(e)}")
            self.update_mission_state(mission.id, MissionState.FAILED)
            raise e

    async def execute_mission(self, mission_id: str):
        """
        Execute the mission flow using the Executor.
        Implementation deferred to Sprint 3.
        """
        if mission_id not in self.active_missions:
            raise ValueError(f"Mission {mission_id} not found.")
            
        mission = self.active_missions[mission_id]
        
        if mission.schema.state != MissionState.WAITING.value:
            mission.log("Mission must be in WAITING state (planned) to execute.")
            raise RuntimeError("Invalid state for execution.")
            
        self.update_mission_state(mission.id, MissionState.RUNNING)
        mission.log("Execution simulation completed (Actual execution deferred to Sprint 3).")
        self.update_mission_state(mission.id, MissionState.COMPLETED)

    def get_mission(self, mission_id: str) -> Optional[Mission]:
        return self.active_missions.get(mission_id)
