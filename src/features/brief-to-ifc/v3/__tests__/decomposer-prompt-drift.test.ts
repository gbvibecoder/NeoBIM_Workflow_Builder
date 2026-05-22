/**
 * Decomposer prompt drift regression test.
 *
 * Mirrors generator/__tests__/prompt-drift.test.ts. Ensures the inline
 * DECOMPOSER_PROMPT_TEMPLATE const stays byte-equal to the canonical
 * .md file.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { DECOMPOSER_PROMPT_TEMPLATE } from "../item-decomposer";

describe("decomposer prompt drift", () => {
  it("item-decomposer-prompt.md matches DECOMPOSER_PROMPT_TEMPLATE byte-for-byte", () => {
    const mdPath = path.join(__dirname, "..", "item-decomposer-prompt.md");
    const md = fs.readFileSync(mdPath, "utf-8").trim();
    const cnst = DECOMPOSER_PROMPT_TEMPLATE.trim();
    expect(cnst).toBe(md);
  });

  it("the prompt contains load-bearing decomposition rules", () => {
    expect(DECOMPOSER_PROMPT_TEMPLATE).toContain("COORDINATE FRAME");
    expect(DECOMPOSER_PROMPT_TEMPLATE).toContain("ALLOWED MATERIALS");
    expect(DECOMPOSER_PROMPT_TEMPLATE).toContain("IfcFurnishingElement");
  });
});
