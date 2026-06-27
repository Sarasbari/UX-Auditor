from typing import List
from pydantic import BaseModel
from .issue import Issue

class Report(BaseModel):
    """
    The final output structure of a completed Mission.
    """
    id: str
    mission_id: str
    overall_score: int
    summary: str
    resolved_issues: List[Issue] = []
    unresolved_issues: List[Issue] = []
