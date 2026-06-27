from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

class TaskType(str, Enum):
    SYSTEM = "SYSTEM"
    AI = "AI"
    BROWSER = "BROWSER"
    ANALYSIS = "ANALYSIS"
    REPORT = "REPORT"
    VERIFICATION = "VERIFICATION"

class TaskStatus(str, Enum):
    PENDING = "PENDING"
    READY = "READY"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    SKIPPED = "SKIPPED"

class Task(BaseModel):
    """
    A single execution unit decomposed from a Mission objective.
    """
    task_id: str
    name: str
    description: str
    required_capability: str = Field(description="The capability required to execute this task, rather than a hardcoded agent.")
    task_type: TaskType
    priority: int = 1
    status: TaskStatus = TaskStatus.PENDING
    dependencies: List[str] = Field(default_factory=list, description="List of task_ids that must complete before this task.")
    expected_output: str
    metadata: Dict[str, Any] = Field(default_factory=dict)
