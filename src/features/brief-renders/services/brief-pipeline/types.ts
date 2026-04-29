/**
 * Brief-to-Renders pipeline — canonical types.
 *
 * Phase 1 introduces type STUBS only. No runtime logic lives here.
 * Phases 2-5 fill in the matching Zod schemas, prompts, and orchestrators.
 *
 * ─── Strict-faithfulness contract (load-bearing) ─────────────────────────
 *
 * Every leaf field on `BriefSpec` (and its nested types) is nullable.
 * The Phase 2 spec extractor's tool definition forces the LLM to set
 * fields to `null` rather than invent values when the source brief is
 * silent. Phase 3 prompt-gen is deterministic — empty/null fields produce
 * empty prompt fragments, never hallucinated descriptors.
 *
 * Do NOT widen these types with non-nullable leaves later. Adding a
 * required field is the failure mode this contract prevents — it forces
 * the extractor to invent values, defeating the whole pipeline.
 */

// ─── Spec — the parsed brief ─────────────────────────────────────────────

/**
 * Project-wide visual baseline pulled from the brief's "general guidance"
 * sections. Applied to every shot's prompt as a prefix.
 */
export interface BaselineSpec {
  /** e.g. "photorealistic interior", "editorial residential" */
  visualStyle: string | null;
  /** Material palette — explicit text from brief, never invented. */
  materialPalette: string | null;
  /** Lighting baseline — e.g. "soft daylight, warm accents". */
  lightingBaseline: string | null;
  /** Camera baseline — e.g. "eye-level, wide-angle 24mm". */
  cameraBaseline: string | null;
  /** Render quality target — e.g. "high-end real-estate listing". */
  qualityTarget: string | null;
  /** Free-form additional notes from the brief's preamble. */
  additionalNotes: string | null;
}

/**
 * One apartment / unit within the brief. A brief typically covers
 * several apartments; each apartment has its own nested shot list.
 *
 * Phase 3 structural correction: shots are nested under each apartment.
 * Phase 1 originally stored shots flat at the BriefSpec level, which
 * made shot→apartment correlation impossible. The flat-shots design
 * was a Phase 1 oversight; Phase 3 corrects it before Phase 4's image
 * generator needs the apartment context for prompt assembly.
 */
export interface ApartmentSpec {
  /** Apartment label as it appears in the brief — e.g. "Apartment A". */
  label: string | null;
  /** German label if the brief is bilingual — e.g. "Wohnung A". */
  labelDe: string | null;
  /** Total floor area in square metres. */
  totalAreaSqm: number | null;
  /** Bedroom count. */
  bedrooms: number | null;
  /** Bathroom count. */
  bathrooms: number | null;
  /** Free-form description specific to this apartment. */
  description: string | null;
  /**
   * Shots belonging to this apartment, in source order. Always an array
   * (possibly empty for apartments whose source listing has no shots).
   */
  shots: ShotSpec[];
}

/**
 * One shot within an apartment. A typical brief has 4 shots per apartment
 * (e.g. living, kitchen, bedroom, bathroom).
 *
 * `null` here means: the brief did not specify this field. Phase 3 prompt
 * generation will simply omit the corresponding fragment from the image
 * prompt — never substitute a default.
 */
export interface ShotSpec {
  /** 1-based shot index within the apartment. */
  shotIndex: number | null;
  /** Room name — English. */
  roomNameEn: string | null;
  /** Room name — German (bilingual deliverable). */
  roomNameDe: string | null;
  /** Room area in square metres (per the brief). */
  areaSqm: number | null;
  /** Aspect ratio for the rendered image — e.g. "16:9", "3:2". */
  aspectRatio: string | null;
  /** Lighting description specific to this shot. */
  lightingDescription: string | null;
  /** Camera notes specific to this shot — angle, focal length, height. */
  cameraDescription: string | null;
  /** Materials override for this shot (if brief specifies). */
  materialNotes: string | null;
  /**
   * Hero shot flag. The first shot of each apartment is typically the
   * hero — the cover-page image. Brief explicitly marks these.
   */
  isHero: boolean | null;
}

/**
 * Full parsed brief — the output of Phase 2.
 *
 * Phase 3 shape correction: shots are no longer a top-level array; they
 * are nested under each `ApartmentSpec`. To enumerate every shot in
 * source order, callers use `spec.apartments.flatMap(a => a.shots)`.
 */
export interface BriefSpec {
  /** Project title as stated in the brief. */
  projectTitle: string | null;
  /** Project location — city / district / address as stated. */
  projectLocation: string | null;
  /** Project type — e.g. "residential", "mixed-use". */
  projectType: string | null;
  /** Project-wide visual baseline. */
  baseline: BaselineSpec;
  /**
   * Apartments / units covered by the brief, in source order. Each
   * apartment carries its own nested `shots` array.
   */
  apartments: ApartmentSpec[];
  /** R2 URLs of reference images extracted from the brief (if any). */
  referenceImageUrls: string[];
}

// ─── Per-shot rendering result ───────────────────────────────────────────

