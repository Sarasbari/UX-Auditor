"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";

export default function Home() {
  const { data: session } = useSession();
  const router = useRouter();

  // Navigation focus helper
  const heroFormRef = useRef<HTMLDivElement>(null);

  // States for main audits
  const [auditMode, setAuditMode] = useState<"url" | "screenshot" | "compare">("url");
  const [compareType, setCompareType] = useState<"url" | "screenshot">("url");
  const [url, setUrl] = useState("");
  const [journeySteps, setJourneySteps] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);

  // Compare inputs
  const [url1, setUrl1] = useState("");
  const [url2, setUrl2] = useState("");
  const [primaryFile, setPrimaryFile] = useState<File | null>(null);
  const [primaryPreview, setPrimaryPreview] = useState<string | null>(null);
  const [competitorFile, setCompetitorFile] = useState<File | null>(null);
  const [competitorPreview, setCompetitorPreview] = useState<string | null>(null);

  // General loading & error states
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  // Verified Fix Slider Value
  const [v, setV] = useState(50);

  // Chat Panel State
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "bot"; content: string }>>([
    { role: "user", content: "Why was the hero button flagged?" },
    { role: "bot", content: "Its text-to-background contrast is 2.1:1 — WCAG AA needs 4.5:1 for normal text. That's why low-vision users may not be able to read it." },
    { role: "user", content: "Show me the React fix" },
    { role: "bot", content: "Swap the class to bg-blue-700 text-white — that gets you to 7.4:1. Want me to verify it against the live audit?" },
  ]);
  const [chatInput, setChatInput] = useState("");

  // Intersection Observer for scroll-reveal animations
  useEffect(() => {
    const revealEls = document.querySelectorAll(".reveal, .pop-3d, .pop-stagger");
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );
    revealEls.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  const handleScrollToForm = () => {
    heroFormRef.current?.scrollIntoView({ behavior: "smooth" });
  };

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

  const handleCompareFileChange = (selectedFile: File | null, type: "primary" | "competitor") => {
    const setF = type === "primary" ? setPrimaryFile : setCompetitorFile;
    const setP = type === "primary" ? setPrimaryPreview : setCompetitorPreview;

    if (!selectedFile) {
      setF(null);
      setP(null);
      return;
    }

    if (selectedFile.size > 8 * 1024 * 1024) {
      setError("Image must be smaller than 8MB");
      setF(null);
      setP(null);
      return;
    }

    if (!selectedFile.type.startsWith("image/")) {
      setError("Only images are allowed");
      setF(null);
      setP(null);
      return;
    }

    setError("");
    setF(selectedFile);
    const reader = new FileReader();
    reader.onloadend = () => {
      setP(reader.result as string);
    };
    reader.readAsDataURL(selectedFile);
  };

  const handleChatSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    const userMsg = chatInput;
    setChatMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setChatInput("");

    setTimeout(() => {
      let reply = "I can analyze that rule for you. Once you run a full audit, I can scan your source code and suggest fix plans and PR-ready recommendations direct to GitHub.";
      if (userMsg.toLowerCase().includes("how") || userMsg.toLowerCase().includes("fix")) {
        reply = "To fix this, adjust the color codes or spacing attributes specified in the report. You can test your changes live inside our Before/After Fix Simulator.";
      }
      setChatMessages((prev) => [...prev, { role: "bot", content: reply }]);
    }, 1000);
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
          body: JSON.stringify({ url: normalizedUrl, journeySteps }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || "Failed to submit audit");
        }

        const data = await response.json();
        router.push(`/audit/${data.id}`);
      } else if (auditMode === "screenshot") {
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
      } else {
        // Compare Mode
        if (compareType === "url") {
          if (!url1 || !url2) {
            setError("Both URLs are required for comparison");
            setIsLoading(false);
            return;
          }
          let norm1 = url1.startsWith("http://") || url1.startsWith("https://") ? url1 : `https://${url1}`;
          let norm2 = url2.startsWith("http://") || url2.startsWith("https://") ? url2 : `https://${url2}`;

          const response = await fetch("/api/compare", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url1: norm1, url2: norm2 }),
          });

          if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || "Failed to submit comparison");
          }

          const data = await response.json();
          router.push(`/compare/${data.id}`);
        } else {
          if (!primaryFile || !competitorFile) {
            setError("Both screenshots are required for comparison");
            setIsLoading(false);
            return;
          }

          const formData = new FormData();
          formData.append("primaryFile", primaryFile);
          formData.append("competitorFile", competitorFile);

          const response = await fetch("/api/compare", {
            method: "POST",
            body: formData,
          });

          if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || "Failed to submit comparison");
          }

          const data = await response.json();
          router.push(`/compare/${data.id}`);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="landing-page">
      {/* ============ NAVIGATION ============ */}
      <nav>
        <div className="wrap">
          <div className="logo">
            <div className="logo-mark">UX</div>
            UX-Auditor
          </div>
          <div className="navlinks">
            <a href="#how">How it works</a>
            <a href="#features">Features</a>
            <a href="#engines">Dual engine</a>
            <a href="#verified">Fix simulator</a>
            <a href="#pricing">Pricing</a>
          </div>
          <div className="navcta">
            {session ? (
              <>
                <a href="/dashboard" className="btn btn-ghost btn-sm">
                  Dashboard
                </a>
                <button
                  onClick={() => signOut()}
                  className="btn btn-primary btn-sm cursor-pointer"
                >
                  Sign Out
                </button>
              </>
            ) : (
              <>
                <a href="/login" className="btn btn-ghost btn-sm">
                  Sign in
                </a>
                <button
                  onClick={handleScrollToForm}
                  className="btn btn-primary btn-sm cursor-pointer"
                >
                  Start free audit
                </button>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* ============ HERO ============ */}
      <header className="hero" id="hero">
        <div className="blueprint"></div>
        <div className="hero-glow"></div>
        <div className="hero-glow two"></div>
        <div className="wrap hero-grid">
          <div>
            <span className="eyebrow">Dual-engine · WCAG Audit + AI Heuristics</span>
            <h1>
              Don't guess what's broken.<br />
              <em>Preview fixes instantly.</em>
            </h1>
            <p className="lede">
              UX-Auditor combines browser evidence, WCAG checks, custom usability heuristics, and AI-assisted remediation. Paste a URL or drop screenshots to estimate score lifts and preview code fixes in our simulator.
            </p>

            <div className="mode-toggle" role="tablist" aria-label="Audit mode">
              <button
                type="button"
                onClick={() => {
                  setAuditMode("url");
                  setError("");
                }}
                className={auditMode === "url" ? "active" : ""}
                role="tab"
                aria-selected={auditMode === "url"}
              >
                URL Audit
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuditMode("screenshot");
                  setError("");
                }}
                className={auditMode === "screenshot" ? "active" : ""}
                role="tab"
                aria-selected={auditMode === "screenshot"}
              >
                Screenshot Audit
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuditMode("compare");
                  setError("");
                }}
                className={auditMode === "compare" ? "active" : ""}
                role="tab"
                aria-selected={auditMode === "compare"}
              >
                Compare Mode
              </button>
            </div>

            <div ref={heroFormRef} className="mt-8">
              <form onSubmit={handleSubmit} className="space-y-4">
                {auditMode === "url" && (
                  <div className="space-y-4">
                    <div className="audit-bar">
                      <input
                        className="audit-input"
                        type="text"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder="yourwebsite.com"
                        aria-label="Website URL"
                        disabled={isLoading}
                      />
                      <button type="submit" disabled={isLoading} className="btn btn-primary">
                        {isLoading ? "Running..." : "Run free audit"}
                      </button>
                    </div>
                    <div className="flex flex-col space-y-1.5 animate-fadeIn">
                      <label htmlFor="journey-steps" className="text-xs font-bold text-slate-500 uppercase tracking-widest pl-1">
                        User Journey Steps (Optional)
                      </label>
                      <textarea
                        id="journey-steps"
                        className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white placeholder-slate-400 text-slate-800"
                        placeholder="Example: Open pricing, click Sign Up, inspect checkout form, then stop."
                        rows={3}
                        value={journeySteps}
                        onChange={(e) => setJourneySteps(e.target.value)}
                        disabled={isLoading}
                        maxLength={2000}
                      />
                    </div>
                  </div>
                )}

                {auditMode === "screenshot" && (
                  <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm">
                    <div
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (isLoading) return;
                        const droppedFile = e.dataTransfer.files?.[0];
                        if (droppedFile) handleFileChange(droppedFile);
                      }}
                      className={`border-2 border-dashed rounded-xl p-6 text-center transition flex flex-col items-center justify-center min-h-[140px] ${
                        filePreview ? "border-blue-300 bg-blue-50/10" : "border-slate-300 hover:border-slate-400 bg-slate-50/50"
                      }`}
                    >
                      {filePreview ? (
                        <div className="relative group max-w-xs mx-auto">
                          <img
                            src={filePreview}
                            alt="Upload Preview"
                            className="max-h-24 rounded shadow-sm border border-slate-250 object-contain mx-auto"
                          />
                          <button
                            type="button"
                            onClick={() => handleFileChange(null)}
                            className="absolute -top-2 -right-2 bg-red-600 hover:bg-red-700 text-white rounded-full p-1 shadow transition cursor-pointer"
                            disabled={isLoading}
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                          <p className="text-[10px] text-slate-500 mt-2 font-medium truncate max-w-[160px] mx-auto">{file?.name}</p>
                        </div>
                      ) : (
                        <>
                          <p className="text-xs font-semibold text-slate-600">Drag & drop your screenshot here</p>
                          <label className="mt-3 px-3 py-1.5 border border-slate-300 rounded-lg text-[10px] font-semibold text-slate-600 bg-white hover:bg-slate-50 transition shadow-sm cursor-pointer inline-block">
                            Browse
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
                      className="w-full btn btn-primary justify-center"
                    >
                      {isLoading ? "Running Visual Audit..." : "Run Screenshot Audit"}
                    </button>
                  </div>
                )}

                {auditMode === "compare" && (
                  <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-4 shadow-sm">
                    <div className="flex justify-center mb-2">
                      <div className="bg-slate-100 p-0.5 rounded-lg flex gap-1 border border-slate-200">
                        <button
                          type="button"
                          onClick={() => {
                            setCompareType("url");
                            setError("");
                          }}
                          className={`px-3 py-1 rounded text-[10px] font-bold transition cursor-pointer ${
                            compareType === "url"
                              ? "bg-white text-slate-900 shadow-sm"
                              : "text-slate-500 hover:text-slate-900"
                          }`}
                        >
                          Compare URLs
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setCompareType("screenshot");
                            setError("");
                          }}
                          className={`px-3 py-1 rounded text-[10px] font-bold transition cursor-pointer ${
                            compareType === "screenshot"
                              ? "bg-white text-slate-900 shadow-sm"
                              : "text-slate-500 hover:text-slate-900"
                          }`}
                        >
                          Compare Screenshots
                        </button>
                      </div>
                    </div>

                    {compareType === "url" ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                            Your Product URL
                          </label>
                          <input
                            type="text"
                            value={url1}
                            onChange={(e) => setUrl1(e.target.value)}
                            placeholder="e.g. mysite.com"
                            className="w-full px-3 py-2 border border-slate-350 rounded-lg text-xs"
                            disabled={isLoading}
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                            Competitor URL
                          </label>
                          <input
                            type="text"
                            value={url2}
                            onChange={(e) => setUrl2(e.target.value)}
                            placeholder="e.g. competitor.com"
                            className="w-full px-3 py-2 border border-slate-350 rounded-lg text-xs"
                            disabled={isLoading}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {/* Primary Drop */}
                        <div
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (isLoading) return;
                            const f = e.dataTransfer.files?.[0];
                            if (f) handleCompareFileChange(f, "primary");
                          }}
                          className={`border-2 border-dashed rounded-xl p-4 text-center transition flex flex-col items-center justify-center min-h-[110px] ${
                            primaryPreview ? "border-blue-300 bg-blue-50/10" : "border-slate-300 bg-slate-50/50"
                          }`}
                        >
                          {primaryPreview ? (
                            <div className="relative max-w-[120px]">
                              <img src={primaryPreview} alt="Preview 1" className="max-h-16 rounded object-contain mx-auto" />
                              <button
                                type="button"
                                onClick={() => handleCompareFileChange(null, "primary")}
                                className="absolute -top-1.5 -right-1.5 bg-red-600 text-white rounded-full p-0.5 shadow transition"
                                disabled={isLoading}
                              >
                                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                          ) : (
                            <>
                              <span className="text-[10px] font-semibold text-slate-600">Your Screenshot</span>
                              <label className="mt-2 px-2 py-1 border border-slate-300 rounded text-[9px] font-semibold bg-white hover:bg-slate-50 transition cursor-pointer">
                                Browse
                                <input
                                  type="file"
                                  accept="image/*"
                                  onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    if (f) handleCompareFileChange(f, "primary");
                                  }}
                                  className="hidden"
                                  disabled={isLoading}
                                />
                              </label>
                            </>
                          )}
                        </div>

                        {/* Competitor Drop */}
                        <div
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (isLoading) return;
                            const f = e.dataTransfer.files?.[0];
                            if (f) handleCompareFileChange(f, "competitor");
                          }}
                          className={`border-2 border-dashed rounded-xl p-4 text-center transition flex flex-col items-center justify-center min-h-[110px] ${
                            competitorPreview ? "border-blue-300 bg-blue-50/10" : "border-slate-300 bg-slate-50/50"
                          }`}
                        >
                          {competitorPreview ? (
                            <div className="relative max-w-[120px]">
                              <img src={competitorPreview} alt="Preview 2" className="max-h-16 rounded object-contain mx-auto" />
                              <button
                                type="button"
                                onClick={() => handleCompareFileChange(null, "competitor")}
                                className="absolute -top-1.5 -right-1.5 bg-red-600 text-white rounded-full p-0.5 shadow transition"
                                disabled={isLoading}
                              >
                                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                          ) : (
                            <>
                              <span className="text-[10px] font-semibold text-slate-600">Competitor Image</span>
                              <label className="mt-2 px-2 py-1 border border-slate-300 rounded text-[9px] font-semibold bg-white hover:bg-slate-50 transition cursor-pointer">
                                Browse
                                <input
                                  type="file"
                                  accept="image/*"
                                  onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    if (f) handleCompareFileChange(f, "competitor");
                                  }}
                                  className="hidden"
                                  disabled={isLoading}
                                />
                              </label>
                            </>
                          )}
                        </div>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={isLoading || (!!session && compareType === "url" ? (!url1 || !url2) : (!primaryFile || !competitorFile))}
                      className="w-full btn btn-primary justify-center"
                    >
                      {isLoading ? "Running Comparison..." : "Run UX Comparison"}
                    </button>
                  </div>
                )}

                {error && <p className="text-xs text-red-600 font-bold text-center mt-2">{error}</p>}
              </form>
            </div>

            <div className="hero-foot">
              <span>No install</span>
              <span>Fast audit reports</span>
              <span>Unlimited audits</span>
            </div>
          </div>

          <div className="scanner-shell">
            <div className="scanner-backdrop"></div>
            <div className="scanner">
              <div className="scanner-chrome">
                <div className="dot"></div>
                <div className="dot"></div>
                <div className="dot"></div>
                <div className="scanner-url">yourwebsite.com</div>
              </div>
              <div className="scanner-canvas">
                <div className="mockpage">
                  <div className="mock-row w40"></div>
                  <div className="mock-hero"></div>
                  <div className="mock-row w90"></div>
                  <div className="mock-row w60"></div>
                  <div className="mock-btn"></div>
                  <div className="mock-cards">
                    <div className="mock-card"></div>
                    <div className="mock-card"></div>
                    <div className="mock-card"></div>
                  </div>
                </div>
                <div className="scan-beam"></div>
                <div className="chip chip1">
                  <span className="tag">contrast-2.1</span>
                  <span className="check">✓</span>
                </div>
                <div className="chip chip2 violet">
                  <span className="tag">heuristic-7</span>
                  <span className="check">✓</span>
                </div>
                <div className="chip chip3">
                  <span className="tag">aria-label</span>
                  <span className="check">✓</span>
                </div>
                <div className="chip chip4 violet">
                  <span className="tag">hierarchy</span>
                  <span className="check">✓</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ============ PROOF STRIP ============ */}
      <div className="proof">
        <div className="wrap">
          <div className="proof-stat">
            <div className="picon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 12l2 2 4-4" />
                <circle cx="12" cy="12" r="9" />
              </svg>
            </div>
            <b>44</b>
            <span>DETERMINISTIC DESIGN RULES</span>
          </div>
          <div className="proof-stat violet">
            <div className="picon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2l3 6 6 1-4.5 4.5L17.5 20 12 17l-5.5 3 1-6.5L3 9l6-1z" />
              </svg>
            </div>
            <b>10/10</b>
            <span>NIELSEN HEURISTICS SCORED</span>
          </div>
          <div className="proof-stat green">
            <div className="picon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 3" />
              </svg>
            </div>
            <b>&lt;60s</b>
            <span>AVG AUDIT + VERIFY TIME</span>
          </div>
          <div className="proof-stat">
            <div className="picon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 17V9m6 8V5m6 12v-6" />
              </svg>
            </div>
            <b>2 tiers</b>
            <span>INSTANT PATCH · CODE DIFF</span>
          </div>
        </div>
      </div>

      {/* ============ PROBLEM ============ */}
      <section className="wrap">
        <div className="section-head reveal">
          <span className="eyebrow violet">The fragmentation problem</span>
          <h2>Four tools. Four tabs. Zero confidence.</h2>
          <p>This is what "auditing a website" looks like today — before anyone's written a single fix.</p>
        </div>
        <div className="tabs-chaos">
          <div className="tab-card pop-stagger" style={{ "--pop-delay": "0ms" } as React.CSSProperties}>
            <span className="badge">tab 1</span>
            <div className="num">01</div>
            <h4>Accessibility scanner</h4>
            <p>Flags 340 violations. No sense of which ones matter or how hard they are to fix.</p>
          </div>
          <div className="tab-card pop-stagger" style={{ "--pop-delay": "90ms" } as React.CSSProperties}>
            <span className="badge">tab 2</span>
            <div className="num">02</div>
            <h4>Performance tool</h4>
            <p>A different scoring system that doesn't talk to the accessibility report at all.</p>
          </div>
          <div className="tab-card pop-stagger" style={{ "--pop-delay": "180ms" } as React.CSSProperties}>
            <span className="badge">tab 3</span>
            <div className="num">03</div>
            <h4>"AI UX feedback"</h4>
            <p>Generic advice that could apply to any website on the internet, ever.</p>
          </div>
          <div className="tab-card pop-stagger" style={{ "--pop-delay": "270ms" } as React.CSSProperties}>
            <span className="badge">tab 4</span>
            <div className="num">04</div>
            <h4>Stack Overflow + a chatbot</h4>
            <p>Pasting one snippet at a time, hoping the fix doesn't break something else.</p>
          </div>
        </div>
        <p className="problem-line reveal">
          Finding the problem was never the bottleneck. <b>Trusting the fix</b> is.
        </p>
      </section>

      {/* ============ PRODUCT SPECIFIC FEATURES GRID ============ */}
      <section className="bg-slate-50/50 border-t border-b border-slate-100" id="features">
        <div className="wrap">
          <div className="section-head reveal mx-auto text-center max-w-2xl">
            <span className="eyebrow violet">Features</span>
            <h2>Hackathon Winning UX Capabilities</h2>
            <p className="max-w-md mx-auto">
              We build specialized remediation tooling that guides you from auditing problems to verifying code-ready fixes.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-12">
            <div className="bg-white border border-slate-200 p-6 rounded-2xl space-y-3 hover:border-blue-400 transition">
              <span className="text-xl">🗺️</span>
              <h4 className="font-bold text-slate-900">Screenshot Heatmap Markup</h4>
              <p className="text-xs text-slate-500 leading-relaxed">
                Visual overlays and high-contrast bounding markers directly on top of screenshot uploads highlight exactly where UX friction points live.
              </p>
            </div>
            <div className="bg-white border border-slate-200 p-6 rounded-2xl space-y-3 hover:border-blue-400 transition">
              <span className="text-xl">📈</span>
              <h4 className="font-bold text-slate-900">UX Score Delta Prediction</h4>
              <p className="text-xs text-slate-500 leading-relaxed">
                Forecast exactly how much your usability score will lift by simulating fixes, utilizing advanced logarithmic diminishing-returns formulas.
              </p>
            </div>
            <div className="bg-white border border-slate-200 p-6 rounded-2xl space-y-3 hover:border-blue-400 transition">
              <span className="text-xl">⚖️</span>
              <h4 className="font-bold text-slate-900">Judge Mode Executive Report</h4>
              <p className="text-xs text-slate-500 leading-relaxed">
                Generate high-level, presentation-ready executive briefs highlighting business risks, usability verdicts, and narrative summaries.
              </p>
            </div>
            <div className="bg-white border border-slate-200 p-6 rounded-2xl space-y-3 hover:border-blue-400 transition">
              <span className="text-xl">⚡</span>
              <h4 className="font-bold text-slate-900">Before/After Fix Simulator</h4>
              <p className="text-xs text-slate-500 leading-relaxed">
                Remediate issues in a sandbox environment. Toggle checklist items and preview predicted scores alongside visual bounding boxes and code diff panels.
              </p>
            </div>
            <div className="bg-white border border-slate-200 p-6 rounded-2xl space-y-3 hover:border-blue-400 transition">
              <span className="text-xl">⚔️</span>
              <h4 className="font-bold text-slate-900">Competitor UX Comparison</h4>
              <p className="text-xs text-slate-500 leading-relaxed">
                Compare your website or mockups side-by-side with a competitor. Get automatic win/loss breakdowns, category metrics, and opportunities.
              </p>
            </div>
            <div className="bg-white border border-slate-200 p-6 rounded-2xl space-y-3 hover:border-blue-400 transition">
              <span className="text-xl">🤖</span>
              <h4 className="font-bold text-slate-900">Remediation Chat Assistant</h4>
              <p className="text-xs text-slate-500 leading-relaxed">
                Explore every report with an AI assistant that explains issue context, WCAG principles, and outputs direct framework code blocks.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ============ HOW IT WORKS ============ */}
      <section className="wrap" id="how">
        <div className="section-head reveal">
          <span className="eyebrow">How it works</span>
          <h2>One URL. Five steps. One verdict.</h2>
          <p>Everything below happens automatically, in a real browser, in under a minute.</p>
        </div>
        <div className="pipeline reveal">
          <div className="pipe-line"></div>
          <div className="pipe-step">
            <div className="ring">01</div>
            <h4>Paste URL</h4>
            <p>Any live page — no install, no SDK, no setup.</p>
          </div>
          <div className="pipe-step">
            <div className="ring">02</div>
            <h4>Real browser capture</h4>
            <p>Screenshot, full DOM, computed styles, network activity.</p>
          </div>
          <div className="pipe-step">
            <div className="ring">03</div>
            <h4>Dual-engine analysis</h4>
            <p>Rules engine + vision-AI heuristics run in parallel.</p>
          </div>
          <div className="pipe-step">
            <div className="ring">04</div>
            <h4>Simulate fixes</h4>
            <p>Preview suggested repairs in the remediation cockpit.</p>
          </div>
          <div className="pipe-step">
            <div className="ring">05</div>
            <h4>Remediation report</h4>
            <p>Estimated score lifts, side-by-side simulation, and PR plans.</p>
          </div>
        </div>

        <div className="report-card pop-3d">
          <div className="rc-head">
            <div className="rc-head-l">
              <div className="dot"></div>
              <span>yourwebsite.com · audit #2417</span>
            </div>
            <span className="rc-score">SCORE 8.6/10 · ESTIMATED LIFT</span>
          </div>
          <div className="rc-body">
            <div className="rc-chart">
              <div className="rc-chart-label">Issues by category</div>
              <div className="rc-bars">
                <div className="rc-bar-col">
                  <div className="rc-bar blue" style={{ height: "78%" }}></div>
                  <span>Contrast</span>
                </div>
                <div className="rc-bar-col">
                  <div className="rc-bar violet" style={{ height: "54%" }}></div>
                  <span>ARIA</span>
                </div>
                <div className="rc-bar-col">
                  <div className="rc-bar green" style={{ height: "32%" }}></div>
                  <span>Hierarchy</span>
                </div>
                <div className="rc-bar-col">
                  <div className="rc-bar amber" style={{ height: "46%" }}></div>
                  <span>Labels</span>
                </div>
                <div className="rc-bar-col">
                  <div className="rc-bar blue" style={{ height: "22%" }}></div>
                  <span>Focus</span>
                </div>
                <div className="rc-bar-col">
                  <div className="rc-bar violet" style={{ height: "65%" }}></div>
                  <span>Errors</span>
                </div>
              </div>
            </div>
            <div className="rc-issues">
              <div className="rc-issue-row">
                <div className="rc-sev high"></div>
                <span className="name">Hero CTA — contrast 2.1:1</span>
                <span className="tag">suggested</span>
              </div>
              <div className="rc-issue-row">
                <div className="rc-sev high"></div>
                <span className="name">Form input — missing aria-label</span>
                <span className="tag">suggested</span>
              </div>
              <div className="rc-issue-row">
                <div className="rc-sev med"></div>
                <span className="name">Nav — heading hierarchy skip</span>
                <span className="tag">suggested</span>
              </div>
              <div className="rc-issue-row">
                <div className="rc-sev med"></div>
                <span className="name">Footer links — touch target 28px</span>
                <span className="tag pending font-mono">needs review</span>
              </div>
              <div className="rc-issue-row">
                <div className="rc-sev low"></div>
                <span className="name">Card grid — inconsistent spacing</span>
                <span className="tag pending font-mono">needs review</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ DUAL ENGINE ============ */}
      <section className="wrap" id="engines">
        <div className="section-head reveal">
          <span className="eyebrow green">The architecture</span>
          <h2>Two engines that have to agree.</h2>
          <p>We didn't pick rules <em>or</em> AI. We made them check each other — then merged the result into one ranked report.</p>
        </div>
        <div className="engines">
          <div className="engine-card blue pop-stagger" style={{ "--pop-delay": "0ms" } as React.CSSProperties}>
            <span className="eyebrow">Deterministic</span>
            <h3>Rules Engine</h3>
            <p>axe-core plus 44 custom design rules. Objective. Provable. This is always ground truth — never overridden by AI opinion.</p>
            <div className="rule-list">
              <code>
                <span>color-contrast</span>
                <b>AA</b>
              </code>
              <code>
                <span>aria-required-attr</span>
                <b>fail</b>
              </code>
              <code>
                <span>label-missing</span>
                <b>3 found</b>
              </code>
            </div>
          </div>
          <div className="engine-fuse pop-stagger" style={{ "--pop-delay": "260ms" } as React.CSSProperties}>
            <div className="fuse-orb">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 3v12a3 3 0 003 3h6M6 9h12" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <span>
              merged · deduped<br />
              ranked by severity
            </span>
          </div>
          <div className="engine-card violet pop-stagger" style={{ "--pop-delay": "130ms" } as React.CSSProperties}>
            <span className="eyebrow violet">Generative</span>
            <h3>Heuristic Engine</h3>
            <p>A vision-language model scores the page the way a person experiences it — against all 10 Nielsen usability heuristics.</p>
            <div className="rule-list">
              <code>
                <span>visibility-of-status</span>
                <b>6/10</b>
              </code>
              <code>
                <span>error-prevention</span>
                <b>4/10</b>
              </code>
              <code>
                <span>visual-hierarchy</span>
                <b>7/10</b>
              </code>
            </div>
          </div>
        </div>
      </section>

      {/* ============ VERIFIED FIX SLIDER ============ */}
      <section className="wrap" id="verified">
        <div className="vf-wrap">
          <div className="vf-side reveal">
            <span className="eyebrow green">The differentiator</span>
            <h3>Simulate and preview fixes before applying.</h3>
            <p className="lede">
              For accessibility and layout issues — contrast, missing labels, broken ARIA — UX-Auditor provides a remediation cockpit. Preview fix suggestions in the simulator and estimate your post-fix usability score improvement.
            </p>
            <ul className="vf-checklist">
              <li>Interactive simulated scoring based on selected fixes</li>
              <li>Detailed side-by-side comparison of proposed code repairs</li>
              <li>AI-generated fix suggestions ready for manual review</li>
              <li>PR-ready remediation plan exported directly to GitHub</li>
            </ul>
          </div>
          <div className="reveal">
            <div className="vf-demo pop-3d">
              <div className="vf-layer vf-before">
                <span className="vf-label">BEFORE · CONTRAST 2.1:1 · FAILS AA</span>
                <button type="button" className="mock-cta">Get started</button>
              </div>
              <div
                className="vf-layer vf-after"
                style={{ clipPath: `inset(0 ${100 - v}% 0 0)` }}
              >
                <span className="vf-label">SIMULATED FIX · CONTRAST 7.4:1 · PASSES AA</span>
                <button type="button" className="mock-cta">Get started</button>
              </div>
              <div className="vf-divider" style={{ left: `${v}%` }}></div>
              <div className="vf-badge">drag to compare</div>
              <div className="vf-handle-row">
                <input
                  type="range"
                  className="vf-range"
                  min="0"
                  max="100"
                  value={v}
                  onChange={(e) => setV(Number(e.target.value))}
                  aria-label="Compare before and after"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ============ CHAT ASSISTANT ============ */}
      <section className="wrap">
        <div className="chat-wrap">
          <div className="reveal">
            <span className="eyebrow violet">Built in</span>
            <h2>A report that talks back.</h2>
            <p className="lede" style={{ marginTop: "14px" }}>
              Every finding is explorable. Ask why something failed, how to fix it in your framework, or what the rule actually means — grounded entirely in your audit, not a generic answer.
            </p>
          </div>
          <div className="chat-panel pop-3d">
            <div className="chat-head">
              <div className="pulse"></div>
              <span style={{ fontSize: "13px", color: "var(--muted)" }}>Audit Assistant · yourwebsite.com</span>
            </div>
            <div className="chat-body overflow-y-auto max-h-[300px]">
              {chatMessages.map((msg, index) => (
                <div key={index} className={`msg ${msg.role}`}>
                  {msg.content}
                </div>
              ))}
            </div>
            <form onSubmit={handleChatSubmit} className="chat-input-row">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask about any issue in this report…"
              />
              <button type="submit" className="btn btn-primary btn-sm">
                Ask
              </button>
            </form>
          </div>
        </div>
      </section>

      {/* ============ TRUST STRIP ============ */}
      <section className="wrap trust">
        <div className="trust-label reveal">BUILT FOR TEAMS USING MODERN STACKS</div>
        <div className="trust-row">
          <div className="tmark pop-stagger" style={{ "--pop-delay": "0ms" } as React.CSSProperties}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M3 9h18" />
            </svg>
            Vercel
          </div>
          <div className="tmark pop-stagger" style={{ "--pop-delay": "60ms" } as React.CSSProperties}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="9" />
            </svg>
            Linear
          </div>
          <div className="tmark pop-stagger" style={{ "--pop-delay": "120ms" } as React.CSSProperties}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 17V7l8-4 8 4v10l-8 4-8-4z" />
            </svg>
            Notion
          </div>
          <div className="tmark pop-stagger" style={{ "--pop-delay": "180ms" } as React.CSSProperties}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2l9 4.5v9L12 20l-9-4.5v-9z" />
            </svg>
            Retool
          </div>
          <div className="tmark pop-stagger" style={{ "--pop-delay": "240ms" } as React.CSSProperties}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="4" y="4" width="16" height="16" rx="4" />
            </svg>
            Resend
          </div>
        </div>
      </section>

      {/* ============ PRICING ============ */}
      <section className="wrap" id="pricing">
        <div className="section-head reveal">
          <span className="eyebrow">Pricing</span>
          <h2>Free is enough to see the proof.</h2>
          <p>Remediate friction and inspect fixes on all plans — with premium features for active engineering squads.</p>
        </div>
        <div className="pricing-grid">
          <div className="price-card pop-stagger" style={{ "--pop-delay": "0ms" } as React.CSSProperties}>
            <span className="pname">Free</span>
            <div className="pamount">
              $0<span>/mo</span>
            </div>
            <ul>
              <li>Unlimited single-page audits</li>
              <li>Full dual-engine reports</li>
              <li>Before/After fix simulations</li>
            </ul>
            <button onClick={handleScrollToForm} className="btn btn-ghost btn-sm mt-auto">
              Start free
            </button>
          </div>
          <div className="price-card pop pop-stagger" style={{ "--pop-delay": "90ms" } as React.CSSProperties}>
            <span className="pop-tag">MOST POPULAR</span>
            <span className="pname">Pro</span>
            <div className="pamount">
              $29<span>/mo</span>
            </div>
            <ul>
              <li>Visual screenshots compare</li>
              <li>Remediation chat assistant</li>
              <li>PDF export &amp; histories</li>
            </ul>
            <button onClick={handleScrollToForm} className="btn btn-primary btn-sm mt-auto">
              Start trial
            </button>
          </div>
          <div className="price-card pop-stagger" style={{ "--pop-delay": "180ms" } as React.CSSProperties}>
            <span className="pname">Team</span>
            <div className="pamount">
              $79<span>/mo</span>
            </div>
            <ul>
              <li>5 seats · priority processing</li>
              <li>90-day audit persistence</li>
              <li>Everything in Pro</li>
            </ul>
            <button onClick={handleScrollToForm} className="btn btn-ghost btn-sm mt-auto">
              Start trial
            </button>
          </div>
          <div className="price-card pop-stagger" style={{ "--pop-delay": "270ms" } as React.CSSProperties}>
            <span className="pname">Enterprise</span>
            <div className="pamount">Custom</div>
            <ul>
              <li>White-labeled reports</li>
              <li>Custom corporate rules pack</li>
              <li>Dedicated SLA support</li>
            </ul>
            <button onClick={handleScrollToForm} className="btn btn-ghost btn-sm mt-auto">
              Talk to us
            </button>
          </div>
        </div>
      </section>

      {/* ============ FINAL CTA ============ */}
      <section className="wrap">
        <div className="final-cta pop-3d">
          <span className="eyebrow" style={{ justifyContent: "center" }}>Interactive Remediation Cockpit</span>
          <h2>Run your first audit before this page finishes loading the next one.</h2>
          <p>Paste a URL or drop screenshots. Get a dual-engine report with AI-assisted fix suggestions — free, instantly.</p>
          <div className="cta-row">
            <button onClick={handleScrollToForm} className="btn btn-primary">
              Start free audit
            </button>
          </div>
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer>
        <div className="wrap">
          <div className="foot-grid">
            <div>
              <div className="logo">
                <div className="logo-mark">UX</div>
                UX-Auditor
              </div>
              <p style={{ color: "var(--muted-2)", fontSize: "13px", maxWidth: "240px", marginTop: "8px" }}>
                Dual-engine UX &amp; accessibility audits with interactive before/after fix simulation.
              </p>
            </div>
            <div className="foot-cols">
              <div className="foot-col">
                <h5>PRODUCT</h5>
                <a href="#how">How it works</a>
                <a href="#features">Features</a>
                <a href="#pricing">Pricing</a>
              </div>
              <div className="foot-col">
                <h5>COMPANY</h5>
                <a href="#">About</a>
                <a href="#">Blog</a>
              </div>
              <div className="foot-col">
                <h5>LEGAL</h5>
                <a href="#">Privacy</a>
                <a href="#">Terms</a>
              </div>
            </div>
          </div>
          <div className="foot-bottom">
            <span>© 2026 UX-Auditor. All rights reserved.</span>
            <span className="mono">status: all systems active ✓</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
