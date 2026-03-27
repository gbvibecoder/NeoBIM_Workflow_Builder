import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatErrorResponse } from "@/lib/user-errors";

/**
 * POST /api/quantity-corrections — Save a QS quantity correction
 *
 * Body: { elementType, buildingType, city, state, extractedQty, correctedQty, unit, notes?, workflowId? }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(formatErrorResponse({ title: "Unauthorized", message: "Sign in to save corrections", code: "AUTH_001" }), { status: 401 });
    }

    const body = await req.json();
    const { elementType, buildingType, city, state, extractedQty, correctedQty, unit, notes, workflowId } = body;

    if (!elementType || !extractedQty || !correctedQty || !unit) {
      return NextResponse.json(formatErrorResponse({ title: "Missing fields", message: "elementType, extractedQty, correctedQty, unit required", code: "VAL_001" }), { status: 400 });
    }

    const correctionRatio = correctedQty / extractedQty;

    const correction = await prisma.quantityCorrection.create({
      data: {
        userId: session.user.id,
        workflowId: workflowId || null,
        elementType,
        buildingType: buildingType || "commercial",
        city: city || "",
        state: state || "",
        extractedQty: Number(extractedQty),
        correctedQty: Number(correctedQty),
        correctionRatio,
        unit,
        notes: notes || null,
      },
    });

    return NextResponse.json({ success: true, correction: { id: correction.id, correctionRatio } });
  } catch (error) {
    console.error("[quantity-corrections] POST error:", error);
    return NextResponse.json(formatErrorResponse({ title: "Failed to save correction", message: String(error), code: "NET_001" }), { status: 500 });
  }
}

/**
 * GET /api/quantity-corrections?elementType=IfcWall&buildingType=commercial&state=Maharashtra
 *
 * Returns average correction ratios for matching element type + building type + state.
 * Used by TR-007 to auto-adjust quantities based on past QS corrections.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json(formatErrorResponse({ title: "Unauthorized", message: "Sign in required", code: "AUTH_001" }), { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const elementType = searchParams.get("elementType");
    const buildingType = searchParams.get("buildingType");
    const state = searchParams.get("state");

    if (!elementType) {
      return NextResponse.json(formatErrorResponse({ title: "Missing elementType", message: "elementType query param required", code: "VAL_001" }), { status: 400 });
    }

    // Find corrections matching this element type, optionally filtered by building type and state
    const corrections = await prisma.quantityCorrection.findMany({
      where: {
        elementType,
        ...(buildingType ? { buildingType } : {}),
        ...(state ? { state } : {}),
      },
      select: {
        correctionRatio: true,
        correctedQty: true,
        extractedQty: true,
      },
      orderBy: { createdAt: "desc" },
      take: 50, // last 50 corrections
    });

    if (corrections.length < 3) {
      return NextResponse.json({ hasEnoughData: false, count: corrections.length, averageRatio: 1.0 });
    }

    // Calculate average correction ratio (trimmed mean — drop top/bottom 10%)
    const ratios = corrections.map((c: { correctionRatio: number }) => c.correctionRatio).sort((a: number, b: number) => a - b);
    const trimCount = Math.max(1, Math.floor(ratios.length * 0.1));
    const trimmed = ratios.slice(trimCount, -trimCount);
    const avgRatio = trimmed.reduce((a: number, b: number) => a + b, 0) / trimmed.length;

    return NextResponse.json({
      hasEnoughData: true,
      count: corrections.length,
      averageRatio: Math.round(avgRatio * 1000) / 1000,
      suggestion: avgRatio > 1.05 ? `Increase by ${Math.round((avgRatio - 1) * 100)}%` : avgRatio < 0.95 ? `Decrease by ${Math.round((1 - avgRatio) * 100)}%` : "No significant adjustment needed",
    });
  } catch (error) {
    console.error("[quantity-corrections] GET error:", error);
    return NextResponse.json(formatErrorResponse({ title: "Failed to fetch corrections", message: String(error), code: "NET_001" }), { status: 500 });
  }
}
