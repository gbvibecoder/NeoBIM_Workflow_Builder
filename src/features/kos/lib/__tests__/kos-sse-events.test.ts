/**
 * Tests for kos-sse-events.ts — discriminator constants + type guard.
 *
 * These are regression catchers: if anyone renames an event type, the
 * test fails noisily and forces the rename to propagate to client,
 * server, and tests in lock-step.
 */

import { describe, expect, it, expectTypeOf } from "vitest";

import {
  SSE_EVT_DRAWING_STATUS,
  SSE_EVT_ARTIFACT_READY,
  SSE_EVT_ARTIFACT_FAILED,
  SSE_EVT_CLASSIFICATION_NEEDED,
  isDrawingSseEvent,
  type DrawingSseStatus,
  type DrawingStatusEvent,
  type ArtifactReadyEvent,
  type ArtifactFailedEvent,
  type ClassificationNeededEvent,
  type KosDrawingSseEvent,
} from "../kos-sse-events";

describe("SSE event discriminator constants — stable wire contract", () => {
  it('SSE_EVT_DRAWING_STATUS is the literal string "drawing_status"', () => {
    expect(SSE_EVT_DRAWING_STATUS).toBe("drawing_status");
  });

  it('SSE_EVT_ARTIFACT_READY is the literal string "artifact_ready"', () => {
    expect(SSE_EVT_ARTIFACT_READY).toBe("artifact_ready");
  });

  it('SSE_EVT_ARTIFACT_FAILED is the literal string "artifact_failed"', () => {
    expect(SSE_EVT_ARTIFACT_FAILED).toBe("artifact_failed");
  });

  it('SSE_EVT_CLASSIFICATION_NEEDED is the literal string "classification_needed"', () => {
    expect(SSE_EVT_CLASSIFICATION_NEEDED).toBe("classification_needed");
  });
});

describe("isDrawingSseEvent type guard", () => {
  it("returns true for each of the 4 PR 3 event types", () => {
    expect(isDrawingSseEvent({ type: "drawing_status" })).toBe(true);
    expect(isDrawingSseEvent({ type: "artifact_ready" })).toBe(true);
    expect(isDrawingSseEvent({ type: "artifact_failed" })).toBe(true);
    expect(isDrawingSseEvent({ type: "classification_needed" })).toBe(true);
  });

  it("returns false for each existing pre-PR-3 event type (regression catcher)", () => {
    for (const t of [
      "text_delta",
      "tool_call_start",
      "tool_call_result",
      "citations",
      "escalation",
      "done",
      "error",
    ]) {
      expect(isDrawingSseEvent({ type: t })).toBe(false);
    }
  });

  it("returns false for malformed / unknown event types", () => {
    expect(isDrawingSseEvent({ type: "" })).toBe(false);
    expect(isDrawingSseEvent({ type: "drawing_" })).toBe(false);
    expect(isDrawingSseEvent({ type: "drawing_unknown" })).toBe(false);
  });
});

describe("type shape compile-time checks", () => {
  it("DrawingSseStatus has 8 documented variants", () => {
    expectTypeOf<DrawingSseStatus>().toEqualTypeOf<
      | "PROCESSING_PARSE"
      | "PROCESSING_MAPPER"
      | "READY_FOR_GENERATION"
      | "GENERATING_BOQ"
      | "GENERATING_FORMWORK"
      | "COMPLETE"
      | "FAILED"
      | "NEEDS_CLASSIFICATION"
    >();
  });

  it("DrawingStatusEvent carries drawingId + status", () => {
    expectTypeOf<DrawingStatusEvent["drawingId"]>().toEqualTypeOf<string>();
    expectTypeOf<DrawingStatusEvent["status"]>().toEqualTypeOf<DrawingSseStatus>();
  });

  it("ArtifactReadyEvent carries kind 'boq' | 'formwork' and s3Key", () => {
    expectTypeOf<ArtifactReadyEvent["kind"]>().toEqualTypeOf<"boq" | "formwork">();
    expectTypeOf<ArtifactReadyEvent["s3Key"]>().toEqualTypeOf<string>();
  });

  it("ArtifactFailedEvent carries errorCode + errorMessage (always set)", () => {
    expectTypeOf<ArtifactFailedEvent["errorCode"]>().toEqualTypeOf<string>();
    expectTypeOf<ArtifactFailedEvent["errorMessage"]>().toEqualTypeOf<string>();
  });

  it("ClassificationNeededEvent carries suggestedHints (frozen list from kos-bot-constants)", () => {
    const ev: ClassificationNeededEvent = {
      type: SSE_EVT_CLASSIFICATION_NEEDED,
      drawingId: "draw_1",
      message: "What kind of wall?",
      suggestedHints: [{ id: "villa_external", label: "Villa external wall" }] as never,
    };
    expect(ev.suggestedHints).toHaveLength(1);
  });

  it("KosDrawingSseEvent is a tagged union of all four payloads", () => {
    const events: KosDrawingSseEvent[] = [
      { type: SSE_EVT_DRAWING_STATUS, drawingId: "d", status: "PROCESSING_PARSE" },
      {
        type: SSE_EVT_ARTIFACT_READY,
        drawingId: "d",
        kind: "boq",
        s3Key: "kos/x/y/boq.json",
        summary: {},
      },
      {
        type: SSE_EVT_ARTIFACT_FAILED,
        drawingId: "d",
        kind: "formwork",
        errorCode: "X",
        errorMessage: "y",
      },
      {
        type: SSE_EVT_CLASSIFICATION_NEEDED,
        drawingId: "d",
        message: "what kind?",
        suggestedHints: [] as never,
      },
    ];
    expect(events).toHaveLength(4);
  });
});
