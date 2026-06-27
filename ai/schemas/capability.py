from enum import Enum


class AgentCapability(str, Enum):
    """
    Canonical enum of all capabilities an agent can fulfil.
    Used by AgentRegistry for routing and by Task.required_capability
    for capability-based agent selection. This is the single source of truth
    — agents never define their own routing policy.
    """
    # Sprint 3 capabilities (legacy / planned)
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

    # Sprint 4 capabilities
    CAPTURE_BROWSER = "capture_browser"
    ANALYZE_ACCESSIBILITY = "analyze_accessibility"
    ANALYZE_HEURISTICS = "analyze_heuristics"

    # Sprint 5 capabilities
    GENERATE_PATCH = "generate_patch"
    VERIFY_PATCH = "verify_patch"

    # Sprint 6 capabilities
    GENERATE_REPORT = "generate_report"
    CONVERSE = "converse"
