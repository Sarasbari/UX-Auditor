"use client";

import { useState, useEffect } from "react";
import { useSession, signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { SeverityBadge, ScoreDisplay, StatusIndicator } from "@/components/ui/badges";

interface AuditRun {
  id: string;
  url: string;
  status: string;
  score: number | null;
  createdAt: string;
  completedAt: string | null;
  project: { name: string };
  _count: { issues: number };
}

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const [audits, setAudits] = useState<AuditRun[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login?callbackUrl=/dashboard");
    }
  }, [status, router]);

  useEffect(() => {
    if (status !== "authenticated") return;

    const fetchAudits = async () => {
      try {
        const response = await fetch("/api/audit");
        if (response.ok) {
          const data = await response.json();
          setAudits(data);
        }
      } catch (error) {
        console.error("Failed to fetch audits:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchAudits();
  }, [status]);

  if (loading || status === "loading" || status === "unauthenticated") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="border-b bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <a href="/" className="flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">UX</span>
              </div>
              <span className="font-semibold">UX-Auditor</span>
            </a>
            <div className="flex items-center gap-4">
              <a
                href="/"
                className="text-sm bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition"
              >
                New Audit
              </a>
              {session && (
                <button
                  onClick={() => signOut()}
                  className="text-sm text-gray-600 hover:text-gray-900"
                >
                  Sign Out
                </button>
              )}
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">Dashboard</h1>
          {session?.user && (
            <p className="text-sm text-gray-600">
              Logged in as <span className="font-semibold text-gray-900">{session.user.name || session.user.email}</span>
            </p>
          )}
        </div>

        {audits.length === 0 ? (
          <div className="bg-white rounded-xl p-12 text-center shadow-sm">
            <h2 className="text-lg font-semibold mb-2">No audits yet</h2>
            <p className="text-gray-600 mb-4">Run your first audit to get started</p>
            <a
              href="/"
              className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition"
            >
              Start Audit
            </a>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Site</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Score</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Issues</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {audits.map((audit) => (
                  <tr key={audit.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div>
                        <p className="font-medium text-sm">{audit.project.name}</p>
                        <p className="text-xs text-gray-500 truncate max-w-xs">{audit.url}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {audit.score !== null ? (
                        <span className="text-lg font-semibold">{audit.score}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className="text-sm">{audit._count.issues}</span>
                    </td>
                    <td className="px-6 py-4">
                      <StatusIndicator status={audit.status} />
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {new Date(audit.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4">
                      <a
                        href={`/audit/${audit.id}`}
                        className="text-sm text-blue-600 hover:text-blue-800"
                      >
                        View →
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
