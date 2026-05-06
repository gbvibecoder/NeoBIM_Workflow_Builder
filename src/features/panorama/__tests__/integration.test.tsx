/* @vitest-environment happy-dom */
/* V2 panorama integration test — `PanoramaSection` is now a controlled
   component (no internal apply/reset). These tests verify:
     · auto-detected type chip
     · thumbnail click bubbles up via onSelectionChange
     · Tier 2 conflict warning visibility + Keep override button
     · clearing selection
*/
import React, { useState } from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { PanoramaSection } from "@/features/panorama/components/PanoramaSection";
import {
  PANORAMA_MANIFEST,
  type PanoramaAsset,
} from "@/features/panorama/constants";
import type { ParseResultLike } from "@/features/panorama/types";

const FIRST_RESIDENTIAL = PANORAMA_MANIFEST["residential-apartment"][0];
const FIRST_OFFICE = PANORAMA_MANIFEST["office"][0];

/* Escape regex metachars in user-facing display names — Poly Haven slugs
   include parens like "Urban Rooftop (Day)" that would otherwise be
   interpreted as capture groups. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* Test harness — mirrors what IFCEnhancePanel does as the real parent. */
function Harness({
  initial,
  parseResult,
  initialTier2Ground = false,
}: {
  initial?: PanoramaAsset | null;
  parseResult?: ParseResultLike | null;
  initialTier2Ground?: boolean;
}) {
  const [staged, setStaged] = useState<PanoramaAsset | null>(initial ?? null);
  const [keep, setKeep] = useState(false);
  return (
    <PanoramaSection
      selectedAsset={staged}
      onSelectionChange={setStaged}
      parseResult={parseResult ?? null}
      tier2GroundEnabled={initialTier2Ground}
      keepTier2Override={keep}
      onToggleKeepTier2={() => setKeep((p) => !p)}
      lastAppliedSlug={null}
      disabled={false}
    />
  );
}

describe("PanoramaSection (V2 controlled picker)", () => {
  it("renders the detected-type chip from the parse result", () => {
    const parseResult: ParseResultLike = {
      classifications: { nbc: ["Group A"] },
    };
    render(<Harness parseResult={parseResult} />);
    expect(screen.getByText(/Detected:/i).textContent).toMatch(
      /Residential apartment/i,
    );
  });

  it("clicking a thumbnail bubbles selection via onSelectionChange", () => {
    render(<Harness parseResult={{ classifications: { nbc: ["Group A"] } }} />);
    /* The first thumbnail in the residential bucket is `balcony`. */
    const thumb = screen.getByTitle(new RegExp(escapeRegex(FIRST_RESIDENTIAL.displayName), "i"));
    fireEvent.click(thumb);
    /* The Status row should now show "Staged: <displayName>". */
    expect(screen.getByText(new RegExp(`Staged: ${escapeRegex(FIRST_RESIDENTIAL.displayName)}`, "i"))).toBeTruthy();
  });

  it("dropdown change preselects the first asset of the new bucket", () => {
    render(<Harness />);
    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "office" } });
    expect(screen.getByText(new RegExp(`Staged: ${escapeRegex(FIRST_OFFICE.displayName)}`, "i"))).toBeTruthy();
  });

  it("Tier 2 conflict warning is hidden when no asset is staged", () => {
    render(<Harness initialTier2Ground={true} />);
    expect(screen.queryByText(/Ground plane will be skipped/i)).toBeNull();
  });

  it("Tier 2 conflict warning appears when selection + tier2GroundEnabled", () => {
    render(<Harness initial={FIRST_RESIDENTIAL} initialTier2Ground={true} />);
    expect(screen.getByText(/Ground plane will be skipped/i)).toBeTruthy();
  });

  it('"Keep ground anyway" link toggles into "Skip ground"', () => {
    render(<Harness initial={FIRST_RESIDENTIAL} initialTier2Ground={true} />);
    const keepBtn = screen.getByText(/Keep ground anyway/i);
    fireEvent.click(keepBtn);
    /* After click, the warning text and link both swap. */
    expect(
      screen.getByText(/Ground plane will mount on top of the panorama/i),
    ).toBeTruthy();
    expect(screen.getByText(/Skip ground/i)).toBeTruthy();
  });

  it("Clear button removes the staged selection", () => {
    render(<Harness initial={FIRST_RESIDENTIAL} />);
    expect(
      screen.getByText(new RegExp(`Staged: ${escapeRegex(FIRST_RESIDENTIAL.displayName)}`, "i")),
    ).toBeTruthy();
    const clearBtn = screen.getByRole("button", { name: /Clear/i });
    fireEvent.click(clearBtn);
    expect(
      screen.getByText(/No panorama selected/i),
    ).toBeTruthy();
  });
});
