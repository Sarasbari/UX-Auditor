import uuid
from typing import List, Dict, Optional
from datetime import datetime
from ai.schemas.task import Task, TaskType
from ai.schemas.execution_plan import ExecutionPlan

class PlanningService:
    """
    Service layer containing business logic for creating, validating,
    and managing Execution Plans.
    """

    @staticmethod
    def create_default_audit_plan(mission_id: str, objective: str) -> ExecutionPlan:
        """
        Builds the default website audit plan template as requested by the Principal Architect.
        """
        tasks = [
            Task(task_id="t1", name="Capture Website", description="Navigate and snapshot DOM/CSS.", required_capability="BROWSER_CONTROL", task_type=TaskType.BROWSER, expected_output="HTML, CSS, Screenshot"),
            Task(task_id="t2", name="Extract DOM", description="Extract elements for accessibility check.", required_capability="DOM_PARSING", task_type=TaskType.SYSTEM, dependencies=["t1"], expected_output="DOM Context"),
            Task(task_id="t3", name="Run Accessibility Analysis", description="Run axe-core checks.", required_capability="DETERMINISTIC_EVAL", task_type=TaskType.ANALYSIS, dependencies=["t2"], expected_output="Accessibility Findings"),
            Task(task_id="t4", name="Run Heuristic Analysis", description="LLM/Vision heuristic checks.", required_capability="VISION_ANALYSIS", task_type=TaskType.AI, dependencies=["t2"], expected_output="Heuristic Findings"),
            Task(task_id="t5", name="Merge Findings", description="Merge axe and heuristic findings.", required_capability="DATA_MERGING", task_type=TaskType.SYSTEM, dependencies=["t3", "t4"], expected_output="Unified Issues"),
            Task(task_id="t6", name="Generate Patches", description="Propose code fixes for issues.", required_capability="CODE_GENERATION", task_type=TaskType.AI, dependencies=["t5"], expected_output="Code Patches"),
            Task(task_id="t7", name="Verify Patches", description="Test patches in sandbox browser.", required_capability="BROWSER_SANDBOX", task_type=TaskType.VERIFICATION, dependencies=["t6"], expected_output="Verified Patches"),
            Task(task_id="t8", name="Generate Report", description="Compile final audit report.", required_capability="REPORT_WRITING", task_type=TaskType.REPORT, dependencies=["t7"], expected_output="Markdown Report"),
            Task(task_id="t9", name="Store Report", description="Save to database.", required_capability="DB_STORAGE", task_type=TaskType.SYSTEM, dependencies=["t8"], expected_output="Saved Status")
        ]
        
        plan = ExecutionPlan(
            plan_id=str(uuid.uuid4()),
            mission_id=mission_id,
            objective=objective,
            tasks=tasks,
            total_tasks=len(tasks),
            confidence=0.95
        )
        
        # Build dependency map
        for t in tasks:
            plan.dependencies[t.task_id] = t.dependencies
            
        return plan

    @staticmethod
    def validate_plan(plan: ExecutionPlan) -> bool:
        """
        Lightweight validation for the task graph structure.
        Ensures:
        - No circular dependencies
        - All dependencies reference valid tasks
        - At least one root task
        - At least one terminal task
        """
        task_ids = {t.task_id for t in plan.tasks}
        
        # 1. Valid References
        for t in plan.tasks:
            for dep in t.dependencies:
                if dep not in task_ids:
                    raise ValueError(f"Task {t.task_id} has invalid dependency: {dep}")
        
        # 2. At least one root task (no dependencies)
        root_tasks = [t for t in plan.tasks if not t.dependencies]
        if not root_tasks:
            raise ValueError("Plan must have at least one root task (no dependencies).")
            
        # 3. At least one terminal task (nobody depends on it)
        all_deps = set()
        for t in plan.tasks:
            all_deps.update(t.dependencies)
        
        terminal_tasks = task_ids - all_deps
        if not terminal_tasks:
            raise ValueError("Plan must have at least one terminal task.")
            
        # 4. Circular Dependencies (Basic DFS check)
        visited = set()
        path = set()
        
        def has_cycle(node: str) -> bool:
            if node in path:
                return True
            if node in visited:
                return False
            path.add(node)
            for dep in plan.dependencies.get(node, []):
                if has_cycle(dep):
                    return True
            path.remove(node)
            visited.add(node)
            return False
            
        for tid in task_ids:
            if has_cycle(tid):
                raise ValueError("Circular dependency detected in ExecutionPlan.")
                
        return True
