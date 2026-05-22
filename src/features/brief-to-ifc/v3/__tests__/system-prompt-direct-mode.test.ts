/**
 * Phase gamma.1 — System Prompt Direct Mode tests.
 *
 * Verifies the rewritten system prompt has the autonomy-focused framing
 * and does NOT contain the old mandatory enforcement terminology.
 */

import { describe, expect, it } from "vitest";
import { GENERATOR_SYSTEM_PROMPT } from "../generator/driver";

describe("System Prompt — Direct Agent Mode (Phase gamma.1)", () => {
  it("prompt contains render_preview reference", () => {
    expect(GENERATOR_SYSTEM_PROMPT).toContain("render_preview");
    expect(GENERATOR_SYSTEM_PROMPT).toContain("10 times per build");
  });

  it("prompt contains advisory framing for suggestions", () => {
    expect(GENERATOR_SYSTEM_PROMPT).toContain("advisory");
    expect(GENERATOR_SYSTEM_PROMPT).toContain("colleague's notes, not a contract");
  });

  it("prompt contains anti-IfcBuildingElementProxy guidance", () => {
    expect(GENERATOR_SYSTEM_PROMPT).toContain("IfcBuildingElementProxy");
    expect(GENERATOR_SYSTEM_PROMPT).toContain("NEVER use IfcBuildingElementProxy for furniture");
  });

  it("prompt does NOT contain old MUST_BUILD/force_parts terminology", () => {
    // The old prompt had Section 4f with MUST_BUILD enforcement
    // and force_parts as non-negotiable directives. The new prompt
    // uses advisory language instead.
    expect(GENERATOR_SYSTEM_PROMPT).not.toContain("MUST_BUILD");
    expect(GENERATOR_SYSTEM_PROMPT).not.toContain("force_parts");
    expect(GENERATOR_SYSTEM_PROMPT).not.toContain("Section 4f");
    expect(GENERATOR_SYSTEM_PROMPT).not.toContain("NON-NEGOTIABLE");
  });

  it("prompt has 200 turns reference (not 50)", () => {
    expect(GENERATOR_SYSTEM_PROMPT).toContain("200 turns");
    expect(GENERATOR_SYSTEM_PROMPT).not.toContain("max turns (50)");
  });

  it("prompt has FINALIZE section with render_preview prerequisite", () => {
    expect(GENERATOR_SYSTEM_PROMPT).toContain("## FINALIZE");
    expect(GENERATOR_SYSTEM_PROMPT).toContain("Used `render_preview` at least once");
  });

  it("prompt has ITERATION CONTEXT section for retry feedback", () => {
    expect(GENERATOR_SYSTEM_PROMPT).toContain("## ITERATION CONTEXT");
    expect(GENERATOR_SYSTEM_PROMPT).toContain("PREVIOUS ITERATION FEEDBACK");
    expect(GENERATOR_SYSTEM_PROMPT).toContain("feedback is in English, not JSON");
  });
});
