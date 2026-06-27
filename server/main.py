import os
import uuid
import json
from datetime import datetime
from typing import Optional, List, Dict, Any
from fastapi import FastAPI, BackgroundTasks, HTTPException, Body, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

# Load env variables
load_dotenv()

import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("ux-auditor")

import server.db as db
from server.auditor import run_audit
from server.llm_layer import rerank_and_generate_fixes, chat_with_audit_report

app = FastAPI(title="Conversational UX Auditor API")

# Enable CORS for Next.js and other local clients
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global in-memory log to track live progress updates for audit runs
audit_progress: Dict[str, List[str]] = {}

class AuditRequest(BaseModel):
    url: str
    journey_steps: Optional[str] = ""
    audit_id: Optional[str] = None

class ChatRequest(BaseModel):
    message: str
    chat_history: List[Dict[str, Any]]
    report_data: Dict[str, Any]

async def execute_audit_job(audit_id: str, url: str, journey_steps: str):
    """
    Background job that runs the browser-use agent, aggregates findings,
    sends them to the LLM for reranking/fixes, and updates database state.
    """
    logger.info(f"[{audit_id}] Starting background audit job for URL: {url}")
    audit_progress[audit_id] = ["Initializing agent session..."]
    db.update_audit_status(audit_id, "processing")
    
    async def log_progress(msg: str):
        logger.info(f"[{audit_id}] {msg}")
        if audit_id not in audit_progress:
            audit_progress[audit_id] = []
        audit_progress[audit_id].append(msg)
        
    try:
        # Run browser-use agent audit (with Playwright fallback)
        audit_res = await run_audit(url, journey_steps, progress_callback=log_progress)
        
        await log_progress("Analyzing & reranking findings with LLM...")
        
        # LLM Reranking & Fix generation
        report_data = await rerank_and_generate_fixes(audit_res["findings"], url)
        
        # Add metadata
        report_data["audit_id"] = audit_id
        report_data["url"] = url
        report_data["journey_steps"] = journey_steps
        report_data["timestamp"] = datetime.utcnow().isoformat()
        
        # Save report details
        db.save_audit_report(audit_id, report_data["score"], report_data)
        
        await log_progress("Audit report generated and saved successfully!")
        
    except Exception as e:
        error_msg = str(e)
        logger.error(f"[{audit_id}] Error executing audit: {error_msg}", exc_info=True)
        await log_progress(f"Audit failed: {error_msg}")
        db.mark_audit_failed(audit_id, error_msg)

@app.post("/audit")
async def start_audit(req: AuditRequest, background_tasks: BackgroundTasks):
    url = req.url
    if not url.startswith("http://") and not url.startswith("https://"):
        url = "https://" + url

    audit_id = req.audit_id or uuid.uuid4().hex
    db.create_audit(audit_id, url, req.journey_steps)
    
    audit_progress[audit_id] = ["Queued in background..."]
    background_tasks.add_task(execute_audit_job, audit_id, url, req.journey_steps)
    
    return {"id": audit_id, "status": "queued", "url": url}

@app.get("/report/{audit_id}")
async def get_report(audit_id: str):
    audit = db.get_audit(audit_id)
    if not audit:
        raise HTTPException(status_code=404, detail="Audit not found")
        
    chat_history = db.get_chat_history(audit_id)
    
    # Parse report
    report_json = audit.get("report") or {}
    
    # Normalize error message
    error_msg = audit.get("error_message")
    if not error_msg and audit["status"] == "failed":
        error_msg = "Audit failed during execution."
        
    # Construct full response payload
    return {
        "id": audit["id"],
        "url": audit["url"],
        "journey_steps": audit["journey_steps"],
        "status": audit["status"],
        "score": audit["score"],
        "timestamp": audit["timestamp"],
        "issues": report_json.get("issues", []),
        "chatMessages": chat_history,
        "progress": audit_progress.get(audit_id, ["No progress logs found."]),
        "error": error_msg
    }

@app.post("/chat")
async def chat_followup(req: ChatRequest):
    # Call LLM chat layer directly with request context
    chat_res = await chat_with_audit_report(req.chat_history, req.report_data, req.message)
    return {
        "response": chat_res["response"],
        "citedIssueIds": chat_res["citedIssueIds"]
    }


@app.get("/progress/{audit_id}")
async def get_progress(audit_id: str):
    audit = db.get_audit(audit_id)
    if not audit:
        raise HTTPException(status_code=404, detail="Audit not found")
        
    return {
        "status": audit["status"],
        "progress": audit_progress.get(audit_id, ["No progress logs yet."])
    }

