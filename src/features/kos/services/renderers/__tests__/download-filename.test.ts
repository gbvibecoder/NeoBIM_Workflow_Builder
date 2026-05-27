/**
 * Tests for buildDownloadFilename — sanitization, fallback, length cap,
 * and the BOQ/Formwork prefix/extension contract.
 *
 * Per V7, `sanitizeFilename` strips non-`[A-Za-z0-9._-]` to `_` and
 * collapses underscore runs. PR 4's wrapper has additional rules:
 * empty/all-invalid sanitize-result → drawing-id fallback (NOT the
 * `"drawing.dxf"` sentinel that bleeds through).
 */

import { describe, expect, it } from "vitest";

import { buildDownloadFilename } from "../download-filename";

describe("buildDownloadFilename — basic naming", () => {
  it("appends .xlsx with BOQ_ prefix for kind=boq", () => {
    const out = buildDownloadFilename("plan.dxf", "boq");
    expect(out).toMatch(/^BOQ_.*\.xlsx$/);
  });

  it("appends .pdf with Formwork_quantities_ prefix for kind=formwork", () => {
    const out = buildDownloadFilename("plan.dxf", "formwork");
    expect(out).toMatch(/^Formwork_quantities_.*\.pdf$/);
  });

  it("strips the trailing extension before sanitizing", () => {
    const out = buildDownloadFilename("MyPlan.dxf", "boq");
    expect(out).toBe("BOQ_MyPlan.xlsx");
  });

  it("strips only the LAST extension on multi-dot stems", () => {
    const out = buildDownloadFilename("file.v2.dxf", "boq");
    // sanitizeFilename keeps dots in `file.v2`, so the output is BOQ_file.v2.xlsx
    expect(out).toBe("BOQ_file.v2.xlsx");
  });

  it("handles no-extension input gracefully", () => {
    const out = buildDownloadFilename("justname", "boq");
    expect(out).toBe("BOQ_justname.xlsx");
  });
});

describe("buildDownloadFilename — sanitization (delegates to filename-sanitize)", () => {
  it("sanitizes the real customer filename from the PDF probe", () => {
    const out = buildDownloadFilename(
      "90VR-MR-AD-2501[J]-Concrete Setout Plan-Basement-Part 2.pdf",
      "boq",
    );
    // sanitizeFilename replaces unsafe chars with _ then collapses runs.
    // Spaces and brackets all become _. Length-cap at 64 (sanitize helper).
    expect(out.startsWith("BOQ_")).toBe(true);
    expect(out.endsWith(".xlsx")).toBe(true);
    expect(out).not.toContain(" ");
    expect(out).not.toContain("[");
    expect(out).not.toContain("]");
  });

  it("THREAT: path-traversal input → no path separators in output", () => {
    const out = buildDownloadFilename("../../etc/passwd.dxf", "boq");
    expect(out).not.toContain("/");
    expect(out).not.toContain("\\");
    expect(out).not.toContain("..");
    // Should be SOMETHING — sanitizeFilename collapses the safe basename
    expect(out.startsWith("BOQ_")).toBe(true);
  });

  it("THREAT: shell-metacharacter input → all stripped", () => {
    const out = buildDownloadFilename(`"; rm -rf /; ".dxf`, "formwork");
    expect(out).not.toContain(";");
    expect(out).not.toContain('"');
    expect(out).not.toContain("/");
    expect(out.endsWith(".pdf")).toBe(true);
  });

  it("does NOT crash on Unicode input (transliteration not required)", () => {
    expect(() => buildDownloadFilename("图纸-1.dxf", "boq")).not.toThrow();
    const out = buildDownloadFilename("图纸-1.dxf", "boq");
    expect(out.startsWith("BOQ_")).toBe(true);
    expect(out.endsWith(".xlsx")).toBe(true);
  });

  it("special chars become underscores", () => {
    const out = buildDownloadFilename(`file<>?:|*.dxf`, "boq");
    expect(out).not.toMatch(/[<>?:|*]/);
  });
});

describe("buildDownloadFilename — empty / fallback", () => {
  it("empty input with no fallback drawingId → BOQ_Drawing.xlsx", () => {
    const out = buildDownloadFilename("", "boq");
    expect(out).toBe("BOQ_Drawing.xlsx");
  });

  it("empty input WITH fallback drawingId → BOQ_Drawing-<id>.xlsx with non-alphanumeric stripped", () => {
    const out = buildDownloadFilename("", "boq", "cuid_abcdefghijklmnop");
    // The id's underscore is stripped by the [^A-Za-z0-9] regex; first 8 chars
    // of the result are taken. So `cuid_abcdefghijklmnop` → `cuidabcd...` → first 8 = `cuidabcd`.
    expect(out).toBe("BOQ_Drawing-cuidabcd.xlsx");

    const out2 = buildDownloadFilename("", "formwork", "cuid_abcdefghijklmnop");
    expect(out2.startsWith("Formwork_quantities_Drawing-")).toBe(true);
    expect(out2.endsWith(".pdf")).toBe(true);
  });

  it("input that sanitizes to the 'drawing.dxf' sentinel → fallback (NOT literal sentinel in output)", () => {
    // Test the explicit fallback detection — single invalid character
    // → sanitizeFilename returns "drawing.dxf" which we treat as empty.
    const out = buildDownloadFilename("?", "boq", "myDrawingId123");
    expect(out).not.toContain("drawing.dxf");
    expect(out.startsWith("BOQ_Drawing-")).toBe(true);
  });

  it("extension-only input → fallback used", () => {
    // ".dxf" → base = "" (after extension strip) → sanitize fallback → our fallback
    const out = buildDownloadFilename(".dxf", "boq", "draw_1");
    expect(out).not.toContain("drawing.dxf");
    expect(out.startsWith("BOQ_Drawing-")).toBe(true);
  });

  it("non-string input does NOT crash (defensive)", () => {
    // TS would reject, but runtime callers can be sloppy.
    expect(() => buildDownloadFilename(undefined as unknown as string, "boq")).not.toThrow();
    const out = buildDownloadFilename(undefined as unknown as string, "boq", "id_xyz");
    expect(out).toMatch(/^BOQ_Drawing/);
  });
});

describe("buildDownloadFilename — kind discrimination", () => {
  it("same input produces different filenames per kind", () => {
    const a = buildDownloadFilename("plan.dxf", "boq");
    const b = buildDownloadFilename("plan.dxf", "formwork");
    expect(a).not.toBe(b);
    expect(a).toMatch(/\.xlsx$/);
    expect(b).toMatch(/\.pdf$/);
  });
});
