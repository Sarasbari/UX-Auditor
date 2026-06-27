import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatSeverity(severity: string): string {
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}

export function severityColor(severity: string): string {
  switch (severity) {
    case "critical": return "bg-red-600 text-white";
    case "serious": return "bg-orange-600 text-white";
    case "moderate": return "bg-amber-600 text-white";
    case "minor": return "bg-blue-600 text-white";
    default: return "bg-gray-600 text-white";
  }
}

export function fixStatusColor(status: string): string {
  switch (status) {
    case "success": return "text-green-600";
    case "failed": return "text-red-600";
    case "pending": return "text-amber-600";
    default: return "text-gray-400";
  }
}

export function fixStatusIcon(status: string): string {
  switch (status) {
    case "success": return "✓";
    case "failed": return "✗";
    case "pending": return "⏳";
    default: return "—";
  }
}
