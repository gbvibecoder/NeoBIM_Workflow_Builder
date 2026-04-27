/**
 * Auto-Enhance Orchestrator — applies all 4 enhancement tiers sequentially
 * when the IFC viewer opens a BuildFlow-generated model.
 *
 * This module provides:
 *   - `shouldAutoEnhance()` — gate check (user pref + BuildFlow origin)
 *   - `AUTO_ENHANCE_DEFAULTS` — default toggles for all 4 tiers
 *
 * The actual apply is delegated to `IFCEnhancePanelHandle.applyAll()`,
 * which reuses the panel's existing engine lifecycle (creation, progress
 * tracking, error handling, state update). This avoids duplicate engines
 * and keeps the panel's UI in sync with auto-applied enhancements.
 */

import {
  DEFAULT_TOGGLES,
  DEFAULT_TIER2_TOGGLES,
  DEFAULT_TIER3_TOGGLES,
  DEFAULT_TIER4_TOGGLES,
  type EnhanceToggles,
  type Tier2Toggles,
  type Tier3Toggles,
  type Tier4Toggles,
} from "@/features/ifc/enhance/types";

// ── localStorage gate ──────────────────────────────────────────────

const PREF_KEY = "buildflow.autoEnhance.disabled";

/** Check if auto-enhance is allowed for this user + context. */
export function shouldAutoEnhance(fromBuildFlow: boolean): boolean {
  if (!fromBuildFlow) return false;
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(PREF_KEY) !== "true";
  } catch {
    return true; // localStorage blocked → default to enabled
  }
}

/** Toggle auto-enhance preference. Returns new enabled state. */
export function setAutoEnhanceEnabled(enabled: boolean): boolean {
  try {
    if (enabled) {
      localStorage.removeItem(PREF_KEY);
    } else {
      localStorage.setItem(PREF_KEY, "true");
    }
  } catch {
    // localStorage blocked — silently ignore
  }
  return enabled;
}

/** Read current auto-enhance preference. */
export function isAutoEnhanceEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(PREF_KEY) !== "true";
  } catch {
    return true;
  }
}

// ── Default toggles for auto-enhance ───────────────────────────────

export const AUTO_ENHANCE_DEFAULTS = {
  tier1: {
    ...DEFAULT_TOGGLES,
    hdriPreset: "day",
    quality: "medium",
  } satisfies EnhanceToggles,

  tier2: {
    ...DEFAULT_TIER2_TOGGLES,
  } satisfies Tier2Toggles,

  tier3: {
    ...DEFAULT_TIER3_TOGGLES,
  } satisfies Tier3Toggles,

  tier4: {
    ...DEFAULT_TIER4_TOGGLES,
  } satisfies Tier4Toggles,
} as const;
