/**
 * Unit Conversion Utilities for Floor Plan CAD
 *
 * Internal: always mm. Display: configurable.
 */

export type DisplayUnit = "mm" | "cm" | "m" | "ft" | "in";

const MM_PER_UNIT: Record<DisplayUnit, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  ft: 304.8,
  in: 25.4,
};

/** Convert mm to display unit value */
export function mmToDisplay(mm: number, unit: DisplayUnit): number {
  return mm / MM_PER_UNIT[unit];
}

/** Convert display unit value to mm */
export function displayToMm(value: number, unit: DisplayUnit): number {
  return value * MM_PER_UNIT[unit];
}

/** Format a dimension value for display */
export function formatDimension(mm: number, unit: DisplayUnit, precision?: number): string {
  const value = mmToDisplay(mm, unit);

  if (unit === "ft") {
    const feet = Math.floor(value);
    const inches = (value - feet) * 12;
    if (inches < 0.125) return `${feet}'`;
    return `${feet}'-${inches.toFixed(0)}"`;
  }

  if (unit === "in") {
    return `${value.toFixed(precision ?? 1)}"`;
  }

  const p = precision ?? (unit === "mm" ? 0 : unit === "cm" ? 1 : 2);
  return `${value.toFixed(p)} ${unit}`;
}

/** Format area (always stored as sqm internally) */
export function formatArea(sqm: number, unit: DisplayUnit): string {
  if (unit === "ft" || unit === "in") {
    const sqft = sqm * 10.7639;
    return `${sqft.toFixed(1)} ft²`;
  }
  return `${sqm.toFixed(1)} m²`;
}

/** Convert sqmm to sqm */
export function sqmmToSqm(sqmm: number): number {
  return sqmm / 1_000_000;
}
