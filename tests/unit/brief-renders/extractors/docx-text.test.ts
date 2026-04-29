/**
 * DOCX text extractor — unit tests.
 *
 * Two layers:
 *   • Mocked-mammoth scenarios — exercise the extractor's contract
 *     without depending on `mammoth` being installed (Phase 2 declares
 *     it in package.json but Rutik runs `npm install` separately).
 *   • Real-fixture happy-path — runs only when both the fixture file
 *     and the `mammoth` package are present. Skips cleanly otherwise
 *     so CI passes pre-`npm install` and pre-fixture.
 *
 * Required fixture (Rutik must drop in):
 *   `tests/fixtures/brief-renders/minimal-1ap-2shots.docx`
 *
 *   Single apartment "WE 01bb" with 2 shots:
 *     S1 "Open Kitchen-Dining" / "Kochen-Essen", 32.54 m², 3:2, golden hour
 *     S2 "Living" / "Wohnen", 19.24 m², 3:2, golden hour
 *   Baseline materials: oak floor, white walls, 2.5m ceilings.
 *   Both shots use the standard baseline.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import { EmptyDocxError } from "@/features/brief-renders/services/brief-pipeline/errors";
import {
  extractDocxText,
  _setMammothForTest,
} from "@/features/brief-renders/services/brief-pipeline/extractors/docx-text";

const FIXTURE_PATH = path.join(
  process.cwd(),
  "tests",
  "fixtures",
  "brief-renders",
  "minimal-1ap-2shots.docx",
);

const fixtureExists = fs.existsSync(FIXTURE_PATH);

function isMammothInstalled(): boolean {
  try {
    require.resolve("mammoth");
    return true;
  } catch {
    return false;
  }
}

const mammothInstalled = isMammothInstalled();

// ─── Mocked-mammoth scenarios (no install required) ─────────────────

describe("extractDocxText — mocked mammoth", () => {
  beforeEach(() => {
    _setMammothForTest({
      convertToHtml: async () => ({
        value: "<table><tr><td>WE 01bb</td><td>32.54 m²</td></tr></table>",
        messages: [],
      }),
      extractRawText: async () => ({
        value: "WE 01bb 32.54 m² Open Kitchen-Dining Kochen-Essen",
        messages: [],
      }),
    });
  });

  afterEach(() => {
    _setMammothForTest(null);
  });

  it("happy path — returns both html (table preserved) and rawText", async () => {
    const result = await extractDocxText(Buffer.from("fake docx"));
    expect(result.html).toContain("<table>");
    expect(result.html).toContain("WE 01bb");
    expect(result.rawText).toContain("WE 01bb");
    expect(result.rawText).toContain("Kochen-Essen");
  });

  it("empty DOCX (both html and raw empty) → throws EmptyDocxError", async () => {
    _setMammothForTest({
      convertToHtml: async () => ({ value: "", messages: [] }),
      extractRawText: async () => ({ value: "", messages: [] }),
    });
    await expect(extractDocxText(Buffer.from("fake"))).rejects.toBeInstanceOf(
      EmptyDocxError,
    );
  });

  it("DOCX with only HTML (no raw text) is still accepted", async () => {
    _setMammothForTest({
      convertToHtml: async () => ({ value: "<p>hello</p>", messages: [] }),
      extractRawText: async () => ({ value: "", messages: [] }),
    });
    const result = await extractDocxText(Buffer.from("fake"));
    expect(result.html).toBe("<p>hello</p>");
    expect(result.rawText).toBe("");
  });

  it("DOCX with only raw text (no HTML) is still accepted", async () => {
    _setMammothForTest({
      convertToHtml: async () => ({ value: "", messages: [] }),
      extractRawText: async () => ({ value: "hello world", messages: [] }),
    });
    const result = await extractDocxText(Buffer.from("fake"));
    expect(result.html).toBe("");
    expect(result.rawText).toBe("hello world");
  });

  it("Buffer and Uint8Array inputs both work — both reach mammoth as Buffer", async () => {
    let convertToHtmlCallCount = 0;
    const seen: Array<unknown> = [];
    _setMammothForTest({
      convertToHtml: async (input) => {
        convertToHtmlCallCount++;
        seen.push(input.buffer);
        return { value: "<p>x</p>", messages: [] };
      },
      extractRawText: async (input) => {
        seen.push(input.buffer);
        return { value: "x", messages: [] };
      },
    });

    const seed = Buffer.from("docx-bytes");
    const u8 = new Uint8Array(seed.byteLength);
    u8.set(seed);

    await extractDocxText(seed);
    await extractDocxText(u8);

    expect(convertToHtmlCallCount).toBe(2);
    for (const input of seen) {
      expect(Buffer.isBuffer(input)).toBe(true);
    }
  });

  it("mammoth throwing → re-throws (corrupt DOCX path)", async () => {
    _setMammothForTest({
      convertToHtml: async () => {
        throw new Error("DOCX is corrupt");
      },
      extractRawText: async () => ({ value: "", messages: [] }),
    });
    await expect(extractDocxText(Buffer.from("fake"))).rejects.toThrow(
      "DOCX is corrupt",
    );
  });
});

// ─── Real-fixture happy path (skipped when fixture or mammoth absent) ─

describe.skipIf(!fixtureExists || !mammothInstalled)(
  "extractDocxText — real fixture (Marx12-mini)",
  () => {
    it("extracts table-shaped content from the synthetic Marx12 brief", async () => {
      const buffer = fs.readFileSync(FIXTURE_PATH);
      const result = await extractDocxText(buffer);

      expect(result.html.length).toBeGreaterThan(0);
      // The fixture brief should have BOTH the apartment label and at
      // least one shot's bilingual room name in the raw text. The HTML
      // path should preserve a table block so downstream Claude can
      // identify the row-to-row mapping.
      expect(result.rawText).toMatch(/WE\s*01\s*bb/i);
      expect(result.rawText.length).toBeGreaterThan(0);
    });
  },
);

if (!fixtureExists || !mammothInstalled) {
  describe("extractDocxText — fixture / mammoth status", () => {
    it("logs why the real-fixture suite is skipped", () => {
      const reasons: string[] = [];
      if (!fixtureExists) reasons.push(`fixture missing at ${FIXTURE_PATH}`);
      if (!mammothInstalled) reasons.push("mammoth not installed");
      // eslint-disable-next-line no-console
      console.warn(
        `[docx-text.test] real-fixture suite skipped: ${reasons.join("; ")}`,
      );
      expect(reasons.length).toBeGreaterThan(0);
    });
  });
}
