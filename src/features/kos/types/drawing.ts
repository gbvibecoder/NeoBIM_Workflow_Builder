/**
 * KOS drawing-parser DTOs (Week 5C-1, Phase 1).
 *
 * These types mirror the Python sidecar's `/kos/parse-drawing` JSON
 * response EXACTLY (see `app/routers/kos_drawing_parser.py`). Keep them in
 * lock-step: a field added on one side must be added on the other, or the
 * parse will silently drop data.
 *
 * Phase 1 is DXF-only. `DrawingFormat` widens to include `"pdf"` in 5C-2.
 */

/**
 * Upload format the sidecar's `/kos/parse-drawing` accepts on the wire.
 *
 * Originally `"dxf"`-only (5C-1, Phase 1). 5I PR 2a widens to include
 * `"pdf"` because 5C-2 shipped on the Python side — see
 * `temp_folder/pdf-probe/REPORT.md` which captured 200-OK responses with
 * `format: "pdf"` against real customer setout plans.
 *
 * DWG is still converted locally first (no DWG support upstream).
 */
export type DrawingFormat = "dxf" | "pdf";

/**
 * 5I PR 1 — superset of DrawingFormat for the customer-side upload
 * pipeline. DrawingFormat (above) is the sidecar's wire contract
 * (DXF-only in Phase 1); DRAWING_SOURCE_FORMATS is the set of file
 * shapes a customer can attach to a chat (DXF native, DWG converted,
 * PDF parsed in PR 2 via Vision, PNG/JPG handled as raster references).
 *
 * The two types intentionally diverge in PR 1 and reconcile in PR 2
 * when the bot's `process_drawing` tool routes each source format to
 * the right parser branch.
 */
export const DRAWING_SOURCE_FORMATS = [
  "dxf",
  "dwg",
  "pdf",
  "png",
  "jpg",
  "jpeg",
] as const;
export type DrawingSourceFormat = (typeof DRAWING_SOURCE_FORMATS)[number];

/** Type guard — narrow unknown user input to a valid DrawingSourceFormat. */
export function isDrawingSourceFormat(x: unknown): x is DrawingSourceFormat {
  return (
    typeof x === "string" &&
    (DRAWING_SOURCE_FORMATS as readonly string[]).includes(x)
  );
}

/** Drawing classification produced by the heuristic classifier. */
export type DrawingType =
  | "FLOOR_PLAN"
  | "ELEVATION"
  | "SECTION"
  | "DETAIL"
  | "TITLE_SHEET"
  | "UNKNOWN";

/** Which wall-detection tier fired (1 strongest … 4 last-resort). */
export type DetectionTier = 1 | 2 | 3 | 4;

/** A single detected wall. Coordinates + lengths are in millimetres. */
export interface WallDto {
  id: string;
  start: [number, number];
  end: [number, number];
  length_mm: number;
  thickness_mm: number | null;
  angle_degrees: number;
  layer: string;
  detection_tier: DetectionTier;
  confidence: number;
}

/** A point where wall endpoints meet. */
export interface JunctionDto {
  point: [number, number];
  type: "CORNER" | "T_JOIN" | "X_JOIN" | "END";
  wall_count: number;
  wall_ids: string[];
}

/** Title-block metadata. Every field is nullable — drawings vary wildly. */
export interface TitleBlockDto {
  project_name: string | null;
  drawing_number: string | null;
  drawing_title: string | null;
  revision: string | null;
  scale: string | null;
  date: string | null;
  sheet: string | null;
  level: string | null;
  client: string | null;
  drawn_by: string | null;
  checked_by: string | null;
  raw_text_block: string;
  source: "title_block" | "filename" | "mixed" | "none";
  extraction_warnings: string[];
}

/** Bounding box of all geometric entities (drawing units). */
export interface DrawingBounds {
  min_x: number;
  min_y: number;
  max_x: number;
  max_y: number;
}

/** Entity + extraction counts. */
export interface DrawingStats {
  total_entities: number;
  walls_count: number;
  junctions_count: number;
  title_block_fields_extracted: number;
  lines: number;
  polylines: number;
  text: number;
  dimensions: number;
  circles: number;
  blocks: number;
}

/** Per-stage readiness — whether we have enough to drive downstream work. */
export interface DownstreamReady {
  boq: boolean;
  formwork: boolean;
  shop_drawings: boolean;
}

/** Full `/kos/parse-drawing` 200 response. */
export interface DrawingParseResult {
  filename: string;
  format: DrawingFormat;
  size_bytes: number;
  parser_version: string;
  phase: string;
  drawing_type: DrawingType;
  drawing_type_confidence: number;
  drawing_classification_signals: string[];
  drawing_classification_reasoning: string;
  title_block: TitleBlockDto;
  walls: WallDto[];
  junctions: JunctionDto[];
  /**
   * Openings (doors, windows) detected by the PDF parser (5C-2+).
   * Always present in the response shape; the DXF parser (5C-1) emits
   * an empty array. Sub-shape is intentionally `unknown` for now —
   * see `temp_folder/pdf-probe/REPORT.md` for example payloads.
   */
  openings: unknown[];
  layers_found: string[];
  drawing_bounds: DrawingBounds;
  units_detected: string;
  stats: DrawingStats;
  warnings: string[];
  detection_strategy_used: `tier_${DetectionTier}`;
  overall_confidence: number;
  field_confidences: {
    walls: number;
    title_block: number;
  };
  missing_data: string[];
  downstream_ready: DownstreamReady;
  duration_ms: number;
  debug_png_base64: string | null;
}

/** Error envelope returned by the sidecar on 4xx / 5xx. */
export interface DrawingParseError {
  error: string;
  message: string;
  traceback?: string | null;
}
