"""
services/capability_service.py
------------------------------
Configures and provides the AgentRegistry, mapping capabilities to agents.

Sprint 4 — Browser Execution & Evidence Pipeline.
"""

from ai.runtime.capability_resolver import AgentRegistry
from ai.schemas.capability import AgentCapability

from ai.agents.browser_agent import BrowserAgent
from ai.agents.analysis_agent import AnalysisAgent
from ai.agents.patch_agent import PatchAgent
from ai.agents.verification_agent import VerificationAgent


class CapabilityService:
    """
    Service responsible for wiring capabilities to agent factories.
    """

    @staticmethod
    def build_registry() -> AgentRegistry:
        """
        Create and populate the AgentRegistry with Sprint 4 capabilities.
        Unknown capabilities requested at runtime will raise CapabilityNotRegisteredError
        automatically via the registry.
        """
        registry = AgentRegistry()

        # Sprint 4 capabilities mapped to agent factories
        registry.register(AgentCapability.CAPTURE_BROWSER, lambda: BrowserAgent())
        registry.register(AgentCapability.ANALYZE_ACCESSIBILITY, lambda: AnalysisAgent())
        registry.register(AgentCapability.ANALYZE_HEURISTICS, lambda: AnalysisAgent())
        
        # Sprint 5 capabilities mapped to agent factories
        registry.register(AgentCapability.GENERATE_PATCH, lambda: PatchAgent())
        registry.register(AgentCapability.VERIFY_PATCH, lambda: VerificationAgent())
        
        return registry
