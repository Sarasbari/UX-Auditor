"""
services/recommendation_service.py
----------------------------------
Generates business-focused recommendations from raw issues.

Sprint 6 — Intelligent Report Generation & Conversational UX Expert.
"""

from typing import List
from ai.schemas.issue import Issue
from ai.schemas.recommendation import (
    Recommendation, 
    BusinessImpactCategory, 
    PriorityLevel, 
    DeveloperEffort
)


class RecommendationService:
    """
    Evaluates issues to build business-oriented Recommendation objects.
    """

    def generate_recommendations(self, issues: List[Issue]) -> List[Recommendation]:
        """
        Maps a list of issues to actionable recommendations.
        """
        recommendations = []
        for issue in issues:
            impact, priority, effort = self._categorize_issue(issue)
            
            recommendation = Recommendation(
                issue_id=issue.id,
                priority=priority,
                business_impact=impact,
                developer_effort=effort,
                suggested_action=f"Address {issue.category} issue affecting {issue.selector}",
                confidence=issue.confidence
            )
            recommendations.append(recommendation)
            
        return recommendations

    def _categorize_issue(self, issue: Issue) -> tuple[BusinessImpactCategory, PriorityLevel, DeveloperEffort]:
        """
        Heuristic mapping of an issue to its business impact, priority, and implementation effort.
        """
        category_lower = issue.category.lower()
        severity_lower = issue.severity.lower()
        
        # Default mappings
        impact = BusinessImpactCategory.USER_EXPERIENCE
        effort = DeveloperEffort.MEDIUM
        
        # Map Category -> Impact
        if "accessibility" in category_lower:
            impact = BusinessImpactCategory.ACCESSIBILITY
            effort = DeveloperEffort.LOW
        elif "contrast" in category_lower or "visual" in category_lower:
            impact = BusinessImpactCategory.CONVERSION
            effort = DeveloperEffort.LOW
        elif "security" in category_lower or "privacy" in category_lower:
            impact = BusinessImpactCategory.TRUST
            effort = DeveloperEffort.HIGH
            
        # Map Severity -> Priority
        if severity_lower in ["critical", "high"]:
            priority = PriorityLevel.HIGH
        elif severity_lower == "moderate":
            priority = PriorityLevel.MEDIUM
        else:
            priority = PriorityLevel.LOW
            
        return impact, priority, effort
