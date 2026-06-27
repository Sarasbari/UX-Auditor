from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

from .evidence import Evidence


class ExecutionResult(BaseModel):
    """
    The structured output of a single task execution by an agent.
    Agents return this. The ExecutionService consumes it to update Mission state.
    Agents never mutate Mission or Task directly.
    """
    task_id: str
    agent_id: str
    success: bool
    output: Optional[Any] = None
    evidence: List[Evidence] = Field(default_factory=list)
    logs: List[str] = Field(default_factory=list)
    duration_ms: int = 0
    errors: List[str] = Field(default_factory=list)
    # next_state allows an agent to signal a desired Mission state transition.
    # The ExecutionService validates and applies it — agents never set state directly.
    next_state: Optional[str] = None
    # retryable signals to future retry infrastructure whether this failure
    # is transient (True) or permanent (False). Extension point for Sprint 5+.
    retryable: bool = False
