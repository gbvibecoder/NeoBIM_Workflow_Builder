/**
 * Typed contracts for the Brief-to-IFC v2 canvas pipeline.
 *
 *   IN-002 ──▶ TR-024 Brief Enricher ──▶ TR-022 IFC Architect ──▶ EX-006 AI IFC Generator
 *
 * Each node writes a private `_`-prefixed field onto `artifact.data` that
 * the next node consumes. Zod is the single source of truth for those
 * shapes: it validates the two *untrusted* boundaries — the Opus `tool_use`
 * payload and the Railway sandbox HTTP response — and the inferred types
 * give the handlers a no-`any` contract for the artifact data they build.
 */

import { z } from "zod";

// ─── TR-024 → TR-022 ────────────────────────────────────────────────
//
// TR-024 writes `data.content` (the enriched markdown spec) + this
// observability block under `data._enriched`.

export const EnrichedBriefDataSchema = z.object({
  /** Character count of the raw brief text fed to the enricher. */
  sourceCharCount: z.number().int().nonnegative(),
  /** Character count of the enriched markdown spec the enricher produced. */
  enrichedCharCount: z.number().int().nonnegative(),
  /** How the source brief reached the enricher. */
  sourceFormat: z.enum(["pdf", "docx", "text"]),
  /** Section / item labels the enricher flagged as `[INFERRED]` (not
   *  stated in the source brief). Empty when the brief was fully surgical. */
  inferredFlags: z.array(z.string()),
});
export type EnrichedBriefData = z.infer<typeof EnrichedBriefDataSchema>;

// ─── TR-022 → EX-006 ────────────────────────────────────────────────
//
// The Opus 4.7 `submit_ifc_builder_script` tool input. Validated against
// this schema before TR-022 trusts the LLM output. Stored verbatim on
// `data._script` for EX-006 to consume.

export const ArchitectElementEmittedSchema = z.object({
  /** IFC class the architect's script emits, e.g. "IfcWall". */
  class: z.string().min(1),
  /** How many instances of that class the script emits. */
  count: z.number().int().nonnegative(),
});
export type ArchitectElementEmitted = z.infer<
  typeof ArchitectElementEmittedSchema
>;

export const ArchitectScriptDataSchema = z.object({
  /** The IfcOpenShell Python script. Writes `output.ifc` to its cwd. */
  python_code: z.string().min(1),
  /** The architect's own estimate of total IFC entities the script emits. */
  expected_entity_count: z.number().int().nonnegative(),
  /** One-paragraph human summary of what the script builds. */
  summary: z.string().min(1),
  /** Per-IFC-class emission breakdown the architect committed to. */
  elements_emitted: z.array(ArchitectElementEmittedSchema),
});
export type ArchitectScriptData = z.infer<typeof ArchitectScriptDataSchema>;

/**
 * JSON Schema for the Anthropic `submit_ifc_builder_script` tool.
 * Hand-written to mirror `ArchitectScriptDataSchema` exactly (the repo
 * has no zod-to-json-schema dependency — same approach as
 * `brief-renders/.../schemas.ts` `briefSpecJsonSchema()`).
 */
export function submitIfcBuilderScriptJsonSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      python_code: {
        type: "string",
        description:
          "Complete, runnable IfcOpenShell 0.8 Python script. When executed " +
          "with `python script.py` it MUST write a single valid IFC file to " +
          "a file named exactly `output.ifc` in the current working directory. " +
          "Standard library + `ifcopenshell` only — no network, no third-party " +
          "packages, no `app.*` imports.",
      },
      expected_entity_count: {
        type: "integer",
        description:
          "Your own estimate of the total number of IFC entities the script " +
          "will emit (sum across all classes). Used as a sanity signal — be honest.",
      },
      summary: {
        type: "string",
        description:
          "One-paragraph plain-English summary of what the script builds: " +
          "spatial hierarchy, element classes, materials, styling.",
      },
      elements_emitted: {
        type: "array",
        description:
          "Per-IFC-class emission breakdown — one entry per distinct IFC class " +
          "the script emits, with the instance count for that class.",
        items: {
          type: "object",
          properties: {
            class: {
              type: "string",
              description: "IFC class name, e.g. 'IfcWall', 'IfcSpace'.",
            },
            count: {
              type: "integer",
              description: "Number of instances of this class the script emits.",
            },
          },
          required: ["class", "count"],
          additionalProperties: false,
        },
      },
    },
    required: [
      "python_code",
      "expected_entity_count",
      "summary",
      "elements_emitted",
    ],
    additionalProperties: false,
  };
}

// ─── EX-006 output ──────────────────────────────────────────────────
//
// EX-006 POSTs the script to the Railway sandbox and validates the
// response against this schema before building its artifact.

export const SandboxLogSchema = z.object({
  stdout_tail: z.string(),
  stderr_tail: z.string(),
  exit_code: z.number().int(),
});
export type SandboxLog = z.infer<typeof SandboxLogSchema>;

export const SandboxAuditSchema = z.object({
  /** Total IFC entities counted in the generated file. */
  total_entities: z.number().int().nonnegative(),
  /** Per-IFC-class instance counts (the `by_type` map from audit_counter). */
  by_class: z.record(z.string(), z.number()),
});
export type SandboxAudit = z.infer<typeof SandboxAuditSchema>;

export const ExecuteBuilderScriptResponseSchema = z.object({
  status: z.enum(["success", "failed"]),
  ifc_url: z.string().nullable().optional(),
  ifc_size_bytes: z.number().int().nullable().optional(),
  entity_count: z.number().int().nullable().optional(),
  audit: SandboxAuditSchema.nullable().optional(),
  execution_time_ms: z.number().int().nonnegative(),
  sandbox_log: SandboxLogSchema,
  error: z
    .object({ code: z.string(), message: z.string() })
    .nullable()
    .optional(),
});
export type ExecuteBuilderScriptResponse = z.infer<
  typeof ExecuteBuilderScriptResponseSchema
>;

/** Shape stored on EX-006's `artifact.data._ifc` for downstream / UI use. */
export const IfcGenerationDataSchema = z.object({
  /** Total IFC entity count in the generated file. */
  entityCount: z.number().int().nonnegative(),
  /** Entity audit from the Python sandbox (`audit_counter.audit_model`). */
  audit: SandboxAuditSchema,
  /** Tail of the sandbox subprocess stdout/stderr + exit code. */
  sandboxLog: SandboxLogSchema,
  /** The architect's own expected entity count, for an at-a-glance delta. */
  expectedEntityCount: z.number().int().nonnegative(),
});
export type IfcGenerationData = z.infer<typeof IfcGenerationDataSchema>;
