"""
evidence/__init__.py
--------------------
Public surface of the evidence pipeline package.

Sprint 4 — Browser Execution & Evidence Pipeline.
"""

from .graph import EvidenceGraph, EvidenceNode
from .extractor import EvidenceExtractor
from .merger import FindingMerger

__all__ = [
    "EvidenceGraph",
    "EvidenceNode",
    "EvidenceExtractor",
    "FindingMerger",
]
