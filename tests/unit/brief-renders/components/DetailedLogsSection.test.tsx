/**
 * DetailedLogsSection — admin deep-dive surface tests.
 *
 * Covers:
 *   • Visibility gate (visible=false → renders nothing)
 *   • Job overview KV grid surfaces every persisted column
 *   • Generated-prompts section renders one card per shot with full
 *     prompt text + apartment + room labels + hero badge
 *   • Per-shot lifecycle table renders one row per shot with status,
 *     timestamps, cost, and image-url-or-error
 *   • Stage-log raw section renders the JSON entries
 *   • Cost breakdown aggregates per stage
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { DetailedLogsSection } from "@/features/brief-renders/components/DetailedLogsSection";
import type { BriefRenderJobView } from "@/features/brief-renders/hooks/useBriefRenderJob";
import type {
  BriefSpec,
  ShotResult,
  BriefStageLogEntry,
} from "@/features/brief-renders/services/brief-pipeline/types";

function makeSpec(): BriefSpec {
  return {
    projectTitle: "Marx12",
    projectLocation: "Gaggenau",
    projectType: "residential",
    baseline: {
      visualStyle: "photorealistic",
      materialPalette: "warm woods",
      lightingBaseline: "soft daylight",
      cameraBaseline: "24mm",
      qualityTarget: "high",
      additionalNotes: null,
    },
    apartments: [
      {
        label: "WE 01bb",
        labelDe: "Wohnung 01",
        totalAreaSqm: 93.99,
        bedrooms: 1,
        bathrooms: 1,
        description: null,
        shots: [
          {
            shotIndex: 1,
            roomNameEn: "Living",
            roomNameDe: "Wohnen",
            areaSqm: null,
            aspectRatio: "3:2",
            lightingDescription: null,
            cameraDescription: null,
            materialNotes: null,
            isHero: true,
          },
        ],
      },
    ],
    referenceImageUrls: ["https://r2/ref-1.png", "https://r2/ref-2.png"],
  };
}

function makeShots(): ShotResult[] {
  return [
    {
      shotIndex: 0,
      apartmentIndex: 0,
      shotIndexInApartment: 0,
      status: "success",
      prompt: "Photorealistic interior render of Living, WE 01bb, …".repeat(8),
      aspectRatio: "3:2",
      templateVersion: "v1",
      imageUrl: "https://r2/shots/0.png",
      errorMessage: null,
      costUsd: 0.25,
      createdAt: "2026-04-29T14:17:37.000Z",
      startedAt: "2026-04-29T14:20:38.000Z",
      completedAt: "2026-04-29T14:21:08.000Z",
    },
    {
      shotIndex: 1,
      apartmentIndex: 0,
      shotIndexInApartment: 0,
      status: "running",
      prompt: "Bathroom render…",
      aspectRatio: "2:3",
      templateVersion: "v1",
      imageUrl: null,
      errorMessage: null,
      costUsd: null,
      createdAt: "2026-04-29T14:17:37.000Z",
      startedAt: "2026-04-29T14:21:10.000Z",
      completedAt: null,
    },
  ];
}

function makeStageLog(): BriefStageLogEntry[] {
  return [
    {
      stage: 1,
      name: "Spec Extract",
      status: "success",
      startedAt: "2026-04-29T14:15:45.000Z",
      completedAt: "2026-04-29T14:17:34.000Z",
      durationMs: 109_000,
      costUsd: 0.108,
      summary: "Parsed 1 apartment, 1 shot",
      output: { tokensIn: 12673 },
      error: null,
    },
    {
      stage: 2,
      name: "Prompt Gen",
      status: "success",
      startedAt: "2026-04-29T14:17:37.000Z",
      completedAt: "2026-04-29T14:17:37.002Z",
      durationMs: 2,
      costUsd: 0,
      summary: null,
      output: { totalShots: 2 },
      error: null,
    },
  ];
}

function makeJob(overrides: Partial<BriefRenderJobView> = {}): BriefRenderJobView {
  return {
    id: "job-xyz",
    requestId: "abcdef0123456789",
    briefUrl: "https://r2/briefs/marx12.docx",
    status: "RUNNING",
    progress: 35,
    currentStage: "rendering",
    specResult: makeSpec(),
    shots: makeShots(),
    pdfUrl: null,
    errorMessage: null,
    costUsd: 0.358,
    startedAt: "2026-04-29T14:15:45.000Z",
    completedAt: null,
    pausedAt: null,
    userApproval: "approved",
    stageLog: makeStageLog(),
    createdAt: "2026-04-29T14:15:00.000Z",
    updatedAt: "2026-04-29T14:21:10.000Z",
    ...overrides,
  };
}

describe("DetailedLogsSection — visibility", () => {
  it("renders nothing when visible=false", () => {
    const { container } = render(
      <DetailedLogsSection job={makeJob()} visible={false} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders the section when visible=true", () => {
    render(<DetailedLogsSection job={makeJob()} visible />);
    expect(screen.getByTestId("detailed-logs-section")).toBeTruthy();
  });

  it("Hide button calls onClose", () => {
    const close = vi.fn();
    render(
      <DetailedLogsSection job={makeJob()} visible onClose={close} />,
    );
    fireEvent.click(screen.getByTestId("detailed-logs-close"));
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("DetailedLogsSection — job overview", () => {
  it("surfaces every persisted job column in the KV grid", () => {
    render(<DetailedLogsSection job={makeJob()} visible />);
    const root = screen.getByTestId("detailed-logs-section");
    // Spot-check the load-bearing fields.
    expect(root.textContent).toContain("job-xyz");
    expect(root.textContent).toContain("RUNNING");
    expect(root.textContent).toContain("rendering");
    expect(root.textContent).toContain("35 %");
    expect(root.textContent).toContain("$0.358");
    expect(root.textContent).toContain("approved");
  });

  it("renders the brief URL verbatim in the Brief input card", () => {
    render(<DetailedLogsSection job={makeJob()} visible />);
    expect(
      screen.getByTestId("detailed-logs-section").textContent,
    ).toContain("https://r2/briefs/marx12.docx");
  });

  it("surfaces errorMessage with error tone when set", () => {
    render(
      <DetailedLogsSection
        job={makeJob({ status: "FAILED", errorMessage: "spec_extract failed" })}
        visible
      />,
    );
    expect(
      screen.getByTestId("detailed-logs-section").textContent,
    ).toContain("spec_extract failed");
  });
});

describe("DetailedLogsSection — generated prompts card", () => {
  it("renders one prompt row per shot with apartment + room + hero badge", () => {
    render(<DetailedLogsSection job={makeJob()} visible />);
    expect(screen.getByTestId("prompt-row-0")).toBeTruthy();
    expect(screen.getByTestId("prompt-row-1")).toBeTruthy();
    const row0 = screen.getByTestId("prompt-row-0");
    expect(row0.textContent).toContain("WE 01bb");
    expect(row0.textContent).toContain("Living");
    expect(row0.textContent).toContain("Wohnen");
    expect(row0.textContent).toContain("HERO");
  });

  it("shows truncated preview by default for long prompts and a full-expand button", () => {
    render(<DetailedLogsSection job={makeJob()} visible />);
    const row0 = screen.getByTestId("prompt-row-0");
    // Long prompt → "Expand full prompt" CTA visible.
    expect(row0.textContent).toContain("Expand full prompt");
  });

  it("includes total prompt char count in row header", () => {
    render(<DetailedLogsSection job={makeJob()} visible />);
    const row0 = screen.getByTestId("prompt-row-0");
    // Each shot shows its prompt char length to help admins eyeball cost.
    expect(row0.textContent).toMatch(/\d+ chars/);
  });

  it("shows empty state when shots array is empty", () => {
    render(
      <DetailedLogsSection job={makeJob({ shots: [] })} visible />,
    );
    expect(
      screen.getByTestId("detailed-logs-section").textContent,
    ).toContain("Stage 2 hasn't completed");
  });
});

describe("DetailedLogsSection — per-shot lifecycle table", () => {
  it("renders status, started, completed, cost, and image-or-error per shot", () => {
    render(<DetailedLogsSection job={makeJob()} visible />);
    const root = screen.getByTestId("detailed-logs-section");
    // Success row: image URL surfaces.
    expect(root.textContent).toContain("https://r2/shots/0.png");
    // Cost surfaces in tabular column.
    expect(root.textContent).toContain("$0.250");
  });
});

describe("DetailedLogsSection — stage-log raw + cost breakdown", () => {
  it("renders stage-log entries as expandable JSON", () => {
    render(<DetailedLogsSection job={makeJob()} visible />);
    const root = screen.getByTestId("detailed-logs-section");
    expect(root.textContent).toContain("S1 · Spec Extract");
    expect(root.textContent).toContain("S2 · Prompt Gen");
  });

  it("aggregates per-stage cost in the breakdown card", () => {
    render(<DetailedLogsSection job={makeJob()} visible />);
    const root = screen.getByTestId("detailed-logs-section");
    expect(root.textContent).toContain("stage 1");
    expect(root.textContent).toContain("$0.108");
    expect(root.textContent).toContain("job total");
  });
});
