"""
schemas/browser_capture.py
--------------------------
Structured output of a BrowserAgent execution.

This schema is the contract between the BrowserAgent and the AnalysisAgent.
BrowserAgent returns a BrowserCapture serialised inside ExecutionResult.output.
AnalysisAgent reads it from shared_context to produce Finding objects.

Sprint 4 — Browser Execution & Evidence Pipeline.
"""

from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class ViewportInfo(BaseModel):
    """Physical dimensions of the captured viewport."""

    width: int = Field(..., description="Viewport width in CSS pixels.")
    height: int = Field(..., description="Viewport height in CSS pixels.")
    device_scale_factor: float = Field(
        default=1.0,
        description="Device pixel ratio (1.0 for standard, 2.0 for Retina).",
    )
    is_mobile: bool = Field(default=False)


class ComputedStyle(BaseModel):
    """Key computed CSS properties for a single DOM element."""

    selector: str = Field(description="CSS selector identifying the element.")
    tag: str = Field(description="HTML tag name, e.g. 'button', 'h1'.")
    text: Optional[str] = Field(None, description="Visible text content (truncated).")
    color: Optional[str] = None
    background_color: Optional[str] = None
    font_size: Optional[str] = None
    font_family: Optional[str] = None
    line_height: Optional[str] = None
    bounding_box: Optional[Dict[str, float]] = Field(
        None,
        description="Element bounds: {x, y, width, height}.",
    )
    aria_label: Optional[str] = None
    role: Optional[str] = None
    tab_index: Optional[int] = None
    is_visible: bool = True
    extra: Dict[str, Any] = Field(
        default_factory=dict,
        description="Additional computed properties captured for future analysis.",
    )


class BrowserCapture(BaseModel):
    """
    The complete structured snapshot of a webpage produced by BrowserAgent.

    Contract:
      - BrowserAgent fills this and places it in ExecutionResult.output.
      - AnalysisAgent reads it from shared_context[task_id] via ExecutionService.
      - No analysis or interpretation happens here — pure data collection.
    """

    url: str = Field(description="Canonical URL that was captured.")
    screenshot_path: Optional[str] = Field(
        None,
        description=(
            "Absolute filesystem path (or base64 data URI) of the viewport screenshot. "
            "None if screenshot capture was skipped."
        ),
    )
    dom: str = Field(description="Full outer HTML of the captured page.")
    css: str = Field(
        description=(
            "Concatenated text of all <style> blocks and inline styles extracted "
            "from the page. Empty string if none found."
        )
    )
    computed_styles: List[ComputedStyle] = Field(
        default_factory=list,
        description="Computed CSS properties for the top-N visible elements.",
    )
    viewport: ViewportInfo = Field(description="Viewport dimensions at capture time.")
    metadata: Dict[str, Any] = Field(
        default_factory=dict,
        description=(
            "Arbitrary capture metadata: page title, response status, "
            "capture duration, browser version, etc."
        ),
    )
