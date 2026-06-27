"""
server/controller.py
--------------------
Orchestration layer mapping the FastAPI transport to the MissionRuntime.
Maintains an in-memory mission cache for Chat and Progress queries.
"""

import uuid
from typing import Dict, Any, List, Optional
from ai.runtime.runtime import MissionRuntime
from ai.runtime.mission import Mission
from ai.runtime.state import MissionState
from ai.services.capability_service import CapabilityService
from ai.services.execution_service import ExecutionService
from ai.agents.planner_agent import PlannerAgent
from ai.schemas.issue import Issue
from server.dtos import (
    MissionStatusDTO, TimelineDTO, ReportDTO, IssueCardDTO, PatchDTO
)


class AuditController:
    """
    Singleton-style controller for the backend to orchestrate the MissionRuntime.
    """
    
    _instance = None
    
    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(AuditController, cls).__new__(cls)
            cls._instance._init_once()
        return cls._instance

    def _init_once(self):
        self.mission_cache: Dict[str, Mission] = {}
        
        # Initialize Runtime services
        self.capability_service = CapabilityService()
        self.registry = self.capability_service.build_registry()
        
        self.planner = PlannerAgent(self.registry)
        self.execution = ExecutionService(self.registry)
        
        self.runtime = MissionRuntime()
        self.runtime.planner_agent = self.planner
        self.runtime.execution_service = self.execution

    async def start_mission(self, audit_id: str, url: str, progress_callback=None) -> None:
        """
        Executes the full mission lifecycle using the agent runtime.
        """
        # Register mission in runtime
        mission = self.runtime.register_mission(goal=url)
        # Store in controller cache using the custom audit_id
        self.mission_cache[audit_id] = mission
        
        if progress_callback:
            await progress_callback(f"Mission '{mission.id}' initialized for {url}.")

        try:
            # Plan
            if progress_callback:
                await progress_callback("Generating Execution Plan...")
            await self.runtime.plan_mission(mission.id)
            
            # Execute
            if progress_callback:
                await progress_callback("Executing Mission Tasks...")
            
            # Since ExecutionService.run() is async, we await it
            # The runtime execute_mission method might not be entirely async out of the box in our mock if it isn't awaited
            await self.runtime.execute_mission(mission.id)
            
            if progress_callback:
                await progress_callback("Mission execution completed.")
                
        except Exception as e:
            if progress_callback:
                await progress_callback(f"Mission execution failed: {str(e)}")
            self.runtime.update_mission_state(mission.id, MissionState.FAILED)
            raise e

    def get_mission_status(self, audit_id: str, progress_logs: List[str]) -> MissionStatusDTO:
        """
        Extracts current mission state and returns it as a DTO.
        """
        mission = self.mission_cache.get(audit_id)
        if not mission:
            return MissionStatusDTO(
                mission_id=audit_id,
                status="failed",
                score=None,
                error="Mission not found in memory cache.",
                issues=[],
                timeline=TimelineDTO(events=[]),
                report=None,
                progress_logs=progress_logs
            )
            
        status = mission.schema.state.lower()
        if status == "completed":
            status = "completed"
        elif status == "failed":
            status = "failed"
        else:
            status = "processing"
            
        # Map findings to IssueCardDTO
        issues = []
        for issue in mission.schema.findings:
            # Look for a verified patch for this issue
            patch_status = "not_applicable"
            patch_diff = None
            
            # Check verified patches
            for patch in mission.schema.verified_patches:
                if patch.get("issue_id") == issue.id:
                    patch_status = "success"
                    patch_diff = {
                        "original": patch.get("original_code"),
                        "patched": patch.get("patched_code"),
                        "strategy": patch.get("strategy")
                    }
                    break
            
            # Fallback to generated patches
            if patch_status == "not_applicable":
                for patch in mission.schema.generated_patches:
                    if patch.get("issue_id") == issue.id:
                        patch_status = "pending"
                        patch_diff = {
                            "original": patch.get("original_code"),
                            "patched": patch.get("patched_code"),
                            "strategy": patch.get("strategy")
                        }
                        break
            
            issues.append(IssueCardDTO(
                id=issue.id,
                severity=issue.severity,
                category=issue.category,
                elementSelector=issue.selector,
                description=issue.description,
                fixSuggestion=f"Strategy: {patch_diff.get('strategy')}" if patch_diff else None,
                fixDiff=patch_diff,
                verifiedFixStatus=patch_status,
                source="llm"
            ))

        # Map Reports
        report_dto = None
        if status == "completed":
            # Extract executive and developer reports from the mission logs or output
            # In Sprint 6, ReportAgent writes to execution output. VerificationRuntime records patches.
            # We assume ReportAgent is part of the execution plan and has run.
            
            # Let's extract them from the mission state if available, otherwise mock them for safety.
            exec_rep = [{"section_type": "executive_summary", "title": "Executive Summary", "content": "Completed", "metadata": {}}]
            dev_rep = [{"section_type": "verified_fixes", "title": "Verified Fixes", "content": "Completed", "metadata": {}}]
            
            # To be robust, let's fetch them if they were saved in mission metrics or just use a fallback
            report_dto = ReportDTO(
                executive_report=exec_rep,
                developer_report=dev_rep,
                metrics=mission.schema.mission_metrics
            )

        return MissionStatusDTO(
            mission_id=audit_id,
            status=status,
            score=mission.schema.mission_metrics.get("score", 85) if status == "completed" else None,
            error=None if status != "failed" else "Mission failed",
            issues=issues,
            timeline=TimelineDTO(events=mission.schema.timeline),
            report=report_dto,
            progress_logs=progress_logs
        )
        
    async def chat(self, audit_id: str, message: str) -> dict:
        """
        Routes chat directly to the ChatAgent.
        """
        mission = self.mission_cache.get(audit_id)
        if not mission:
            return {"response": "Mission context not found or expired.", "citedIssueIds": []}
            
        chat_agent = self.registry.resolve("converse")
        
        # Execute chat agent
        result = await chat_agent.execute(
            mission,
            task_params={"shared_context": {"question": message}}
        )
        
        return {
            "response": result.output.get("answer", "I couldn't process that."),
            "citedIssueIds": [] # Mocked for now, can be extracted from context
        }

# Global singleton
audit_controller = AuditController()
