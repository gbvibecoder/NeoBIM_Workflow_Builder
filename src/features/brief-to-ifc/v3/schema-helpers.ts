/**
 * Brief-to-IFC v3 — schema tolerance helpers (Phase δ.1a).
 *
 * One uniform tolerance layer so `briefSpecSchema` coerces recoverable
 * malformed Opus output (wrong-scale RGB, near-miss enum strings,
 * missing optional components) instead of rejecting the whole spec.
 *
 * Tolerance ≠ accepting garbage. The core sections
 * (`project` / `site` / `spaces` / `elements` / `materials`) must
 * still validate as a whole — these helpers only recover field-level
 * deviations within those sections, and every recovery is recorded
 * into the active coercion context (see `telemetry.ts`) so we can
 * observe how often each tolerance fires.
 *
 * Helpers here use `superRefine` / `transform` on `z.unknown()` so the
 * caller can hand them whatever Opus emits — numbers as strings, RGB
 * as 0-255 ints, enum values with different casing — and get back the
 * canonical shape without throwing.
 */

import { z } from "zod";
import type { ZodType } from "zod";

import { recordCoercion } from "./telemetry";
import type { CoercionKind } from "./telemetry";

// ─── Opus-tool-schema hints ──────────────────────────────────────────
//
// Every tolerant helper wraps `z.unknown().transform(...)` for runtime
// tolerance. That choice loses the canonical schema shape — the
// `zod-to-opus-schema` converter only sees an opaque transform pipe
// and emits `{}`, which would tell Opus the field is unconstrained.
// To keep Opus's tool schema rigorous (so the model emits canonical
// values most of the time, with tolerance as a *recovery* layer, not
// the primary contract), each helper records the JSON-schema shape
// callers should advertise to Opus via the WeakMap below. The
// converter then reads the hint and emits the strict enum / number /
// tuple — schema-as-contract for Opus, tolerance-as-recovery at runtime.

const OPUS_SCHEMA_HINTS = new WeakMap<object, Record<string, unknown>>();

export function setOpusSchemaHint<S extends ZodType>(
  schema: S,
  hint: Record<string, unknown>,
): S {
  try {
    OPUS_SCHEMA_HINTS.set(schema as unknown as object, hint);
  } catch {
    // WeakMap requires an object key; in the unlikely event we ever
    // try to attach to a primitive, fail silently and let the
    // converter fall through to its default behaviour.
  }
  return schema;
}

export function getOpusSchemaHint(schema: unknown): Record<string, unknown> | undefined {
  if (schema === null || typeof schema !== "object") return undefined;
  return OPUS_SCHEMA_HINTS.get(schema);
}

/**
 * Zod v4 removed `path` from `RefinementCtx`, so helpers cannot
 * auto-derive the field path from the parse context the way zod v3
 * allowed. Each helper therefore takes an explicit `fieldName` at
 * construction time. The name is purely a label on telemetry events
 * — it does NOT affect schema behaviour. Callers in `types.ts` use
 * the dotted-path form (`"materials.0.rgb"` etc.) for triage parity
 * with previous-shape coercion records.
 */
function logCoercion(
  fieldName: string,
  kind: CoercionKind,
  received: unknown,
  recovered: unknown,
): void {
  recordCoercion({
    field: fieldName,
    kind,
    received,
    recovered,
  });
}

// ─── tolerantEnum ────────────────────────────────────────────────────
//
// Accepts the value verbatim if it matches the canonical set.
// Otherwise: case-normalises (trim, lower for compare, then map to
// canonical case via `synonyms`), and finally falls back to `fallback`
// when no synonym matches. Every coercion is recorded.

export interface TolerantEnumOptions<T extends string> {
  /** Canonical values the schema accepts as-is. */
  values: readonly T[];
  /** Returned when normalisation finds no match. */
  fallback: T;
  /** Optional explicit synonym map. Keys are normalised (lowercased,
   *  trimmed) variants Opus is known to emit; values are the canonical
   *  member. Case-insensitive matches against `values` are handled
   *  automatically — synonyms cover semantic near-misses
   *  (e.g. "co-working" → "office"). */
  synonyms?: Readonly<Record<string, T>>;
  /** Telemetry label — appears in `BuildTelemetry.schemaCoercions[].field`.
   *  Defaults to "unknown" when omitted. Use a dotted path
   *  (`"project.type"`, `"materials[].method"`) for triage parity. */
  fieldName?: string;
}

function normaliseEnumKey(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .toLowerCase()
    .replace(/[-_\s]+/g, "_");
}

