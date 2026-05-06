/**
 * Integration test for Phase 1 Track B rich-mode resolver.
 *
 * Asserts the 5 × mode → flag matrix and the 3 × resolution-source
 * paths (override / env / default). Also covers the invalid-override
 * fall-through behaviour.
 *
 * Related: docs/ifc-phase-1-subplan.md § B3.
 */

import { describe, test, expect } from "vitest";
import {
  isValidRichMode,
  richModeToFlags,
  resolveRichMode,
  type RichMode,
  type RichFlags,
} from "@/features/ifc/lib/rich-mode";

// ── Fixture table: the contract ─────────────────────────────────────────

const MODE_TO_FLAGS: ReadonlyArray<{ mode: RichMode; flags: RichFlags }> = [
  {
    mode: "off",
    flags: {
      emitRebarGeometry: false,
      autoEmitDemoContent: false,
      emitCurtainWallGeometry: false,
      emitMEPGeometry: false,
    },
  },
  {
    mode: "arch-only",
    flags: {
      emitRebarGeometry: false,
      autoEmitDemoContent: false,
      emitCurtainWallGeometry: true,
      emitMEPGeometry: false,
    },
  },
  {
    mode: "mep",
    flags: {
      emitRebarGeometry: false,
      autoEmitDemoContent: true,
      emitCurtainWallGeometry: false,
      emitMEPGeometry: true,
    },
  },
  {
    mode: "structural",
    flags: {
      emitRebarGeometry: true,
      autoEmitDemoContent: false,
      emitCurtainWallGeometry: false,
      emitMEPGeometry: false,
    },
  },
  {
    mode: "full",
    flags: {
      emitRebarGeometry: true,
      autoEmitDemoContent: true,
      emitCurtainWallGeometry: true,
      emitMEPGeometry: true,
    },
  },
];

// ── Tests ───────────────────────────────────────────────────────────────

describe("rich-mode: isValidRichMode", () => {
  test.each(MODE_TO_FLAGS.map((m) => m.mode))("accepts valid mode %s", (mode) => {
    expect(isValidRichMode(mode)).toBe(true);
  });

  test.each(["", "on", "OFF", "Arch-Only", "full ", " full", "ARCH-ONLY", "rich", "default"])(
    "rejects invalid string %s",
    (input) => {
      expect(isValidRichMode(input)).toBe(false);
    },
  );

  test.each([null, undefined, 0, 1, true, false, {}, [], () => "full"])(
    "rejects non-string value %s",
    (input) => {
      expect(isValidRichMode(input)).toBe(false);
    },
  );
});

describe("rich-mode: richModeToFlags produces expected bundle", () => {
  test.each(MODE_TO_FLAGS)("mode=$mode", ({ mode, flags }) => {
    expect(richModeToFlags(mode)).toEqual(flags);
  });
});

describe("rich-mode: resolveRichMode source = default", () => {
  test("no input and no env → default + off", () => {
    const result = resolveRichMode(undefined, undefined);
    // Phase 2: default flipped from "off" → "arch-only" so cold-start
    // BuildFlow → Python doesn't silently produce empty IFCs.
    expect(result.mode).toBe("arch-only");
    expect(result.source).toBe("default");
    expect(result.flags).toEqual(richModeToFlags("arch-only"));
  });

  test("empty-object input and no env → default + arch-only", () => {
    const result = resolveRichMode({}, undefined);
    expect(result.mode).toBe("arch-only");
    expect(result.source).toBe("default");
  });

  test("null input and no env → default + arch-only", () => {
    const result = resolveRichMode(null, undefined);
    expect(result.mode).toBe("arch-only");
    expect(result.source).toBe("default");
  });

  test("invalid env value → default + arch-only (silent fall-through)", () => {
    const result = resolveRichMode(undefined, "turbo");
    expect(result.mode).toBe("arch-only");
    expect(result.source).toBe("default");
  });
});

describe("rich-mode: resolveRichMode source = env", () => {
  test.each(MODE_TO_FLAGS)("env=$mode and no override → source=env", ({ mode, flags }) => {
    const result = resolveRichMode(undefined, mode);
    expect(result.mode).toBe(mode);
    expect(result.source).toBe("env");
    expect(result.flags).toEqual(flags);
  });

  test("env=full and input has no richMode field → source=env", () => {
    const result = resolveRichMode({ other: "data" }, "full");
    expect(result.mode).toBe("full");
    expect(result.source).toBe("env");
  });
});

describe("rich-mode: resolveRichMode source = override", () => {
  test.each(MODE_TO_FLAGS)(
    "input.richMode=$mode beats env → source=override",
    ({ mode, flags }) => {
      // Put a conflicting env value to prove override wins
      const result = resolveRichMode({ richMode: mode }, "off");
      expect(result.mode).toBe(mode);
      expect(result.source).toBe("override");
      expect(result.flags).toEqual(flags);
    },
  );

  test("input.richMode=full overrides env=structural", () => {
    const result = resolveRichMode({ richMode: "full" }, "structural");
    expect(result.mode).toBe("full");
    expect(result.source).toBe("override");
  });

  test("input.richMode=off overrides env=full", () => {
    const result = resolveRichMode({ richMode: "off" }, "full");
    expect(result.mode).toBe("off");
    expect(result.source).toBe("override");
    expect(result.flags.emitRebarGeometry).toBe(false);
  });

  test("invalid override + valid env → falls through to env", () => {
    const result = resolveRichMode({ richMode: "turbo" }, "full");
    expect(result.mode).toBe("full");
    expect(result.source).toBe("env");
  });

  test("invalid override + no env → falls through to default", () => {
    const result = resolveRichMode({ richMode: 42 }, undefined);
    // Phase 2 default
    expect(result.mode).toBe("arch-only");
    expect(result.source).toBe("default");
  });

  test("richMode key absent from input → falls through", () => {
    const result = resolveRichMode({ somethingElse: "full" }, "structural");
    expect(result.mode).toBe("structural");
    expect(result.source).toBe("env");
  });
});

describe("rich-mode: mode literals are exhaustive", () => {
  test("richModeToFlags covers every literal in the RichMode union", () => {
    // If a new mode is added to the union but not to richModeToFlags,
    // TypeScript's exhaustive-switch check fires — but this runtime test
    // also asserts each mode in our fixture list produces distinct output.
    const seen = new Set<string>();
    for (const { mode } of MODE_TO_FLAGS) {
      const key = JSON.stringify(richModeToFlags(mode));
      seen.add(key);
    }
    // 5 modes → 5 distinct flag bundles
    expect(seen.size).toBe(MODE_TO_FLAGS.length);
  });
});
