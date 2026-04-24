/**
 * Phase E — artifact-grouping tests.
 *
 * Asserts that `buildRibbon` yields entries in primary→supporting order and
 * `groupDownloads` buckets correctly per `kind`.
 */

import { describe, it, expect } from "vitest";
import { buildRibbon, groupDownloads } from "@/features/results-v2/lib/artifact-grouping";
import type { ExecutionResult } from "@/features/results-v2/types";

function base(overrides: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    executionId: "t",
    workflowId: "wf",
    workflowName: "T",
    status: { state: "success", startedAt: null, completedAt: null, durationMs: null },
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

describe("buildRibbon — primary→supporting ordering", () => {
  it("returns an empty ribbon when nothing is generated", () => {
    expect(buildRibbon(base())).toEqual([]);
  });

  it("leads with video when a video is present", () => {
    const entries = buildRibbon(
      base({
        video: {
          nodeId: "v",
          videoUrl: "u",
          downloadUrl: "u",
          name: "v.mp4",
          durationSeconds: 1,
          shotCount: 1,
          status: "complete",
        },
        images: ["https://example.test/a.png"],
      }),
    );
    expect(entries[0].id).toBe("video");
    expect(entries.map(e => e.id)).toContain("renders");
  });

  it("includes 3D Model chip when model3d is present", () => {
    const entries = buildRibbon(base({ model3d: { kind: "procedural", floors: 5 } }));
    expect(entries.map(e => e.id)).toContain("model3d");
  });

  it("labels BOQ chip when tables include a BOQ table", () => {
    const entries = buildRibbon(
      base({
        tables: [
          { label: "Bill of Quantities", headers: [], rows: [], isBoq: true },
        ],
      }),
    );
    expect(entries.map(e => e.id)).toContain("boq");
    // If a BOQ table exists, we don't double-emit a generic "tables" chip.
    expect(entries.map(e => e.id)).not.toContain("tables");
  });

  it("emits 'tables' when non-BOQ tables exist", () => {
    const entries = buildRibbon(
      base({ tables: [{ label: "Room Schedule", headers: [], rows: [] }] }),
    );
    expect(entries.map(e => e.id)).toContain("tables");
    expect(entries.map(e => e.id)).not.toContain("boq");
  });

  it("includes PDF chip when downloads include a .pdf", () => {
    const entries = buildRibbon(
      base({
        downloads: [
          { name: "report.pdf", kind: "document", sizeBytes: 1 },
          { name: "brief.csv", kind: "data", sizeBytes: 1 },
        ],
      }),
    );
    expect(entries.map(e => e.id)).toContain("pdf");
  });

  it("does not include PDF chip when no .pdf downloads", () => {
    const entries = buildRibbon(
      base({ downloads: [{ name: "brief.csv", kind: "data", sizeBytes: 1 }] }),
    );
    expect(entries.map(e => e.id)).not.toContain("pdf");
  });

  it("targetPanel is always one of the 5 panel ids", () => {
    const entries = buildRibbon(
      base({
        video: {
          nodeId: "v",
          videoUrl: "u",
          downloadUrl: "u",
          name: "v.mp4",
          durationSeconds: 1,
          shotCount: 1,
          status: "complete",
        },
        images: ["https://example.test/a.png"],
        metrics: [{ label: "Rooms", value: 7 }],
        downloads: [{ name: "r.pdf", kind: "document", sizeBytes: 1 }],
      }),
    );
    const allowed = new Set(["overview", "assets", "pipeline", "downloads", "notes"]);
    for (const e of entries) {
      expect(allowed.has(e.targetPanel)).toBe(true);
    }
  });
});

describe("groupDownloads — kind bucketing", () => {
  it("buckets each download into its declared kind", () => {
    const g = groupDownloads(
      base({
        downloads: [
          { name: "a.mp4", kind: "video", sizeBytes: 1 },
          { name: "b.glb", kind: "model3d", sizeBytes: 2 },
          { name: "c.pdf", kind: "document", sizeBytes: 3 },
          { name: "d.svg", kind: "drawing", sizeBytes: 4 },
          { name: "e.csv", kind: "data", sizeBytes: 5 },
          { name: "f.zip", kind: "other", sizeBytes: 6 },
        ],
      }),
    );
    expect(g.video).toHaveLength(1);
    expect(g.model3d).toHaveLength(1);
    expect(g.document).toHaveLength(1);
    expect(g.drawing).toHaveLength(1);
    expect(g.data).toHaveLength(1);
    expect(g.other).toHaveLength(1);
  });

  it("returns empty buckets for every kind when downloads=[]", () => {
    const g = groupDownloads(base());
    expect(g.video).toEqual([]);
    expect(g.model3d).toEqual([]);
    expect(g.document).toEqual([]);
    expect(g.drawing).toEqual([]);
    expect(g.data).toEqual([]);
    expect(g.other).toEqual([]);
  });
});
