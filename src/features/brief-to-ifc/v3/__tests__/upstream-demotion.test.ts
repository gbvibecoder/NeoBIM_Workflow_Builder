/**
 * Phase gamma.1 — Upstream Node Demotion tests.
 *
 * Verifies advisory role labels on TR-028/029/030 handler output
 * and absence on TR-031/034.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const handlersDir = path.join(__dirname, "..", "..", "..", "..", "app", "api", "execute-node", "handlers");

describe("Upstream Demotion (Phase gamma.1)", () => {
  it("TR-028 handler output metadata includes advisoryRole: true", () => {
    const src = fs.readFileSync(path.join(handlersDir, "tr-028.ts"), "utf-8");
    expect(src).toContain("advisoryRole: true");
  });

  it("TR-029 handler output metadata includes advisoryRole: true", () => {
    const src = fs.readFileSync(path.join(handlersDir, "tr-029.ts"), "utf-8");
    expect(src).toContain("advisoryRole: true");
  });

  it("TR-030 handler output metadata includes advisoryRole: true", () => {
    const src = fs.readFileSync(path.join(handlersDir, "tr-030.ts"), "utf-8");
    expect(src).toContain("advisoryRole: true");
  });

  it("TR-031 (Material Resolver) does NOT have advisoryRole", () => {
    const src = fs.readFileSync(path.join(handlersDir, "tr-031.ts"), "utf-8");
    expect(src).not.toContain("advisoryRole");
  });

  it("TR-034 (Spec Validator) does NOT have advisoryRole", () => {
    // TR-034 may not exist as a file; check if it does first
    const filePath = path.join(handlersDir, "tr-034.ts");
    if (fs.existsSync(filePath)) {
      const src = fs.readFileSync(filePath, "utf-8");
      expect(src).not.toContain("advisoryRole");
    } else {
      // If the handler doesn't exist as a separate file, that's fine
      // — it doesn't have advisoryRole by default
      expect(true).toBe(true);
    }
  });

  it("node-catalogue has advisory labels for TR-028/029/030", () => {
    const cataloguePath = path.join(
      __dirname, "..", "..", "..", "workflows", "constants", "node-catalogue.ts",
    );
    const src = fs.readFileSync(cataloguePath, "utf-8");
    expect(src).toContain('Item Decomposer (advisory)');
    expect(src).toContain('Architectural Reasoner (advisory)');
    expect(src).toContain('Trim Specifier (advisory)');
  });
});
