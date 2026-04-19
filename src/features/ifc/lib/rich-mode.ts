/**
 * Rich-mode resolver for EX-001 IFC exporter.
 *
 * Phase 1 Track B — translates a coarse `IFC_RICH_MODE` env var (or
 * per-run `inputData.richMode` override) into the four TypeScript
 * exporter gate flags declared in `ifc-exporter.ts:65-168`:
 *   - emitRebarGeometry       (default false: rebar bodies hidden)
 *   - autoEmitDemoContent     (default false: sample MEP/furniture)
 *   - emitCurtainWallGeometry (default false: mullion body chaos)
 *   - emitMEPGeometry         (default false: duct/pipe bodies)
 *
 * Resolution order (highest wins):
 *   1. inputData.richMode        → source = "override"
 *   2. process.env.IFC_RICH_MODE → source = "env"
 *   3. fall back to "off"        → source = "default"
 *
 * Default `"off"` matches pre-Track-B production behaviour exactly. No
 * runtime change unless a workflow explicitly sets the override or an
 * operator sets the env var.
 *
 * This file is the authoritative source of the rich-mode contract.
 * `ex-001.ts` imports from here. Tests import from here directly —
 * avoids pulling the whole execute-node handler graph into the test's
 * module scope.
 *
 * Related docs:
 *   - docs/ifc-phase-1-subplan.md § Track B
 *   - docs/RICH_IFC_IMPLEMENTATION_PLAN_v2.md § Phase 1 (B + C + D)
 *   - docs/RICH_IFC_IMPLEMENTATION_PLAN_v2_1_AMENDMENTS.md (no amendment;
 *     Track B ships as originally scoped)
 */

export type RichMode = "off" | "arch-only" | "mep" | "structural" | "full";

export interface RichFlags {
  emitRebarGeometry: boolean;
  autoEmitDemoContent: boolean;
  emitCurtainWallGeometry: boolean;
  emitMEPGeometry: boolean;
}

export type RichModeSource = "override" | "env" | "default";

export interface ResolvedRichMode {
  mode: RichMode;
  flags: RichFlags;
  source: RichModeSource;
}

const VALID_MODES: ReadonlyArray<RichMode> = [
  "off",
  "arch-only",
  "mep",
  "structural",
  "full",
];

const VALID_SET: ReadonlySet<RichMode> = new Set(VALID_MODES);

/** Runtime-safe mode validator. Accepts only the five literal string values. */
export function isValidRichMode(x: unknown): x is RichMode {
  return typeof x === "string" && VALID_SET.has(x as RichMode);
}

/**
 * Map a RichMode literal to the four gate-flag booleans. Exhaustive switch
 * — adding a new RichMode literal would require a new case here (TS would
 * otherwise warn on the fallthrough).
 */
export function richModeToFlags(mode: RichMode): RichFlags {
  switch (mode) {
    case "arch-only":
      return {
        emitRebarGeometry: false,
        autoEmitDemoContent: false,
        emitCurtainWallGeometry: true,
        emitMEPGeometry: false,
      };
    case "mep":
      return {
        emitRebarGeometry: false,
        autoEmitDemoContent: true,
        emitCurtainWallGeometry: false,
        emitMEPGeometry: true,
      };
    case "structural":
      return {
        emitRebarGeometry: true,
        autoEmitDemoContent: false,
        emitCurtainWallGeometry: false,
        emitMEPGeometry: false,
      };
    case "full":
      return {
        emitRebarGeometry: true,
        autoEmitDemoContent: true,
        emitCurtainWallGeometry: true,
        emitMEPGeometry: true,
      };
    case "off":
      return {
        emitRebarGeometry: false,
        autoEmitDemoContent: false,
        emitCurtainWallGeometry: false,
        emitMEPGeometry: false,
      };
  }
}

/**
 * Resolve the effective rich mode for an EX-001 invocation.
 *
 * @param inputData  loose inputData map from NodeHandlerContext; checked
 *                   for an optional `richMode` override field
 * @param envValue   optional env override — defaults to
 *                   `process.env.IFC_RICH_MODE`. Injected for tests.
 *
 * @returns ResolvedRichMode with source tracking so the caller can
 *          distinguish user-override from env from default in logs +
 *          artifact metadata.
 */
export function resolveRichMode(
  inputData: unknown,
  envValue: string | undefined = process.env.IFC_RICH_MODE,
): ResolvedRichMode {
  // 1) Per-run override via inputData.richMode
  if (
    inputData !== null &&
    typeof inputData === "object" &&
    "richMode" in (inputData as Record<string, unknown>)
  ) {
    const maybe = (inputData as Record<string, unknown>).richMode;
    if (isValidRichMode(maybe)) {
      return {
        mode: maybe,
        flags: richModeToFlags(maybe),
        source: "override",
      };
    }
    // Invalid override value — fall through silently rather than throwing.
    // Ex-001 should never fail a whole workflow over a typo in richMode.
  }

  // 2) Env var
  if (isValidRichMode(envValue)) {
    return {
      mode: envValue,
      flags: richModeToFlags(envValue),
      source: "env",
    };
  }

  // 3) Default
  return {
    mode: "off",
    flags: richModeToFlags("off"),
    source: "default",
  };
}
