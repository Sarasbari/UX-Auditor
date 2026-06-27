from typing import Any, Dict, Optional
from pydantic import BaseModel, Field

class Evidence(BaseModel):
    """
    Evidence collected during an audit mission to prove an issue's existence.
    Supports Explainability First principle.
    """
    id: str
    source_url: str
    dom_snippet: str = Field(description="The exact HTML node where the issue was found.")
    css_computed: Optional[str] = Field(None, description="Relevant computed styles.")
    screenshot_path: Optional[str] = Field(None, description="Path or base64 data for visual proof.")
    confidence: float = Field(..., ge=0.0, le=1.0, description="AI confidence score of this evidence.")
    metadata: Dict[str, Any] = Field(default_factory=dict)
