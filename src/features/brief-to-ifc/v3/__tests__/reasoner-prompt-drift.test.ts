/**
 * Reasoner prompt drift regression test.
 *
 * Ensures the inline REASONER_PROMPT_TEMPLATE const in
 * architectural-reasoner.ts stays byte-equal to the canonical
 * architectural-reasoner-prompt.md file.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { REASONER_PROMPT_TEMPLATE } from "../architectural-reasoner";

describe("architectural-reasoner prompt drift", () => {
  it("architectural-reasoner-prompt.md matches REASONER_PROMPT_TEMPLATE byte-for-byte", () => {
    const mdPath = path.join(__dirname, "..", "architectural-reasoner-prompt.md");
    const md = fs.readFileSync(mdPath, "utf-8").trim();
    const cnst = REASONER_PROMPT_TEMPLATE.trim();
    expect(cnst).toBe(md);
  });

  it("the prompt contains load-bearing architectural principles", () => {
    expect(REASONER_PROMPT_TEMPLATE).toContain("COORDINATE FRAME");
    expect(REASONER_PROMPT_TEMPLATE).toContain("designRationale");
    expect(REASONER_PROMPT_TEMPLATE).toContain("FAITHFULNESS");
  });
});
