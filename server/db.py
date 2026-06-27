import json
from datetime import datetime
from typing import Dict, Any, List

# In-memory dictionary acting as the transient database for running jobs
_audits: Dict[str, Dict[str, Any]] = {}

def init_db():
    # No-op since we use in-memory structures now
    pass

def create_audit(audit_id: str, url: str, journey_steps: str = ""):
    _audits[audit_id] = {
        "id": audit_id,
        "url": url,
        "journey_steps": journey_steps,
        "status": "queued",
        "timestamp": datetime.utcnow().isoformat(),
        "score": None,
        "report_json": None,
        "error_message": None
    }

def update_audit_status(audit_id: str, status: str):
    if audit_id in _audits:
        _audits[audit_id]["status"] = status

def save_audit_report(audit_id: str, score: int, report_data: dict):
    if audit_id in _audits:
        _audits[audit_id]["status"] = "completed"
        _audits[audit_id]["score"] = score
        _audits[audit_id]["report_json"] = json.dumps(report_data)

def mark_audit_failed(audit_id: str, error_message: str = None):
    if audit_id in _audits:
        _audits[audit_id]["status"] = "failed"
        _audits[audit_id]["error_message"] = error_message or "Audit failed during execution."

def get_audit(audit_id: str):
    audit = _audits.get(audit_id)
    if audit:
        res = dict(audit)
        if res.get("report_json"):
            res["report"] = json.loads(res["report_json"])
        else:
            res["report"] = None
        return res
    return None

_chat_messages: Dict[str, List[Dict[str, Any]]] = {}

def save_chat_message(audit_id: str, role: str, content: str, cited_issue_ids: list = None):
    if audit_id not in _chat_messages:
        _chat_messages[audit_id] = []
    _chat_messages[audit_id].append({
        "id": f"{role}-{len(_chat_messages[audit_id])}",
        "role": role,
        "content": content,
        "citedIssueIds": cited_issue_ids or []
    })

def get_chat_history(audit_id: str) -> List[Dict[str, Any]]:
    return _chat_messages.get(audit_id, [])

