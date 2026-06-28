import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/services/auth";
import { prisma } from "@/lib/db/prisma";
import { buildCompetitorComparison } from "@/lib/services/competitor-comparison";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    const userId = session?.user?.id;

    if (!userId) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const { id } = await params;

    const comparisonRun = await prisma.comparisonRun.findUnique({
      where: { id },
    });

    if (!comparisonRun) {
      return NextResponse.json({ error: "Comparison not found" }, { status: 404 });
    }

    if (comparisonRun.userId !== userId) {
      return NextResponse.json({ error: "You do not have access to this comparison" }, { status: 403 });
    }

    // Load both audits
    const primaryAudit = await prisma.auditRun.findUnique({
      where: { id: comparisonRun.primaryAuditId },
      include: { issues: true },
    });

    const competitorAudit = await prisma.auditRun.findUnique({
      where: { id: comparisonRun.competitorAuditId },
      include: { issues: true },
    });

    if (!primaryAudit || !competitorAudit) {
      return NextResponse.json({ error: "Linked audits not found" }, { status: 404 });
    }

    // Check if both audits are in terminal completed state
    const isPrimaryDone = primaryAudit.status === "COMPLETED";
    const isCompetitorDone = competitorAudit.status === "COMPLETED";

    // If either audit failed, we transition the comparison run status to FAILED
    const isPrimaryFailed = primaryAudit.status === "FAILED";
    const isCompetitorFailed = competitorAudit.status === "FAILED";

    if (isPrimaryFailed || isCompetitorFailed) {
      if (comparisonRun.status !== "FAILED") {
        await prisma.comparisonRun.update({
          where: { id },
          data: { status: "FAILED" },
        });
        comparisonRun.status = "FAILED";
      }
      return NextResponse.json({
        ...comparisonRun,
        primaryAudit: { ...primaryAudit, status: primaryAudit.status.toLowerCase() },
        competitorAudit: { ...competitorAudit, status: competitorAudit.status.toLowerCase() },
      });
    }

    if (isPrimaryDone && isCompetitorDone) {
      // Both are COMPLETED. Generate comparison if not already done
      let comparisonData;
      if (!comparisonRun.summary || comparisonRun.status !== "COMPLETED") {
        comparisonData = buildCompetitorComparison(primaryAudit, competitorAudit);
        
        await prisma.comparisonRun.update({
          where: { id },
          data: {
            status: "COMPLETED",
            summary: comparisonData.summary,
            categoryScores: JSON.stringify(comparisonData.categoryBreakdown),
            opportunities: JSON.stringify(comparisonData.topOpportunities),
          },
        });

        // Update local object fields
        comparisonRun.status = "COMPLETED";
        comparisonRun.summary = comparisonData.summary;
        comparisonRun.categoryScores = JSON.stringify(comparisonData.categoryBreakdown);
        comparisonRun.opportunities = JSON.stringify(comparisonData.topOpportunities);
      } else {
        comparisonData = {
          winner: (primaryAudit.score || 0) > (competitorAudit.score || 0) ? "primary" : ((competitorAudit.score || 0) > (primaryAudit.score || 0) ? "competitor" : "tie"),
          scoreGap: Math.abs((primaryAudit.score || 0) - (competitorAudit.score || 0)),
          summary: comparisonRun.summary,
          wherePrimaryWins: JSON.parse(comparisonRun.categoryScores || "[]")
            .filter((c: any) => c.primaryCount < c.competitorCount)
            .map((c: any) => `Fewer issues detected in ${c.category} compared to competitor.`),
          whereCompetitorWins: JSON.parse(comparisonRun.categoryScores || "[]")
            .filter((c: any) => c.competitorCount < c.primaryCount)
            .map((c: any) => `Fewer issues detected in ${c.category} compared to your product.`),
          topOpportunities: JSON.parse(comparisonRun.opportunities || "[]"),
          categoryBreakdown: JSON.parse(comparisonRun.categoryScores || "[]"),
          executiveTakeaway: "", // We can regenerate this dynamically or fall back
        };

        // Add overall score check
        if ((primaryAudit.score || 0) > (competitorAudit.score || 0)) {
          comparisonData.wherePrimaryWins.push(`Higher overall UX score (+${comparisonData.scoreGap} points higher).`);
        } else if ((competitorAudit.score || 0) > (primaryAudit.score || 0)) {
          comparisonData.whereCompetitorWins.push(`Higher overall UX score (+${comparisonData.scoreGap} points higher).`);
        }

        // Add fallbacks
        if (comparisonData.wherePrimaryWins.length === 0) comparisonData.wherePrimaryWins.push("No significant advantages detected.");
        if (comparisonData.whereCompetitorWins.length === 0) comparisonData.whereCompetitorWins.push("No significant competitor advantages detected.");

        const pScore = primaryAudit.score ?? 70;
        const cScore = competitorAudit.score ?? 70;
        if (comparisonData.winner === "primary") {
          comparisonData.executiveTakeaway = `Your product has a stronger usability profile than the competitor with an overall score of ${pScore} vs ${cScore}. Focus on wrapping up the remaining top opportunities to widen your competitive lead.`;
        } else if (comparisonData.winner === "competitor") {
          comparisonData.executiveTakeaway = `The competitor currently leads by ${comparisonData.scoreGap} points due to lower density of high-severity layout and accessibility issues. Remediating your primary risk areas will close the score gap and elevate your product's user experience.`;
        } else {
          comparisonData.executiveTakeaway = `The overall usability is closely matched. Addressing the top opportunities listed below represents a clear path to outperform the competitor.`;
        }
      }

      return NextResponse.json({
        ...comparisonRun,
        primaryAudit: { ...primaryAudit, status: primaryAudit.status.toLowerCase() },
        competitorAudit: { ...competitorAudit, status: competitorAudit.status.toLowerCase() },
        comparison: comparisonData,
      });
    }

    // Otherwise, still processing
    return NextResponse.json({
      ...comparisonRun,
      primaryAudit: { ...primaryAudit, status: primaryAudit.status.toLowerCase() },
      competitorAudit: { ...competitorAudit, status: competitorAudit.status.toLowerCase() },
    });
  } catch (error) {
    console.error("Failed to fetch comparison:", error);
    return NextResponse.json({ error: "Failed to fetch comparison" }, { status: 500 });
  }
}