/**
 * Status machine for one shot inside `BriefRenderJob.shots`.
 */
export type ShotStatus = "pending" | "running" | "success" | "failed";

/**
 * One entry in `BriefRenderJob.shots`. The Phase 4 worker rewrites this
 * array in-place as each shot completes; the client polls for progress.
 *
 * Phase 3 created the bulk of these fields when Stage 2 (prompt-gen)
 * runs. Phase 4 fills in `imageUrl`, `errorMessage`, `costUsd`,
 * `startedAt`, `completedAt` as each shot is dispatched and resolved.
 */
export interface ShotResult {
  /**
   * 0-based global shot index across the entire job (running counter
   * over `apartments.flatMap(a => a.shots)`). Stable identifier — the
   * Phase 4 worker uses this to look up shots when persisting progress.
   */
  shotIndex: number;
  /**
   * 0-based index of the parent apartment in `BriefSpec.apartments`.
   * Nullable for forward-compat with Phase 1-vintage rows; new rows
   * always populate it.
   */
  apartmentIndex: number | null;
  /**
   * 0-based index of this shot within its apartment's shots[] array.
   * Used by Phase 5's PDF compile to render `Shot 1 of 4`-style headers.
   */
  shotIndexInApartment: number;
  /** Lifecycle. */
  status: ShotStatus;
  /** Deterministic prompt assembled in Phase 3 Stage 2. */
  prompt: string;
  /**
   * Aspect ratio for this shot's image — derived from `ShotSpec.aspectRatio`
   * or the structural fallback default `"3:2"` when source is silent.
   */
  aspectRatio: string;
  /**
   * Prompt-template version — bumped when `image-prompt-template.ts`
   * changes shape. Lets Phase 4 invalidate caches if the template
   * evolves between job creation and image gen.
   */
  templateVersion: string;
  /** R2 URL of the rendered image (set when status === "success"). */
  imageUrl: string | null;
  /** Error message (set when status === "failed"). */
  errorMessage: string | null;
  /** Cost in USD for this shot's image generation call. */
  costUsd: number | null;
  /**
   * ISO timestamp of when this `ShotResult` row was created (Stage 2).
   * Distinct from `startedAt` (image gen dispatch).
   */
  createdAt: string;
  /** ISO timestamp when image gen was first dispatched (Phase 4). */
  startedAt: string | null;
  /** ISO timestamp when this shot reached a terminal state. */
  completedAt: string | null;
}

// ─── Pipeline configuration & stage log ──────────────────────────────────

/**
 * Per-job configuration. Set at job creation; immutable afterwards.
 */
export interface BriefRenderJobConfig {
  /** Originating user. */
  userId: string;
  /** Idempotency key — the same `requestId` is rejected on retry. */
  requestId: string;
  /** R2 URL of the input brief (PDF or DOCX). */
  briefUrl: string;
  /** Brief filename (display only). */
  briefFileName: string;
  /** Brief MIME type — `application/pdf` or DOCX. */
  briefMimeType: string;
  /** Brief size in bytes. */
  briefFileSize: number;
}

/**
 * One entry in `BriefRenderJob.stageLog`. Mirrors VIP's `StageLogEntry`.
 * Persisted by an atomic replace on every stage transition so the client
 * can poll and render incremental progress.
 */
export interface BriefStageLogEntry {
  /** 1-based stage number (1 = spec extract, 2 = prompt gen, …). */
  stage: number;
  /** Human-readable stage name — e.g. "Spec Extract". */
  name: string;
  /** Lifecycle. */
  status: "running" | "success" | "failed";
  /** ISO timestamp when the stage began (empty until logged). */
  startedAt: string;
  /** ISO timestamp when the stage finished (null while running). */
  completedAt: string | null;
  /** Wall-clock duration in milliseconds (null while running). */
  durationMs: number | null;
  /** Cost in USD attributable to this stage. */
  costUsd: number | null;
  /** Short summary for the UI's stage row. */
  summary: string | null;
  /** Optional structured output (per-stage shape). */
  output: Record<string, unknown> | null;
  /** Error message (set when status === "failed"). */
  error: string | null;
}

// ─── Phase 5 — PDF compile types (additive) ──────────────────────────────

/**
 * Discriminated-union result for `runStage4PdfCompile`. Mirrors the
 * Phase 4 `Stage3Result` shape for symmetry across stages.
 */
export type Stage4Result =
  | {
      status: "success";
      pdfUrl: string;
      pageCount: number;
      pdfSizeBytes: number;
      costUsd: 0;
    }
  | {
      status: "skipped";
      reason: "job_not_ready" | "missing_shots" | "already_compiled";
    }
  | { status: "failed"; error: string };

/**
 * Persisted-on-the-job summary of a successful compile. Phase 5 stores
 * `pdfUrl` directly on `BriefRenderJob.pdfUrl`; this struct is the
 * shape returned to the worker route's response body.
 */
export interface CompiledPdfArtifact {
  pdfUrl: string;
  pageCount: number;
  pdfSizeBytes: number;
  /** ISO timestamp when the compile completed. */
  compiledAt: string;
}
