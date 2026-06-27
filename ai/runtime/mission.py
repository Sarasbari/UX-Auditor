import uuid
from typing import Any, Dict
from datetime import datetime

from ai.schemas.mission import MissionSchema
from .state import MissionState
from .context import MissionContext

class Mission:
    """
    The orchestratable object encapsulating the serializable schema and the live runtime context.
    """
    def __init__(self, goal: str, priority: int = 1, user_info: Dict[str, Any] = None):
        self.id = str(uuid.uuid4())
        
        self.schema = MissionSchema(
            id=self.id,
            goal=goal,
            priority=priority,
            state=MissionState.CREATED.value
        )
        
        self.context = MissionContext(
            mission_id=self.id,
            goal=goal,
            user_info=user_info or {}
        )
    
    def transition_state(self, new_state: MissionState):
        """Transition mission to a new state and log it."""
        self.schema.state = new_state.value
        self.schema.updated_at = datetime.utcnow()
        self.log(f"Mission transitioned to {new_state.value}")
        
    def log(self, message: str):
        """Append a timestamped log to the mission history."""
        timestamp = datetime.utcnow().isoformat()
        self.schema.logs.append(f"[{timestamp}] {message}")
