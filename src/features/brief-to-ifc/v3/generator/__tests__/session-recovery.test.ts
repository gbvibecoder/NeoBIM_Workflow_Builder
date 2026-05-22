/**
 * Session-recovery regression test (AGENT_FAILURE_DIAGNOSIS_2026-05-22.md).
 *
 * Reproduces the failure pattern of run `cmpgp326q…` (2026-05-22 09:06 UTC)
 * where the Railway Python sandbox lost the in-memory session at turn 18
 * and the driver had no recovery path. After Layer 1 the driver:
 *
 *   • detects the session-shaped http-error (404 / "session not found"),
 *   • once per `runGenerator` invocation, resets sessionId=null and
 *     re-issues the failed `run_python` call with `brief` so Railway
 *     can bootstrap a fresh session,
 *   • on a successful re-bootstrap, prepends a "session re-created" hint
 *     to the tool_result the agent sees and keeps building,
 *   • on a SECOND session loss within the same iteration, exits cleanly
 *     with the new precise error code `SANDBOX_SESSION_LOST` (NOT the
 *     misleading `AGENT_GAVE_UP` that previously swallowed this case).
 *
 * The test mocks the sandbox-client module so no Railway call is made and
 * no Anthropic API key is required. Verification is $0.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock the sandbox-client BEFORE importing the driver so the driver's
// module-level imports resolve to the mocks. `vi.mock` is hoisted.
vi.mock("../sandbox-client", () => ({
  sandboxExec: vi.fn(),
  sandboxValidate: vi.fn(),
  sandboxSummary: vi.fn(),
  sandboxFinalize: vi.fn(),
}));

// eslint-disable-next-line import/first
import { runGenerator, isSessionLossFailure } from "../driver";
// eslint-disable-next-line import/first
import { sandboxExec } from "../sandbox-client";
// eslint-disable-next-line import/first
import type { BriefSpec } from "../../types";

// ─── Minimal brief (same shape as cost-cap.test.ts) ────────────────────

function minimalBrief(): BriefSpec {
  return {
    project: {
      name: "T", type: "exhibition_booth",
      location: "X", description: "session-recovery test brief",
    },
    site: {
      bounds_m: [10.0, 10.0],
      height_limit_m: 3.0,
      coordinate_origin: "sw_corner",
    },
    spaces: [],
    elements: [],
    materials: [
      {
        id: "mat-x", name: "X", rgb: [0.5, 0.5, 0.5],
        roughness: 0.5, method: "MATT", category: "test",
      },
    ],
    brand_language: {
      primary_text: "T", approved_terms: [], forbidden_terms: [],
    },
  };
}

// ─── Mock Anthropic — emits `run_python` tool_use each turn ────────────

function fakeAnthropicMessage(turn: number): Anthropic.Messages.Message {
  return {
    id: `msg_test_${turn}`,
    type: "message",
    role: "assistant",
    model: "claude-opus-4-7",
    stop_reason: "tool_use",
    stop_sequence: null,
    content: [
      {
        type: "tool_use",
        id: `tu_test_${turn}`,
        name: "run_python",
        input: { code: `print('turn ${turn}')` },
      },
    ],
    usage: {
      input_tokens: 1_000,
      output_tokens: 100,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      server_tool_use: null,
      service_tier: null,
    },
  } as unknown as Anthropic.Messages.Message;
}

function mockAnthropicClient(): Anthropic {
  let turn = 0;
  return {
    messages: {
      stream(_params: unknown, _options?: unknown) {
        turn += 1;
        const message = fakeAnthropicMessage(turn);
        return {
          async finalMessage() {
            return message;
          },
        };
      },
    },
  } as unknown as Anthropic;
}

// ─── Mock sandbox-client return shapes ─────────────────────────────────

function execOk(sessionId: string) {
  return {
    ok: true as const,
    data: {
      session_id: sessionId,
      ok: true,
      stdout: "",
      stderr: "",
      error_type: null,
      error_message: null,
      error_traceback: null,
      duration_ms: 1,
    },
  };
}

function execHttpError404(message = "Sandbox responded 404 Not Found: session not found") {
  return {
    ok: false as const,
    failure: {
      kind: "http-error" as const,
      statusCode: 404,
      message,
    },
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe("Layer-1 sandbox session recovery", () => {
  beforeEach(() => {
    vi.mocked(sandboxExec).mockReset();
  });

  it("the session-loss heuristic matches 404 and 'session not found' bodies", () => {
    expect(
      isSessionLossFailure({
        kind: "http-error",
        statusCode: 404,
        message: "Sandbox responded 404 Not Found",
      }),
    ).toBe(true);
    expect(
      isSessionLossFailure({
        kind: "http-error",
        statusCode: 500,
        message: "Sandbox responded 500 Internal Server Error: no session",
      }),
    ).toBe(true);
    expect(
      isSessionLossFailure({
        kind: "http-error",
        statusCode: 500,
        message: "Sandbox responded 500: kernel panic",
      }),
    ).toBe(false);
    expect(
      isSessionLossFailure({ kind: "timeout", message: "AbortError" }),
    ).toBe(false);
    expect(
      isSessionLossFailure({ kind: "network-error", message: "ECONNREFUSED" }),
    ).toBe(false);
  });

  it("recovers transparently when the second sandbox call 404s once and the retry succeeds", async () => {
    // Plan: call 1 = ok (sid=s1) → call 2 = 404 (lost) → driver auto-retries
    // with sessionId=null + brief → call 3 = ok (sid=s2). Build continues.
    // We stop after 4 successful turns by reducing maxTurns.
    const exec = vi.mocked(sandboxExec);
    exec
      .mockResolvedValueOnce(execOk("s1"))          // turn 1, first exec
      .mockResolvedValueOnce(execHttpError404())    // turn 2, session lost
      .mockResolvedValueOnce(execOk("s2"))          // turn 2, recovery retry
      .mockResolvedValueOnce(execOk("s2"))          // turn 3
      .mockResolvedValueOnce(execOk("s2"));         // turn 4

    const result = await runGenerator({
      brief: minimalBrief(),
      clientFactory: mockAnthropicClient,
      maxTurns: 4,
      costCapUsd: 5.0,
    });

    // The loop exited via MAX_TURNS_EXCEEDED, NOT SANDBOX_SESSION_LOST —
    // recovery worked.
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("MAX_TURNS_EXCEEDED");

    // Exactly 5 sandbox calls: turn 1, turn 2 first attempt, turn 2 retry,
    // turn 3, turn 4. (One extra call vs. 4 turns = the recovery retry.)
    expect(exec).toHaveBeenCalledTimes(5);

    // The recovery call (the 3rd invocation) MUST carry `brief` and
    // `sessionId === null`. This is the load-bearing assertion: without
    // it Railway can't bootstrap a session and the recovery is a no-op.
    const recoveryCall = exec.mock.calls[2]?.[0];
    expect(recoveryCall?.sessionId).toBeNull();
    expect(recoveryCall?.brief).toBeDefined();
    expect(recoveryCall?.brief?.project?.type).toBe("exhibition_booth");

    // Subsequent calls (turn 3, turn 4) MUST carry the re-bootstrapped
    // sessionId ("s2") and must NOT re-send brief.
    const post1 = exec.mock.calls[3]?.[0];
    const post2 = exec.mock.calls[4]?.[0];
    expect(post1?.sessionId).toBe("s2");
    expect(post1?.brief).toBeUndefined();
    expect(post2?.sessionId).toBe("s2");
    expect(post2?.brief).toBeUndefined();

    // The turn-2 record must carry the recovery marker.
    const t2 = result.turnRecords.find((r) => r.turn === 2);
    expect(t2?.sessionRecovered).toBe(true);
  });

  it("returns SANDBOX_SESSION_LOST (not AGENT_GAVE_UP) when the recovery retry also 404s", async () => {
    // Plan: call 1 = ok (sid=s1) → call 2 = 404 → driver retries with brief
    // → call 3 = 404 again → driver exits with SANDBOX_SESSION_LOST.
    const exec = vi.mocked(sandboxExec);
    exec
      .mockResolvedValueOnce(execOk("s1"))          // turn 1
      .mockResolvedValueOnce(execHttpError404())    // turn 2, lost
      .mockResolvedValueOnce(execHttpError404("Sandbox responded 404: session not found"));
      // turn 2 recovery retry also 404s

    const result = await runGenerator({
      brief: minimalBrief(),
      clientFactory: mockAnthropicClient,
      maxTurns: 50,   // ample headroom; the driver should exit at turn 2
      costCapUsd: 5.0,
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("SANDBOX_SESSION_LOST");
    expect(result.error?.code).not.toBe("AGENT_GAVE_UP");
    // The driver did NOT burn all 50 turns — it exited promptly.
    expect(result.turns).toBeLessThanOrEqual(2);
    // The recovery retry happened exactly once (we don't loop on session
    // loss after the budget is burned).
    expect(exec).toHaveBeenCalledTimes(3);
    // And that retry was indeed shaped as a re-bootstrap.
    const retryCall = exec.mock.calls[2]?.[0];
    expect(retryCall?.sessionId).toBeNull();
    expect(retryCall?.brief).toBeDefined();
  });

  it("does NOT consume the recovery budget on non-session http-errors", async () => {
    // Plan: call 1 = ok → call 2 = 500 (NOT session-shaped) → driver does
    // NOT auto-retry. The agent sees the error as a normal failure.
    // Later a real session loss should still be recoverable.
    const exec = vi.mocked(sandboxExec);
    exec
      .mockResolvedValueOnce(execOk("s1"))
      .mockResolvedValueOnce({
        ok: false as const,
        failure: {
          kind: "http-error" as const,
          statusCode: 500,
          message: "Sandbox responded 500 Internal Server Error: kernel panic",
        },
      })
      .mockResolvedValueOnce(execOk("s1"))          // turn 3, no retry happened
      .mockResolvedValueOnce(execHttpError404())    // turn 4, real session loss
      .mockResolvedValueOnce(execOk("s2"))          // turn 4 recovery retry
      .mockResolvedValueOnce(execOk("s2"));         // turn 5

    const result = await runGenerator({
      brief: minimalBrief(),
      clientFactory: mockAnthropicClient,
      maxTurns: 5,
      costCapUsd: 5.0,
    });

    expect(result.error?.code).toBe("MAX_TURNS_EXCEEDED");
    // Exactly 6 calls: 4 base turns + 1 retry on turn 4. The 500 on
    // turn 2 did NOT trigger a retry — call count would be 7 if it had.
    expect(exec).toHaveBeenCalledTimes(6);
  });
});
