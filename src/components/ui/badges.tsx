import { cn, severityColor, formatSeverity } from "@/lib/utils";

interface SeverityBadgeProps {
  severity: string;
  className?: string;
}

export function SeverityBadge({ severity, className }: SeverityBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium",
        severityColor(severity),
        className
      )}
    >
      {formatSeverity(severity)}
    </span>
  );
}

interface FixBadgeProps {
  status: string;
  className?: string;
}

export function FixBadge({ status, className }: FixBadgeProps) {
  const colors: Record<string, string> = {
    success: "bg-green-100 text-green-800",
    failed: "bg-red-100 text-red-800",
    pending: "bg-yellow-100 text-yellow-800",
    not_applicable: "bg-gray-100 text-gray-600",
  };

  const icons: Record<string, string> = {
    success: "✓ Verified Fix",
    failed: "✗ Fix Failed",
    pending: "⏳ Pending",
    not_applicable: "— N/A",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium",
        colors[status] || colors.not_applicable,
        className
      )}
    >
      {icons[status] || icons.not_applicable}
    </span>
  );
}

interface SourceBadgeProps {
  source: string;
  className?: string;
}

export function SourceBadge({ source, className }: SourceBadgeProps) {
  const colors: Record<string, string> = {
    "axe-core": "bg-blue-100 text-blue-800 border border-blue-200",
    "custom_heuristic": "bg-teal-100 text-teal-800 border border-teal-200",
    "llm": "bg-purple-100 text-purple-800 border border-purple-200",
    "merged": "bg-indigo-100 text-indigo-800 border border-indigo-200",
    "screenshot_vision": "bg-amber-100 text-amber-800 border border-amber-200",
    "screenshot-vision": "bg-amber-100 text-amber-800 border border-amber-200",
  };

  const labels: Record<string, string> = {
    "axe-core": "WCAG / axe-core",
    "custom_heuristic": "Custom UX Rule",
    "llm": "AI Suggestion",
    "merged": "Merged Findings",
    "screenshot_vision": "Screenshot Vision",
    "screenshot-vision": "Screenshot Vision",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border",
        colors[source] || "bg-gray-100 text-gray-600 border-gray-200",
        className
      )}
    >
      {labels[source] || source}
    </span>
  );
}

interface ConfidenceBadgeProps {
  confidence: string;
  className?: string;
}

export function ConfidenceBadge({ confidence, className }: ConfidenceBadgeProps) {
  const colors: Record<string, string> = {
    high: "bg-emerald-50 text-emerald-700 border border-emerald-200",
    medium: "bg-amber-50 text-amber-700 border-amber-200",
    low: "bg-blue-50 text-blue-700 border-blue-200",
  };

  const labels: Record<string, string> = {
    high: "High confidence",
    medium: "Medium confidence",
    low: "Low confidence",
  };

  const cleanConfidence = (confidence || "medium").toLowerCase();

  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold border capitalize tracking-normal",
        colors[cleanConfidence] || "bg-gray-50 text-gray-700 border-gray-200",
        className
      )}
    >
      {labels[cleanConfidence] || `${confidence} confidence`}
    </span>
  );
}

interface ScoreDisplayProps {
  score: number;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function ScoreDisplay({ score, size = "md", className }: ScoreDisplayProps) {
  const getScoreColor = (s: number) => {
    if (s >= 80) return "text-green-600";
    if (s >= 60) return "text-yellow-600";
    if (s >= 40) return "text-orange-600";
    return "text-red-600";
  };

  const sizeClasses = {
    sm: "text-2xl",
    md: "text-4xl",
    lg: "text-6xl",
  };

  return (
    <div className={cn("text-center", className)}>
      <div className={cn("font-bold", getScoreColor(score), sizeClasses[size])}>
        {score}
      </div>
      <div className="text-sm text-muted-foreground">UX Score</div>
    </div>
  );
}

interface StatusIndicatorProps {
  status: string;
  className?: string;
}

export function StatusIndicator({ status, className }: StatusIndicatorProps) {
  const colors: Record<string, string> = {
    queued: "bg-gray-400",
    processing: "bg-blue-400 animate-pulse",
    capturing: "bg-blue-500 animate-pulse",
    analyzing: "bg-purple-500 animate-pulse",
    merging: "bg-indigo-500 animate-pulse",
    verifying_fixes: "bg-yellow-500 animate-pulse",
    completed: "bg-green-500",
    failed: "bg-red-500",
  };

  const labels: Record<string, string> = {
    queued: "Queued",
    processing: "Processing",
    capturing: "Capturing page",
    analyzing: "Analyzing",
    merging: "Merging results",
    verifying_fixes: "Verifying fixes",
    completed: "Complete",
    failed: "Failed",
  };

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className={cn("w-2 h-2 rounded-full", colors[status] || "bg-gray-400")} />
      <span className="text-sm">{labels[status] || status}</span>
    </div>
  );
}

interface ScoreDeltaBadgeProps {
  delta: number;
  severity: string;
  className?: string;
}

export function ScoreDeltaBadge({ delta, severity, className }: ScoreDeltaBadgeProps) {
  const cleanSeverity = (severity || "").toLowerCase();
  const isProminent = cleanSeverity === "critical" || cleanSeverity === "serious";

  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border tracking-normal",
        isProminent
          ? "bg-purple-100 text-purple-800 border-purple-200"
          : "bg-gray-100 text-gray-600 border-gray-200",
        className
      )}
      title="Estimated score lift if this issue is fixed"
    >
      +{delta} potential
    </span>
  );
}

