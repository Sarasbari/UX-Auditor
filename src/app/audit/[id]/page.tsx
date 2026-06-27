"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { SeverityBadge, FixBadge, SourceBadge, ConfidenceBadge, ScoreDisplay, StatusIndicator } from "@/components/ui/badges";

interface Issue {
  id: string;
  severity: string;
  category: string;
  elementSelector: string | null;
  description: string;
  fixSuggestion: string | null;
  fixDiff: Record<string, unknown> | null;
  verifiedFixStatus: string;
  source: string;
  confidence: string;
  actualValue?: string | null;
  expectedValue?: string | null;
  viewport?: string | null;
  ruleId?: string | null;
  sampleElements?: Array<{ selector: string; text?: string; width?: number; height?: number; html?: string; url?: string }> | null;
  pageUrl?: string | null;
}

interface AuditData {
  id: string;
  url: string;
  status: string;
  errorMessage: string | null;
  score: number | null;
  issues: Issue[];
  chatMessages: ChatMessage[];
  createdAt: string;
  completedAt: string | null;
}

interface ChatMessage {
  id: string;
  role: string;
  content: string;
  citedIssueIds: string[];
}

export default function AuditPage() {
  const params = useParams();
  const [audit, setAudit] = useState<AuditData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    let active = true;
    let timerId: NodeJS.Timeout;

    const fetchAudit = async () => {
      try {
        const response = await fetch(`/api/audit/${params.id}`);
        if (!active) return;
        if (response.ok) {
          const data = await response.json();
          setAudit(data);
          
          // Stop polling if we reached a terminal status
          if (data.status === "completed" || data.status === "failed") {
            setLoading(false);
            return;
          }
        }
      } catch (error) {
        console.error("Failed to fetch audit:", error);
      } finally {
        if (active) {
          setLoading(false);
        }
      }

      // Schedule next poll
      timerId = setTimeout(fetchAudit, 3000);
    };

    fetchAudit();

    return () => {
      active = false;
      clearTimeout(timerId);
    };
  }, [params.id]);

  const handleChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !audit) return;

    setChatLoading(true);
    try {
      const response = await fetch(`/api/audit/${audit.id}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: chatInput }),
      });

      if (response.ok) {
        const data = await response.json();
        setAudit(prev => prev ? {
          ...prev,
          chatMessages: [
            ...prev.chatMessages,
            { id: "user-" + Date.now(), role: "user", content: chatInput, citedIssueIds: [] },
            { id: "assistant-" + Date.now(), role: "assistant", content: data.response, citedIssueIds: data.citedIssueIds },
          ],
        } : null);
        setChatInput("");
      }
    } catch (error) {
      console.error("Chat failed:", error);
    } finally {
      setChatLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-600">Loading audit...</p>
        </div>
      </div>
    );
  }

  if (!audit) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-600">Audit not found</p>
      </div>
    );
  }

  // ── FAILURE STATE ──────────────────────────────────────────────────────────
  if (audit.status === "failed") {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <nav className="border-b bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between h-16 items-center">
              <a href="/" className="flex items-center gap-2">
                <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold text-sm">UX</span>
                </div>
                <span className="font-semibold">UX-Auditor</span>
              </a>
              <span className="text-sm text-red-650 font-semibold uppercase tracking-wider">Audit Failed</span>
            </div>
          </div>
        </nav>

        <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-16 flex flex-col items-center justify-center text-center">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-6">
            <svg className="w-8 h-8 text-red-650" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Audit Execution Failed</h1>
          <p className="text-gray-500 mb-8 max-w-md">
            We ran into an issue while analyzing <span className="font-medium text-gray-700 break-all">{audit.url}</span>.
          </p>
          <div className="w-full bg-white rounded-xl p-6 shadow-sm border border-red-100 text-left mb-8">
            <h2 className="text-xs font-semibold uppercase text-red-800 tracking-wider mb-2">Error Details</h2>
            <p className="font-mono text-xs text-gray-700 whitespace-pre-wrap break-all bg-gray-50 p-4 rounded-lg border border-gray-150">
              {audit.errorMessage || "An unknown error occurred during the audit execution."}
            </p>
          </div>
          <a
            href="/"
            className="inline-flex items-center px-5 py-2.5 bg-blue-605 hover:bg-blue-700 text-white font-medium rounded-lg shadow-sm transition active:scale-95 duration-150"
          >
            ← Try Another URL
          </a>
        </main>
      </div>
    );
  }

  // ── IN-PROGRESS STATE ──────────────────────────────────────────────────────
  if (audit.status !== "completed") {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <nav className="border-b bg-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between h-16 items-center">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold text-sm">UX</span>
                </div>
                <span className="font-semibold">UX-Auditor</span>
              </div>
              <StatusIndicator status={audit.status} />
            </div>
          </div>
        </nav>

        <main className="flex-1 max-w-2xl w-full mx-auto px-4 py-24 text-center flex flex-col items-center justify-center">
          <div className="relative w-20 h-20 mb-8">
            <div className="absolute inset-0 rounded-full border-4 border-blue-100" />
            <div className="absolute inset-0 rounded-full border-4 border-blue-600 border-t-transparent animate-spin" />
          </div>
          
          <h1 className="text-2xl font-extrabold text-gray-900 mb-2">
            Analyzing Site Architecture
          </h1>
          <p className="text-gray-500 mb-8 break-all max-w-lg">
            Auditing <span className="font-medium text-gray-700">{audit.url}</span>
          </p>

          <div className="w-full bg-white rounded-2xl p-6 shadow-sm border text-left max-w-md">
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Current Status</h2>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                  audit.status === "queued" ? "bg-blue-100 text-blue-700 animate-pulse" : "bg-green-100 text-green-700"
                }`}>
                  {audit.status === "queued" ? "⏳" : "✓"}
                </div>
                <span className={`text-sm ${audit.status === "queued" ? "font-semibold text-gray-900" : "text-gray-500"}`}>
                  Queued in system
                </span>
              </div>
              <div className="flex items-center gap-3">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                  audit.status === "queued" ? "bg-gray-100 text-gray-400" :
                  audit.status === "processing" ? "bg-blue-100 text-blue-700 animate-pulse" : "bg-green-100 text-green-700"
                }`}>
                  {audit.status === "queued" ? "•" : audit.status === "processing" ? "⏳" : "✓"}
                </div>
                <span className={`text-sm ${
                  audit.status === "processing" ? "font-semibold text-gray-900" : "text-gray-500"
                }`}>
                  Running axe-core & custom heuristic rules
                </span>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  const filteredIssues = filter === "all"
    ? audit.issues
    : audit.issues.filter(i => i.severity === filter);

  const severityCounts = {
    critical: audit.issues.filter(i => i.severity === "critical").length,
    serious: audit.issues.filter(i => i.severity === "serious").length,
    moderate: audit.issues.filter(i => i.severity === "moderate").length,
    minor: audit.issues.filter(i => i.severity === "minor").length,
  };

  const verifiedCount = audit.issues.filter(i => i.verifiedFixStatus === "success").length;

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="border-b bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-4">
              <a href="/" className="flex items-center gap-2">
                <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold text-sm">UX</span>
                </div>
                <span className="font-semibold">UX-Auditor</span>
              </a>
              <span className="text-gray-400">|</span>
              <span className="text-sm text-gray-600 truncate max-w-md">{audit.url}</span>
            </div>
            <StatusIndicator status={audit.status} />
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-white rounded-xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h1 className="text-2xl font-bold">Audit Report</h1>
                {audit.score !== null && <ScoreDisplay score={audit.score} size="sm" />}
              </div>

              <div className="flex gap-4 flex-wrap">
                {Object.entries(severityCounts).map(([severity, count]) => (
                  <button
                    key={severity}
                    onClick={() => setFilter(filter === severity ? "all" : severity)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition ${
                      filter === severity ? "bg-gray-900 text-white" : "bg-gray-100 hover:bg-gray-200"
                    }`}
                  >
                    <SeverityBadge severity={severity} />
                    <span>{count}</span>
                  </button>
                ))}
              </div>

              {verifiedCount > 0 && (
                <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                  <p className="text-sm text-green-800">
                    ✓ {verifiedCount} verified fix{verifiedCount !== 1 ? "es" : ""} proven to work
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-3">
              {filteredIssues.map((issue) => (
                <div
                  key={issue.id}
                  onClick={() => setSelectedIssue(issue)}
                  className={`bg-white rounded-lg p-4 shadow-sm cursor-pointer transition hover:shadow-md ${
                    selectedIssue?.id === issue.id ? "ring-2 ring-blue-500" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                        <SeverityBadge severity={issue.severity} />
                        <SourceBadge source={issue.source} />
                        <ConfidenceBadge confidence={issue.confidence} />
                        <FixBadge status={issue.verifiedFixStatus} />
                        {issue.sampleElements && issue.sampleElements.length > 1 && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-indigo-50 text-indigo-755 border border-indigo-150">
                            Grouped ({issue.sampleElements.length})
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-900 line-clamp-2">{issue.description}</p>
                      {issue.elementSelector && (
                        <code className="text-xs text-gray-500 mt-1 block truncate font-mono">{issue.elementSelector}</code>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {filteredIssues.length === 0 && (
                <div className="bg-white rounded-lg p-8 text-center">
                  <p className="text-gray-500">No issues found with this filter</p>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            {selectedIssue && (
              <div className="bg-white rounded-xl p-6 shadow-sm">
                <h2 className="font-semibold mb-4">Issue Details</h2>
                <div className="space-y-4">
                  <div>
                    <label className="text-xs text-gray-500 uppercase">Severity</label>
                    <div className="mt-1">
                      <SeverityBadge severity={selectedIssue.severity} />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 uppercase">Source &amp; Confidence</label>
                    <div className="mt-1 flex gap-2">
                      <SourceBadge source={selectedIssue.source} />
                      <ConfidenceBadge confidence={selectedIssue.confidence} />
                    </div>
                  </div>
                  {selectedIssue.viewport && (
                    <div>
                      <label className="text-xs text-gray-500 uppercase">Viewport</label>
                      <span className="mt-0.5 block text-sm font-semibold capitalize text-gray-700">{selectedIssue.viewport}</span>
                    </div>
                  )}
                  {selectedIssue.pageUrl && (
                    <div>
                      <label className="text-xs text-gray-500 uppercase">Page URL</label>
                      <a href={selectedIssue.pageUrl} target="_blank" rel="noreferrer" className="mt-0.5 block text-xs text-blue-600 hover:underline break-all">
                        {selectedIssue.pageUrl}
                      </a>
                    </div>
                  )}
                  {selectedIssue.actualValue && (
                    <div>
                      <label className="text-xs text-gray-500 uppercase">Evidence (Actual vs Expected)</label>
                      <div className="mt-1 text-sm bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-1 text-gray-750">
                        <div><strong className="text-gray-700">Actual:</strong> {selectedIssue.actualValue}</div>
                        {selectedIssue.expectedValue && <div><strong className="text-gray-700">Expected:</strong> {selectedIssue.expectedValue}</div>}
                      </div>
                    </div>
                  )}
                  <div>
                    <label className="text-xs text-gray-500 uppercase">Description</label>
                    <p className="mt-1 text-sm text-gray-750 leading-relaxed">{selectedIssue.description}</p>
                  </div>
                  {selectedIssue.elementSelector && (
                    <div>
                      <label className="text-xs text-gray-500 uppercase">Selector / Class Pattern</label>
                      <code className="mt-1 block text-xs bg-gray-100 p-2.5 rounded font-mono break-all text-purple-700">{selectedIssue.elementSelector}</code>
                    </div>
                  )}
                  {selectedIssue.sampleElements && selectedIssue.sampleElements.length > 0 && (
                    <div>
                      <label className="text-xs text-gray-500 uppercase font-semibold">
                        Affected Elements ({selectedIssue.sampleElements.length})
                      </label>
                      <div className="mt-1 max-h-40 overflow-y-auto space-y-2 border border-gray-200 rounded-lg p-2 bg-gray-50">
                        {selectedIssue.sampleElements.map((el, i) => (
                          <div key={i} className="text-xs font-mono bg-white p-2 border border-gray-150 rounded shadow-sm">
                            <span className="text-purple-650 block break-all">{el.selector}</span>
                            {el.text && <span className="text-gray-500 block mt-0.5 font-sans">Text: "{el.text}"</span>}
                            {(el.width || el.height) && (
                              <span className="text-gray-505 block mt-0.5 font-sans">Measured Size: {el.width}x{el.height}px</span>
                            )}
                            {el.html && <pre className="text-[10px] text-gray-500 bg-gray-50 p-1 mt-1 border border-gray-100 rounded overflow-x-auto whitespace-pre-wrap break-all">{el.html}</pre>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {selectedIssue.fixSuggestion && (
                    <div>
                      <label className="text-xs text-gray-500 uppercase font-semibold">Suggested Fix</label>
                      <p className="mt-1 text-sm text-gray-700 bg-blue-50/30 border border-blue-100 rounded-lg p-3 leading-relaxed">{selectedIssue.fixSuggestion}</p>
                    </div>
                  )}
                  {selectedIssue.fixDiff && (
                    <div>
                      <label className="text-xs text-gray-500 uppercase">Fix Diff</label>
                      <pre className="mt-1 text-xs bg-gray-100 p-2 rounded overflow-auto">
                        {JSON.stringify(selectedIssue.fixDiff, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="bg-white rounded-xl shadow-sm overflow-hidden">
              <div className="p-4 border-b">
                <h2 className="font-semibold">Chat Assistant</h2>
                <p className="text-xs text-gray-500">Ask questions about your audit</p>
              </div>

              <div className="h-64 overflow-y-auto p-4 space-y-3">
                {audit.chatMessages.length === 0 && (
                  <p className="text-sm text-gray-400 text-center py-8">
                    No messages yet. Ask a question about your audit results.
                  </p>
                )}
                {audit.chatMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                        msg.role === "user"
                          ? "bg-blue-600 text-white"
                          : "bg-gray-100 text-gray-900"
                      }`}
                    >
                      {msg.content}
                    </div>
                  </div>
                ))}
              </div>

              <form onSubmit={handleChat} className="p-4 border-t">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Ask about your audit..."
                    className="flex-1 px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    disabled={chatLoading}
                  />
                  <button
                    type="submit"
                    disabled={chatLoading || !chatInput.trim()}
                    className="px-3 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
                  >
                    Send
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
