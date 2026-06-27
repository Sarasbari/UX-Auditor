"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { SeverityBadge, FixBadge, SourceBadge, ScoreDisplay, StatusIndicator } from "@/components/ui/badges";

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
}

interface AuditData {
  id: string;
  url: string;
  status: string;
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
    const fetchAudit = async () => {
      try {
        const response = await fetch(`/api/audit/${params.id}`);
        if (response.ok) {
          const data = await response.json();
          setAudit(data);
        }
      } catch (error) {
        console.error("Failed to fetch audit:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchAudit();
    const interval = setInterval(fetchAudit, 3000);
    return () => clearInterval(interval);
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
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-600">Loading audit...</p>
        </div>
      </div>
    );
  }

  if (!audit) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-600">Audit not found</p>
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
                      <div className="flex items-center gap-2 mb-1">
                        <SeverityBadge severity={issue.severity} />
                        <SourceBadge source={issue.source} />
                        <FixBadge status={issue.verifiedFixStatus} />
                      </div>
                      <p className="text-sm text-gray-900 line-clamp-2">{issue.description}</p>
                      {issue.elementSelector && (
                        <code className="text-xs text-gray-500 mt-1 block">{issue.elementSelector}</code>
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
                    <label className="text-xs text-gray-500 uppercase">Source</label>
                    <div className="mt-1">
                      <SourceBadge source={selectedIssue.source} />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 uppercase">Fix Status</label>
                    <div className="mt-1">
                      <FixBadge status={selectedIssue.verifiedFixStatus} />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 uppercase">Description</label>
                    <p className="mt-1 text-sm">{selectedIssue.description}</p>
                  </div>
                  {selectedIssue.elementSelector && (
                    <div>
                      <label className="text-xs text-gray-500 uppercase">Element</label>
                      <code className="mt-1 block text-xs bg-gray-100 p-2 rounded">{selectedIssue.elementSelector}</code>
                    </div>
                  )}
                  {selectedIssue.fixSuggestion && (
                    <div>
                      <label className="text-xs text-gray-500 uppercase">Suggested Fix</label>
                      <p className="mt-1 text-sm text-gray-700">{selectedIssue.fixSuggestion}</p>
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
