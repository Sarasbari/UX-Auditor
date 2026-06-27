"""
agents/chat_agent.py
--------------------
Stateless conversational agent providing UX expertise based on mission context.

Sprint 6 — Intelligent Report Generation & Conversational UX Expert.
"""

from datetime import datetime
from typing import Any, Dict
from ai.agents.base import BaseAgent
from ai.runtime.mission import Mission
from ai.schemas.execution_result import ExecutionResult
from ai.services.context_service import ContextService, ContextBundle


class ChatAgent(BaseAgent):
    """
    Accepts a Question and an immutable ContextBundle.
    Provides answers without maintaining conversation state or mutating the Mission.
    """

    def __init__(self) -> None:
        super().__init__(agent_id="chat_agent_01", agent_name="Chat Agent")
        self.context_service = ContextService()

    async def execute(self, mission: Mission, task_params: Dict[str, Any]) -> ExecutionResult:
        task = task_params.get("task")
        shared_context = task_params.get("shared_context", {})
        start = datetime.utcnow().timestamp()

        question = shared_context.get("question", "What were the main issues found?")
        
        # Build immutable context bundle
        # In a real scenario, recommendations would come from shared_context or mission
        # For simplicity, we assume they are provided in shared_context or empty if not
        recommendation_dicts = shared_context.get("recommendations", [])
        
        # The context service builds the safe bundle
        # But for the context bundle, we can mock the recommendation parsing
        context_bundle = self.context_service.build_context_bundle(mission, [])
        
        # Override with extracted dicts for prompt
        context_bundle.recommendations = recommendation_dicts

        # Mock conversational answer utilizing the context bundle
        answer = (
            f"Based on the audit of {context_bundle.goal} (Mission ID: {context_bundle.mission_id}), "
            f"we verified {len(context_bundle.verified_patches)} patches. "
            f"Regarding your question '{question}', the most critical business impacts "
            f"identified were derived from the {len(context_bundle.recommendations)} recommendations provided."
        )

        return ExecutionResult(
            task_id=task.task_id if task else "unknown",
            agent_id=self.agent_id,
            success=True,
            output={"answer": answer, "context_used": context_bundle.model_dump()},
            logs=[f"[{self.agent_name}] Answered question using stateless context."],
            duration_ms=int((datetime.utcnow().timestamp() - start) * 1000),
        )

    async def validate(self, result: Any) -> bool:
        return isinstance(result, ExecutionResult) and result.success

    async def rollback(self, mission: Mission) -> None:
        pass  # ChatAgent is stateless, nothing to rollback

    async def health(self) -> Dict[str, Any]:
        return {"agent_id": self.agent_id, "status": "healthy"}
