import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const auditRun = await prisma.auditRun.findUnique({
      where: { id },
      include: {
        project: true,
        issues: {
          orderBy: { severity: "asc" },
        },
        screenshots: true,
        domSnapshot: true,
        chatMessages: {
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!auditRun) {
      return NextResponse.json({ error: "Audit not found" }, { status: 404 });
    }

    return NextResponse.json(auditRun);
  } catch (error) {
    console.error("Failed to fetch audit:", error);
    return NextResponse.json({ error: "Failed to fetch audit" }, { status: 500 });
  }
}
