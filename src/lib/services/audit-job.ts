import { prisma } from "@/lib/db/prisma";

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
    await prisma.$transaction(async (tx) => {
      await tx.auditRun.update({
        where: { id: auditRunId },
        data: {
          status: "COMPLETED",
          score: reportData.score,
          completedAt: new Date(),
        },
      });

      for (const issue of reportData.issues ?? []) {
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
          },
        });
      }
    });

    console.log(`[audit-job:${auditRunId}] COMPLETED — score ${reportData.score}`);
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
