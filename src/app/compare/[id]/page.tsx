"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

interface Issue {
  id: string;
  severity: string;
  category: string;
  description: string;
  scoreDelta: number | null;
  boundingBox?: string | null;
}

interface AuditRun {
  id: string;
  status: string;
  url: string;
  inputType: string;
  uploadedImageUrl: string | null;
  score: number | null;
  issues: Issue[];
}

interface CategoryBreakdown {
  category: string;
  primaryCount: number;
  competitorCount: number;
  primaryRisk: "Low" | "Medium" | "High";
  competitorRisk: "Low" | "Medium" | "High";
}

interface TopOpportunity {
  title: string;
  reason: string;
  relatedIssueIds: string[];
}

interface ComparisonData {
  winner: "primary" | "competitor" | "tie";
  scoreGap: number;
  summary: string;
  wherePrimaryWins: string[];
  whereCompetitorWins: string[];
  topOpportunities: TopOpportunity[];
  categoryBreakdown: CategoryBreakdown[];
  executiveTakeaway: string;
}

interface ComparisonRun {
  id: string;
  status: string;
  summary: string | null;
  primaryAuditId: string;
  competitorAuditId: string;
  primaryAudit?: AuditRun;
  competitorAudit?: AuditRun;
  comparison?: ComparisonData;
}

