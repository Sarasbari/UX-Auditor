from abc import ABC, abstractmethod
from typing import Any, Dict

from ai.runtime.mission import Mission

class BaseAgent(ABC):
    """
    Abstract interface for all autonomous Agents in the system.
    Defines a standard lifecycle for Planning, Browser, Patch, and Verification Agents.
    """
    
    def __init__(self, agent_id: str, agent_name: str):
        self.agent_id = agent_id
        self.agent_name = agent_name

    @abstractmethod
    async def execute(self, mission: Mission, task_params: Dict[str, Any]) -> Any:
        """Execute the agent's primary domain logic."""
        raise NotImplementedError

    @abstractmethod
    async def validate(self, result: Any) -> bool:
        """Self-reflect and validate the execution output."""
        raise NotImplementedError

    @abstractmethod
    async def rollback(self, mission: Mission) -> None:
        """Revert changes or clean up state on execution failure."""
        raise NotImplementedError

    @abstractmethod
    async def health(self) -> Dict[str, Any]:
        """Return diagnostic health and capability status of the agent."""
        raise NotImplementedError
