import time
from datetime import datetime

from ai.runtime.capability_resolver import CapabilityResolver
from ai.runtime.execution_context import ExecutionContext
from ai.schemas.execution_result import ExecutionResult
from ai.schemas.task import Task


class Executor:
    """
    Executes exactly ONE task and returns an ExecutionResult.

    Architectural contract (enforced):
      - Executor DOES NOT update task.status.
      - Executor DOES NOT update Mission state.
      - Executor DOES NOT collect metrics.
      - Executor only: resolves agent → calls execute → returns result.

    All state mutation is the exclusive responsibility of ExecutionService.
    """

    def __init__(self, resolver: CapabilityResolver) -> None:
        self._resolver = resolver

    async def execute_task(self, context: ExecutionContext) -> ExecutionResult:
        """
        Resolve the correct agent for the task's required_capability,
        execute it, and return a structured ExecutionResult.
        The result is returned untouched — no state is modified here.
        """
        task = context.current_task
        start_ms = int(datetime.utcnow().timestamp() * 1000)

        try:
            from ai.schemas.capability import AgentCapability
            capability = AgentCapability(task.required_capability)
            agent = self._resolver.resolve(capability)

            task_params = {
                "task": task,
                "shared_context": context.shared_context,
                "execution_id": context.execution_id,
                "trace_id": context.trace_id,
            }

            result: ExecutionResult = await agent.execute(context.mission, task_params)

            # Enforce duration if agent did not populate it
            if result.duration_ms == 0:
                result.duration_ms = int(datetime.utcnow().timestamp() * 1000) - start_ms

            return result

        except Exception as exc:
            duration = int(datetime.utcnow().timestamp() * 1000) - start_ms
            return ExecutionResult(
                task_id=task.task_id,
                agent_id="executor",
                success=False,
                errors=[str(exc)],
                logs=[f"Executor caught unhandled exception: {exc}"],
                duration_ms=duration,
                retryable=True,
            )
