"""
services/context_service.py
---------------------------
Builds a stateless, immutable context bundle for the conversational agent.

Sprint 6 — Intelligent Report Generation & Conversational UX Expert.
"""

from typing import Any, Dict, List
from pydantic import BaseModel
from ai.runtime.mission import Mission
from ai.schemas.recommendation import Recommendation


class ContextBundle(BaseModel):
    """
    Immutable snapshot of relevant mission context for ChatAgent.
    """
    mission_id: str
    goal: str
    evidence_count: int
    verified_patches: List[Dict[str, Any]]
    recommendations: List[Dict[str, Any]]
    metrics: Dict[str, Any]


class ContextService:
    """
    Constructs an immutable Context Bundle to prevent state mutations by ChatAgent.
    """

    def build_context_bundle(self, mission: Mission, recommendations: List[Recommendation]) -> ContextBundle:
        """
        Extracts safe, read-only data for the conversational agent.
        """
        return ContextBundle(
            mission_id=mission.id,
            goal=mission.schema.goal,
            evidence_count=len(mission.schema.evidence),
            verified_patches=mission.schema.verified_patches,
            recommendations=[r.model_dump() for r in recommendations],
            metrics=mission.schema.mission_metrics
        )
