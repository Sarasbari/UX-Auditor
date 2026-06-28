import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/services/auth";
import { prisma } from "@/lib/db/prisma";
import { buildVoiceSummaryText } from "@/lib/services/voice-summary";

/**
 * POST /api/audit/[id]/voice-summary
 *
 * Generates an audio voice summary of the audit report using Smallest.ai TTS.
 * The API key is kept server-side and never exposed to the client.
 * Returns audio/wav binary data.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    const { id } = await params;

    // ── Fetch audit ──────────────────────────────────────────────────────────
    const auditRun = await prisma.auditRun.findUnique({
      where: { id },
      include: {
        issues: {
          orderBy: { severity: "asc" },
        },
      },
    });

    if (!auditRun) {
      return NextResponse.json({ error: "Audit not found" }, { status: 404 });
    }

    if (auditRun.userId !== session.user.id) {
      return NextResponse.json(
        { error: "You do not have access to this audit" },
        { status: 403 }
      );
    }

    if (auditRun.status !== "COMPLETED") {
      return NextResponse.json(
        { error: "Audit is not completed yet" },
        { status: 400 }
      );
    }

    // ── Check API key ────────────────────────────────────────────────────────
    const apiKey = process.env.SMALLEST_AI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "Voice summary is not configured. SMALLEST_AI_API_KEY is missing." },
        { status: 503 }
      );
    }

    // ── Build summary text ───────────────────────────────────────────────────
    const issues = auditRun.issues.map((issue) => ({
      ...issue,
      severity: issue.severity.toLowerCase(),
      category: issue.category.toLowerCase(),
      source: issue.source.toLowerCase(),
      confidence: (issue as any).confidence
        ? (issue as any).confidence.toLowerCase()
        : "medium",
      ruleId: (issue as any).ruleId,
      sampleElements: (issue as any).sampleElements
        ? JSON.parse((issue as any).sampleElements)
        : null,
      fixDiff: issue.fixDiff ? JSON.parse(issue.fixDiff) : null,
      scoreDelta: issue.scoreDelta,
    }));

    const summaryText = buildVoiceSummaryText({
      score: auditRun.score,
      inputType: auditRun.inputType,
      url: auditRun.url,
      issues,
    });

    // ── Call Smallest.ai Waves API ───────────────────────────────────────────
    const voiceId = process.env.SMALLEST_AI_VOICE_ID || "meher";
    const model = process.env.SMALLEST_AI_MODEL || "lightning_v3.1";

    const ttsResponse = await fetch(
      "https://api.smallest.ai/waves/v1/tts",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          Accept: "audio/wav",
        },
        body: JSON.stringify({
          text: summaryText,
          voice_id: voiceId,
          model,
          sample_rate: 24000,
          output_format: "wav",
        }),
      }
    );

    if (!ttsResponse.ok) {
      const errorText = await ttsResponse.text().catch(() => "Unknown error");
      console.error(
        `[voice-summary] Smallest.ai API error (${ttsResponse.status}):`,
        errorText
      );
      return NextResponse.json(
        { error: "Failed to generate voice summary. TTS service returned an error." },
        { status: 502 }
      );
    }

    // ── Stream audio back to client ──────────────────────────────────────────
    const audioBuffer = await ttsResponse.arrayBuffer();

    return new NextResponse(audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Content-Length": String(audioBuffer.byteLength),
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    console.error("[voice-summary] Unexpected error:", error);
    return NextResponse.json(
      { error: "Failed to generate voice summary" },
      { status: 500 }
    );
  }
}
