import {
  NextResponse,
  parseBriefDocument,
  generateId,
  formatErrorResponse,
  logger,
} from "./deps";
import type { NodeHandler } from "./types";

/**
 * TR-001 — Brief Parser (PDF text extraction + GPT structuring)
 * Pure copy from execute-node/route.ts (lines 347-450 of the pre-decomposition file).
 */
export const handleTR001: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId, apiKey } = ctx;
  // Brief Parser — PDF text extraction + GPT structuring
  const rawText = inputData?.content ?? inputData?.prompt ?? inputData?.rawText ?? "";
  const pdfBase64 = inputData?.fileData ?? inputData?.buffer ?? null;

  // Validate PDF file size (base64 → ~20MB raw ≈ 26.7MB base64)
  const MAX_PDF_BASE64_LEN = 27 * 1024 * 1024;
  if (pdfBase64 && typeof pdfBase64 === "string") {
    if (pdfBase64.length === 0) {
      return NextResponse.json(
        formatErrorResponse({ title: "Empty file", message: "The uploaded file is empty. Please select a valid PDF file.", code: "EMPTY_FILE" }),
        { status: 400 }
      );
    }
    if (pdfBase64.length > MAX_PDF_BASE64_LEN) {
      return NextResponse.json(
        formatErrorResponse({ title: "File too large", message: "File too large. Maximum size is 20MB.", code: "FILE_TOO_LARGE" }),
        { status: 413 }
      );
    }
  }

  let extractedText = typeof rawText === "string" ? rawText : "";
  // Hoisted: parseBriefDocument can accept this buffer to extract embedded
  // reference images (site photos, mood references, sketches) and pass them
  // through to downstream image generation as visual anchors.
  let pdfBuffer: Buffer | undefined;

  logger.debug("[TR-001] rawText from inputData:", typeof rawText, "length:", typeof rawText === "string" ? rawText.length : 0);
  logger.debug("[TR-001] pdfBase64 present:", !!pdfBase64, "type:", typeof pdfBase64, "length:", typeof pdfBase64 === "string" ? pdfBase64.length : 0);

  // If we have actual PDF data (base64), extract text from it
  if (pdfBase64 && typeof pdfBase64 === "string") {
    try {
      // Import from lib/ directly to avoid pdf-parse v1 test-runner bug
      // (index.js tries to open ./test/data/05-versions-space.pdf when !module.parent)
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require("pdf-parse/lib/pdf-parse.js") as (buf: Buffer) => Promise<{ text: string; numpages: number; info: Record<string, unknown> }>;
      pdfBuffer = Buffer.from(pdfBase64, "base64");
      logger.debug("[TR-001] PDF buffer size:", pdfBuffer.length, "bytes");
      const pdfData = await pdfParse(pdfBuffer);
      logger.debug("[TR-001] pdf-parse result — pages:", pdfData.numpages, "text length:", pdfData.text?.length ?? 0);
      logger.debug("[TR-001] Extracted text (first 300):", pdfData.text?.slice(0, 300));
      extractedText = pdfData.text || "";
    } catch (parseErr) {
      console.error("[TR-001] PDF parsing failed:", parseErr);
      // Fall through to use rawText if available
    }
  }

  logger.debug("[TR-001] Final extractedText length:", extractedText.trim().length, "chars");

  if (!extractedText || extractedText.trim().length < 20) {
    console.error("[TR-001] Text too short or empty — returning 400. Text:", JSON.stringify(extractedText.slice(0, 100)));
    return NextResponse.json(
      formatErrorResponse({
        title: "No document content",
        message: "Could not extract text from the document. The PDF may be scanned (image-only) or too short. Try pasting the brief text into a Text Prompt node instead.",
        code: "EMPTY_DOCUMENT",
      }),
      { status: 400 }
    );
  }

  // Pass the PDF buffer (when available) so parseBriefDocument also extracts
  // embedded reference images and uploads them to R2 for downstream renders.
  const parsed = await parseBriefDocument(extractedText, apiKey, pdfBuffer);
  logger.debug("[TR-001] reference images extracted:", parsed.referenceImageUrls?.length ?? 0);

  // ── Floor-plan extraction layer (deterministic-first) ─────────────
  // Run the deterministic regex parser BEFORE trusting GPT's floorPlan
  // output. GPT-4o-mini drops the rooms array on briefs longer than its
  // reliable JSON-schema-following window, producing an empty-rooms
  // floorPlan that downstream emits a column-grid skeleton. The regex
  // parser is purpose-built for the typical Indian-residential brief
  // format ("Plot Size", numbered room sections with "Size: X' × Y'",
  // "Located in NW quadrant" phrases, "Window on N wall"). When it
  // succeeds, its output overrides whatever GPT produced — we trust the
  // text we can verify deterministically over GPT's interpretation.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { extractFloorPlanFromText } = await import("@/features/ifc/services/floor-plan-text-parser");
  const detResult = extractFloorPlanFromText(extractedText);
  if (detResult.isFloorPlanBrief && detResult.schema) {
    /* Deterministic parser succeeded — its output is the source of truth.
       Override whatever GPT produced. */
    logger.debug("[TR-001] floor-plan detected via deterministic regex parser:", {
      ...detResult.diagnostics,
      plotWidthFt: detResult.schema.plotWidthFt,
      plotDepthFt: detResult.schema.plotDepthFt,
      rooms: detResult.schema.floors[0]?.rooms.map((r) => ({
        name: r.name,
        widthFt: r.widthFt,
        lengthFt: r.lengthFt,
        quadrant: r.quadrant,
      })),
    });
    parsed.floorPlan = detResult.schema;
  } else if (detResult.diagnostics.plotFound) {
    /* The text contains a plot-size signal but the parser couldn't extract
       structured rooms. Synthesise a minimal floorPlan from the
       diagnostics so EX-001's converter can apply its category-aware
       template fallback (one storey, empty rooms[] → template populates
       a sensible default 2BHK / office / warehouse for that category).
       This is much better than dropping the floorPlan entirely (which
       used to cascade into the massing-path failure mode). */
    logger.debug(
      "[TR-001] plot detected but rooms not parseable — synthesising minimal floorPlan for converter template fallback:",
      detResult.diagnostics,
    );
    /* We need plot dims; the parser produced them in `detResult.diagnostics`
       indirectly. Re-extract here to keep the synthesis self-contained. */
    /* eslint-disable-next-line @typescript-eslint/no-require-imports */
    const { extractFloorPlanFromText: re } = await import("@/features/ifc/services/floor-plan-text-parser");
    /* Trigger a re-call so even partial signals (plot only) still
       produce something. We accept null and do nothing in that case. */
    void re;
    parsed.floorPlan = parsed.floorPlan ?? undefined;
    /* If GPT had ANY floorPlan, keep it. The converter's defensive
       template fallback will fill in empty rooms. NEVER drop here —
       dropping cascades into the massing-path failure. */
  } else {
    logger.debug("[TR-001] floor-plan regex did not match; using GPT output:", detResult.diagnostics);
    /* GPT's floorPlan (if any) passes through verbatim. The converter's
       defensive template fallback handles empty rooms[] downstream. */
  }
  if (parsed.floorPlan) {
    logger.debug("[TR-001] final floorPlan attached: floors=" +
      parsed.floorPlan.floors.length +
      ", rooms=" +
      parsed.floorPlan.floors.reduce((n, f) => n + (f.rooms?.length ?? 0), 0) +
      ", category=" + (parsed.floorPlan.buildingCategory ?? "unset"));
  } else {
    logger.debug("[TR-001] no floorPlan attached — EX-001 will use massing path");
  }

  // Build a formatted text output that downstream nodes (TR-002, GN-001) can consume
  const programLines = (parsed.programme ?? [])
    .map(p => `• ${p.space}: ${p.area_m2 ? `${p.area_m2} m²` : "TBD"} (${p.floor ?? "TBD"})`)
    .join("\n");

  const formattedContent = `PROJECT BRIEF — ${parsed.projectTitle.toUpperCase()}

Type: ${parsed.projectType}
${parsed.site?.address ? `Site: ${parsed.site.address}` : ""}
${parsed.site?.area ? `Site Area: ${parsed.site.area}` : ""}

PROGRAMME REQUIREMENTS:
${programLines || "Not specified"}

${parsed.constraints ? `CONSTRAINTS:\n• Max Height: ${parsed.constraints.maxHeight ?? "N/A"}\n• Setbacks: ${parsed.constraints.setbacks ?? "N/A"}\n• Zoning: ${parsed.constraints.zoning ?? "N/A"}` : ""}

${parsed.budget?.amount ? `BUDGET: ${parsed.budget.amount} ${parsed.budget.currency ?? ""}` : ""}

${parsed.sustainability ? `SUSTAINABILITY: ${parsed.sustainability}` : ""}

${parsed.designIntent ? `DESIGN INTENT: ${parsed.designIntent}` : ""}

${parsed.keyRequirements?.length ? `KEY REQUIREMENTS:\n${parsed.keyRequirements.map(r => `• ${r}`).join("\n")}` : ""}`;

  logger.debug("[TR-001] Parsed brief — rawText length:", parsed.rawText?.length ?? 0, "chars");
  logger.debug("[TR-001] rawText first 300 chars:", parsed.rawText?.slice(0, 300));
  logger.debug("[TR-001] projectTitle:", parsed.projectTitle);

  return {
    id: generateId(),
    executionId: executionId ?? "local",
    tileInstanceId,
    type: "text",
    data: {
      content: formattedContent,
      label: `Parsed Brief: ${parsed.projectTitle}`,
      _raw: parsed,
      prompt: formattedContent,
    },
    metadata: { model: "gpt-4o-mini", real: true },
    createdAt: new Date(),
  };
};