export default function ComparisonPage() {
  const { id } = useParams() as { id: string };
  const { data: session } = useSession();
  const router = useRouter();

  const [comparisonRun, setComparisonRun] = useState<ComparisonRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!id) return;

    let pollInterval: NodeJS.Timeout;

    const fetchComparison = async () => {
      try {
        const res = await fetch(`/api/compare/${id}`);
        if (!res.ok) {
          if (res.status === 401) {
            router.push("/login");
            return;
          }
          throw new Error("Failed to fetch comparison details");
        }
        const data: ComparisonRun = await res.json();
        setComparisonRun(data);
        setLoading(false);

        // If completed or failed, stop polling
        if (data.status === "COMPLETED" || data.status === "FAILED") {
          clearInterval(pollInterval);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
        setLoading(false);
        clearInterval(pollInterval);
      }
    };

    // Initial fetch
    fetchComparison();

    // Poll every 3 seconds
    pollInterval = setInterval(fetchComparison, 3000);

    return () => clearInterval(pollInterval);
  }, [id, router]);

  const handleCopySummary = async () => {
    if (!comparisonRun || !comparisonRun.comparison) return;
    const comp = comparisonRun.comparison;

    const summaryText = `UX-Auditor Competitor Comparison

Your Score: ${comparisonRun.primaryAudit?.score ?? "N/A"}
Competitor Score: ${comparisonRun.competitorAudit?.score ?? "N/A"}
Result: ${comp.summary}

Where You Win:
${comp.wherePrimaryWins.map((w) => `- ${w}`).join("\n")}

Where Competitor Wins:
${comp.whereCompetitorWins.map((w) => `- ${w}`).join("\n")}

Top Opportunities:
${comp.topOpportunities.map((o, idx) => `${idx + 1}. ${o.title}: ${o.reason}`).join("\n")}

Executive Takeaway:
${comp.executiveTakeaway}
`;

    try {
      await navigator.clipboard.writeText(summaryText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy comparison report:", err);
    }
  };

  if (loading && !comparisonRun) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-4">
        <div className="text-center space-y-4 max-w-sm">
          <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-sm font-medium text-slate-400">Loading comparison details...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-4">
        <div className="bg-slate-900 border border-red-500/20 rounded-2xl p-6 text-center max-w-md space-y-4">
          <div className="w-12 h-12 bg-red-500/10 text-red-400 rounded-full flex items-center justify-center mx-auto text-xl font-bold">!</div>
          <h2 className="text-lg font-bold text-red-200">Failed to load comparison</h2>
          <p className="text-sm text-slate-400">{error}</p>
          <button
            onClick={() => router.push("/")}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition"
          >
            Return Home
          </button>
        </div>
      </div>
    );
  }

  const isProcessing = comparisonRun?.status === "PROCESSING" || comparisonRun?.status === "QUEUED";

  if (isProcessing) {
    const pStatus = comparisonRun?.primaryAudit?.status || "queued";
    const cStatus = comparisonRun?.competitorAudit?.status || "queued";

    return (
      <div className="min-h-screen bg-slate-950 text-white py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-xl mx-auto space-y-8">
          <div className="text-center space-y-2">
            <span className="text-xs font-bold text-blue-400 uppercase tracking-widest bg-blue-500/10 px-3 py-1 rounded-full">
              Dual Audit Processing
            </span>
            <h1 className="text-3xl font-extrabold tracking-tight">Competitor UX Analysis</h1>
            <p className="text-sm text-slate-400">
              Please wait while our dual engines run parallel usability audits on both systems.
            </p>
          </div>

          <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 space-y-6">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Audit Jobs</span>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-blue-500 animate-ping"></div>
                <span className="text-xs text-blue-400 font-semibold">Active</span>
              </div>
            </div>

            <div className="space-y-4">
              {/* Primary Audit */}
              <div className="flex items-center justify-between p-4 bg-slate-950/80 border border-slate-800/80 rounded-xl">
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Your Product</span>
                  <span className="text-sm font-semibold text-slate-200 truncate max-w-[240px] block">
                    {comparisonRun?.primaryAudit?.url}
                  </span>
                </div>
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full uppercase ${
                  pStatus === "completed" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                }`}>
                  {pStatus}
                </span>
              </div>

              {/* Competitor Audit */}
              <div className="flex items-center justify-between p-4 bg-slate-950/80 border border-slate-800/80 rounded-xl">
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block">Competitor</span>
                  <span className="text-sm font-semibold text-slate-200 truncate max-w-[240px] block">
                    {comparisonRun?.competitorAudit?.url}
                  </span>
                </div>
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full uppercase ${
                  cStatus === "completed" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-blue-500/10 text-blue-400 border border-blue-500/20"
                }`}>
                  {cStatus}
                </span>
              </div>
            </div>

            <div className="relative pt-2">
              <div className="overflow-hidden h-1 text-xs flex rounded bg-slate-850">
                <div
                  style={{
                    width: `${
                      (pStatus === "completed" ? 50 : 15) + (cStatus === "completed" ? 50 : 15)
                    }%`,
                  }}
                  className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-blue-500 transition-all duration-500"
                ></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (comparisonRun?.status === "FAILED") {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-4">
        <div className="bg-slate-900 border border-red-500/20 rounded-2xl p-6 text-center max-w-md space-y-4">
          <div className="w-12 h-12 bg-red-500/10 text-red-400 rounded-full flex items-center justify-center mx-auto text-xl font-bold">!</div>
          <h2 className="text-lg font-bold text-red-200">Comparison Run Failed</h2>
          <p className="text-sm text-slate-400">One of the audits failed to run successfully.</p>
          <button
            onClick={() => router.push("/")}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold transition"
          >
            Return Home
          </button>
        </div>
      </div>
    );
  }

  const pAudit = comparisonRun?.primaryAudit;
  const cAudit = comparisonRun?.competitorAudit;
  const comp = comparisonRun?.comparison;

  const isScreenshotComparison = pAudit?.inputType === "SCREENSHOT";

  return (
    <div className="min-h-screen bg-slate-950 text-white py-12">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        
        {/* Navigation & Actions Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-800 pb-6">
          <div className="space-y-1">
            <button
              onClick={() => router.push("/")}
              className="text-xs text-slate-400 hover:text-white flex items-center gap-1 transition mb-1"
            >
              ← Back to Home
            </button>
            <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-450 bg-clip-text text-transparent">
              Competitor UX Comparison
            </h1>
          </div>
          <div className="flex flex-wrap gap-2.5">
            <button
              onClick={() => router.push(`/audit/${pAudit?.id}`)}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-850 text-white border border-slate-800 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
            >
              Open Your Audit
            </button>
            <button
              onClick={() => router.push(`/audit/${cAudit?.id}`)}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-850 text-white border border-slate-800 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer"
            >
              Open Competitor Audit
            </button>
            <button
              onClick={handleCopySummary}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5 cursor-pointer ${
                copied
                  ? "bg-emerald-500 text-white"
                  : "bg-blue-600 hover:bg-blue-700 text-white"
              }`}
            >
              {copied ? "✓ Copied Summary!" : "Copy Comparison Summary"}
            </button>
          </div>
        </div>

        {/* Side-by-Side Overall Score Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Your Score Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 relative overflow-hidden flex flex-col justify-between min-h-[180px]">
            <div className="space-y-1">
              <span className="text-xs font-bold text-blue-400 uppercase tracking-widest">
                Your Product
              </span>
              <p className="text-xs text-slate-400 truncate max-w-[340px]">
                {pAudit?.url}
              </p>
            </div>
            <div className="flex items-baseline gap-2.5 py-4">
              <span className="text-5xl font-black text-white">{pAudit?.score ?? "N/A"}</span>
              <span className="text-xs text-slate-500">/ 100 UX Score</span>
            </div>
            <div className="flex items-center gap-3 border-t border-slate-850 pt-3">
              <div className="flex gap-2">
                <span className="text-[10px] bg-red-500/10 text-red-400 px-2 py-0.5 rounded font-semibold">
                  {pAudit?.issues?.filter((i) => i.severity === "critical").length || 0} Critical
                </span>
                <span className="text-[10px] bg-orange-500/10 text-orange-400 px-2 py-0.5 rounded font-semibold">
                  {pAudit?.issues?.filter((i) => i.severity === "serious").length || 0} Serious
                </span>
              </div>
            </div>
            {comp?.winner === "primary" && (
              <div className="absolute top-6 right-6 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider animate-pulse">
                Winner
              </div>
            )}
          </div>

          {/* Competitor Score Card */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 relative overflow-hidden flex flex-col justify-between min-h-[180px]">
            <div className="space-y-1">
              <span className="text-xs font-bold text-amber-400 uppercase tracking-widest">
                Competitor / Reference
              </span>
              <p className="text-xs text-slate-400 truncate max-w-[340px]">
                {cAudit?.url}
              </p>
            </div>
            <div className="flex items-baseline gap-2.5 py-4">
              <span className="text-5xl font-black text-white">{cAudit?.score ?? "N/A"}</span>
              <span className="text-xs text-slate-500">/ 100 UX Score</span>
            </div>
            <div className="flex items-center gap-3 border-t border-slate-850 pt-3">
              <div className="flex gap-2">
                <span className="text-[10px] bg-red-500/10 text-red-400 px-2 py-0.5 rounded font-semibold">
                  {cAudit?.issues?.filter((i) => i.severity === "critical").length || 0} Critical
                </span>
                <span className="text-[10px] bg-orange-500/10 text-orange-400 px-2 py-0.5 rounded font-semibold">
                  {cAudit?.issues?.filter((i) => i.severity === "serious").length || 0} Serious
                </span>
              </div>
            </div>
            {comp?.winner === "competitor" && (
              <div className="absolute top-6 right-6 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider animate-pulse">
                Winner
              </div>
            )}
          </div>
        </div>

        {/* Winner Announcement Banner */}
        <div className={`border rounded-2xl p-5 flex items-center justify-between ${
          comp?.winner === "primary"
            ? "bg-emerald-950/20 border-emerald-500/20 text-emerald-300"
            : comp?.winner === "competitor"
            ? "bg-amber-950/20 border-amber-500/20 text-amber-300"
            : "bg-blue-950/20 border-blue-500/20 text-blue-300"
        }`}>
          <div className="space-y-1">
            <span className="text-[10px] font-black uppercase tracking-wider block">Comparison Result</span>
            <span className="text-base font-bold">{comp?.summary}</span>
          </div>
          <span className="text-2xl">
            {comp?.winner === "primary" ? "🏆" : comp?.winner === "competitor" ? "📈" : "⚖️"}
          </span>
        </div>

        {/* Screenshot Side-by-Side Preview Section */}
        {isScreenshotComparison && (
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4">
            <div>
              <h2 className="text-lg font-bold text-white">Visual Screenshot Comparison</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Screenshot comparisons are visual UX estimates based on uploaded images.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2">
              {/* Primary Screenshot image */}
              <div className="space-y-2">
                <span className="text-xs font-bold text-slate-400 block text-center">Your Product Screenshot</span>
                <div className="bg-slate-950 rounded-xl overflow-hidden border border-slate-800 max-h-[360px] flex items-center justify-center p-2 relative">
                  {pAudit?.uploadedImageUrl ? (
                    <div className="relative">
                      <img
                        src={pAudit.uploadedImageUrl}
                        alt="Your Upload"
                        className="max-h-[340px] rounded object-contain mx-auto"
                      />
                      {/* Render bounding boxes */}
                      {pAudit.issues?.map((issue) => {
                        if (!issue.boundingBox) return null;
                        try {
                          const box = JSON.parse(issue.boundingBox);
                          return (
                            <div
                              key={issue.id}
                              className="absolute border border-red-500 bg-red-500/10 pointer-events-none rounded"
                              style={{
                                left: `${box.x * 100}%`,
                                top: `${box.y * 100}%`,
                                width: `${box.width * 100}%`,
                                height: `${box.height * 100}%`,
                              }}
                            />
                          );
                        } catch {
                          return null;
                        }
                      })}
                    </div>
                  ) : (
                    <span className="text-xs text-slate-500 italic">No image uploaded</span>
                  )}
                </div>
              </div>

              {/* Competitor Screenshot image */}
              <div className="space-y-2">
                <span className="text-xs font-bold text-slate-400 block text-center">Competitor Screenshot</span>
                <div className="bg-slate-950 rounded-xl overflow-hidden border border-slate-800 max-h-[360px] flex items-center justify-center p-2 relative">
                  {cAudit?.uploadedImageUrl ? (
                    <div className="relative">
                      <img
                        src={cAudit.uploadedImageUrl}
                        alt="Competitor Upload"
                        className="max-h-[340px] rounded object-contain mx-auto"
                      />
                      {/* Render bounding boxes */}
                      {cAudit.issues?.map((issue) => {
                        if (!issue.boundingBox) return null;
                        try {
                          const box = JSON.parse(issue.boundingBox);
                          return (
                            <div
                              key={issue.id}
                              className="absolute border border-orange-500 bg-orange-500/10 pointer-events-none rounded"
                              style={{
                                left: `${box.x * 100}%`,
                                top: `${box.y * 100}%`,
                                width: `${box.width * 100}%`,
                                height: `${box.height * 100}%`,
                              }}
                            />
                          );
                        } catch {
                          return null;
                        }
                      })}
                    </div>
                  ) : (
                    <span className="text-xs text-slate-500 italic">No competitor image uploaded</span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {!isScreenshotComparison && (
          <div className="bg-slate-900/40 border border-slate-800/80 rounded-2xl p-4">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">Audits Information</span>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              URL comparisons include DOM evidence, axe-core/custom heuristic findings, and remediation-ready issues where available.
            </p>
          </div>
        )}

        {/* Win/Loss Strengths Columns */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Where you win */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-850 pb-3">
              <span className="text-emerald-400 font-bold text-sm bg-emerald-500/10 px-2 py-0.5 rounded">✓</span>
              <h3 className="font-extrabold text-white text-sm uppercase tracking-wider">Where You Win</h3>
            </div>
            <ul className="space-y-3">
              {comp?.wherePrimaryWins.map((win, idx) => (
                <li key={idx} className="flex gap-2.5 items-start text-xs text-slate-300">
                  <span className="text-emerald-500 mt-0.5">●</span>
                  <span className="leading-relaxed">{win}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Where competitor wins */}
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-4">
            <div className="flex items-center gap-2 border-b border-slate-850 pb-3">
              <span className="text-amber-400 font-bold text-sm bg-amber-500/10 px-2 py-0.5 rounded">⚠</span>
              <h3 className="font-extrabold text-white text-sm uppercase tracking-wider">Where Competitor Wins</h3>
            </div>
            <ul className="space-y-3">
              {comp?.whereCompetitorWins.map((loss, idx) => (
                <li key={idx} className="flex gap-2.5 items-start text-xs text-slate-300">
                  <span className="text-amber-500 mt-0.5">●</span>
                  <span className="leading-relaxed">{loss}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Top Opportunities List */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-5">
          <div className="border-b border-slate-850 pb-3">
            <h3 className="text-base font-extrabold text-white">Top Opportunities</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Highest-impact improvements for your product to close the gap or expand your lead.
            </p>
          </div>
          <div className="space-y-4">
            {comp?.topOpportunities.map((opp, idx) => (
              <div key={idx} className="p-4 bg-slate-950/80 border border-slate-850 rounded-2xl space-y-1">
                <div className="flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-blue-500/10 text-blue-400 flex items-center justify-center text-[10px] font-bold">
                    {idx + 1}
                  </span>
                  <span className="text-sm font-bold text-white">{opp.title}</span>
                </div>
                <p className="text-xs text-slate-350 leading-relaxed pl-7">{opp.reason}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Category Breakdown Compare */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-6">
          <div className="border-b border-slate-850 pb-3">
            <h3 className="text-base font-extrabold text-white">Category Breakdown</h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Comparison of issue densities and risk profiles. Fewer issues indicate higher stability.
            </p>
          </div>
          <div className="space-y-5">
            {comp?.categoryBreakdown.map((item, idx) => (
              <div key={idx} className="space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-slate-300">{item.category}</span>
                  <div className="flex items-center gap-4 text-[10px]">
                    <span className="text-slate-400 font-semibold">
                      Your Product: <span className="text-white">{item.primaryCount} issues</span> ({item.primaryRisk} Risk)
                    </span>
                    <span className="text-slate-400 font-semibold">
                      Competitor: <span className="text-white">{item.competitorCount} issues</span> ({item.competitorRisk} Risk)
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  {/* Your Product Progress Bar */}
                  <div className="space-y-1">
                    <div className="h-2 w-full bg-slate-950 rounded-full overflow-hidden">
                      <div
                        style={{ width: `${Math.min(100, Math.max(8, item.primaryCount * 15))}%` }}
                        className={`h-full rounded-full ${
                          item.primaryRisk === "High"
                            ? "bg-red-500"
                            : item.primaryRisk === "Medium"
                            ? "bg-orange-500"
                            : "bg-emerald-500"
                        }`}
                      ></div>
                    </div>
                  </div>
                  {/* Competitor Progress Bar */}
                  <div className="space-y-1">
                    <div className="h-2 w-full bg-slate-950 rounded-full overflow-hidden">
                      <div
                        style={{ width: `${Math.min(100, Math.max(8, item.competitorCount * 15))}%` }}
                        className={`h-full rounded-full ${
                          item.competitorRisk === "High"
                            ? "bg-red-500"
                            : item.competitorRisk === "Medium"
                            ? "bg-orange-500"
                            : "bg-emerald-500"
                        }`}
                      ></div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Executive Takeaway */}
        <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-3">
          <h3 className="text-base font-extrabold text-white">Executive Takeaway</h3>
          <p className="text-sm text-slate-300 leading-relaxed bg-slate-950/60 p-4 rounded-2xl border border-slate-850">
            {comp?.executiveTakeaway}
          </p>
        </div>

      </div>
    </div>
  );
}
