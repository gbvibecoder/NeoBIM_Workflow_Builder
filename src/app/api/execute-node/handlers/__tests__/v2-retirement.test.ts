/**
 * v2 IFC pipeline retirement (2026-05-17).
 *
 * The execute-node handlers for TR-024 / TR-022 / EX-006 used to drive
 * the broken millimetre-scale v2 pipeline. After retirement they each
 * return HTTP 410 Gone with a structured `PIPELINE_RETIRED` error code,
 * pointing the caller at GN-013 (the v3 replacement).
 *
 * These tests pin the retirement behaviour so a future refactor that
 * accidentally re-enables the v2 handlers fails CI loudly.
 */

import { describe, expect, it } from "vitest";

import { handleTR022 } from "../tr-022";
import { handleTR024 } from "../tr-024";
import { handleEX006 } from "../ex-006";
import type { NodeHandlerContext } from "../types";

const baseCtx: NodeHandlerContext = {
  catalogueId: "TR-024",
  executionId: "exe-1",
  tileInstanceId: "tile-1",
  inputData: { brief: "irrelevant — v2 is retired" },
  userId: "user-1",
  userRole: "PRO",
  userEmail: "user@buildflow.dev",
  isAdmin: false,
  apiKey: undefined,
  dbExecutionId: undefined,
};

async function expectRetired(handler: typeof handleTR022) {
  const result = await handler(baseCtx);
  // Result is ExecutionArtifact | NextResponse; narrow to Response.
  if (!("status" in result)) {
    throw new Error(
      "expected a NextResponse (retirement returns 410), got an ExecutionArtifact",
    );
  }
  const res = result as Response;
  expect(res.status).toBe(410);
  const body = (await res.json()) as { error?: { code?: string } };
  expect(body.error?.code).toBe("PIPELINE_RETIRED");
}

describe("v2 IFC pipeline retirement", () => {
  it("TR-024 (Brief Enricher) returns 410 PIPELINE_RETIRED", async () => {
    await expectRetired(handleTR024);
  });
  it("TR-022 (IFC Architect) returns 410 PIPELINE_RETIRED", async () => {
    await expectRetired(handleTR022);
  });
  it("EX-006 (AI IFC Generator v2) returns 410 PIPELINE_RETIRED", async () => {
    await expectRetired(handleEX006);
  });
});
