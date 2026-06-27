from typing import List

from ai.schemas.execution_plan import ExecutionPlan
from ai.schemas.task import Task, TaskStatus


class TaskScheduler:
    """
    Stateless utility for determining task execution order.
    Operates purely on the ExecutionPlan — no side effects, no state.
    All scheduling decisions are made from task dependency and status alone.
    """

    @staticmethod
    def get_ready_tasks(plan: ExecutionPlan) -> List[Task]:
        """
        Returns all tasks that are eligible to run immediately.
        A task is ready if:
          1. Its status is PENDING or READY.
          2. All of its declared dependency task_ids have status COMPLETED.
        """
        completed_ids = {
            t.task_id for t in plan.tasks if t.status == TaskStatus.COMPLETED
        }

        ready = []
        for task in plan.tasks:
            if task.status not in (TaskStatus.PENDING, TaskStatus.READY):
                continue
            if all(dep in completed_ids for dep in task.dependencies):
                ready.append(task)
        return ready

    @staticmethod
    def is_complete(plan: ExecutionPlan) -> bool:
        """True when every task in the plan has been completed."""
        return all(t.status == TaskStatus.COMPLETED for t in plan.tasks)

    @staticmethod
    def has_failed(plan: ExecutionPlan) -> bool:
        """True if any non-skipped task has failed — terminates the execution loop."""
        return any(
            t.status == TaskStatus.FAILED
            for t in plan.tasks
            if t.status != TaskStatus.SKIPPED
        )

    @staticmethod
    def get_failed_tasks(plan: ExecutionPlan) -> List[Task]:
        """Returns all tasks currently in FAILED state."""
        return [t for t in plan.tasks if t.status == TaskStatus.FAILED]
