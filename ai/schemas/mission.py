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
    
    # Audit state
    findings: List[Issue] = Field(default_factory=list)
    evidence: List[Evidence] = Field(default_factory=list)
    
    # Patch tracking
    generated_patches: List[Dict[str, Any]] = Field(default_factory=list)
    verified_patches: List[Dict[str, Any]] = Field(default_factory=list)
    
    # Diagnostics
    mission_metrics: Dict[str, Any] = Field(default_factory=dict)
    logs: List[str] = Field(default_factory=list)
    
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
