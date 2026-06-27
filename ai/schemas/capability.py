from enum import Enum


class AgentCapability(str, Enum):
    """
    Canonical enum of all capabilities an agent can fulfil.
    Used by AgentRegistry for routing and by Task.required_capability
    for capability-based agent selection. This is the single source of truth
    — agents never define their own routing policy.
    """
    BROWSER_CONTROL = "BROWSER_CONTROL"
    DOM_PARSING = "DOM_PARSING"
    BROWSER_SANDBOX = "BROWSER_SANDBOX"
    DETERMINISTIC_EVAL = "DETERMINISTIC_EVAL"
    VISION_ANALYSIS = "VISION_ANALYSIS"
    DATA_MERGING = "DATA_MERGING"
    CODE_GENERATION = "CODE_GENERATION"
    REPORT_WRITING = "REPORT_WRITING"
    DB_STORAGE = "DB_STORAGE"
    VERIFICATION = "VERIFICATION"