export function tolerantEnum<T extends string>(
  options: TolerantEnumOptions<T>,
) {
  const { values, fallback, synonyms = {}, fieldName = "unknown" } = options;
  const canonicalByKey: Record<string, T> = {};
  for (const v of values) canonicalByKey[normaliseEnumKey(v)] = v;
  const synonymByKey: Record<string, T> = {};
  for (const [k, v] of Object.entries(synonyms)) {
    synonymByKey[normaliseEnumKey(k)] = v;
  }

  const schema = z.unknown().transform((raw): T => {
    if (typeof raw === "string" && (values as readonly string[]).includes(raw)) {
      return raw as T;
    }
    const key = normaliseEnumKey(raw);
    if (key && canonicalByKey[key]) {
      const recovered = canonicalByKey[key];
      if (recovered !== raw) {
        logCoercion(fieldName, "enum_normalized", raw, recovered);
      }
      return recovered;
    }
    if (key && synonymByKey[key]) {
      const recovered = synonymByKey[key];
      logCoercion(fieldName, "enum_normalized", raw, recovered);
      return recovered;
    }
    logCoercion(fieldName, "enum_fallback", raw, fallback);
    return fallback;
  });

  // Hint the Opus tool-schema converter to advertise the canonical
  // enum to the model, even though runtime validation is tolerant.
  return setOpusSchemaHint(schema, {
    type: "string",
    enum: [...values],
  });
}

// ─── tolerantRgb ─────────────────────────────────────────────────────
//
// Accepts:
//   • [r, g, b] with each component in [0, 1]               — pass-through
//   • [r, g, b] with any component > 1 (0-255 scale)        — divide by 255
//   • [r, g, b, a] (RGBA)                                    — drop alpha
//   • [r, g] (missing component)                             — pad with 0.5
//   • out-of-range components                                — clamp to [0, 1]
//   • non-numeric junk                                       — fallback to gray
//
// Never rejects. Every recovery is recorded.

const FALLBACK_RGB: readonly [number, number, number] = [0.5, 0.5, 0.5];

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** Shared coercion core — used by both `tolerantRgb` and
 *  `tolerantOptionalRgb`. Pulled out so the field label flows through
 *  in both shapes without duplicating the recovery logic. */
function coerceRgb(raw: unknown, fieldName: string): [number, number, number] {
  if (!Array.isArray(raw)) {
    logCoercion(fieldName, "rgb_coerced", raw, FALLBACK_RGB);
    return [...FALLBACK_RGB] as [number, number, number];
  }
  let nums: number[] = raw.map((v) => {
    if (typeof v === "number") return v;
    if (typeof v === "string") {
      const parsed = Number(v);
      return Number.isFinite(parsed) ? parsed : NaN;
    }
    return NaN;
  });

  let coerced = false;

  if (nums.length < 3) {
    const padded = [...nums];
    while (padded.length < 3) padded.push(0.5);
    logCoercion(fieldName, "rgb_padded", raw, padded);
    nums = padded;
    coerced = true;
  }

  if (nums.length > 3) {
    const truncated = nums.slice(0, 3);
    logCoercion(fieldName, "rgb_truncated", raw, truncated);
    nums = truncated;
    coerced = true;
  }

  const anyAbove1 = nums.some((n) => Number.isFinite(n) && n > 1);
  if (anyAbove1) {
    const rescaled = nums.map((n) => (Number.isFinite(n) ? n / 255 : 0.5));
    logCoercion(fieldName, "rgb_rescaled_255", raw, rescaled);
    nums = rescaled;
    coerced = true;
  }

  const clamped = nums.map(clamp01);
  if (!coerced && clamped.some((n, i) => n !== nums[i])) {
    logCoercion(fieldName, "rgb_clamped", raw, clamped);
  }
  return [clamped[0], clamped[1], clamped[2]];
}

/** Opus tool-schema shape advertised for any RGB triple — a strict
 *  tuple of three numbers in [0, 1]. Tolerance kicks in only when
 *  Opus deviates from this contract. */
const RGB_OPUS_HINT: Record<string, unknown> = {
  type: "array",
  prefixItems: [
    { type: "number", minimum: 0, maximum: 1 },
    { type: "number", minimum: 0, maximum: 1 },
    { type: "number", minimum: 0, maximum: 1 },
  ],
  items: false,
  minItems: 3,
  maxItems: 3,
};

/** Tolerant RGB triple. Default `fieldName` is "rgb"; for richer
 *  triage callers can wrap via `tolerantRgbNamed(name)`. */
export const tolerantRgb = setOpusSchemaHint(
  z.unknown().transform((raw): [number, number, number] => coerceRgb(raw, "rgb")),
  RGB_OPUS_HINT,
);

export function tolerantRgbNamed(fieldName: string) {
  return setOpusSchemaHint(
    z
      .unknown()
      .transform((raw): [number, number, number] => coerceRgb(raw, fieldName)),
    RGB_OPUS_HINT,
  );
}

// ─── tolerantOptionalRgb ─────────────────────────────────────────────
//
// Same as tolerantRgb but `undefined` / `null` pass through as
// undefined (for optional fields like `specular_rgb`).

export const tolerantOptionalRgb = setOpusSchemaHint(
  z
    .unknown()
    .transform((raw): [number, number, number] | undefined => {
      if (raw === undefined || raw === null) return undefined;
      return coerceRgb(raw, "rgb");
    }),
  RGB_OPUS_HINT,
);

// ─── tolerantPositive ────────────────────────────────────────────────
//
// Coerce to a finite number, clamp to >= minimum (default 0.01), or
// fall back to `fallback`. Accepts numeric strings. `acceptZero=true`
// flips the minimum to 0 (used for fields where 0 is a sentinel
// meaning "uncapped").

