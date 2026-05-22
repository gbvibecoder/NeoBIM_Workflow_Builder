/**
 * Unit tests for the pure KOS BIM filename classifiers (Week 5A). These
 * guard the SKU-extraction + categorisation logic that the ingestion
 * orchestrator depends on, against the real Dincel package filenames.
 */

import { describe, it, expect } from "vitest";
import {
  extractSkuFromFilename,
  detectAccessoryType,
  detectCategoryFromFolder,
  fileExtension,
  isSupportedBimExtension,
  mimeTypeForExtension,
} from "@/features/kos/lib/kos-bim-naming";

describe("extractSkuFromFilename", () => {
  it.each([
    ["Profile_DIN-200P-1.rfa", "DIN-200P-1"],
    ["Track_DIN-110P-EG.rfa", "DIN-110P-EG"],
    ["Corner_DIN_110P-3.rfa", "DIN-110P-3"],
    ["DIN-200P-Standard.rfa", "DIN-200P-Standard"],
    ["EndCap_DIN_200P-EC.rfa", "DIN-200P-EC"],
    ["StopEnd_DIN_155P-SE.rfa", "DIN-155P-SE"],
    ["Joiner_DIN_110P-J.rfa", "DIN-110P-J"],
    ["Spacer_DIN-200P-2.rfa", "DIN-200P-2"],
    ["Finishes_DIN.rfa", "DIN"],
    ["DIN-200P-AngleArray.rfa", "DIN-200P-AngleArray"],
  ])("%s → %s", (filename, expected) => {
    expect(extractSkuFromFilename(filename)).toBe(expected);
  });

  it("tolerates a full path", () => {
    expect(extractSkuFromFilename("/abs/profiles/Profile_DIN-275P-WS.rfa")).toBe(
      "DIN-275P-WS",
    );
  });
});

describe("detectAccessoryType", () => {
  it.each([
    ["Track_DIN-110P-EG.rfa", "TRACK"],
    ["Finishes_DIN.rfa", "FINISH"],
    ["Voids_DIN.rfa", "VOID"],
    ["Corner_DIN_110P-3.rfa", "CORNER"],
    ["Joiner_DIN_110P-J.rfa", "JOINER"],
    ["EndCap_DIN_110P-EC.rfa", "END_CAP"],
    ["StopEnd_DIN_155P-SE.rfa", "STOP_END"],
    ["Spacer_DIN-200P-2.rfa", "SPACER"],
    ["Angle_DIN-200P-4.rfa", "ANGLE"],
    ["DIN-200P-Standard.rfa", "OTHER"],
  ] as const)("%s → %s", (filename, expected) => {
    expect(detectAccessoryType(filename)).toBe(expected);
  });
});

describe("detectCategoryFromFolder", () => {
  it("maps folders to categories", () => {
    expect(detectCategoryFromFolder("profiles", "Profile_DIN-200P-1.rfa")).toBe(
      "PANEL",
    );
    expect(detectCategoryFromFolder("vertical", "Angle_DIN-200P-4.rfa")).toBe(
      "ACCESSORY",
    );
    expect(detectCategoryFromFolder("horizontal", "Track_DIN-110P-G.rfa")).toBe(
      "ACCESSORY",
    );
    expect(detectCategoryFromFolder("systems", "DIN-200P-Standard.rfa")).toBe(
      "ASSEMBLY",
    );
  });

  it("classifies the root .dwg as REFERENCE", () => {
    expect(
      detectCategoryFromFolder(null, "dincel-profiles-and-accessories.dwg"),
    ).toBe("REFERENCE");
  });

  it("falls back to OTHER for an unknown folder / non-dwg root file", () => {
    expect(detectCategoryFromFolder("misc", "something.rfa")).toBe("OTHER");
    expect(detectCategoryFromFolder(null, "stray.rfa")).toBe("OTHER");
  });
});

describe("extension helpers", () => {
  it("extracts a lower-cased extension", () => {
    expect(fileExtension("Profile_DIN-200P-1.RFA")).toBe(".rfa");
    expect(fileExtension("catalog.dwg")).toBe(".dwg");
    expect(fileExtension("noext")).toBe("");
  });

  it("recognises supported extensions", () => {
    expect(isSupportedBimExtension(".rfa")).toBe(true);
    expect(isSupportedBimExtension(".DWG")).toBe(true);
    expect(isSupportedBimExtension(".pdf")).toBe(false);
  });

  it("maps extension → APS mime type", () => {
    expect(mimeTypeForExtension(".rfa")).toBe("application/octet-stream");
    expect(mimeTypeForExtension(".dwg")).toBe("image/vnd.dwg");
    expect(mimeTypeForExtension(".ifc")).toBe("application/x-step");
    expect(mimeTypeForExtension(".xyz")).toBe("application/octet-stream");
  });
});
