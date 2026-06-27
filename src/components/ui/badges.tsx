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
    deterministic: "bg-blue-100 text-blue-800",
    llm: "bg-purple-100 text-purple-800",
    merged: "bg-indigo-100 text-indigo-800",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
        colors[source] || "bg-gray-100 text-gray-600",
        className
      )}
    >
      {source === "deterministic" ? "Rule" : source === "llm" ? "AI" : "Merged"}
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
