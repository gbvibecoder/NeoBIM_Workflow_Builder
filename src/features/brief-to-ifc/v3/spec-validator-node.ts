/**
 * Spec Validator Node (pre-generator gate) — deterministic BriefSpec
 * validation.
 *
 * PURE DETERMINISTIC — no Opus / LLM calls. Sub-10 ms execution for any
 * realistic spec size. Catches structural errors that would cause the
 * Python sandbox or agent builder to fail at runtime.
 *
 * Hard errors block the pipeline. Warnings are informational — they hint
 * at likely brief omissions but don't prevent generation.
 */

import { MATERIAL_LIBRARY } from "./material-library";
import type { BriefSpec } from "./types";

// ─── Types ────────────────────────────────────────────────────────────

export interface SpecError {
  field: string;
  message: string;
}

export interface SpecWarning {
  field: string;
  message: string;
}

export interface SpecValidationResult {
  valid: boolean;
  errors: SpecError[];
  warnings: SpecWarning[];
}

// ─── Lookup (module-level, built once) ────────────────────────────────

const MATERIAL_SET = new Set<string>(MATERIAL_LIBRARY);

// ─── Helpers ──────────────────────────────────────────────────────────

function hasNaN(value: number): boolean {
  return Number.isNaN(value);
}

function hasNaNOrInfinity(value: number): boolean {
  return Number.isNaN(value) || !Number.isFinite(value);
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Validate a BriefSpec for structural correctness before it enters the
 * generator pipeline.
 */
export function validateSpec(spec: BriefSpec): SpecValidationResult {
  const errors: SpecError[] = [];
  const warnings: SpecWarning[] = [];

  // ── Hard errors ───────────────────────────────────────────────────

  // 1. Spaces must not be empty.
  if (spec.spaces.length === 0) {
    errors.push({
      field: "spaces",
      message: "Spec must contain at least one space.",
    });
  }

  // 2. Space polygons with < 3 vertices (when present).
  for (let i = 0; i < spec.spaces.length; i++) {
    const space = spec.spaces[i];
    if (
      space.polygon_world_m !== null &&
      space.polygon_world_m.length < 3
    ) {
      errors.push({
        field: `spaces[${i}].polygon_world_m`,
        message: `Space "${space.id}" polygon has ${space.polygon_world_m.length} vertices — minimum is 3.`,
      });
    }
  }

  // 3. Openings with non-positive dimensions.
  if (spec.openings) {
    for (let i = 0; i < spec.openings.length; i++) {
      const opening = spec.openings[i];
      if (opening.width_m <= 0) {
        errors.push({
          field: `openings[${i}].width_m`,
          message: `Opening "${opening.id}" has width_m=${opening.width_m} — must be > 0.`,
        });
      }
      if (opening.height_m <= 0) {
        errors.push({
          field: `openings[${i}].height_m`,
          message: `Opening "${opening.id}" has height_m=${opening.height_m} — must be > 0.`,
        });
      }
    }
  }

  // 4. Furniture items with NaN bounding_box coordinates.
  if (spec.furniture) {
    for (let i = 0; i < spec.furniture.length; i++) {
      const item = spec.furniture[i];
      if (item.bounding_box) {
        const [x, y, z] = item.bounding_box;
        if (hasNaN(x) || hasNaN(y) || hasNaN(z)) {
          errors.push({
            field: `furniture[${i}].bounding_box`,
            message: `Furniture "${item.id}" has NaN in bounding_box [${x}, ${y}, ${z}].`,
          });
        }
      }

      // 5. Furniture parts with NaN or Infinity in origin_local_m.
      if (item.parts) {
        for (let j = 0; j < item.parts.length; j++) {
          const part = item.parts[j];
          const [px, py, pz] = part.origin_local_m;
          if (
            hasNaNOrInfinity(px) ||
            hasNaNOrInfinity(py) ||
            hasNaNOrInfinity(pz)
          ) {
            errors.push({
              field: `furniture[${i}].parts[${j}].origin_local_m`,
              message: `Part "${part.id}" of furniture "${item.id}" has NaN/Infinity in origin_local_m [${px}, ${py}, ${pz}].`,
            });
          }
        }
      }
    }
  }

  // ── Warnings ──────────────────────────────────────────────────────

  // W1. Material IDs referenced by furniture/trim not in MATERIAL_LIBRARY.
  if (spec.furniture) {
    for (let i = 0; i < spec.furniture.length; i++) {
      const item = spec.furniture[i];
      if (!MATERIAL_SET.has(item.material_id)) {
        warnings.push({
          field: `furniture[${i}].material_id`,
          message: `Furniture "${item.id}" references unknown material "${item.material_id}".`,
        });
      }
      if (item.parts) {
        for (let j = 0; j < item.parts.length; j++) {
          const part = item.parts[j];
          if (!MATERIAL_SET.has(part.material_id)) {
            warnings.push({
              field: `furniture[${i}].parts[${j}].material_id`,
              message: `Part "${part.id}" of furniture "${item.id}" references unknown material "${part.material_id}".`,
            });
          }
        }
      }
    }
  }

  if (spec.trim) {
    for (let i = 0; i < spec.trim.length; i++) {
      const item = spec.trim[i];
      if (!MATERIAL_SET.has(item.material_id)) {
        warnings.push({
          field: `trim[${i}].material_id`,
          message: `Trim "${item.id}" references unknown material "${item.material_id}".`,
        });
      }
    }
  }

  // W2. Has furniture but no openings (likely missing doors).
  if (
    spec.furniture &&
    spec.furniture.length > 0 &&
    (!spec.openings || spec.openings.length === 0)
  ) {
    warnings.push({
      field: "openings",
      message:
        "Spec has furniture but no openings — doors/windows may be missing.",
    });
  }

  // W3. Single furniture item with > 30 parts.
  if (spec.furniture) {
    for (let i = 0; i < spec.furniture.length; i++) {
      const item = spec.furniture[i];
      if (item.parts && item.parts.length > 30) {
        warnings.push({
          field: `furniture[${i}].parts`,
          message: `Furniture "${item.id}" has ${item.parts.length} parts — unusually high (> 30).`,
        });
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
