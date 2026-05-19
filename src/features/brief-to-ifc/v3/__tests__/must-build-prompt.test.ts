/**
 * Phase gamma.1: Prompt evolution test.
 *
 * Previously tested MUST_BUILD Section 4f presence. Phase gamma.1
 * replaced the mandatory enforcement model with autonomy-focused
 * "advisory" suggestions. This test now verifies the new prompt
 * structure is correct.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";

import { GENERATOR_SYSTEM_PROMPT } from "../generator/driver";

describe("Phase gamma.1 — prompt evolution from MUST_BUILD to advisory", () => {
  it("driver.ts inline const does NOT contain old mandatory enforcement terms", () => {
    // Phase gamma.1 removed MUST_BUILD, force_parts, and NO COLLAPSE
    // enforcement from the system prompt. These were the β-phase additions
    // that made quality worse by over-constraining the agent.
    expect(GENERATOR_SYSTEM_PROMPT).not.toContain("MUST_BUILD");
    expect(GENERATOR_SYSTEM_PROMPT).not.toContain("force_parts");
    expect(GENERATOR_SYSTEM_PROMPT).not.toContain("Section 4f");
    expect(GENERATOR_SYSTEM_PROMPT).not.toContain("NON-NEGOTIABLE");
  });

  it("system-prompt.md matches driver.ts inline const (byte-equal)", () => {
    const mdPath = path.join(__dirname, "..", "generator", "system-prompt.md");
    const md = fs.readFileSync(mdPath, "utf-8").trim();
    const cnst = GENERATOR_SYSTEM_PROMPT.trim();
    expect(cnst).toBe(md);
  });

  it("new prompt contains autonomy-focused sections", () => {
    expect(GENERATOR_SYSTEM_PROMPT).toContain("## HOW YOU WORK");
    expect(GENERATOR_SYSTEM_PROMPT).toContain("## SEEING YOUR WORK");
    expect(GENERATOR_SYSTEM_PROMPT).toContain("## UPSTREAM SUGGESTIONS");
    expect(GENERATOR_SYSTEM_PROMPT).toContain("advisory");
    expect(GENERATOR_SYSTEM_PROMPT).toContain("render_preview");
  });

  it("new prompt still contains IFC correctness guidance", () => {
    expect(GENERATOR_SYSTEM_PROMPT).toContain("IfcBuildingElementProxy");
    expect(GENERATOR_SYSTEM_PROMPT).toContain("IfcRelAggregates");
    expect(GENERATOR_SYSTEM_PROMPT).toContain("IfcFurnishingElement");
    expect(GENERATOR_SYSTEM_PROMPT).toContain("attach_canonical_psets");
    expect(GENERATOR_SYSTEM_PROMPT).toContain("finalize_ifc");
  });
});