# HTML String for the Premium SPA Frontend
HTML_DASHBOARD = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Conversational UX Auditor</title>
    <!-- Google Fonts -->
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <!-- Tailwind CSS -->
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
        tailwind.config = {
            theme: {
                extend: {
                    fontFamily: {
                        sans: ['"Plus Jakarta Sans"', 'sans-serif'],
                    },
                }
            }
        }
    </script>
    <!-- Custom styling -->
    <style>
        body {
            background-color: #0b0f19;
            color: #f3f4f6;
        }
        .glass-panel {
            background: rgba(17, 24, 39, 0.7);
            backdrop-filter: blur(12px);
            border: 1px solid rgba(255, 255, 255, 0.08);
        }
        .gradient-text {
            background: linear-gradient(135deg, #60a5fa 0%, #a78bfa 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        ::-webkit-scrollbar {
            width: 6px;
        }
        ::-webkit-scrollbar-track {
            background: rgba(0,0,0,0.1);
        }
        ::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.1);
            border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, 0.2);
        }
    </style>
</head>
<body class="min-h-screen flex flex-col font-sans">

    <!-- Header -->
    <header class="glass-panel border-b border-gray-800 sticky top-0 z-50">
        <div class="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
            <div class="flex items-center space-x-3">
                <div class="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-purple-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
                    <span class="text-white font-extrabold text-sm">UX</span>
                </div>
                <span class="font-bold text-lg tracking-tight">Conversational UX Auditor</span>
            </div>
            <div id="status-bar" class="hidden flex items-center space-x-2">
                <span class="w-2.5 h-2.5 rounded-full bg-blue-500 animate-ping"></span>
                <span id="status-text" class="text-sm font-medium text-gray-300">Auditing website...</span>
            </div>
        </div>
    </header>

    <main class="flex-1 max-w-7xl w-full mx-auto p-6 flex flex-col lg:flex-row gap-6">
        
        <!-- Left Panel: Input, Progress, Audit Results -->
        <div class="flex-1 flex flex-col space-y-6 min-w-0">
            
            <!-- Submit Audit Form -->
            <div class="glass-panel rounded-2xl p-6 shadow-xl">
                <h2 class="text-xl font-semibold mb-4 text-white">Start New Audit</h2>
                <form id="audit-form" class="space-y-4">
                    <div>
                        <label class="block text-xs font-semibold uppercase text-gray-400 mb-1">Target Website URL</label>
                        <input type="text" id="target-url" placeholder="example.com or https://example.com" required
                               class="w-full px-4 py-3 bg-gray-900/60 border border-gray-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-200 placeholder-gray-500 transition">
                    </div>
                    <div>
                        <label class="block text-xs font-semibold uppercase text-gray-400 mb-1">User Journey Steps (Optional)</label>
                        <textarea id="journey-steps" placeholder="e.g., Click 'Pricing', then click 'Sign Up' button and check form labels" rows="2"
                                  class="w-full px-4 py-3 bg-gray-900/60 border border-gray-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-200 placeholder-gray-500 transition resize-none"></textarea>
                    </div>
                    <button type="submit" id="submit-btn"
                            class="w-full py-3 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-semibold rounded-xl shadow-lg transition active:scale-95 duration-200">
                        Launch Audit Agent
                    </button>
                </form>
            </div>

            <!-- Progress Tracker -->
            <div id="progress-box" class="hidden glass-panel rounded-2xl p-6 shadow-xl">
                <h3 class="font-semibold text-white mb-3">Auditor Progress Log</h3>
                <div class="bg-black/40 border border-gray-800/80 rounded-xl p-4 h-48 overflow-y-auto font-mono text-xs text-blue-400 space-y-1.5" id="progress-logs">
                    <!-- Progress steps added dynamically -->
                </div>
            </div>

            <!-- Report Results View -->
            <div id="report-view" class="hidden flex flex-col space-y-4">
                <div class="glass-panel rounded-2xl p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <h2 class="text-2xl font-bold text-white mb-1">Audit Report</h2>
                        <p class="text-sm text-gray-400" id="report-url"></p>
                    </div>
                    <div class="flex items-center space-x-6">
                        <div class="text-center">
                            <span class="block text-xs font-semibold uppercase text-gray-500">UX Score</span>
                            <span id="report-score" class="text-4xl font-extrabold text-green-400">92</span>
                        </div>
                        <div class="h-10 w-[1px] bg-gray-800"></div>
                        <div class="text-center">
                            <span class="block text-xs font-semibold uppercase text-gray-500">Total Issues</span>
                            <span id="report-count" class="text-4xl font-extrabold text-blue-400">0</span>
                        </div>
                    </div>
                </div>

                <!-- Filters -->
                <div class="flex items-center space-x-2 overflow-x-auto pb-1">
                    <button onclick="filterIssues('all')" class="filter-btn active px-4 py-2 rounded-xl text-sm font-semibold bg-blue-600 text-white transition">All</button>
                    <button onclick="filterIssues('critical')" class="filter-btn px-4 py-2 rounded-xl text-sm font-semibold bg-gray-800 text-red-400 hover:bg-gray-700 transition">Critical</button>
                    <button onclick="filterIssues('serious')" class="filter-btn px-4 py-2 rounded-xl text-sm font-semibold bg-gray-800 text-orange-400 hover:bg-gray-700 transition">Serious</button>
                    <button onclick="filterIssues('moderate')" class="filter-btn px-4 py-2 rounded-xl text-sm font-semibold bg-gray-800 text-yellow-400 hover:bg-gray-700 transition">Moderate</button>
                    <button onclick="filterIssues('minor')" class="filter-btn px-4 py-2 rounded-xl text-sm font-semibold bg-gray-800 text-blue-400 hover:bg-gray-700 transition">Minor</button>
                </div>

                <!-- Issues List -->
                <div id="issues-list" class="space-y-4">
                    <!-- Issue cards added dynamically -->
                </div>
            </div>

        </div>

        <!-- Right Panel: Conversational Q&A (chat) -->
        <div class="w-full lg:w-96 flex flex-col h-[650px] lg:h-auto lg:min-h-[500px] glass-panel rounded-2xl shadow-xl overflow-hidden">
            <div class="p-4 border-b border-gray-800 flex flex-col">
                <span class="font-bold text-white">UX Chat Assistant</span>
                <span class="text-xs text-gray-400">Ask clarifying questions about the audit results</span>
            </div>
            
            <!-- Chat Messages Box -->
            <div id="chat-messages" class="flex-1 p-4 overflow-y-auto space-y-4 text-sm flex flex-col justify-end">
                <div class="text-center text-gray-500 py-8" id="chat-placeholder">
                    No active audit report yet. Run an audit to begin chatting.
                </div>
            </div>

            <!-- Chat Form -->
            <form id="chat-form" class="p-3 bg-gray-900/40 border-t border-gray-800 flex items-center space-x-2">
                <input type="text" id="chat-input" disabled placeholder="Ask about the audit..." 
                       class="flex-1 bg-gray-950 border border-gray-800 rounded-xl px-4 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 transition">
                <button type="submit" id="chat-send-btn" disabled
                        class="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl px-4 py-2.5 text-sm font-semibold transition active:scale-95 duration-200">
                    Send
                </button>
            </form>
        </div>

    </main>

    <!-- Detailed Issue Modal -->
    <div id="issue-modal" class="hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
        <div class="glass-panel w-full max-w-3xl rounded-2xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
            <div class="p-5 border-b border-gray-800 flex justify-between items-center bg-gray-950/40">
                <h3 class="font-bold text-lg text-white" id="modal-title">Issue Details</h3>
                <button onclick="closeModal()" class="text-gray-400 hover:text-white text-2xl font-bold">&times;</button>
            </div>
            <div class="p-6 overflow-y-auto space-y-6 text-sm">
                
                <div class="grid grid-cols-2 gap-4">
                    <div>
                        <span class="block text-xs uppercase text-gray-500 font-semibold mb-1">Severity</span>
                        <span id="modal-severity" class="inline-block px-3 py-1 rounded-full font-bold text-xs">CRITICAL</span>
                    </div>
                    <div>
                        <span class="block text-xs uppercase text-gray-500 font-semibold mb-1">Rule/Category</span>
                        <span id="modal-category" class="inline-block px-3 py-1 bg-gray-800 rounded-full font-bold text-xs text-blue-400">accessibility</span>
                    </div>
                </div>

                <div>
                    <span class="block text-xs uppercase text-gray-500 font-semibold mb-1">Issue Description</span>
                    <p id="modal-desc" class="text-gray-200 leading-relaxed bg-gray-950/40 p-3.5 border border-gray-850 rounded-xl"></p>
                </div>

                <div>
                    <span class="block text-xs uppercase text-gray-500 font-semibold mb-1">Business Impact Reasoning</span>
                    <p id="modal-justification" class="text-gray-300 italic"></p>
                </div>

                <div>
                    <span class="block text-xs uppercase text-gray-500 font-semibold mb-1">Target Element CSS Selector</span>
                    <code id="modal-selector" class="block bg-black/50 p-2.5 rounded-lg text-xs text-purple-400 overflow-x-auto border border-gray-850"></code>
                </div>

                <div id="modal-fix-section">
                    <span class="block text-xs uppercase text-gray-500 font-semibold mb-1.5">Concrete Code Fix (Before vs After)</span>
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div class="bg-red-950/20 border border-red-900/40 rounded-xl p-4 flex flex-col">
                            <span class="text-xs font-bold text-red-400 mb-1.5">Original Code</span>
                            <pre id="modal-original-code" class="text-xs text-gray-300 font-mono overflow-auto flex-1 max-h-36 whitespace-pre-wrap"></pre>
                        </div>
                        <div class="bg-green-950/20 border border-green-900/40 rounded-xl p-4 flex flex-col">
                            <span class="text-xs font-bold text-green-400 mb-1.5">Suggested Fix</span>
                            <pre id="modal-patched-code" class="text-xs text-gray-300 font-mono overflow-auto flex-1 max-h-36 whitespace-pre-wrap"></pre>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    </div>

    <!-- Scripts -->
    <script>
        let currentAuditId = null;
        let auditInterval = null;
        let allIssues = [];

        document.getElementById('audit-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const urlInput = document.getElementById('target-url').value.trim();
            const stepsInput = document.getElementById('journey-steps').value.trim();
            
            if (!urlInput) return;

            // Update UI state
            document.getElementById('submit-btn').disabled = true;
            document.getElementById('submit-btn').innerText = "Initializing audit job...";
            document.getElementById('status-bar').classList.remove('hidden');
            document.getElementById('progress-box').classList.remove('hidden');
            document.getElementById('progress-logs').innerHTML = "";
            document.getElementById('report-view').classList.add('hidden');
            allIssues = [];

            try {
                const response = await fetch('/audit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: urlInput, journey_steps: stepsInput })
                });
                
                const data = await response.json();
                currentAuditId = data.id;
                
                // Start polling progress
                pollProgress();
            } catch (err) {
                console.error("Failed to start audit:", err);
                document.getElementById('submit-btn').disabled = false;
                document.getElementById('submit-btn').innerText = "Launch Audit Agent";
            }
        });

        function pollProgress() {
            if (auditInterval) clearInterval(auditInterval);
            
            auditInterval = setInterval(async () => {
                try {
                    const response = await fetch(`/report/${currentAuditId}`);
                    const data = await response.json();
                    
                    // Update progress logs
                    const logsBox = document.getElementById('progress-logs');
                    logsBox.innerHTML = (data.progress || [])
                        .map(msg => `<div class="py-0.5 border-b border-gray-900">> ${msg}</div>`)
                        .join('');
                    logsBox.scrollTop = logsBox.scrollHeight;

                    if (data.status === 'completed') {
                        clearInterval(auditInterval);
                        showReport(data);
                    } else if (data.status === 'failed') {
                        clearInterval(auditInterval);
                        alert("Audit failed. Check logs.");
                        document.getElementById('submit-btn').disabled = false;
                        document.getElementById('submit-btn').innerText = "Launch Audit Agent";
                        document.getElementById('status-bar').classList.add('hidden');
                    }
                } catch (err) {
                    console.error("Progress polling error:", err);
                }
            }, 2000);
        }

        function showReport(data) {
            document.getElementById('submit-btn').disabled = false;
            document.getElementById('submit-btn').innerText = "Launch Audit Agent";
            document.getElementById('status-bar').classList.add('hidden');
            document.getElementById('progress-box').classList.add('hidden');
            document.getElementById('report-view').classList.remove('hidden');
            
            document.getElementById('report-url').innerText = data.url;
            document.getElementById('report-score').innerText = data.score !== null ? data.score : 'N/A';
            
            // Set score color
            const scoreVal = data.score || 0;
            const scoreEl = document.getElementById('report-score');
            if (scoreVal >= 90) {
                scoreEl.className = "text-4xl font-extrabold text-green-400";
            } else if (scoreVal >= 70) {
                scoreEl.className = "text-4xl font-extrabold text-yellow-400";
            } else {
                scoreEl.className = "text-4xl font-extrabold text-red-500";
            }

            allIssues = data.issues || [];
            document.getElementById('report-count').innerText = allIssues.length;
            
            renderIssues(allIssues);

            // Enable chat Q&A
            document.getElementById('chat-input').disabled = false;
            document.getElementById('chat-send-btn').disabled = false;
            document.getElementById('chat-placeholder').style.display = 'none';
            
            // Load messages
            renderChatHistory(data.chatMessages || []);
        }

        function renderIssues(issues) {
            const listEl = document.getElementById('issues-list');
            listEl.innerHTML = "";

            if (issues.length === 0) {
                listEl.innerHTML = `
                    <div class="glass-panel p-6 text-center rounded-2xl text-gray-500">
                        No issues found matching this criteria!
                    </div>
                `;
                return;
            }

            issues.forEach(issue => {
                const card = document.createElement('div');
                card.onclick = () => openModal(issue);
                card.className = "glass-panel p-5 rounded-2xl shadow hover:shadow-xl transition cursor-pointer hover:border-gray-700/80 duration-150 flex flex-col space-y-3";
                
                // Set badge colors
                let severityColor = "bg-blue-950/40 text-blue-400 border border-blue-900/60";
                if (issue.severity === 'critical') severityColor = "bg-red-950/40 text-red-400 border border-red-900/60";
                else if (issue.severity === 'serious') severityColor = "bg-orange-950/40 text-orange-400 border border-orange-900/60";
                else if (issue.severity === 'moderate') severityColor = "bg-yellow-950/40 text-yellow-400 border border-yellow-900/60";

                card.innerHTML = `
                    <div class="flex items-center space-x-2.5">
                        <span class="px-2.5 py-0.5 rounded-full font-bold text-[10px] uppercase ${severityColor}">${issue.severity}</span>
                        <span class="px-2.5 py-0.5 rounded-full font-bold text-[10px] uppercase bg-gray-800 text-gray-400 border border-gray-750">${issue.category}</span>
                        ${issue.verifiedFixStatus === 'success' ? '<span class="text-xs text-green-400 font-bold">✓ Fix Verified</span>' : ''}
                    </div>
                    <p class="text-sm text-gray-200 line-clamp-2">${issue.description}</p>
                    ${issue.elementSelector ? `<code class="text-xs text-purple-400 font-mono truncate max-w-full block bg-black/30 p-1.5 rounded">${issue.elementSelector}</code>` : ''}
                `;
                listEl.appendChild(card);
            });
        }

        function filterIssues(severity) {
            // Update active filter button style
            const filterBtns = document.querySelectorAll('.filter-btn');
            filterBtns.forEach(btn => {
                btn.classList.remove('bg-blue-600', 'text-white');
                btn.classList.add('bg-gray-800', 'text-gray-300');
            });
            event.target.classList.remove('bg-gray-800', 'text-gray-300');
            event.target.classList.add('bg-blue-600', 'text-white');

            if (severity === 'all') {
                renderIssues(allIssues);
            } else {
                renderIssues(allIssues.filter(i => i.severity === severity));
            }
        }

        // Modal Handlers
        function openModal(issue) {
            const modal = document.getElementById('issue-modal');
            document.getElementById('modal-title').innerText = issue.description.substring(0, 50) + "...";
            document.getElementById('modal-desc').innerText = issue.description;
            document.getElementById('modal-justification').innerText = issue.severityJustification || "No justification provided.";
            document.getElementById('modal-selector').innerText = issue.elementSelector || "Global";
            
            const severityEl = document.getElementById('modal-severity');
            severityEl.innerText = issue.severity.toUpperCase();
            if (issue.severity === 'critical') severityEl.className = "inline-block px-3 py-1 rounded-full font-bold text-xs bg-red-950/40 text-red-400 border border-red-900/60";
            else if (issue.severity === 'serious') severityEl.className = "inline-block px-3 py-1 rounded-full font-bold text-xs bg-orange-950/40 text-orange-400 border border-orange-900/60";
            else if (issue.severity === 'moderate') severityEl.className = "inline-block px-3 py-1 rounded-full font-bold text-xs bg-yellow-950/40 text-yellow-400 border border-yellow-900/60";
            else severityEl.className = "inline-block px-3 py-1 rounded-full font-bold text-xs bg-blue-950/40 text-blue-400 border border-blue-900/60";

            document.getElementById('modal-category').innerText = issue.category;
            
            // Set code diffs
            if (issue.fixDiff && issue.fixDiff.original && issue.fixDiff.patched) {
                document.getElementById('modal-fix-section').style.display = 'block';
                document.getElementById('modal-original-code').innerText = issue.fixDiff.original;
                document.getElementById('modal-patched-code').innerText = issue.fixDiff.patched;
            } else {
                document.getElementById('modal-fix-section').style.display = 'none';
            }

            modal.classList.remove('hidden');
        }

        function closeModal() {
            document.getElementById('issue-modal').classList.add('hidden');
        }

        // Chat logic
        document.getElementById('chat-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const inputEl = document.getElementById('chat-input');
            const userMsg = inputEl.value.trim();
            if (!userMsg || !currentAuditId) return;

            inputEl.value = "";
            appendMessage("user", userMsg);
            
            // Disable while responding
            inputEl.disabled = true;
            document.getElementById('chat-send-btn').disabled = true;

            try {
                const response = await fetch('/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ audit_id: currentAuditId, message: userMsg })
                });
                
                const data = await response.json();
                appendMessage("assistant", data.response, data.citedIssueIds);
            } catch (err) {
                console.error("Chat failure:", err);
                appendMessage("assistant", "Sorry, I had trouble reaching the AI brain. Please try again.");
            } finally {
                inputEl.disabled = false;
                document.getElementById('chat-send-btn').disabled = false;
                inputEl.focus();
            }
        });

        function renderChatHistory(messages) {
            const chatBox = document.getElementById('chat-messages');
            chatBox.innerHTML = "";
            messages.forEach(msg => {
                appendMessage(msg.role, msg.content, msg.cited_issue_ids, false);
            });
            chatBox.scrollTop = chatBox.scrollHeight;
        }

        function appendMessage(role, content, citedIssueIds = [], scroll = true) {
            const chatBox = document.getElementById('chat-messages');
            const msgEl = document.createElement('div');
            
            const isUser = role.toLowerCase() === 'user';
            msgEl.className = `flex flex-col space-y-1 ${isUser ? 'items-end' : 'items-start'}`;
            
            // Format cited issue HTML
            let citationHtml = "";
            if (citedIssueIds && citedIssueIds.length > 0) {
                citationHtml = `<div class="mt-1.5 flex flex-wrap gap-1.5">` + 
                    citedIssueIds.map(id => {
                        const targetIssue = allIssues.find(i => i.id === id);
                        const label = targetIssue ? targetIssue.severity.substring(0, 3).toUpperCase() + ': ' + (targetIssue.elementSelector || 'Global').substring(0,10) + '...' : id.substring(0,8);
                        return `<span onclick="highlightIssue('${id}')" class="cursor-pointer text-[10px] font-bold px-2 py-0.5 bg-gray-800 text-purple-400 border border-purple-900 rounded hover:bg-gray-700 hover:text-purple-300 transition">${label}</span>`;
                    }).join('') + `</div>`;
            }

            msgEl.innerHTML = `
                <div class="px-3.5 py-2.5 rounded-2xl max-w-[85%] shadow-md leading-relaxed text-sm ${
                    isUser 
                        ? 'bg-blue-600 text-white rounded-br-none' 
                        : 'bg-gray-900 text-gray-200 border border-gray-800 rounded-bl-none'
                }">
                    ${formatMarkdownText(content)}
                    ${citationHtml}
                </div>
            `;
            
            chatBox.appendChild(msgEl);
            if (scroll) {
                chatBox.scrollTop = chatBox.scrollHeight;
            }
        }

        function highlightIssue(id) {
            const issue = allIssues.find(i => i.id === id);
            if (issue) {
                openModal(issue);
            }
        }

        function formatMarkdownText(text) {
            // Simple markdown formatter for bold and backticks
            return text
                .replace(/\\n/g, '<br>')
                .replace(/\\*\\*(.*?)\\*\\*/g, '<strong>$1</strong>')
                .replace(/`(.*?)`/g, '<code class="bg-black/35 px-1 rounded text-purple-300 font-mono text-xs">$1</code>');
        }
    </script>
</body>
</html>
"""

@app.get("/", response_class=HTMLResponse)
async def serve_dashboard():
    return HTMLResponse(content=HTML_DASHBOARD)
