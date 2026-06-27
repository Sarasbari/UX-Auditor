import { prisma } from "@/lib/db/prisma";
import { deduplicateIssues, calculateDiminishingScore } from "@/lib/remediation/deduplicate";
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

/** Maximum time (ms) to poll FastAPI before declaring timeout. */
const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/** Interval (ms) between poll requests to FastAPI. */
const POLL_INTERVAL_MS = 3_000;

/** FastAPI base URL. */
const FASTAPI_URL = process.env.FASTAPI_URL || "http://localhost:8001";

/**
 * Transition an audit run to FAILED with an error message.
 * Safe to call multiple times — last write wins.
 */
async function markFailed(auditRunId: string, errorMessage: string) {
  console.error(`[audit-job:${auditRunId}] FAILED — ${errorMessage}`);
  await prisma.auditRun.update({
    where: { id: auditRunId },
    data: { status: "FAILED", errorMessage },
  });
}

/**
 * Execute the full audit lifecycle for a single audit run.
 *
 * Guarantees a terminal status (COMPLETED or FAILED) will be written
 * to the database, even if the process crashes mid-flight.
 *
 * Status transitions:
 *   QUEUED → PROCESSING → COMPLETED
 *   QUEUED → PROCESSING → FAILED
 */
export async function executeAuditJob(auditRunId: string, url: string) {
  try {
    // ── QUEUED → PROCESSING ──────────────────────────────────────
    await prisma.auditRun.update({
      where: { id: auditRunId },
      data: { status: "PROCESSING", startedAt: new Date() },
    });

    // ── Submit to FastAPI ─────────────────────────────────────────
    let apiRes: Response;
    try {
      apiRes = await fetch(`${FASTAPI_URL}/audit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, audit_id: auditRunId }),
      });
    } catch (fetchErr) {
      await markFailed(
        auditRunId,
        `Could not reach audit backend at ${FASTAPI_URL}. Is the FastAPI server running?`
      );
      return;
    }

    if (!apiRes.ok) {
      await markFailed(
        auditRunId,
        `Audit backend returned ${apiRes.status}: ${apiRes.statusText}`
      );
      return;
    }

    // ── Poll for results with timeout ────────────────────────────
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let status = "queued";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let reportData: any = null;

    while (status === "queued" || status === "processing") {
      if (Date.now() > deadline) {
        await markFailed(
          auditRunId,
          `Audit timed out after ${POLL_TIMEOUT_MS / 60_000} minutes`
        );
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      try {
        const pollRes = await fetch(`${FASTAPI_URL}/report/${auditRunId}`);
        if (pollRes.ok) {
          reportData = await pollRes.json();
          status = reportData.status;
        } else {
          console.warn(
            `[audit-job:${auditRunId}] Poll returned ${pollRes.status}, retrying…`
          );
        }
      } catch (pollErr) {
        console.warn(
          `[audit-job:${auditRunId}] Poll fetch error, retrying…`,
          pollErr
        );
      }
    }

    // ── Check for backend-side failure ────────────────────────────
    if (status === "failed" || !reportData) {
      await markFailed(
        auditRunId,
        reportData?.error || "Audit failed in the Python backend agent"
      );
      return;
    }

    // ── PROCESSING → COMPLETED ───────────────────────────────────
    const dedupedIssues = deduplicateIssues(reportData.issues ?? []);
    const calculatedScore = calculateDiminishingScore(dedupedIssues);

    await prisma.$transaction(async (tx) => {
      await tx.auditRun.update({
        where: { id: auditRunId },
        data: {
          status: "COMPLETED",
          score: calculatedScore,
          completedAt: new Date(),
        },
      });

      for (const issue of dedupedIssues) {
        await tx.issue.create({
          data: {
            id: issue.id,
            auditRunId,
            severity: issue.severity.toUpperCase(),
            category: issue.category.toUpperCase(),
            elementSelector: issue.elementSelector,
            description: issue.description,
            fixSuggestion: issue.fixSuggestion,
            fixDiff: issue.fixDiff ? JSON.stringify(issue.fixDiff) : null,
            verifiedFixStatus: issue.verifiedFixStatus.toUpperCase(),
            source: issue.source.toUpperCase(),
            confidence: issue.confidence ? issue.confidence.toUpperCase() : "MEDIUM",
            actualValue: issue.actualValue || null,
            expectedValue: issue.expectedValue || null,
            viewport: issue.viewport || null,
            ruleId: issue.ruleId || null,
            sampleElements: issue.sampleElements ? JSON.stringify(issue.sampleElements) : null,
            pageUrl: issue.pageUrl || null,
          },
        });
      }
    });

    console.log(`[audit-job:${auditRunId}] COMPLETED — score ${calculatedScore}`);
  } catch (error) {
    // ── Catch-all: any unhandled error → FAILED ──────────────────
    const message =
      error instanceof Error ? error.message : "Unknown internal error";
    try {
      await markFailed(auditRunId, message);
    } catch (dbErr) {
      // If even the failure write fails, log it — nothing else we can do.
      console.error(
        `[audit-job:${auditRunId}] CRITICAL: could not write failure status`,
        dbErr
      );
    }
  }
}

export async function executeScreenshotAuditJob(auditRunId: string, imageUrl: string) {
  try {
    // ── QUEUED → PROCESSING ──────────────────────────────────────
    await prisma.auditRun.update({
      where: { id: auditRunId },
      data: { status: "PROCESSING", startedAt: new Date() },
    });

    // Read the uploaded file and convert to base64
    const absoluteImagePath = path.join(process.cwd(), "public", imageUrl);
    let base64Image = "";
    try {
      const fileBuffer = await fs.readFile(absoluteImagePath);
      base64Image = fileBuffer.toString("base64");
    } catch (readErr) {
      await markFailed(
        auditRunId,
        `Could not read uploaded screenshot file: ${readErr instanceof Error ? readErr.message : "Unknown file error"}`
      );
      return;
    }

    // Submit to FastAPI /screenshot-audit
    let apiRes: Response;
    try {
      apiRes = await fetch(`${FASTAPI_URL}/screenshot-audit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audit_id: auditRunId,
          image_path_or_url: imageUrl,
          image_base64: base64Image,
        }),
      });
    } catch (fetchErr) {
      await markFailed(
        auditRunId,
        `Could not reach audit backend at ${FASTAPI_URL}. Is the FastAPI server running?`
      );
      return;
    }

    if (!apiRes.ok) {
      await markFailed(
        auditRunId,
        `Screenshot audit backend returned ${apiRes.status}: ${apiRes.statusText}`
      );
      return;
    }

    // Poll for results
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let status = "queued";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let reportData: any = null;

    while (status === "queued" || status === "processing") {
      if (Date.now() > deadline) {
        await markFailed(
          auditRunId,
          `Screenshot audit timed out after ${POLL_TIMEOUT_MS / 60_000} minutes`
        );
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

      try {
        const pollRes = await fetch(`${FASTAPI_URL}/report/${auditRunId}`);
        if (pollRes.ok) {
          reportData = await pollRes.json();
          status = reportData.status;
        } else {
          console.warn(
            `[screenshot-audit-job:${auditRunId}] Poll returned ${pollRes.status}, retrying…`
          );
        }
      } catch (pollErr) {
        console.warn(
          `[screenshot-audit-job:${auditRunId}] Poll fetch error, retrying…`,
          pollErr
        );
      }
    }

    // Check backend-side failure
    if (status === "failed" || !reportData) {
      await markFailed(
        auditRunId,
        reportData?.error || "Screenshot audit failed in Python backend"
      );
      return;
    }

    const dedupedIssues = reportData.issues ?? [];
    const calculatedScore = reportData.score ?? 100;

    await prisma.$transaction(async (tx) => {
      await tx.auditRun.update({
        where: { id: auditRunId },
        data: {
          status: "COMPLETED",
          score: calculatedScore,
          completedAt: new Date(),
        },
      });

      for (const issue of dedupedIssues) {
        await tx.issue.create({
          data: {
            id: issue.id || randomUUID(),
            auditRunId,
            severity: issue.severity.toUpperCase(),
            category: issue.category.toUpperCase(),
            elementSelector: issue.elementSelector || null,
            description: issue.description,
            fixSuggestion: issue.fixSuggestion || null,
            fixDiff: issue.fixDiff ? JSON.stringify(issue.fixDiff) : null,
            verifiedFixStatus: (issue.verifiedFixStatus || "NOT_APPLICABLE").toUpperCase(),
            source: (issue.source || "screenshot_vision").toUpperCase(),
            confidence: (issue.confidence || "MEDIUM").toUpperCase(),
            actualValue: issue.actualValue || null,
            expectedValue: issue.expectedValue || null,
            viewport: issue.viewport || null,
            ruleId: issue.ruleId || null,
            sampleElements: issue.sampleElements ? JSON.stringify(issue.sampleElements) : null,
            pageUrl: issue.pageUrl || null,
          },
        });
      }
    });

    console.log(`[screenshot-audit-job:${auditRunId}] COMPLETED — score ${calculatedScore}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown internal error";
    try {
      await markFailed(auditRunId, message);
    } catch (dbErr) {
      console.error(`[screenshot-audit-job:${auditRunId}] CRITICAL: could not write failure status`, dbErr);
    }
  }
}
