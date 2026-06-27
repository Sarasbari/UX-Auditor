"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";

export default function Home() {
  const { data: session } = useSession();
  const [url, setUrl] = useState("");
  const [auditMode, setAuditMode] = useState<"url" | "screenshot">("url");
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  const handleFileChange = (selectedFile: File | null) => {
    if (!selectedFile) {
      setFile(null);
      setFilePreview(null);
      return;
    }

    if (selectedFile.size > 8 * 1024 * 1024) {
      setError("Image must be smaller than 8MB");
      setFile(null);
      setFilePreview(null);
      return;
    }

    if (!selectedFile.type.startsWith("image/")) {
      setError("Only PNG, JPG, JPEG or WebP images are allowed");
      setFile(null);
      setFilePreview(null);
      return;
    }

    setError("");
    setFile(selectedFile);
    const reader = new FileReader();
    reader.onloadend = () => {
      setFilePreview(reader.result as string);
    };
    reader.readAsDataURL(selectedFile);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) {
      router.push("/login?callbackUrl=/");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      if (auditMode === "url") {
        if (!url) {
          setError("URL is required");
          setIsLoading(false);
          return;
        }
        let normalizedUrl = url;
        if (!url.startsWith("http://") && !url.startsWith("https://")) {
          normalizedUrl = `https://${url}`;
        }

        const response = await fetch("/api/audit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: normalizedUrl }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Failed to submit audit");
        }

        const data = await response.json();
        router.push(`/audit/${data.id}`);
      } else {
        if (!file) {
          setError("Please select or drop a screenshot image");
          setIsLoading(false);
          return;
        }

        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch("/api/audit/screenshot", {
          method: "POST",
          body: formData,
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Failed to submit screenshot audit");
        }

        const data = await response.json();
        router.push(`/audit/${data.id}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-gray-50">
      <nav className="border-b bg-white/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">UX</span>
              </div>
              <span className="font-semibold text-lg">UX-Auditor</span>
            </div>
            <div className="flex items-center gap-4">
              {session ? (
                <>
                  <a href="/dashboard" className="text-sm text-gray-600 hover:text-gray-900">
                    Dashboard
                  </a>
                  <button
                    onClick={() => signOut()}
                    className="text-sm text-gray-600 hover:text-gray-900 cursor-pointer"
                  >
                    Sign Out
                  </button>
                </>
              ) : (
                <a href="/login" className="text-sm bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition">
                  Sign In
                </a>
              )}
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-32">
        <div className="text-center mb-8">
          <h1 className="text-5xl font-bold text-gray-900 mb-4 leading-tight">
            Audit a URL or screenshot, <span className="text-blue-600">get verified fixes</span>
          </h1>
          <p className="text-xl text-gray-600 max-w-2xl mx-auto leading-relaxed">
            Run live URL audits with DOM evidence and verified fixes, or upload a screenshot for fast visual UX feedback.
          </p>
        </div>

        {/* Tab Segmented Control */}
        <div className="flex justify-center mb-8">
          <div className="bg-gray-100 p-1 rounded-xl flex gap-1 border border-gray-200">
            <button
              type="button"
              onClick={() => {
                setAuditMode("url");
                setError("");
              }}
              className={`px-6 py-2 rounded-lg text-sm font-semibold transition cursor-pointer ${
                auditMode === "url"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-900"
              }`}
            >
              URL Audit
            </button>
            <button
              type="button"
              onClick={() => {
                setAuditMode("screenshot");
                setError("");
              }}
              className={`px-6 py-2 rounded-lg text-sm font-semibold transition cursor-pointer ${
                auditMode === "screenshot"
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-900"
              }`}
            >
              Screenshot Audit
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="max-w-2xl mx-auto mb-16">
          {auditMode === "url" ? (
            <div className="flex gap-3">
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Enter website URL (e.g., example.com)"
                className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-lg"
                disabled={isLoading}
              />
              <button
                type="submit"
                disabled={isLoading || (!!session && !url)}
                className="px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition whitespace-nowrap cursor-pointer"
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Auditing...
                  </span>
                ) : session ? (
                  "Run Audit"
                ) : (
                  "Sign in to run audit"
                )}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (isLoading) return;
                  const droppedFile = e.dataTransfer.files?.[0];
                  if (droppedFile) handleFileChange(droppedFile);
                }}
                className={`border-2 border-dashed rounded-2xl p-8 text-center transition flex flex-col items-center justify-center min-h-[220px] ${
                  filePreview ? "border-blue-300 bg-blue-50/10" : "border-gray-350 hover:border-gray-400 bg-white"
                }`}
              >
                {filePreview ? (
                  <div className="relative group max-w-xs mx-auto">
                    <img
                      src={filePreview}
                      alt="Upload Preview"
                      className="max-h-40 rounded-lg shadow-md border border-gray-200 object-contain mx-auto"
                    />
                    <button
                      type="button"
                      onClick={() => handleFileChange(null)}
                      className="absolute -top-2.5 -right-2.5 bg-red-600 hover:bg-red-700 text-white rounded-full p-1.5 shadow-md transition cursor-pointer"
                      disabled={isLoading}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                    <p className="text-xs text-gray-500 mt-2 font-medium truncate">{file?.name}</p>
                  </div>
                ) : (
                  <>
                    <div className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center mb-3">
                      <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <p className="text-sm font-semibold text-gray-700">Drag & drop your screenshot here</p>
                    <p className="text-xs text-gray-400 mt-1">PNG, JPG, JPEG or WebP up to 8MB</p>
                    <label className="mt-4 px-4 py-2 border border-gray-300 rounded-lg text-xs font-semibold text-gray-600 bg-white hover:bg-gray-50 transition shadow-sm cursor-pointer inline-block">
                      Browse Files
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleFileChange(f);
                        }}
                        className="hidden"
                        disabled={isLoading}
                      />
                    </label>
                  </>
                )}
              </div>
              <button
                type="submit"
                disabled={isLoading || (!!session && !file)}
                className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition shadow-md hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Running Visual Audit...
                  </span>
                ) : session ? (
                  "Run Screenshot Audit"
                ) : (
                  "Sign in to run screenshot audit"
                )}
              </button>
            </div>
          )}

          {!session && (
            <p className="mt-3 text-gray-500 text-xs text-center">
              Create an account to save audit history and chat with reports.
            </p>
          )}
          {error && (
            <p className="mt-3 text-red-650 text-sm font-semibold text-center">{error}</p>
          )}
        </form>

        <div className="grid md:grid-cols-3 gap-8 max-w-3xl mx-auto">
          <div className="text-center">
            <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="font-semibold mb-1">Dual-Engine Analysis</h3>
            <p className="text-sm text-gray-600">
              Deterministic rules (axe-core + 44 design rules) combined with AI heuristic scoring
            </p>
          </div>
          <div className="text-center">
            <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="font-semibold mb-1">Verified Fixes</h3>
            <p className="text-sm text-gray-600">
              Fixes are applied in-browser and re-audited to prove they actually work
            </p>
          </div>
          <div className="text-center">
            <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center mx-auto mb-3">
              <svg className="w-6 h-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
              </svg>
            </div>
            <h3 className="font-semibold mb-1">Chat Assistant</h3>
            <p className="text-sm text-gray-600">
              Ask questions about your audit results and get expert guidance
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
