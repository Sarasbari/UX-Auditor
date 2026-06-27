import sqlite3
import json
import os
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "audits.db")

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Audits Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS audits (
        id TEXT PRIMARY KEY,
        url TEXT,
        journey_steps TEXT,
        status TEXT,
        timestamp TEXT,
        score INTEGER,
        report_json TEXT
    )
    """)
    
    # Chat Messages Table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        audit_id TEXT,
        role TEXT,
        content TEXT,
        cited_issue_ids TEXT DEFAULT '[]',
        timestamp TEXT,
        FOREIGN KEY (audit_id) REFERENCES audits (id) ON DELETE CASCADE
    )
    """)
    
    # Self-healing migration for existing databases
    try:
        cursor.execute("SELECT cited_issue_ids FROM chat_messages LIMIT 1")
    except sqlite3.OperationalError:
        cursor.execute("ALTER TABLE chat_messages ADD COLUMN cited_issue_ids TEXT DEFAULT '[]'")
    
    conn.commit()
    conn.close()

def create_audit(audit_id: str, url: str, journey_steps: str = ""):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO audits (id, url, journey_steps, status, timestamp) VALUES (?, ?, ?, ?, ?)",
        (audit_id, url, journey_steps, "queued", datetime.utcnow().isoformat())
    )
    conn.commit()
    conn.close()

def update_audit_status(audit_id: str, status: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE audits SET status = ? WHERE id = ?",
        (status, audit_id)
    )
    conn.commit()
    conn.close()

def save_audit_report(audit_id: str, score: int, report_data: dict):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE audits SET status = ?, score = ?, report_json = ? WHERE id = ?",
        ("completed", score, json.dumps(report_data), audit_id)
    )
    conn.commit()
    conn.close()

def mark_audit_failed(audit_id: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE audits SET status = ? WHERE id = ?",
        ("failed", audit_id)
    )
    conn.commit()
    conn.close()

def get_audit(audit_id: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM audits WHERE id = ?", (audit_id,))
    row = cursor.fetchone()
    conn.close()
    if row:
        res = dict(row)
        if res.get("report_json"):
            res["report"] = json.loads(res["report_json"])
        else:
            res["report"] = None
        return res
    return None

def save_chat_message(audit_id: str, role: str, content: str, cited_issue_ids: list = None):
    conn = get_db_connection()
    cursor = conn.cursor()
    cited_str = json.dumps(cited_issue_ids or [])
    cursor.execute(
        "INSERT INTO chat_messages (audit_id, role, content, cited_issue_ids, timestamp) VALUES (?, ?, ?, ?, ?)",
        (audit_id, role, content, cited_str, datetime.utcnow().isoformat())
    )
    conn.commit()
    conn.close()

def get_chat_history(audit_id: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT role, content, cited_issue_ids, timestamp FROM chat_messages WHERE audit_id = ? ORDER BY id ASC",
        (audit_id,)
    )
    rows = cursor.fetchall()
    conn.close()
    
    history = []
    for row in rows:
        d = dict(row)
        try:
            d["cited_issue_ids"] = json.loads(d["cited_issue_ids"] or "[]")
        except:
            d["cited_issue_ids"] = []
        history.append(d)
    return history

# Initialize on import/load
init_db()
