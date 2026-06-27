import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict

from ai.runtime.mission import Mission
from ai.schemas.task import Task


@dataclass
class ExecutionContext:
    """
    Carries all state needed for a single task execution.
    Built fresh per task by ExecutionService before calling Executor.execute_task().
    Never mutated by agents — they receive it read-only as task_params.
    """
    mission: Mission
    current_task: Task

    # Tracing & diagnostics
    execution_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    trace_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    started_at: datetime = field(default_factory=datetime.utcnow)

    # Static metadata passed from AIRuntimeSettings
    runtime_metadata: Dict[str, Any] = field(default_factory=dict)

    # Scratchpad: shared mutable context for inter-task data passing within a plan.
    # Agents read from this; ExecutionService writes results back into it.
    shared_context: Dict[str, Any] = field(default_factory=dict)
