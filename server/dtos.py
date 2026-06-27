"""
server/dtos.py
--------------
Lightweight Data Transfer Objects for communication between the MissionRuntime,
FastAPI backend, and Next.js frontend.
"""

from typing import List, Dict, Any, Optional
from pydantic import BaseModel


class IssueCardDTO(BaseModel):
    id: str
    severity: str
    category: str
    elementSelector: Optional[str]
    description: str
    fixSuggestion: Optional[str]
    fixDiff: Optional[Dict[str, Any]]
    verifiedFixStatus: str
    source: str


class PatchDTO(BaseModel):
    patch_id: str
    issue_id: str
    strategy: str
    target: str
    original_code: str
    patched_code: str
    status: str
    confidence: float


class TimelineDTO(BaseModel):
    events: List[str]


class ReportDTO(BaseModel):
    executive_report: List[Dict[str, Any]]
    developer_report: List[Dict[str, Any]]
    metrics: Dict[str, Any]


class MissionStatusDTO(BaseModel):
    mission_id: str
    status: str
    score: Optional[int]
    error: Optional[str]
    issues: List[IssueCardDTO]
    timeline: TimelineDTO
    report: Optional[ReportDTO]
    progress_logs: List[str]
