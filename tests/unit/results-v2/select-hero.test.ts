/**
 * Phase E — select-hero determinism + cascade tests.
 *
 * Asserts every branch of the priority cascade in `selectHero()` and runs a
 * 200-call fuzz loop to prove the function never throws on random input.
 */

import { describe, it, expect } from "vitest";
import { selectHero } from "@/features/results-v2/lib/select-hero";
import type {
  ExecutionResult,
  HeroVariant,
  Result3D,
  ResultFloorPlan,
  ResultMetric,
  ResultVideo,
} from "@/features/results-v2/types";

const HERO_VARIANTS: readonly HeroVariant[] = [
  "video",
  "image",
  "viewer3d",
  "floorPlan",
  "kpi",
  "skeleton",
];

function baseResult(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    executionId: "test-exec",
    workflowId: "test-wf",
    workflowName: "Test Workflow",
    status: {
      state: "success",
      startedAt: "2026-04-24T00:00:00.000Z",
      completedAt: "2026-04-24T00:00:30.000Z",
      durationMs: 30_000,
    },
    video: null,
    images: [],
    model3d: null,
    floorPlan: null,
    tables: [],
    metrics: [],
    boqTotalGfa: null,
    boqCurrencySymbol: null,
    downloads: [],
    pipeline: [],
    models: [],
    summaryText: null,
    ...overrides,
  };
}

function makeVideo(o: Partial<ResultVideo> = {}): ResultVideo {
  return {
    nodeId: "n-video",
    videoUrl: "https://example.test/walk.mp4",
    downloadUrl: "https://example.test/walk.mp4",
    name: "walk.mp4",
    durationSeconds: 15,
    shotCount: 2,
    status: "complete",
    ...o,
  };
}

describe("selectHero — priority cascade", () => {
  it("picks skeleton when pending/running with no terminal artifacts", () => {
    const res = baseResult({
      status: {
        state: "pending",
        startedAt: null,
        completedAt: null,
        durationMs: null,
      },
    });
    expect(selectHero(res)).toBe("skeleton");
  });

  it("picks skeleton when running with no artifacts", () => {
    const res = baseResult({
      status: {
        state: "running",
        startedAt: "2026-04-24T00:00:00.000Z",
        completedAt: null,
        durationMs: null,
      },
    });
    expect(selectHero(res)).toBe("skeleton");
  });

  it("picks video when a complete video artifact exists", () => {
    expect(selectHero(baseResult({ video: makeVideo() }))).toBe("video");
  });

  it("picks video when videoJobId is set even with empty videoUrl", () => {
    // VIDEO_BG_JOBS path — the job id is enough to route to the video hero;
    // HeroVideo falls back to HeroSkeleton internally when the URL is empty.
    const res = baseResult({
      video: makeVideo({
        videoUrl: "",
        downloadUrl: "",
        videoJobId: "job-123",
        status: "rendering",
      }),
    });
    expect(selectHero(res)).toBe("video");
  });

  it("does NOT pick video when status is failed and no URL", () => {
    const res = baseResult({
      video: makeVideo({ videoUrl: "", status: "failed" }),
    });
    expect(selectHero(res)).not.toBe("video");
  });

  it("picks viewer3d for procedural 3D models", () => {
    const model: Result3D = {
      kind: "procedural",
      floors: 5,
      height: 20,
      footprint: 500,
      gfa: 2500,
      buildingType: "Mixed-Use",
    };
    expect(selectHero(baseResult({ model3d: model }))).toBe("viewer3d");
  });

  it("picks viewer3d for glb models", () => {
    const model: Result3D = { kind: "glb", glbUrl: "https://example.test/b.glb" };
    expect(selectHero(baseResult({ model3d: model }))).toBe("viewer3d");
  });

  it("picks viewer3d for html-iframe models", () => {
    const model: Result3D = { kind: "html-iframe", iframeUrl: "https://example.test/v.html" };
    expect(selectHero(baseResult({ model3d: model }))).toBe("viewer3d");
  });

  it("picks floorPlan for interactive / editor / svg floor plans", () => {
    const fp: ResultFloorPlan = { kind: "svg", svg: "<svg/>", label: "Plan" };
    expect(selectHero(baseResult({ floorPlan: fp }))).toBe("floorPlan");

    const fpEditor: ResultFloorPlan = {
      kind: "editor",
      sourceImageUrl: "https://example.test/plan.png",
      label: "Editor",
    };
    expect(selectHero(baseResult({ floorPlan: fpEditor }))).toBe("floorPlan");

    const fpInteractive: ResultFloorPlan = { kind: "interactive", label: "Interactive" };
    expect(selectHero(baseResult({ floorPlan: fpInteractive }))).toBe("floorPlan");
  });

  it("picks image when images[] exists and no higher-priority artifact", () => {
    expect(
      selectHero(
        baseResult({
          images: ["https://example.test/a.png", "https://example.test/b.png"],
        }),
      ),
    ).toBe("image");
  });

  it("picks kpi when metrics.length ≥ 2 and no higher-priority artifact", () => {
    const metrics: ResultMetric[] = [
      { label: "Rooms", value: 5 },
      { label: "Walls", value: 14 },
    ];
    expect(selectHero(baseResult({ metrics }))).toBe("kpi");
  });

  it("picks kpi when boqTotalGfa is set (even without metrics)", () => {
    expect(selectHero(baseResult({ boqTotalGfa: 5120 }))).toBe("kpi");
  });

  it("picks skeleton as the final fallback when success + no artifacts + no metrics", () => {
    expect(selectHero(baseResult())).toBe("skeleton");
  });

  it("honors priority — video trumps everything else", () => {
    const res = baseResult({
      video: makeVideo(),
      model3d: { kind: "procedural", floors: 5 },
      images: ["https://example.test/a.png"],
      floorPlan: { kind: "svg", svg: "<svg/>", label: "P" },
      metrics: [
        { label: "A", value: 1 },
        { label: "B", value: 2 },
      ],
    });
    expect(selectHero(res)).toBe("video");
  });

  it("honors priority — viewer3d trumps image/kpi when no video", () => {
    const res = baseResult({
      model3d: { kind: "glb", glbUrl: "https://example.test/b.glb" },
      images: ["https://example.test/a.png"],
      metrics: [
        { label: "A", value: 1 },
        { label: "B", value: 2 },
      ],
    });
    expect(selectHero(res)).toBe("viewer3d");
  });

  it("is deterministic — same input → same output", () => {
    const res = baseResult({
      video: makeVideo(),
      metrics: [{ label: "Shots", value: 4 }],
    });
    const first = selectHero(res);
    for (let i = 0; i < 10; i++) {
      expect(selectHero(res)).toBe(first);
    }
  });
});

