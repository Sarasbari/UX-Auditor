from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field
from datetime import datetime

from .evidence import Evidence
from .issue import Issue

class MissionSchema(BaseModel):
    """
    The core data representation of an Agentic Mission.
    This schema contains placeholders for Agentic planning structures.
    """
    id: str
    goal: str
    objective: Optional[str] = None
    priority: int = 1
    state: str = "CREATED"
    
    # Execution & Planner Placeholders (Architect additions)
    execution_plan: Optional[str] = Field(None, description="The serialized graph or plan text")
    planned_tasks: List[str] = Field(default_factory=list)
    current_task: Optional[str] = None
    constraints: List[str] = Field(default_factory=list)
    
    # Mission Timeline (Sprint 6)
    timeline: List[str] = Field(
        default_factory=list,
        description="Records high-level mission phases e.g., Planning, Execution, Browser Capture..."
    )
    
    # Audit state
    findings: List[Issue] = Field(default_factory=list)
    evidence: List[Evidence] = Field(default_factory=list)
    
    # Patch tracking
    generated_patches: List[Dict[str, Any]] = Field(default_factory=list)
    verified_patches: List[Dict[str, Any]] = Field(default_factory=list)
    verification_results: List[Dict[str, Any]] = Field(default_factory=list)
    patch_history: List[Dict[str, Any]] = Field(
        default_factory=list,
        description="Lightweight audit trail of patch verifications."
    )
    
    # Diagnostics
    mission_metrics: Dict[str, Any] = Field(
        default_factory=lambda: {
            "mission_duration_ms": 0,
            "tasks_completed": 0,
            "verified_patches": 0,
            "issues_resolved": 0
        }
    )
    logs: List[str] = Field(default_factory=list)
    
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
