/**
 * MUST_BUILD Section 4f presence test.
 *
 * Verifies that the system prompt contains the MUST_BUILD enforcement
 * section (4f) in both the .md file and the driver.ts inline const.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import { GENERATOR_SYSTEM_PROMPT } from "../generator/driver";

describe("MUST_BUILD enforcement — Section 4f", () => {
  it("driver.ts inline const contains all MUST_BUILD keywords", () => {
    expect(GENERATOR_SYSTEM_PROMPT).toContain("force_parts");
    expect(GENERATOR_SYSTEM_PROMPT).toContain("must_build");
    expect(GENERATOR_SYSTEM_PROMPT).toContain("mandatory");
    expect(GENERATOR_SYSTEM_PROMPT).toContain("Hard Verifier");
    expect(GENERATOR_SYSTEM_PROMPT).toContain("MUST_BUILD");
    expect(GENERATOR_SYSTEM_PROMPT).toContain("NO COLLAPSE");
    expect(GENERATOR_SYSTEM_PROMPT).toContain("RETRY CONTEXT");
    expect(GENERATOR_SYSTEM_PROMPT).toContain("TRIM ENFORCEMENT");
  });

  it("system-prompt.md matches driver.ts inline const (byte-equal)", () => {
    const mdPath = path.join(__dirname, "..", "generator", "system-prompt.md");
    const md = fs.readFileSync(mdPath, "utf-8").trim();
    const cnst = GENERATOR_SYSTEM_PROMPT.trim();
    expect(cnst).toBe(md);
  });

  it(".md file contains Section 4f header", () => {
    const mdPath = path.join(__dirname, "..", "generator", "system-prompt.md");
    const md = fs.readFileSync(mdPath, "utf-8");
    expect(md).toContain("## Section 4f: MUST_BUILD Enforcement");
  });
});
