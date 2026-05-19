/**
 * Prompt-drift regression test.
 *
 * `GENERATOR_SYSTEM_PROMPT` is loaded by `driver.ts` from
 * `system-prompt.md` via `fs.readFileSync` at module init — so by
 * construction the const equals the file content. This test re-reads
 * the file at test time and asserts byte-equality, catching:
 *
 *   • A future refactor that switches the const back to an inline
 *     template literal and lets it drift from the canonical .md.
 *   • A build pipeline that strips the .md file (Next.js bundling
 *     regression, hypothetical Vercel asset-trim).
 *   • A path resolution change in `driver.ts` (e.g. renaming the file
 *     without updating the import).
 *
 * Test logic mirrors the exact shape the Phase v3 completion prompt
 * specified (read .md trim → compare to const trim).
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { GENERATOR_SYSTEM_PROMPT } from "../driver";

describe("system-prompt drift", () => {
  it("system-prompt.md matches driver.ts GENERATOR_SYSTEM_PROMPT byte-for-byte", () => {
    const mdPath = path.join(__dirname, "..", "system-prompt.md");
    const md = fs.readFileSync(mdPath, "utf-8").trim();
    const cnst = GENERATOR_SYSTEM_PROMPT.trim();
    expect(cnst).toBe(md);
  });

  it("the prompt contains load-bearing IFC strictness rules", () => {
    // Defensive: a refactor that accidentally truncates the .md file
    // (e.g. an empty rewrite) would pass the byte-equality test above
    // because both sides would be empty. Anchor against specific
    // strings that MUST be in the prompt for the agent to author IFC
    // correctly.
    expect(GENERATOR_SYSTEM_PROMPT).toContain("IFC4");
    expect(GENERATOR_SYSTEM_PROMPT).toContain("attach_canonical_psets");
    expect(GENERATOR_SYSTEM_PROMPT).toContain("finalize_ifc");
  });

  it("Phase gamma.1: prompt contains new Direct Agent Mode sections", () => {
    expect(GENERATOR_SYSTEM_PROMPT).toContain("## HOW YOU WORK");
    expect(GENERATOR_SYSTEM_PROMPT).toContain("## SEEING YOUR WORK");
    expect(GENERATOR_SYSTEM_PROMPT).toContain("## UPSTREAM SUGGESTIONS");
    expect(GENERATOR_SYSTEM_PROMPT).toContain("## WHAT MAKES A GREAT IFC");
  });
});
