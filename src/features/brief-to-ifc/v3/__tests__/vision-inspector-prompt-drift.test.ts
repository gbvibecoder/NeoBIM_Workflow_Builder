/**
 * Vision inspector prompt drift regression test.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { VISION_INSPECTOR_PROMPT_TEMPLATE } from "../vision-inspector";

describe("vision-inspector prompt drift", () => {
  it("vision-inspector-prompt.md matches VISION_INSPECTOR_PROMPT_TEMPLATE byte-for-byte", () => {
    const mdPath = path.join(__dirname, "..", "vision-inspector-prompt.md");
    const md = fs.readFileSync(mdPath, "utf-8").trim();
    const cnst = VISION_INSPECTOR_PROMPT_TEMPLATE.trim();
    expect(cnst).toBe(md);
  });

  it("the prompt contains fixability guide (Phase Beta 3)", () => {
    expect(VISION_INSPECTOR_PROMPT_TEMPLATE).toContain("fixable");
    expect(VISION_INSPECTOR_PROMPT_TEMPLATE).toContain("recommended_patch_type");
    expect(VISION_INSPECTOR_PROMPT_TEMPLATE).toContain("FIXABILITY GUIDE");
    expect(VISION_INSPECTOR_PROMPT_TEMPLATE).toContain("force_parts");
    expect(VISION_INSPECTOR_PROMPT_TEMPLATE).toContain("manual_review");
  });
});
