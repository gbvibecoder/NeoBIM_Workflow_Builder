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

  // ── Slice P3.1.B — Multi-layer PDF text extraction ──────────────────
  // The previous implementation called `pdf-parse` directly inside a
  // try/catch. When `pdf-parse` threw (it does, frequently — modern
  // PDFs with PostScript token sequences > 128 chars crash its
  // tokenizer with `UnknownErrorException: Command token too long`),
  // the catch silently fell through to `rawText`, which for an upload
  // is just the filename (~20 chars). The empty-content gate below
  // used `< 20`, so a 20-char filename ("floor_plan_brief.pdf") slipped
  // through and got passed to GPT-4o-mini, which hallucinated default
  // plot dimensions (164×164 ft = 50m × 50m), room counts, and a
  // project name ("Urban Residential Development"). Every downstream
  // node operated on fabricated data.
  //
  // The replacement extractor (`src/lib/pdf-text-extractor.ts`)
  // chains three layers:
  //   Layer 1 — unpdf  (PDF.js-based, modern, ~95% success)
  //   Layer 2 — pdf-parse  (different engine; rescues some PDFs unpdf misses)
  //   Layer 3 — Claude vision-document (handles scanned & complex PDFs natively)
  // The result carries per-layer error captures so the failure mode is
  // visible in logs and so the gate below can fail loud instead of
  // letting hallucinations cascade.
  if (pdfBase64 && typeof pdfBase64 === "string") {
    pdfBuffer = Buffer.from(pdfBase64, "base64");
    logger.debug("[TR-001] PDF buffer size:", pdfBuffer.length, "bytes");
    const { extractTextFromPdf, summariseExtractResult } = await import(
      "@/lib/pdf-text-extractor"
    );
    const extracted = await extractTextFromPdf(pdfBuffer, {
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      enableVisionFallback: true,
    });
    logger.info(
      "[TR-001] pdf-extract " + summariseExtractResult(extracted),
    );
    if (extracted.text) {
      extractedText = extracted.text;
    } else {
      // All layers failed. Do NOT fall back to the filename / GPT.
      console.error(
        "[TR-001] All PDF extractors failed — surfacing clear error to UI",
        extracted.errors,
      );
      const errSummary = [
        extracted.errors.unpdf && `unpdf: ${extracted.errors.unpdf}`,
        extracted.errors.pdfParse && `pdf-parse: ${extracted.errors.pdfParse}`,
        extracted.errors.vision && `vision: ${extracted.errors.vision}`,
      ]
        .filter(Boolean)
        .join(" | ");
      return NextResponse.json(
        formatErrorResponse({
          title: "Could not read PDF",
          message:
            `The PDF could not be parsed by any of our text extractors. ` +
            `Try one of: (a) re-export the PDF as text-based from your tool ` +
            `(File → Export → PDF with selectable text), (b) paste the brief ` +
            `as plain text into a Text Prompt node, or (c) make sure the file ` +
            `is not password-protected.\n\nUnderlying parser errors: ${errSummary}`,
          code: "PDF_EXTRACTION_FAILED",
        }),
        { status: 422 },
      );
    }
  }

  logger.debug("[TR-001] Final extractedText length:", extractedText.trim().length, "chars");

  // Tightened threshold from 20 → 100 chars. The filename
  // "floor_plan_brief.pdf" is exactly 20 chars and used to slip
  // through the prior `< 20` gate; even a minimal real brief is
  // ≥ 100 chars. This is the *second* defense; the first is the
  // extractor's own `MIN_USEFUL_TEXT_CHARS=50` per-layer threshold.
  if (!extractedText || extractedText.trim().length < 100) {
    console.error("[TR-001] Text too short or empty — returning 422. Text:", JSON.stringify(extractedText.slice(0, 200)));
    return NextResponse.json(
      formatErrorResponse({
        title: "Brief content too short",
        message:
          "Extracted text from the document is too short to parse a brief " +
          `(${extractedText.trim().length} chars). The PDF may be scanned, ` +
          "image-only, or password-protected. Try pasting the brief text " +
          "into a Text Prompt node instead.",
        code: "BRIEF_TOO_SHORT",
      }),
      { status: 422 }
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
  // Slice P3.1.B — Defense-in-depth: sanity-check the final plot dims.
  // GPT-4o-mini has been observed to hallucinate plot dimensions of
  // 164.04 × 164.04 ft (exactly 50 m × 50 m in feet) when given empty
  // or near-empty text. That's outside any realistic residential plot
  // (typical Indian 1/2/3 BHK plots are 20–80 ft per side). When such
  // values land in the floorPlan, the design-agent matcher correctly
  // refuses, fallback fires, and the user sees a thin generic IFC.
  // Here we override hallucinated plot dims by re-extracting from the
  // original text via the deterministic regex parser as a final source
  // of truth — its regex is highly specific and won't hallucinate.
  if (parsed.floorPlan) {
    const MAX_RESIDENTIAL_PLOT_FT = 100;
    const looksHallucinated =
      parsed.floorPlan.plotWidthFt > MAX_RESIDENTIAL_PLOT_FT ||
      parsed.floorPlan.plotDepthFt > MAX_RESIDENTIAL_PLOT_FT ||
      Math.abs(parsed.floorPlan.plotWidthFt - parsed.floorPlan.plotDepthFt) < 0.1; // suspicious perfect square
    if (looksHallucinated) {
      logger.warn(
        "[TR-001] floorPlan plot dims look hallucinated " +
          `(width=${parsed.floorPlan.plotWidthFt}, depth=${parsed.floorPlan.plotDepthFt}); ` +
          "re-extracting from raw text",
      );
      const retry = extractFloorPlanFromText(extractedText);
      if (retry.schema) {
        parsed.floorPlan = {
          ...parsed.floorPlan,
          plotWidthFt: retry.schema.plotWidthFt,
          plotDepthFt: retry.schema.plotDepthFt,
        };
        logger.info(
          "[TR-001] plot dims overridden by deterministic re-extraction: " +
            `${retry.schema.plotWidthFt} × ${retry.schema.plotDepthFt} ft`,
        );
      } else {
        logger.warn(
          "[TR-001] deterministic re-extraction also failed — leaving " +
            "hallucinated values; downstream matcher will refuse (expected)",
        );
      }
    }
    logger.debug("[TR-001] final floorPlan attached: floors=" +
      parsed.floorPlan.floors.length +
      ", rooms=" +
      parsed.floorPlan.floors.reduce((n, f) => n + (f.rooms?.length ?? 0), 0) +
      ", category=" + (parsed.floorPlan.buildingCategory ?? "unset") +
      ", plot=" + parsed.floorPlan.plotWidthFt + "×" + parsed.floorPlan.plotDepthFt + " ft");
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
