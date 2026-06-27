import json
import uuid
from datetime import datetime
from typing import Any, Dict

from ai.config.settings import settings
from ai.runtime.execution_context import ExecutionContext
from ai.runtime.executor import Executor
from ai.runtime.mission import Mission
from ai.runtime.scheduler import TaskScheduler
from ai.runtime.capability_resolver import AgentRegistry
from ai.runtime.state import MissionState
from ai.schemas.execution_plan import ExecutionPlan
from ai.schemas.execution_result import ExecutionResult
from ai.schemas.task import TaskStatus


class ExecutionService:
    """
    Owns the complete execution loop for a Mission's ExecutionPlan.

    Architectural responsibilities (exclusive to this service):
      - Iterating tasks via TaskScheduler.
      - Building ExecutionContext per task.
      - Invoking Executor.execute_task().
      - Updating task.status from ExecutionResult.
      - Updating mission_metrics.
      - Appending mission logs.
      - Returning the terminal MissionState.

    The Runtime orchestrates; this Service executes.
    """

    def __init__(self, executor: Executor, scheduler: TaskScheduler) -> None:
        self._executor = executor
        self._scheduler = scheduler

    async def run(self, mission: Mission, plan: ExecutionPlan) -> MissionState:
        """
        Drive the execution loop until the plan completes or fails.
        Returns the terminal MissionState for the Runtime to apply.
        """
        trace_id = str(uuid.uuid4())
        shared_context: Dict[str, Any] = {}
        task_results: Dict[str, ExecutionResult] = {}

        mission.log(f"ExecutionService started. trace_id={trace_id}")

        while not self._scheduler.is_complete(plan):
            if self._scheduler.has_failed(plan):
                failed = self._scheduler.get_failed_tasks(plan)
                mission.log(f"Execution halted — failed tasks: {[t.task_id for t in failed]}")
                return MissionState.FAILED

            ready_tasks = self._scheduler.get_ready_tasks(plan)

            if not ready_tasks:
                # Deadlock guard: no tasks ready but plan not complete or failed.
                mission.log("Execution stalled — no ready tasks and plan not complete.")
                return MissionState.FAILED

            # Sprint 3: sequential execution only.
            # Extension point: replace this loop with parallel dispatch in Sprint 5+.
            for task in ready_tasks:
                context = ExecutionContext(
                    mission=mission,
                    current_task=task,
                    trace_id=trace_id,
                    runtime_metadata={
                        "timeout_seconds": settings.timeout_seconds,
                        "provider": settings.provider_preference,
                    },
                    shared_context=shared_context,
                )

                mission.log(f"Executing task '{task.task_id}' ({task.name}) "
                            f"via capability '{task.required_capability}'")

                result = await self._executor.execute_task(context)
                task_results[task.task_id] = result

                # --- State mutation: ExecutionService owns this exclusively ---
                if result.success:
                    task.status = TaskStatus.COMPLETED
                    mission.log(f"Task '{task.task_id}' COMPLETED in {result.duration_ms}ms.")
                    # Write agent output into shared_context for downstream tasks
                    if result.output is not None:
                        shared_context[task.task_id] = result.output
                else:
                    task.status = TaskStatus.FAILED
                    mission.log(
                        f"Task '{task.task_id}' FAILED. "
                        f"Errors: {result.errors}. "
                        f"Retryable: {result.retryable}"
                    )
                # ----------------------------------------------------------------

        # All tasks completed — collect metrics
        self._collect_metrics(mission, plan, task_results)
        mission.log("ExecutionService: all tasks completed successfully.")
        return MissionState.COMPLETED

    @staticmethod
    def _collect_metrics(
        mission: Mission,
        plan: ExecutionPlan,
        results: Dict[str, ExecutionResult],
    ) -> None:
        """Aggregate per-task metrics into mission_metrics."""
        mission.schema.mission_metrics = {
            "total_tasks": plan.total_tasks,
            "completed_tasks": sum(1 for r in results.values() if r.success),
            "failed_tasks": sum(1 for r in results.values() if not r.success),
            "total_duration_ms": sum(r.duration_ms for r in results.values()),
            "per_task": {
                task_id: {
                    "agent_id": r.agent_id,
                    "success": r.success,
                    "duration_ms": r.duration_ms,
                    "errors": r.errors,
                }
                for task_id, r in results.items()
            },
        }
