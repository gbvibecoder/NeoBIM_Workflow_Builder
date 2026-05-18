/**
 * Spec Patcher prompt drift regression test.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { SPEC_PATCHER_PROMPT_TEMPLATE } from "../spec-patcher";

describe("spec-patcher prompt drift", () => {
  it("spec-patcher-prompt.md matches SPEC_PATCHER_PROMPT_TEMPLATE byte-for-byte", () => {
    const mdPath = path.join(__dirname, "..", "spec-patcher-prompt.md");
    const md = fs.readFileSync(mdPath, "utf-8").trim();
    const cnst = SPEC_PATCHER_PROMPT_TEMPLATE.trim();
    expect(cnst).toBe(md);
  });

  it("the prompt contains load-bearing patch types", () => {
    expect(SPEC_PATCHER_PROMPT_TEMPLATE).toContain("force_parts");
    expect(SPEC_PATCHER_PROMPT_TEMPLATE).toContain("add_trim");
    expect(SPEC_PATCHER_PROMPT_TEMPLATE).toContain("fix_size");
    expect(SPEC_PATCHER_PROMPT_TEMPLATE).toContain("PATCHING RULES");
    expect(SPEC_PATCHER_PROMPT_TEMPLATE).toContain("Maximum 12 patches");
  });
});
