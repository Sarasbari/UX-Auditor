"""
agents/browser_agent.py
-----------------------
Executes browser actions and captures visual and structural state.

Sprint 4 — Browser Execution & Evidence Pipeline.
"""

from datetime import datetime
from typing import Any, Dict

from ai.agents.base import BaseAgent
from ai.runtime.mission import Mission
from ai.schemas.execution_result import ExecutionResult
from ai.schemas.browser_capture import BrowserCapture, ViewportInfo


class BrowserAgent(BaseAgent):
    """
    Executes browser actions and captures visual and structural state.
    Sprint 4: Implements capture_browser capability.
    Does NOT analyze data.
    """

    def __init__(self) -> None:
        super().__init__(agent_id="browser_agent_01", agent_name="Browser Agent")

    async def execute(self, mission: Mission, task_params: Dict[str, Any]) -> ExecutionResult:
        task = task_params.get("task")
        start = datetime.utcnow().timestamp()

        url = mission.schema.goal

        # Stub Playwright capture for Sprint 4 executable workflow
        # In future sprints, this will use actual Playwright headless browser
        capture = BrowserCapture(
            url=url,
            screenshot_path="/tmp/mock_screenshot.png",
            dom="<html><body><h1>Mock DOM</h1></body></html>",
            css="h1 { color: red; }",
            computed_styles=[],
            viewport=ViewportInfo(width=1920, height=1080),
            metadata={"status": "mock_captured"}
        )

        return ExecutionResult(
            task_id=task.task_id if task else "unknown",
            agent_id=self.agent_id,
            success=True,
            output=capture.model_dump(),
            logs=[f"[{self.agent_name}] Captured browser state for '{url}'"],
            duration_ms=int((datetime.utcnow().timestamp() - start) * 1000),
        )

    async def validate(self, result: Any) -> bool:
        return isinstance(result, ExecutionResult) and result.success

    async def rollback(self, mission: Mission) -> None:
        mission.log(f"[{self.agent_name}] Rollback: closing browser session.")

    async def health(self) -> Dict[str, Any]:
        return {"agent_id": self.agent_id, "status": "healthy"}
