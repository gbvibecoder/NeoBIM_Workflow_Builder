/**
 * ShotGrid + composeLabel tests.
 * @vitest-environment happy-dom
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { ShotGrid } from "@/features/brief-renders/components/ShotGrid";
import type {
  BriefSpec,
  ShotResult,
} from "@/features/brief-renders/services/brief-pipeline/types";

// Stub global fetch so the inner ShotCell's regen button (if clicked
// in any future test) doesn't escape into the network. ShotGrid itself
// doesn't fetch, but ShotCell's effect-free render is safe.
vi.stubGlobal("fetch", vi.fn());

function makeSpec(): BriefSpec {
  return {
    projectTitle: "Marx12",
    projectLocation: null,
    projectType: null,
    baseline: {
      visualStyle: null,
      materialPalette: null,
      lightingBaseline: null,
      cameraBaseline: null,
      qualityTarget: null,
      additionalNotes: null,
    },
    apartments: [
      {
        label: "Apt A",
        labelDe: null,
        totalAreaSqm: null,
        bedrooms: null,
        bathrooms: null,
        description: null,
        shots: [
          {
            shotIndex: 1,
            roomNameEn: "Living Room",
            roomNameDe: null,
            areaSqm: null,
            aspectRatio: "3:2",
            lightingDescription: null,
            cameraDescription: null,
            materialNotes: null,
            isHero: true,
          },
        ],
      },
      {
        label: null, // null label → graceful fallback
        labelDe: null,
        totalAreaSqm: null,
        bedrooms: null,
        bathrooms: null,
        description: null,
        shots: [
          {
            shotIndex: 1,
            roomNameEn: null, // null room → falls back to "Shot N"
            roomNameDe: null,
            areaSqm: null,
            aspectRatio: "1:1",
            lightingDescription: null,
            cameraDescription: null,
            materialNotes: null,
            isHero: false,
          },
        ],
      },
    ],
    referenceImageUrls: [],
  };
}

function makeShots(): ShotResult[] {
  return [
    {
      shotIndex: 0,
      apartmentIndex: 0,
      shotIndexInApartment: 0,
      status: "success",
      prompt: "p1",
      aspectRatio: "3:2",
      templateVersion: "v1",
      imageUrl: "https://r2/s0.png",
      errorMessage: null,
      costUsd: 0.25,
      createdAt: "2026-04-28T10:00:00Z",
      startedAt: null,
      completedAt: null,
    },
    {
      shotIndex: 1,
      apartmentIndex: 1,
      shotIndexInApartment: 0,
      status: "pending",
      prompt: "p2",
      aspectRatio: "1:1",
      templateVersion: "v1",
      imageUrl: null,
      errorMessage: null,
      costUsd: null,
      createdAt: "2026-04-28T10:00:00Z",
      startedAt: null,
      completedAt: null,
    },
  ];
}

describe("ShotGrid", () => {
  it("renders one cell per shot regardless of apartment count", () => {
    render(
      <ShotGrid jobId="job-1" spec={makeSpec()} shots={makeShots()} />,
    );
    const grid = screen.getByTestId("shot-grid");
    expect(grid.getAttribute("data-shot-count")).toBe("2");
    expect(screen.getByTestId("shot-cell-0")).toBeTruthy();
    expect(screen.getByTestId("shot-cell-1")).toBeTruthy();
  });

  it('label is "Apartment · Room" when both are present', () => {
    render(<ShotGrid jobId="job-1" spec={makeSpec()} shots={makeShots()} />);
    const cell = screen.getByTestId("shot-cell-0");
    expect(cell.textContent).toContain("Apt A · Living Room");
  });

  it('falls back to "Shot N" when both apartment label and room name are null', () => {
    render(<ShotGrid jobId="job-1" spec={makeSpec()} shots={makeShots()} />);
    const cell = screen.getByTestId("shot-cell-1");
    expect(cell.textContent).toContain("Shot 2");
  });

  it("shows empty state when shots array is empty", () => {
    render(<ShotGrid jobId="job-1" spec={makeSpec()} shots={[]} />);
    expect(screen.getByTestId("shot-grid-empty")).toBeTruthy();
  });

  it("renders failed state with the error message", () => {
    const failed = makeShots();
    failed[0] = {
      ...failed[0],
      status: "failed",
      imageUrl: null,
      errorMessage: "rate_limit_exceeded",
    };
    render(<ShotGrid jobId="job-1" spec={makeSpec()} shots={failed} />);
    const cell = screen.getByTestId("shot-cell-0");
    expect(cell.getAttribute("data-status")).toBe("failed");
    expect(cell.textContent).toContain("rate_limit_exceeded");
  });

  it("shot count is data-driven, not hardcoded — accepts arbitrary N", () => {
    const oneShot: ShotResult[] = [makeShots()[0]];
    const { rerender } = render(
      <ShotGrid jobId="job-1" spec={makeSpec()} shots={oneShot} />,
    );
    expect(screen.getByTestId("shot-grid").getAttribute("data-shot-count")).toBe(
      "1",
    );
    const fiveShots: ShotResult[] = Array.from({ length: 5 }, (_, i) => ({
      ...makeShots()[0],
      shotIndex: i,
    }));
    rerender(<ShotGrid jobId="job-1" spec={makeSpec()} shots={fiveShots} />);
    expect(screen.getByTestId("shot-grid").getAttribute("data-shot-count")).toBe(
      "5",
    );
  });
});
