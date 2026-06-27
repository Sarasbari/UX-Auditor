from typing import Callable, Dict, Type

from ai.agents.base import BaseAgent
from ai.schemas.capability import AgentCapability


class CapabilityNotRegisteredError(Exception):
    """Raised when AgentRegistry cannot resolve a requested capability."""
    pass


class AgentRegistry:
    """
    Central registry mapping AgentCapability → agent factory (callable).
    Stores factories, not instances, to support lazy instantiation.
    This is the ONLY place where capability-to-agent routing is defined.
    Agents themselves are unaware of this mapping.
    """

    def __init__(self) -> None:
        self._registry: Dict[AgentCapability, Callable[[], BaseAgent]] = {}

    def register(self, capability: AgentCapability, factory: Callable[[], BaseAgent]) -> None:
        """
        Bind a zero-argument factory to a capability.
        The factory is called on demand in resolve() to produce a fresh agent instance.
        """
        self._registry[capability] = factory

    def resolve(self, capability: AgentCapability) -> BaseAgent:
        """
        Instantiate and return the agent registered for the given capability.
        Raises CapabilityNotRegisteredError if no factory is registered.
        """
        factory = self._registry.get(capability)
        if factory is None:
            raise CapabilityNotRegisteredError(
                f"No agent registered for capability: '{capability}'. "
                f"Registered capabilities: {list(self._registry.keys())}"
            )
        return factory()

    def registered_capabilities(self) -> list:
        return list(self._registry.keys())


class CapabilityResolver:
    """
    Thin facade over AgentRegistry exposed to Executor.
    Keeps Executor decoupled from the registry internals.
    """

    def __init__(self, registry: AgentRegistry) -> None:
        self._registry = registry

    def resolve(self, capability: AgentCapability) -> BaseAgent:
        return self._registry.resolve(capability)