describe("selectHero — fuzz (200 random results, zero throws)", () => {
  it("returns a valid HeroVariant for every random ExecutionResult", () => {
    const coverage: Record<HeroVariant, number> = {
      video: 0,
      image: 0,
      viewer3d: 0,
      floorPlan: 0,
      kpi: 0,
      skeleton: 0,
    };

    for (let i = 0; i < 200; i++) {
      const res = randomResult(i);
      let picked: HeroVariant;
      expect(() => {
        picked = selectHero(res);
      }).not.toThrow();
      // @ts-expect-error — picked is assigned inside the callback above.
      coverage[picked] += 1;
      // @ts-expect-error — picked is assigned inside the callback above.
      expect(HERO_VARIANTS).toContain(picked);
    }

    // Log coverage so the report can include it (visible via `vitest run`).
    console.info("[select-hero fuzz coverage]", JSON.stringify(coverage));

    // The "does it throw" assertion is the core property this fuzz guards.
    // Coverage is observed (reported above) rather than asserted — a biased
    // PRNG that favors video/viewer3d doesn't indicate a selectHero bug.
    const total = Object.values(coverage).reduce((a, b) => a + b, 0);
    expect(total).toBe(200);
  });

  it("hits every hero variant at least once across a curated input set", () => {
    const curated: Array<{ expected: HeroVariant; input: ExecutionResult }> = [
      { expected: "video", input: baseWith({ video: makeVideo() }) },
      { expected: "viewer3d", input: baseWith({ model3d: { kind: "procedural", floors: 5 } }) },
      { expected: "floorPlan", input: baseWith({ floorPlan: { kind: "svg", svg: "<svg/>", label: "p" } }) },
      { expected: "image", input: baseWith({ images: ["https://example.test/a.png"] }) },
      { expected: "kpi", input: baseWith({ boqTotalGfa: 5120 }) },
      { expected: "skeleton", input: baseWith({}) },
    ];
    for (const { expected, input } of curated) {
      expect(selectHero(input)).toBe(expected);
    }
  });
});

function baseWith(overrides: Partial<ExecutionResult>): ExecutionResult {
  return baseResult(overrides);
}

// ─── Fuzz helpers ───

function randomResult(seed: number): ExecutionResult {
  // Deterministic-ish — use seed to keep the test reproducible across CI runs.
  const bit = (n: number) => ((seed * 9301 + n * 49297) % 7) !== 0;
  const pick = (n: number) => (seed * 9301 + n * 49297) % 100;

  return {
    executionId: `fuzz-${seed}`,
    workflowId: "fuzz-wf",
    workflowName: "Fuzz Workflow",
    status: {
      state: bit(1)
        ? "success"
        : bit(2)
          ? "running"
          : bit(3)
            ? "partial"
            : "failed",
      startedAt: bit(4) ? "2026-04-24T00:00:00.000Z" : null,
      completedAt: bit(5) ? "2026-04-24T00:00:30.000Z" : null,
      durationMs: bit(6) ? 30_000 : null,
    },
    video: bit(7)
      ? {
          nodeId: `n-${seed}`,
          videoUrl: bit(8) ? "https://example.test/v.mp4" : "",
          downloadUrl: "",
          name: "v.mp4",
          durationSeconds: 15,
          shotCount: 2,
          status: bit(9) ? "complete" : "rendering",
          videoJobId: bit(10) ? `job-${seed}` : undefined,
        }
      : null,
    images: bit(11)
      ? Array.from({ length: pick(12) % 5 }, (_, i) => `https://example.test/img${seed}-${i}.png`)
      : [],
    model3d: bit(13)
      ? {
          kind: bit(14) ? "procedural" : bit(15) ? "glb" : "html-iframe",
          floors: pick(16),
          glbUrl: bit(15) ? "https://example.test/b.glb" : undefined,
          iframeUrl: "https://example.test/v.html",
        }
      : null,
    floorPlan: bit(17)
      ? {
          kind: bit(18) ? "svg" : bit(19) ? "editor" : "interactive",
          svg: "<svg/>",
          label: "Plan",
        }
      : null,
    tables: [],
    metrics: bit(20)
      ? Array.from({ length: pick(21) % 5 }, (_, i) => ({ label: `M${i}`, value: i }))
      : [],
    boqTotalGfa: bit(22) ? pick(23) * 10 : null,
    boqCurrencySymbol: null,
    downloads: [],
    pipeline: [],
    models: [],
    summaryText: null,
  };
}