export interface TolerantPositiveOptions {
  fallback: number;
  /** Minimum positive value when coercing tiny/negative inputs.
   *  Default 0.01. Ignored when `acceptZero` is true and input is 0. */
  minimum?: number;
  /** Maximum value — useful for stopping pathological inputs like
   *  height_limit_m = 10_000_000. Default Number.MAX_SAFE_INTEGER. */
  maximum?: number;
  /** When true, 0 is preserved as a sentinel meaning "uncapped" rather
   *  than coerced up to `minimum`. */
  acceptZero?: boolean;
  /** Telemetry label. Default "unknown". */
  fieldName?: string;
}

export function tolerantPositive(options: TolerantPositiveOptions) {
  const {
    fallback,
    minimum = 0.01,
    maximum = Number.MAX_SAFE_INTEGER,
    acceptZero = false,
    fieldName = "unknown",
  } = options;
  const schema = z.unknown().transform((raw): number => {
    let n: number;
    if (typeof raw === "number") n = raw;
    else if (typeof raw === "string") {
      const parsed = Number(raw);
      n = Number.isFinite(parsed) ? parsed : NaN;
      if (Number.isFinite(parsed) && raw.trim() !== "") {
        logCoercion(fieldName, "number_from_string", raw, parsed);
      }
    } else n = NaN;

    if (!Number.isFinite(n)) {
      logCoercion(fieldName, "positive_clamped", raw, fallback);
      return fallback;
    }
    if (acceptZero && n === 0) return 0;
    if (n < minimum) {
      logCoercion(fieldName, "positive_clamped", raw, minimum);
      return minimum;
    }
    if (n > maximum) {
      logCoercion(fieldName, "positive_clamped", raw, maximum);
      return maximum;
    }
    return n;
  });

  // Hint Opus to emit a number in the canonical [minimum, maximum]
  // range. `acceptZero` widens the lower bound to 0 to advertise the
  // sentinel value (e.g. height_limit_m=0 means "uncapped").
  const lower = acceptZero ? 0 : minimum;
  const hint: Record<string, unknown> = { type: "number", minimum: lower };
  if (Number.isFinite(maximum) && maximum < Number.MAX_SAFE_INTEGER) {
    hint.maximum = maximum;
  }
  return setOpusSchemaHint(schema, hint);
}

// ─── tolerantBoundsTuple ─────────────────────────────────────────────
//
// Site bounds_m specifically: a [width, depth] tuple of positive
// numbers. Accepts 2 or 3 elements (drops Z), accepts numeric strings,
// coerces non-positive to a minimum. Never rejects.

export interface TolerantBoundsOptions {
  fallbackWidth: number;
  fallbackDepth: number;
  minimum?: number;
  fieldName?: string;
}

export function tolerantBoundsTuple(options: TolerantBoundsOptions) {
  const {
    fallbackWidth,
    fallbackDepth,
    minimum = 0.5,
    fieldName = "unknown",
  } = options;
  const schema = z.unknown().transform((raw): [number, number] => {
    if (!Array.isArray(raw)) {
      logCoercion(fieldName, "tuple_padded", raw, [fallbackWidth, fallbackDepth]);
      return [fallbackWidth, fallbackDepth];
    }
    const nums = raw.map((v) => {
      if (typeof v === "number") return v;
      if (typeof v === "string") {
        const parsed = Number(v);
        return Number.isFinite(parsed) ? parsed : NaN;
      }
      return NaN;
    });

    let w = nums[0];
    let d = nums[1];

    let coerced = false;
    if (!Number.isFinite(w) || w <= 0) {
      w = w === 0 ? minimum : fallbackWidth;
      coerced = true;
    }
    if (!Number.isFinite(d) || d <= 0) {
      d = d === 0 ? minimum : fallbackDepth;
      coerced = true;
    }
    if (w < minimum) { w = minimum; coerced = true; }
    if (d < minimum) { d = minimum; coerced = true; }

    if (coerced || nums.length !== 2) {
      logCoercion(fieldName, "tuple_padded", raw, [w, d]);
    }
    return [w, d];
  });

  return setOpusSchemaHint(schema, {
    type: "array",
    prefixItems: [
      { type: "number", minimum, exclusiveMinimum: 0 },
      { type: "number", minimum, exclusiveMinimum: 0 },
    ],
    items: false,
    minItems: 2,
    maxItems: 2,
  });
}

// ─── tolerantStringWithDefault ──────────────────────────────────────
//
// Accepts any value, coerces to string, falls back to `fallback` on
// empty/null/undefined.

export function tolerantStringWithDefault(
  fallback: string,
  fieldName: string = "unknown",
) {
  return z.unknown().transform((raw): string => {
    if (typeof raw === "string" && raw.trim() !== "") return raw;
    if (raw === undefined || raw === null) return fallback;
    if (typeof raw === "string") {
      logCoercion(fieldName, "string_default", raw, fallback);
      return fallback;
    }
    const coerced = String(raw);
    logCoercion(fieldName, "string_default", raw, coerced);
    return coerced;
  });
}
