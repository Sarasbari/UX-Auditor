from typing import Any, Dict

class MissionContext:
    """
    In-memory state container strictly for active runtime execution.
    Holds objects that cannot be serialized (like active browser sessions).
    """
    def __init__(self, mission_id: str, goal: str, user_info: Dict[str, Any]):
        self.mission_id = mission_id
        self.goal = goal
        self.user_info = user_info
        self.metadata: Dict[str, Any] = {}
        
        # Hooks for dynamic browser or system resources during a run
        self.browser_session: Any = None 
        
        # Scratchpad for inter-agent communication
        self.temporary_memory: Dict[str, Any] = {}
        
        # Local audit progress
        self.audit_state: Dict[str, Any] = {
            "scanned_urls": [],
            "current_url": None,
        }
