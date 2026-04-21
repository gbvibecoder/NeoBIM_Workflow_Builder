/**
 * Phase 2.6 — lock in the inverted feature-flag semantics for the VIP
 * worker. Before Phase 2.6, the gated (image approval) path required an
 * explicit opt-in via PIPELINE_VIP_APPROVAL_GATE=true. Phase 2.6 flipped
 * it: gated is the default, and the legacy monolithic flow is only
 * reachable via PIPELINE_VIP_MONOLITHIC=true as an emergency rollback.
 *
 * These tests are source-level — they inspect the worker route file to
 * make sure the old flag is gone and the new flag is present with the
 * expected "default to gated" branching.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const WORKER_ROUTE = readFileSync(
  join(process.cwd(), "src/app/api/vip-jobs/worker/route.ts"),
  "utf-8",
);

describe("Phase 2.6 — worker route feature-flag semantics", () => {
  it("does not reference the pre-Phase-2.6 PIPELINE_VIP_APPROVAL_GATE env var", () => {
    expect(WORKER_ROUTE).not.toContain("PIPELINE_VIP_APPROVAL_GATE");
    expect(WORKER_ROUTE).not.toContain("APPROVAL_GATE_ENABLED");
  });

  it("reads the inverted rollback flag PIPELINE_VIP_MONOLITHIC", () => {
    expect(WORKER_ROUTE).toContain("PIPELINE_VIP_MONOLITHIC");
    expect(WORKER_ROUTE).toMatch(/USE_MONOLITHIC_FALLBACK\s*=\s*process\.env\.PIPELINE_VIP_MONOLITHIC\s*===\s*"true"/);
  });

  it("routes to the gated Phase A path when the monolithic flag is NOT set", () => {
    // The branch condition must be `if (!USE_MONOLITHIC_FALLBACK)` —
    // unset / any-value-except-"true" falls through to gated.
    expect(WORKER_ROUTE).toMatch(/if\s*\(\s*!USE_MONOLITHIC_FALLBACK\s*\)/);
  });

  it("still imports both orchestrator entry points (gated default + monolithic fallback)", () => {
    expect(WORKER_ROUTE).toMatch(/runVIPPipelinePhaseA/);
    expect(WORKER_ROUTE).toMatch(/runVIPPipeline\b/);
  });
});
