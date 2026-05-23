/* @vitest-environment happy-dom */
/* V2 panorama integration test — `PanoramaSection` is now a controlled
   component (no internal apply/reset). After the Phase Z.IFC.2 compression
   pass the UI surface changed: the standalone "Detected:" chip and the
   "Staged: …" / "No panorama selected" status row were dropped, and the
   Tier-2 conflict warning became a toggle pill ("Ground skipped" ⇄
   "Ground kept"). These tests verify:
     · detected type seeds the building-type <select>
     · thumbnail click / dropdown change stage a selection (Clear appears)
     · Tier 2 conflict pill visibility + keep-override toggle
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
  it("detected building type seeds the bucket select", () => {
    const parseResult: ParseResultLike = {
      classifications: { nbc: ["Group A"] },
    };
    render(<Harness parseResult={parseResult} />);
    // The standalone "Detected:" chip was dropped; the detected bucket now
    // seeds the building-type <select> directly.
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.value).toBe(FIRST_RESIDENTIAL.bucket);
    expect(
      select.options[select.selectedIndex].textContent,
    ).toMatch(/Residential apartment/i);
  });

  it("clicking a thumbnail stages the selection via onSelectionChange", () => {
    render(<Harness parseResult={{ classifications: { nbc: ["Group A"] } }} />);
    // Nothing staged yet → no Clear control.
    expect(screen.queryByRole("button", { name: /Clear/i })).toBeNull();
    /* The first thumbnail in the residential bucket is `balcony`. */
    const thumb = screen.getByTitle(
      new RegExp(escapeRegex(FIRST_RESIDENTIAL.displayName), "i"),
    );
    fireEvent.click(thumb);
    // Selection bubbled to the parent → staged asset surfaces the Clear
    // control (the "Staged: …" row was removed in the redesign).
    expect(screen.getByRole("button", { name: /Clear/i })).toBeTruthy();
  });

  it("dropdown change preselects the first asset of the new bucket", () => {
    render(<Harness />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "office" } });
    // Bucket switched to office and its first asset was auto-staged
    // (Clear only renders when an asset is staged).
    expect(select.value).toBe("office");
    expect(screen.getByRole("button", { name: /Clear/i })).toBeTruthy();
  });

  it("Tier 2 conflict pill is hidden when no asset is staged", () => {
    render(<Harness initialTier2Ground={true} />);
    expect(screen.queryByText(/Ground (skipped|kept)/i)).toBeNull();
  });

  it("Tier 2 conflict pill appears when selection + tier2GroundEnabled", () => {
    render(<Harness initial={FIRST_RESIDENTIAL} initialTier2Ground={true} />);
    expect(screen.getByText(/Ground skipped/i)).toBeTruthy();
  });

  it("the tier-2 pill toggles between Ground skipped and Ground kept", () => {
    render(<Harness initial={FIRST_RESIDENTIAL} initialTier2Ground={true} />);
    const pill = screen.getByText(/Ground skipped/i);
    fireEvent.click(pill);
    // Clicking the pill flips the keep-override; the copy swaps.
    expect(screen.getByText(/Ground kept/i)).toBeTruthy();
  });

  it("Clear button removes the staged selection", () => {
    render(<Harness initial={FIRST_RESIDENTIAL} />);
    const clearBtn = screen.getByRole("button", { name: /Clear/i });
    fireEvent.click(clearBtn);
    // Cleared → the Clear control unmounts (no asset staged).
    expect(screen.queryByRole("button", { name: /Clear/i })).toBeNull();
  });
});
