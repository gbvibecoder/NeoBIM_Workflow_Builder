/**
 * Zod schemas for Brief-to-Renders LLM output validation.
 *
 * Strict-faithfulness contract (load-bearing for the whole pipeline):
 *   • Every leaf field is `.nullable()` — Claude is instructed to set
 *     fields to `null` when the source brief is silent.
 *   • Every object is `.strict()` — invented keys at any nesting level
 *     are rejected at parse time, not silently stripped.
 *   • Fields are wrapped in `.nullable().optional().transform(v => v ?? null)`
 *     so Claude can omit them entirely (a common Sonnet behaviour) and
 *     the parsed output still ships a clean `T | null` shape.
 *
 * The inferred types must remain assignable to the Phase 1 stub types
 * in `./types.ts`. The compile-time `_assertAssignable*` lines at the
 * bottom of this file enforce that — modify the stub or the schema and
 * the build breaks loudly.
 *
 * Mirrors the discipline of `src/features/floor-plan/lib/vip-pipeline/schemas.ts`
 * but uses tighter nullable handling because the strict-faithfulness rule
 * forbids any defaulted leaf values (VIP can default `adjacencies: []`;
 * Brief-to-Renders cannot default the source-derived fields).
 */

import { z } from "zod";

import type {
  ApartmentSpec,
  BaselineSpec,
  BriefSpec,
  ShotSpec,
} from "./types";

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Leaf primitive schema with the canonical nullable+optional+normalise
 * dance. `undefined` (key omitted) is normalised to `null` so the parsed
 * output is always `T | null`.
 */
function nullableLeaf<T>(inner: z.ZodType<T>): z.ZodType<T | null> {
  return inner
    .nullable()
    .optional()
    .transform((v): T | null => (v === undefined ? null : v));
}

const nullableString = nullableLeaf(z.string());
const nullableNumber = nullableLeaf(z.number());

/**
 * `is_hero` / `isHero` — sanctioned non-null default. Per the
 * strict-faithfulness contract, leaves default to `null`. This boolean
 * is the lone exception: it's a STRUCTURAL flag (Claude derives it
 * from "is this the first shot under an apartment's section header"),
 * not a material attribute that could be invented. Normalising
 * `null` → `false` keeps downstream prompt-gen logic clean (it would
 * otherwise need to treat `null` as "not hero").
 */
const isHeroSchema: z.ZodType<boolean> = z
  .boolean()
  .nullable()
  .optional()
  .transform((v): boolean => v ?? false);

// ─── Spec Schemas ───────────────────────────────────────────────────

export const BaselineSpecSchema = z
  .object({
    visualStyle: nullableString,
    materialPalette: nullableString,
    lightingBaseline: nullableString,
    cameraBaseline: nullableString,
    qualityTarget: nullableString,
    additionalNotes: nullableString,
  })
  .strict();

export const ShotSpecSchema = z
  .object({
    shotIndex: nullableNumber,
    roomNameEn: nullableString,
    roomNameDe: nullableString,
    areaSqm: nullableNumber,
    aspectRatio: nullableString,
    lightingDescription: nullableString,
    cameraDescription: nullableString,
    materialNotes: nullableString,
    isHero: isHeroSchema,
  })
  .strict();

/**
 * Phase 3 structural correction: shots are nested under each apartment.
 * `shots` is a non-nullable array (zero-shot apartments must explicitly
 * return `[]`, not omit the key). `.strict()` rejects invented per-
 * apartment fields at parse time.
 */
export const ApartmentSpecSchema = z
  .object({
    label: nullableString,
    labelDe: nullableString,
    totalAreaSqm: nullableNumber,
    bedrooms: nullableNumber,
    bathrooms: nullableNumber,
    description: nullableString,
    shots: z.array(ShotSpecSchema),
  })
  .strict();

/**
 * Phase 3: shots are no longer at the BriefSpec level. To enumerate all
 * shots in source order, callers use `spec.apartments.flatMap(a => a.shots)`.
 */
export const BriefSpecSchema = z
  .object({
    projectTitle: nullableString,
    projectLocation: nullableString,
    projectType: nullableString,
    baseline: BaselineSpecSchema,
    apartments: z.array(ApartmentSpecSchema),
    referenceImageUrls: z.array(z.string()),
  })
  .strict();

// ─── Inferred types ─────────────────────────────────────────────────

export type ZBaselineSpec = z.infer<typeof BaselineSpecSchema>;
export type ZApartmentSpec = z.infer<typeof ApartmentSpecSchema>;
export type ZShotSpec = z.infer<typeof ShotSpecSchema>;
export type ZBriefSpec = z.infer<typeof BriefSpecSchema>;

// ─── Compile-time assertion: inferred types ⊆ Phase 1 stub types ────
//
// The Phase 1 stubs in `./types.ts` are the public contract. The Zod
// schemas above MUST produce values assignable to those stubs. If you
// change either side and the assignment becomes invalid, this file
// stops compiling — no silent drift between schema and types.

type AssertAssignable<T extends U, U> = true;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _AssertBaseline = AssertAssignable<ZBaselineSpec, BaselineSpec>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _AssertApartment = AssertAssignable<ZApartmentSpec, ApartmentSpec>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _AssertShot = AssertAssignable<ZShotSpec, ShotSpec>;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _AssertBrief = AssertAssignable<ZBriefSpec, BriefSpec>;

// ─── Zod → JSON Schema (Anthropic tool input_schema) ────────────────

/**
 * Convert our top-level Brief Spec schema to a JSON Schema object
 * suitable for the Anthropic `tools[].input_schema` field. Uses Zod 4's
 * built-in `z.toJSONSchema()` — no `zod-to-json-schema` dep required.
 *
 * Options:
 *   • `io: "input"` — emit the *input* shape (with `.optional()` keys
 *     surfaced as not-required). The default `"output"` would emit the
 *     post-transform shape, which has the optional keys merged into the
 *     required set — wrong direction for telling Claude what to send.
 *   • `unrepresentable: "any"` — our `.transform()` chain (used by
 *     `nullableLeaf` to coerce `undefined` → `null`) is intentionally
 *     not representable in JSON Schema; we don't want it serialised.
 *
 * Returned shape is `Record<string, unknown>` because Anthropic's tool
 * input_schema typing is intentionally permissive at the SDK boundary.
 * Callers cast to `Anthropic.Tool["input_schema"]` at the use site.
 */
export function briefSpecJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(BriefSpecSchema, {
    io: "input",
    unrepresentable: "any",
  }) as Record<string, unknown>;
}
