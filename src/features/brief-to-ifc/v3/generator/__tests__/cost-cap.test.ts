/**
 * Cost-cap regression test (Phase v3 completion §D4).
 *
 * Mocks the Anthropic client so each turn returns a known input /
 * output token count. With `costCapUsd = 0.50` and a per-turn cost of
 * `$0.20`, the loop MUST break at turn 3 (cumulative $0.60 > $0.50)
 * with `error.code === "COST_CAP_EXCEEDED"` and a 3-entry ledger.
 *
 * The mock skips the tool-execution path entirely because the cost-cap
 * circuit breaker fires AFTER the ledger entry is recorded but BEFORE
 * `toolUses` is processed — so we never reach the sandbox-client
 * fetches. That keeps the test self-contained: no network, no API
 * key, no sandbox.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

import { runGenerator, DEFAULT_COST_CAP_USD } from "../driver";
import type { BriefSpec } from "../../types";

// Cost math (Opus 4.7 rates locked in `driver.ts`):
//   cost_usd = (input * 5 + output * 25) / 1_000_000
// At input=30_000, output=2_000 → ($150_000 + $50_000)/1e6 = $0.20 / turn.
// With cap = $0.50:
//   turn 1: cumulative $0.20 < $0.50 → continue
//   turn 2: cumulative $0.40 < $0.50 → continue
//   turn 3: cumulative $0.60 > $0.50 → BREAK with COST_CAP_EXCEEDED
const PER_TURN_INPUT_TOKENS = 30_000;
const PER_TURN_OUTPUT_TOKENS = 2_000;
const EXPECTED_PER_TURN_COST = 0.2;
const COST_CAP_FOR_TEST = 0.5;
const EXPECTED_BREAK_TURN = 3;

function fakeAnthropicMessage(turn: number): Anthropic.Messages.Message {
  // Minimal shape the driver reads: `content` (a non-empty tool_use is
  // fine — the cost-cap check fires before we filter for tool_uses),
  // `usage`, and `stop_reason`. Casting through `unknown` because we're
  // only filling the fields the driver accesses, not the full Message
  // surface area.
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
        input: { code: "print('mock')" },
      },
    ],
    usage: {
      input_tokens: PER_TURN_INPUT_TOKENS,
      output_tokens: PER_TURN_OUTPUT_TOKENS,
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
        // The driver calls `.finalMessage()` on the returned stream.
        // We don't need full streaming semantics — just the awaitable.
        return {
          async finalMessage() {
            return message;
          },
        };
      },
    },
  } as unknown as Anthropic;
}

function minimalBrief(): BriefSpec {
  return {
    project: {
      name: "T", type: "exhibition_booth",
      location: "X", description: "Cost-cap test brief",
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

describe("cost cap circuit breaker", () => {
  it("terminates the loop at the configured cap with COST_CAP_EXCEEDED", async () => {
    const result = await runGenerator({
      brief: minimalBrief(),
      costCapUsd: COST_CAP_FOR_TEST,
      clientFactory: mockAnthropicClient,
      // Tight max-turns isn't strictly needed (the cap fires first)
      // but defends the test against accidentally running 25 mock
      // turns if the cap logic regresses.
      maxTurns: 10,
    });

    expect(result.ok).toBe(false);
    expect(result.error).not.toBeNull();
    expect(result.error?.code).toBe("COST_CAP_EXCEEDED");
    expect(result.turns).toBe(EXPECTED_BREAK_TURN);

    // Ledger preserved — caller can read cumulative spend at the
    // moment of the break.
    expect(result.ledger).toHaveLength(EXPECTED_BREAK_TURN);
    for (const entry of result.ledger) {
      expect(entry.costUsd).toBeCloseTo(EXPECTED_PER_TURN_COST, 4);
      expect(entry.inputTokens).toBe(PER_TURN_INPUT_TOKENS);
      expect(entry.outputTokens).toBe(PER_TURN_OUTPUT_TOKENS);
    }
    const cumulative = result.ledger.reduce((s, e) => s + e.costUsd, 0);
    expect(cumulative).toBeGreaterThan(COST_CAP_FOR_TEST);
    expect(result.costUsd).toBeCloseTo(cumulative, 4);
  });

  it("runs to max_turns when the cap is never hit", async () => {
    // 25 turns × $0.20 = $5.00. A cap of $10 is never hit — the loop
    // exits via MAX_TURNS_EXCEEDED, NOT cost-cap.
    const result = await runGenerator({
      brief: minimalBrief(),
      costCapUsd: 10.0,
      clientFactory: mockAnthropicClient,
      maxTurns: 5,
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("MAX_TURNS_EXCEEDED");
    expect(result.turns).toBe(5);
    expect(result.ledger).toHaveLength(5);
  });

  it("the published DEFAULT_COST_CAP_USD is the documented $2.50", () => {
    expect(DEFAULT_COST_CAP_USD).toBe(2.5);
  });
});
