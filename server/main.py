import sys
import asyncio

if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

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
from server.llm_layer import rerank_and_generate_fixes

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
            <div id="progress-box" class="hidden glass-panel rounded-2xl p-6 shadow-xl space-y-6">
                <div class="flex items-center justify-between border-b border-gray-800 pb-3">
                    <h3 class="font-semibold text-white">Audit Pipeline Progress</h3>
                    <div id="active-step-badge" class="flex items-center space-x-2 text-xs font-semibold text-blue-400 bg-blue-950/40 border border-blue-900/60 px-3 py-1 rounded-full">
                        <span class="w-1.5 h-1.5 bg-blue-500 rounded-full animate-ping"></span>
                        <span id="active-step-label">Initializing...</span>
                    </div>
                </div>
                
                <!-- Vertical Timeline -->
                <div class="relative pl-8 border-l border-gray-850 ml-3 space-y-5" id="timeline-steps">
                    <!-- Dynamic Steps checklist -->
                </div>

                <div class="mt-4 pt-4 border-t border-gray-800/80">
                    <span class="block text-xs font-semibold text-gray-500 uppercase mb-2">Raw Engine Logs</span>
                    <div class="bg-black/40 border border-gray-800/80 rounded-xl p-3 h-24 overflow-y-auto font-mono text-[10px] text-blue-400 space-y-1.5" id="progress-logs"></div>
                </div>
            </div>

            <!-- Report Results View -->
            <div id="report-view" class="hidden flex flex-col space-y-4">
                <div class="glass-panel rounded-2xl p-6 shadow-xl flex flex-col space-y-4">
                    <div class="flex justify-between items-center border-b border-gray-800 pb-3">
                        <div>
                            <h2 class="text-xl font-bold text-white">Audit Report</h2>
                            <p class="text-xs text-gray-400 font-medium mt-0.5" id="report-url"></p>
                        </div>
                    </div>
                    <div class="grid grid-cols-1 md:grid-cols-4 gap-6 items-center">
                        <div class="md:col-span-1 border-r border-gray-800 pr-4 flex flex-col items-center md:items-start">
                            <span class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">UX Score</span>
                            <div class="flex items-baseline space-x-1">
                                <span id="report-score" class="text-4xl font-black text-white">N/A</span>
                                <span class="text-xs text-gray-500">/100</span>
                            </div>
                            <span id="report-score-label" class="mt-2 inline-block px-2.5 py-0.5 rounded-full font-bold text-[9px] uppercase border bg-gray-900 border-gray-800 text-gray-400">Loading</span>
                        </div>
                        <div class="md:col-span-3 space-y-3">
                            <div>
                                <h3 class="font-bold text-white text-sm">Executive Summary</h3>
                                <p class="text-xs text-gray-400 leading-relaxed mt-1" id="report-summary-text">Analyzing findings...</p>
                            </div>
                            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center md:text-left">
                                <div class="bg-black/30 border border-gray-850 rounded-xl p-2">
                                    <span class="block text-[9px] font-semibold uppercase text-gray-500">WCAG Issues</span>
                                    <span id="report-wcag-count" class="text-sm font-bold text-blue-400">0</span>
                                </div>
                                <div class="bg-black/30 border border-gray-850 rounded-xl p-2">
                                    <span class="block text-[9px] font-semibold uppercase text-gray-500">UX Suggestions</span>
                                    <span id="report-ux-count" class="text-sm font-bold text-teal-400">0</span>
                                </div>
                                <div class="bg-black/30 border border-gray-850 rounded-xl p-2">
                                    <span class="block text-[9px] font-semibold uppercase text-gray-500">Grouped groups</span>
                                    <span id="report-grouped-count" class="text-sm font-bold text-indigo-400">0</span>
                                </div>
                                <div class="bg-black/30 border border-gray-850 rounded-xl p-2">
                                    <span class="block text-[9px] font-semibold uppercase text-gray-500">Verified Fixes</span>
                                    <span id="report-verified-count" class="text-sm font-bold text-emerald-400">0</span>
                                </div>
                            </div>
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



    <!-- Scripts -->
    <script>
        let currentAuditId = null;
        let auditInterval = null;
        let allIssues = [];
        let expandedIssueId = null;
        let activeTab = "overview";

        const STEPS = [
          { id: "queued", label: "Queued in system" },
          { id: "opening", label: "Opening website in browser" },
          { id: "capturing", label: "Capturing screenshot and DOM" },
          { id: "wcag", label: "Running WCAG / axe-core checks" },
          { id: "heuristics", label: "Running custom UX heuristic rules" },
          { id: "grouping", label: "Grouping duplicate findings" },
          { id: "score", label: "Calculating UX score" },
          { id: "fixes", label: "Generating fix suggestions" },
          { id: "preparing", label: "Preparing final report" }
        ];

        const STEP_HELPERS = {
          "queued": "Waiting for an audit runner to pick up this job.",
          "opening": "Launching headless Chrome, setting viewport size, and loading the target URL.",
          "capturing": "Taking page screenshots and dumping the full interactive DOM tree.",
          "wcag": "Checking color contrast, aria labels, landmarks, keyboard focus, and accessibility trees.",
          "heuristics": "Measuring touch targets, verifying anchor link destinations, and tracking page load speeds.",
          "grouping": "Stripping dynamic class IDs, normalising CSS selectors, and merging repeated layout issues.",
          "score": "Applying capped category weights and diminishing-returns formulas to compute UX Score.",
          "fixes": "Analyzing broken elements and generating drop-in HTML/CSS patch suggestions.",
          "preparing": "Writing report metrics, uploading screenshots, and preparing the interactive dashboard."
        };

        function getIssueTitle(issue) {
            const ruleId = issue.ruleId || "";
            const description = issue.description || "";
            
            if (ruleId === "color-contrast") return "Text contrast is too low";
            if (ruleId === "small-touch-target" || ruleId === "target-size") return "Touch target is too small";
            if (ruleId === "missing-label") return "Form field is missing a label";
            if (ruleId === "broken-link") return "Broken link detected";
            if (ruleId === "slow-load-time") return "Page load time is slow";
            
            if (ruleId === "button-name") return "Buttons need accessible names";
            if (ruleId === "image-alt") return "Images need alternative text";
            if (ruleId === "link-name") return "Links need discernible text";
            if (ruleId === "label") return "Form elements need labels";
            if (ruleId === "document-title") return "Document must have a title";
            if (ruleId === "html-has-lang") return "HTML must have a language attribute";
            
            const descLower = description.toLowerCase();
            if (descLower.includes("contrast")) return "Text contrast is too low";
            if (descLower.includes("tap target") || descLower.includes("touch target") || descLower.includes("size")) return "Touch target is too small";
            if (descLower.includes("label")) return "Form field is missing a label";
            if (descLower.includes("broken link")) return "Broken link detected";
            
            if (ruleId) {
                return ruleId.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
            }
            return description.substring(0, 50) + (description.length > 50 ? "..." : "");
        }

        function getIssueImpact(issue) {
            const ruleId = issue.ruleId || "";
            const description = issue.description || "";
            
            if (ruleId === "color-contrast") return "Low contrast can make this text difficult to read.";
            if (ruleId === "small-touch-target" || ruleId === "target-size") return "Small touch areas can cause mis-taps on mobile.";
            if (ruleId === "missing-label" || ruleId === "label") return "Form field lacks a label, making it hard to fill out.";
            if (ruleId === "broken-link") return "Users will encounter a dead end or error page.";
            if (ruleId === "slow-load-time") return "Slow loading increases bounce rates and harms user experience.";
            
            if (ruleId === "button-name") return "Screen reader users may not understand what this button does.";
            if (ruleId === "image-alt") return "Screen readers cannot describe this image to visually impaired users.";
            if (ruleId === "link-name") return "Screen readers cannot announce where this link goes.";
            
            const descLower = description.toLowerCase();
            if (descLower.includes("contrast")) return "Low contrast can make this text difficult to read.";
            if (descLower.includes("tap target") || descLower.includes("touch target") || descLower.includes("size")) return "Small touch areas can cause mis-taps on mobile.";
            if (descLower.includes("label")) return "Form field lacks a label, making it hard to fill out.";
            if (descLower.includes("broken link")) return "Users will encounter a dead end or error page.";
            
            return "This issue affects usability or accessibility standards.";
        }

        function shouldShowFixBadge(status) {
            return ["success", "failed", "pending"].includes((status || "").toLowerCase());
        }

        function formatSelector(selector) {
            if (!selector) return "";
            if (selector.length > 50) return selector.substring(0, 50) + "...";
            return selector;
        }

        function getScoreLabel(score) {
            if (score >= 90) return { label: "Excellent", color: "text-emerald-400 bg-emerald-950/40 border-emerald-900/60", desc: "The site meets standard usability and accessibility requirements." };
            if (score >= 75) return { label: "Good", color: "text-amber-400 bg-amber-950/40 border-amber-900/60", desc: "The site is generally usable but has several areas for improvement." };
            if (score >= 50) return { label: "Needs Work", color: "text-orange-400 bg-orange-950/40 border-orange-900/60", desc: "Usability is compromised. Multiple serious accessibility barriers found." };
            return { label: "High Risk", color: "text-red-400 bg-red-950/40 border-red-900/60", desc: "Severe critical failures detected. The interface is difficult to navigate." };
        }

        function getSummarySentence(issues) {
            if (issues.length === 0) {
                return "Great job! No usability or accessibility issues were detected on this page.";
            }
            const wcagCount = issues.filter(i => i.source === "axe-core").length;
            const customCount = issues.filter(i => i.source === "custom_heuristic").length;
            
            if (wcagCount > customCount) {
                return `Most findings are high-confidence WCAG accessibility issues related to contrast or screen-reader usability.`;
            } else if (customCount > wcagCount) {
                return `Most findings are custom UX suggestions to improve visual structure and touch target sizes.`;
            } else {
                return `Findings are split between WCAG accessibility issues and custom UX suggestions.`;
            }
        }

        function getConfidenceLabel(confidence) {
            const clean = (confidence || "medium").toLowerCase();
            if (clean === "high") return "High confidence";
            if (clean === "medium") return "Medium confidence";
            return "Low confidence";
        }

        function getSourceLabel(source) {
            if (source === 'axe-core') return "WCAG / axe-core";
            if (source === 'custom_heuristic') return "Custom UX Rule";
            if (source === 'llm') return "AI Suggestion";
            if (source === 'merged') return "Merged Findings";
            return source;
        }

        function hasFixDiff(issue) {
            return !!(issue.fixDiff && issue.fixDiff.original && issue.fixDiff.patched);
        }

        function hasScreenshots(issue) {
            return !!(issue.screenshots && issue.screenshots.length > 0);
        }

        function toggleIssue(id) {
            if (expandedIssueId === id) {
                expandedIssueId = null;
            } else {
                expandedIssueId = id;
                activeTab = "overview";
            }
            renderIssues(allIssues);
        }

        function switchTab(event, tabName) {
            event.stopPropagation();
            activeTab = tabName;
            renderIssues(allIssues);
        }

        function getActiveStepId(status, progress = []) {
            if (status === 'queued') return 'queued';
            if (status === 'failed') {
                const lastLogs = progress.slice(-3).join('\n').toLowerCase();
                if (lastLogs.includes('saving') || lastLogs.includes('saved') || lastLogs.includes('prepare')) return 'preparing';
                if (lastLogs.includes('suggestion') || lastLogs.includes('patch') || lastLogs.includes('fix')) return 'fixes';
                if (lastLogs.includes('calculating') || lastLogs.includes('score')) return 'score';
                if (lastLogs.includes('grouping') || lastLogs.includes('deduplicat')) return 'grouping';
                if (lastLogs.includes('heuristic')) return 'heuristics';
                if (lastLogs.includes('axe-core') || lastLogs.includes('wcag')) return 'wcag';
                if (lastLogs.includes('capturing') || lastLogs.includes('screenshot') || lastLogs.includes('dom')) return 'capturing';
                if (lastLogs.includes('navigating') || lastLogs.includes('opening') || lastLogs.includes('browser')) return 'opening';
            }
            
            const logsStr = progress.join('\n').toLowerCase();
            if (logsStr.includes('saved report') || logsStr.includes('completed successfully')) return 'preparing';
            if (logsStr.includes('generating fix suggestions') || logsStr.includes('generating patches')) return 'fixes';
            if (logsStr.includes('calculating ux score') || logsStr.includes('score calculated')) return 'score';
            if (logsStr.includes('grouping duplicate findings') || logsStr.includes('deduplicating')) return 'grouping';
            if (logsStr.includes('running custom ux heuristic') || logsStr.includes('custom_heuristic')) return 'heuristics';
            if (logsStr.includes('running wcag') || logsStr.includes('axe-core')) return 'wcag';
            if (logsStr.includes('capturing screenshot') || logsStr.includes('dom snapshot')) return 'capturing';
            if (logsStr.includes('navigating to') || logsStr.includes('opening website') || logsStr.includes('browser-use')) return 'opening';
            
            if (progress.length > 3) return 'capturing';
            if (progress.length > 1) return 'opening';
            return 'queued';
        }

        function getStepStatus(stepId, status, progress = []) {
            const activeId = getActiveStepId(status, progress);
            const stepOrder = ["queued", "opening", "capturing", "wcag", "heuristics", "grouping", "score", "fixes", "preparing"];
            const stepIdx = stepOrder.indexOf(stepId);
            const activeIdx = stepOrder.indexOf(activeId);
            
            if (status === 'completed') return 'completed';
            
            if (stepIdx < activeIdx) return 'completed';
            if (stepIdx === activeIdx) return status === 'failed' ? 'failed' : 'active';
            return 'pending';
        }

        function updateTimeline(status, progress = []) {
            const activeId = getActiveStepId(status, progress);
            const activeStep = STEPS.find(s => s.id === activeId);
            
            const badgeLabel = document.getElementById('active-step-label');
            if (badgeLabel && activeStep) {
                badgeLabel.innerText = status === 'failed' ? 'Failed: ' + activeStep.label : activeStep.label;
            }
            
            const stepsContainer = document.getElementById('timeline-steps');
            if (!stepsContainer) return;
            
            stepsContainer.innerHTML = STEPS.map(step => {
                const stepStatus = getStepStatus(step.id, status, progress);
                
                let iconHtml = '';
                if (stepStatus === 'completed') {
                    iconHtml = `
                        <div class="absolute -left-[41px] top-1.5 w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center border-2 border-[#0b0f19] shadow-sm">
                            <svg class="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3.5">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                        </div>
                    `;
                } else if (stepStatus === 'active') {
                    iconHtml = `
                        <div class="absolute -left-[41px] top-1.5 w-5 h-5 bg-blue-600 rounded-full flex items-center justify-center border-2 border-[#0b0f19] shadow-sm">
                            <div class="w-2.5 h-2.5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        </div>
                    `;
                } else if (stepStatus === 'failed') {
                    iconHtml = `
                        <div class="absolute -left-[41px] top-1.5 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center border-2 border-[#0b0f19] shadow-sm">
                            <svg class="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3.5">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </div>
                    `;
                } else {
                    iconHtml = `
                        <div class="absolute -left-[41px] top-1.5 w-5 h-5 bg-gray-800 rounded-full flex items-center justify-center border-2 border-gray-700">
                            <div class="w-1.5 h-1.5 bg-gray-500 rounded-full"></div>
                        </div>
                    `;
                }
                
                const isPending = stepStatus === 'pending';
                const isActive = stepStatus === 'active';
                const isFailed = stepStatus === 'failed';
                
                return `
                    <div class="relative transition duration-200">
                        ${iconHtml}
                        <div class="${isPending ? 'opacity-40' : 'opacity-100'}">
                            <h4 class="text-xs font-bold ${isActive ? 'text-blue-400 animate-pulse' : isFailed ? 'text-red-400 font-extrabold' : 'text-gray-200'}">${step.label}</h4>
                            ${isActive ? `<p class="text-[10px] text-gray-400 mt-0.5 leading-relaxed">${STEP_HELPERS[step.id]}</p>` : ''}
                        </div>
                    </div>
                `;
            }).join('');
        }

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
            expandedIssueId = null;
            
            // Set initial timeline view
            updateTimeline('queued', []);

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

                    // Update timeline
                    updateTimeline(data.status, data.progress || []);

                    if (data.status === 'completed') {
                        clearInterval(auditInterval);
                        showReport(data);
                    } else if (data.status === 'failed') {
                        clearInterval(auditInterval);
                        updateTimeline('failed', data.progress || []);
                        document.getElementById('submit-btn').disabled = false;
                        document.getElementById('submit-btn').innerText = "Launch Audit Agent";
                        document.getElementById('status-bar').classList.add('hidden');
                        
                        // Render error in the raw logs
                        logsBox.innerHTML += `<div class="text-red-400 py-1 font-bold">ERROR: ${data.errorMessage || "Execution aborted"}</div>`;
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
            
            // Set score color and label
            const scoreVal = data.score || 0;
            const scoreEl = document.getElementById('report-score');
            const scoreLabelEl = document.getElementById('report-score-label');
            const scoreInfo = getScoreLabel(scoreVal);
            
            scoreEl.className = "text-4xl font-extrabold text-white";
            scoreLabelEl.innerText = scoreInfo.label;
            scoreLabelEl.className = `mt-2 inline-block px-2.5 py-0.5 rounded-full font-bold text-[9px] uppercase border ${scoreInfo.color}`;

            allIssues = data.issues || [];
            expandedIssueId = null;
            
            // Calculate and display dynamic summary metrics
            const wcagCount = allIssues.filter(i => i.source === "axe-core").length;
            const uxCount = allIssues.filter(i => i.source === "custom_heuristic" || i.source === "llm").length;
            const groupedCount = allIssues.filter(i => i.sampleElements && i.sampleElements.length > 1).length;
            const verifiedCount = allIssues.filter(i => i.verifiedFixStatus === "success").length;

            document.getElementById('report-wcag-count').innerText = wcagCount;
            document.getElementById('report-ux-count').innerText = uxCount;
            document.getElementById('report-grouped-count').innerText = groupedCount;
            document.getElementById('report-verified-count').innerText = verifiedCount;
            document.getElementById('report-summary-text').innerText = `${getSummarySentence(allIssues)} ${scoreInfo.desc}`;
            
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
                    <div class="glass-panel p-6 text-center rounded-2xl text-gray-500 border border-gray-900">
                        No issues found matching this criteria!
                    </div>
                `;
                return;
            }

            issues.forEach(issue => {
                const isExpanded = expandedIssueId === issue.id;
                const card = document.createElement('div');
                card.setAttribute('data-issue-id', issue.id);
                card.setAttribute('role', 'button');
                card.setAttribute('tabindex', '0');
                card.onclick = () => toggleIssue(issue.id);
                card.onkeydown = (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        toggleIssue(issue.id);
                    }
                };

                card.className = `glass-panel p-5 rounded-2xl shadow transition text-left cursor-pointer hover:border-gray-700/80 duration-150 flex flex-col space-y-2.5 border ${
                    isExpanded ? 'ring-2 ring-blue-500 border-blue-500' : 'border-gray-800/80 hover:shadow-xl'
                }`;
                
                // Set badge colors
                let severityColor = "bg-blue-950/40 text-blue-400 border border-blue-900/60";
                if (issue.severity === 'critical') severityColor = "bg-red-950/40 text-red-400 border border-red-900/60";
                else if (issue.severity === 'serious') severityColor = "bg-orange-950/40 text-orange-400 border border-orange-900/60";
                else if (issue.severity === 'moderate') severityColor = "bg-yellow-950/40 text-yellow-400 border border-yellow-900/60";

                let sourceLabel = getSourceLabel(issue.source);
                let sourceColor = "bg-blue-950/30 text-blue-300 border border-blue-900/40";
                if (issue.source === 'axe-core') {
                    sourceColor = "bg-blue-950/45 text-blue-400 border border-blue-900/60";
                } else if (issue.source === 'custom_heuristic') {
                    sourceColor = "bg-teal-950/45 text-teal-400 border border-teal-900/60";
                } else if (issue.source === 'llm') {
                    sourceColor = "bg-purple-950/45 text-purple-400 border border-purple-900/60";
                } else if (issue.source === 'merged') {
                    sourceColor = "bg-indigo-950/45 text-indigo-400 border border-indigo-900/60";
                }

                let confidenceColor = "bg-blue-950/45 text-blue-400 border border-blue-900/60";
                let confidenceLabel = "Low confidence";
                const cleanConf = (issue.confidence || "medium").toLowerCase();
                if (cleanConf === 'high') {
                    confidenceColor = "bg-emerald-950/45 text-emerald-400 border border-emerald-900/60";
                    confidenceLabel = "High confidence";
                } else if (cleanConf === 'medium') {
                    confidenceColor = "bg-amber-950/45 text-amber-400 border border-amber-900/60";
                    confidenceLabel = "Medium confidence";
                }

                const isGrouped = issue.sampleElements && issue.sampleElements.length > 1;
                const showFix = shouldShowFixBadge(issue.verifiedFixStatus);

                let inlineDetailsHtml = "";
                if (isExpanded) {
                    let tabOverviewClass = activeTab === 'overview' ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-800 text-gray-400 hover:bg-gray-700';
                    let tabEvidenceClass = activeTab === 'evidence' ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-800 text-gray-400 hover:bg-gray-700';
                    let tabFixClass = activeTab === 'fix' ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-800 text-gray-400 hover:bg-gray-700';

                    let tabContent = "";
                    if (activeTab === 'overview') {
                        tabContent = `
                            <div class="space-y-4 pt-2">
                                <div class="space-y-1">
                                    <span class="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Problem</span>
                                    <p class="text-xs text-gray-300 leading-relaxed bg-black/20 border border-gray-850 p-2.5 rounded">${issue.description}</p>
                                </div>
                                <div class="space-y-1">
                                    <span class="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Why It Matters</span>
                                    <p class="text-xs text-gray-400 bg-black/25 border border-gray-850 rounded-xl p-3 italic leading-relaxed">
                                        ${getIssueImpact(issue)}
                                    </p>
                                </div>
                                ${issue.fixSuggestion ? `
                                    <div class="space-y-1">
                                        <span class="text-[10px] font-bold text-gray-500 uppercase tracking-wider block">Recommended Fix</span>
                                        <p class="text-xs text-gray-300 leading-relaxed">${issue.fixSuggestion}</p>
                                    </div>
                                ` : ''}
                            </div>
                        `;
                    } else if (activeTab === 'evidence') {
                        let evidenceTable = `
                            <div class="border border-gray-855 rounded-xl overflow-hidden bg-black/25 text-xs mt-2">
                                <div class="grid grid-cols-3 border-b border-gray-900 p-2.5">
                                    <span class="text-gray-500 font-semibold col-span-1 flex flex-col">
                                        <span>Selector</span>
                                        <span class="text-[9px] text-gray-600 font-normal normal-case leading-tight">The CSS path of the affected page element.</span>
                                    </span>
                                    <span class="text-gray-350 col-span-2 font-mono break-all bg-black/30 p-1.5 rounded border border-gray-900 select-all">${issue.elementSelector || "Global"}</span>
                                </div>
                                <div class="grid grid-cols-3 border-b border-gray-900 p-2.5">
                                    <span class="text-gray-500 font-semibold col-span-1">Rule ID</span>
                                    <span class="text-gray-355 col-span-2 font-mono">${issue.ruleId || "N/A"}</span>
                                </div>
                                <div class="grid grid-cols-3 border-b border-gray-900 p-2.5">
                                    <span class="text-gray-500 font-semibold col-span-1">Source</span>
                                    <span class="text-gray-355 col-span-2 capitalize">${getSourceLabel(issue.source)}</span>
                                </div>
                                <div class="grid grid-cols-3 border-b border-gray-900 p-2.5">
                                    <span class="text-gray-500 font-semibold col-span-1 flex flex-col">
                                        <span>Confidence</span>
                                        <span class="text-[9px] text-gray-600 font-normal normal-case leading-tight">How certain the system is based on rule source and available evidence.</span>
                                    </span>
                                    <span class="text-gray-355 col-span-2 capitalize font-semibold">${getConfidenceLabel(issue.confidence)}</span>
                                </div>
                        `;
                        if (issue.viewport) {
                            evidenceTable += `
                                <div class="grid grid-cols-3 border-b border-gray-900 p-2.5">
                                    <span class="text-gray-500 font-semibold col-span-1">Viewport</span>
                                    <span class="text-gray-355 col-span-2 capitalize font-semibold">${issue.viewport}</span>
                                </div>
                            `;
                        }
                        if (issue.pageUrl) {
                            evidenceTable += `
                                <div class="grid grid-cols-3 border-b border-gray-900 p-2.5">
                                    <span class="text-gray-500 font-semibold col-span-1">Page URL</span>
                                    <a href="${issue.pageUrl}" target="_blank" class="text-blue-400 hover:underline break-all col-span-2">${issue.pageUrl}</a>
                                </div>
                            `;
                        }
                        if (issue.actualValue) {
                            evidenceTable += `
                                <div class="grid grid-cols-3 p-2.5">
                                    <span class="text-gray-500 font-semibold col-span-1">Measured values</span>
                                    <div class="text-gray-300 col-span-2 space-y-0.5">
                                        <div><strong>Actual:</strong> ${issue.actualValue}</div>
                                        ${issue.expectedValue ? `<div><strong>Expected:</strong> ${issue.expectedValue}</div>` : ''}
                                    </div>
                                </div>
                            `;
                        }
                        evidenceTable += `</div>`;

                        let elementsHtml = "";
                        if (issue.sampleElements && issue.sampleElements.length > 0) {
                            elementsHtml = `
                                <div class="space-y-2 mt-4">
                                    <span class="block text-[10px] uppercase text-gray-500 font-semibold mb-2">Affected HTML Elements (${issue.sampleElements.length})</span>
                                    <div class="max-h-36 overflow-y-auto space-y-2 bg-black/40 border border-gray-800 rounded-xl p-2.5 text-xs font-mono text-gray-300">
                                        ${issue.sampleElements.map((el, i) => `
                                            <div class="bg-black/30 p-2.5 rounded border border-gray-900/60">
                                                <span class="text-purple-450 block break-all font-semibold">${el.selector}</span>
                                                ${el.text ? `<span class="text-gray-400 font-sans block mt-1">InnerText: "${el.text}"</span>` : ''}
                                                ${el.width || el.height ? `<span class="text-gray-455 font-sans block mt-0.5">Size: ${el.width}x${el.height}px</span>` : ''}
                                                ${el.html ? `<pre class="text-[10px] text-gray-550 mt-1.5 border-t border-gray-900 pt-1 overflow-x-auto whitespace-pre-wrap break-all">${el.html.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>` : ''}
                                            </div>
                                        `).join('')}
                                    </div>
                                </div>
                            `;
                        }

                        tabContent = `
                            <div class="space-y-4 pt-2">
                                ${evidenceTable}
                                ${elementsHtml}
                            </div>
                        `;
                    } else if (activeTab === 'fix') {
                        let fixHtml = "";
                        if (hasFixDiff(issue)) {
                            fixHtml = `
                                <div class="space-y-2">
                                    <span class="block text-xs uppercase text-gray-500 font-semibold mb-1.5">Suggested Code Fix (Original vs Patched)</span>
                                    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div class="bg-red-955/20 border border-red-900/40 rounded-xl p-4 flex flex-col">
                                            <span class="text-xs font-bold text-red-400 mb-1.5">Original Code</span>
                                            <pre class="text-[10px] text-gray-300 font-mono overflow-auto max-h-36 whitespace-pre-wrap">${issue.fixDiff.original}</pre>
                                        </div>
                                        <div class="bg-green-955/20 border border-green-900/40 rounded-xl p-4 flex flex-col">
                                            <span class="text-xs font-bold text-green-400 mb-1.5">Suggested Fix</span>
                                            <pre class="text-[10px] text-gray-300 font-mono overflow-auto max-h-36 whitespace-pre-wrap">${issue.fixDiff.patched}</pre>
                                        </div>
                                    </div>
                                </div>
                            `;
                        } else {
                            fixHtml = `
                                <div class="bg-blue-955/20 border border-blue-900/40 rounded-xl p-4 text-xs text-blue-300 leading-relaxed font-sans">
                                    <p class="font-bold mb-1 uppercase tracking-wider text-[10px] text-blue-400">Manual Fix Recommended</p>
                                    <p>${issue.fixSuggestion || "No automated code fix patch is available for this issue. Inspect the HTML elements and resolve manually."}</p>
                                </div>
                            `;
                        }

                        let screenshotHtml = "";
                        if (hasScreenshots(issue)) {
                            screenshotHtml = `
                                <div class="mt-4 pt-4 border-t border-gray-900">
                                    <span class="block text-xs uppercase text-gray-500 font-semibold mb-2">Visual Proof (Screenshots)</span>
                                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                        ${issue.screenshots.map(shot => `
                                            <div class="border border-gray-800 rounded-xl overflow-hidden bg-black/30 shadow flex flex-col">
                                                <span class="text-[10px] font-bold text-gray-400 block p-2 bg-black/40 border-b border-gray-900 uppercase tracking-wider">
                                                    ${shot.type.toLowerCase()} Screen
                                                </span>
                                                <div class="p-2 flex items-center justify-center bg-gray-950 flex-1 min-h-24">
                                                    <img src="${shot.url}" alt="${shot.type} Screenshot" class="max-h-36 max-w-full object-contain rounded" />
                                                </div>
                                            </div>
                                        `).join('')}
                                    </div>
                                </div>
                            `;
                        }

                        tabContent = `
                            <div class="space-y-4 pt-2">
                                ${fixHtml}
                                ${screenshotHtml}
                            </div>
                        `;
                    }

                    inlineDetailsHtml = `
                        <div class="mt-4 pt-4 border-t border-gray-800 space-y-4" onclick="event.stopPropagation()">
                            <!-- Tab Headers -->
                            <div class="flex gap-2 border-b border-gray-900 pb-2">
                                <button type="button" onclick="switchTab(event, 'overview')" class="px-3 py-1.5 rounded-lg text-[10px] font-bold transition ${tabOverviewClass}">Overview</button>
                                <button type="button" onclick="switchTab(event, 'evidence')" class="px-3 py-1.5 rounded-lg text-[10px] font-bold transition ${tabEvidenceClass}">Evidence</button>
                                <button type="button" onclick="switchTab(event, 'fix')" class="px-3 py-1.5 rounded-lg text-[10px] font-bold transition ${tabFixClass}">Fix Suggestion</button>
                            </div>
                            <!-- Tab Content -->
                            <div class="animate-fadeIn">
                                ${tabContent}
                            </div>
                        </div>
                    `;
                }

                card.innerHTML = `
                    <div class="flex items-start justify-between gap-3">
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center space-x-2 flex-wrap gap-y-1 mb-2">
                                <span class="px-2 py-0.5 rounded text-[9px] font-bold uppercase ${severityColor}">${issue.severity}</span>
                                <span class="px-2 py-0.5 rounded text-[9px] font-bold uppercase ${sourceColor}">${sourceLabel}</span>
                                <span class="px-2 py-0.5 rounded text-[9px] font-bold uppercase ${confidenceColor}">${confidenceLabel}</span>
                                ${isGrouped ? `<span class="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-gray-900 text-purple-300 border border-purple-950">Grouped (${issue.sampleElements.length})</span>` : ''}
                                ${showFix && issue.verifiedFixStatus === 'success' ? '<span class="text-[10px] text-green-400 font-bold ml-1">✓ Fix Verified</span>' : ''}
                            </div>
                            <h3 class="text-sm font-bold text-gray-100">${getIssueTitle(issue)}</h3>
                            <p class="text-xs text-gray-400 leading-normal mt-1">${getIssueImpact(issue)}</p>
                        </div>
                        <div class="text-gray-500 mt-1 flex-shrink-0">
                            <svg class="w-4 h-4 transform transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                                <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                            </svg>
                        </div>
                    </div>
                    ${inlineDetailsHtml}
                `;
                listEl.appendChild(card);
            });
        }

        function filterIssues(severity) {
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
        }        // Chat logic
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
                        return `<span onclick="highlightIssue('${id}')" class="cursor-pointer text-[9px] font-bold px-2 py-0.5 bg-gray-900 text-purple-400 border border-purple-955 rounded hover:bg-gray-800 hover:text-purple-300 transition">${label}</span>`;
                    }).join('') + `</div>`;
            }

            msgEl.innerHTML = `
                <div class="px-3.5 py-2.5 rounded-2xl max-w-[85%] shadow-md leading-relaxed text-xs ${
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
            expandedIssueId = id;
            activeTab = "overview";
            renderIssues(allIssues);
            
            const card = document.querySelector(`[data-issue-id="${id}"]`);
            if (card) {
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }

        function formatMarkdownText(text) {
            return text
                .replace(/\n/g, '<br>')
                .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                .replace(/`/g, '&#96;')
                .replace(/&#96;(.*?)&#96;/g, '<code class="bg-black/35 px-1 rounded text-purple-300 font-mono text-[10px]">$1</code>');
    </script>
</body>
</html>
"""

@app.get("/", response_class=HTMLResponse)
async def serve_dashboard():
    return HTMLResponse(content=HTML_DASHBOARD)
