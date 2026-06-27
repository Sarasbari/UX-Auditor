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

    async def execute_mission(self, mission_id: str):
        """
        Execute the mission flow.
        Per Architect Review: This will delegate to the Planner Agent,
        generate a Task Graph (Execution Plan), and then pass to an Executor.
        Implementation is deferred to future sprints.
        """
        if mission_id not in self.active_missions:
            raise ValueError(f"Mission {mission_id} not found.")
            
        mission = self.active_missions[mission_id]
        self.update_mission_state(mission.id, MissionState.PLANNING)
        mission.log("Beginning execution flow. (Planner logic deferred)")
        
        # In the future:
        # 1. execution_plan = await self.planner_agent.plan(mission)
        # 2. await self.executor_agent.execute(mission, execution_plan)
        
        # For Sprint 1, we just simulate a completed pipeline.
        self.update_mission_state(mission.id, MissionState.COMPLETED)
        mission.log("Execution simulation completed.")

    def get_mission(self, mission_id: str) -> Optional[Mission]:
        return self.active_missions.get(mission_id)
