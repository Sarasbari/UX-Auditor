from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field
from datetime import datetime

from .task import Task

class ExecutionPlan(BaseModel):
    """
    The output of the Planning Layer. A formalized task graph required to complete a Mission.
    """
    plan_id: str
    mission_id: str
    mission_type: str = Field(default="DEFAULT")
    objective: str
    status: str = Field(default="DRAFT", description="DRAFT, APPROVED, IN_PROGRESS, COMPLETED, FAILED")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    
    tasks: List[Task] = Field(default_factory=list)
    dependencies: Dict[str, List[str]] = Field(default_factory=dict, description="Task dependency map: { task_id: [dependent_task_ids] }")
    
    total_tasks: int = 0
    estimated_duration: Optional[int] = Field(None, description="Estimated duration in seconds")
    confidence: float = Field(..., ge=0.0, le=1.0)
    
    execution_strategy: str = Field(default="SEQUENTIAL", description="SEQUENTIAL or PARALLEL")
    planner_version: str = Field(default="v1.0")
    planning_duration_ms: int = 0
