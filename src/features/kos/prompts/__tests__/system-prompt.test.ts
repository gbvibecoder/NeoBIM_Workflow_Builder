/**
 * Tests for the Kalzen system-prompt builder.
 *
 * Focused on the contract surface (version marker, tool name presence,
 * preservation of retrieval / citation rules) — not the prose itself
 * (free-text drift would otherwise cause noisy failures).
 */

import { describe, expect, it } from "vitest";

import { buildKalzenSystemPrompt } from "../system-prompt";
import { KALZEN_PROMPT_VERSION } from "@/features/kos/lib/kos-bot-constants";

function build(): string {
  return buildKalzenSystemPrompt({
    tenantName: "Kalzen",
    customerDisplayName: "Test Customer",
  });
}

describe("buildKalzenSystemPrompt", () => {
  it("emits a leading version-marker HTML comment that matches KALZEN_PROMPT_VERSION", () => {
    const prompt = build();
    expect(prompt.startsWith(`<!-- KALZEN_PROMPT_VERSION: ${KALZEN_PROMPT_VERSION} -->`)).toBe(true);
  });

  it("contains the 4 new PR 2b tool names by name", () => {
    const prompt = build();
    expect(prompt).toContain("process_drawing");
    expect(prompt).toContain("generate_boq");
    expect(prompt).toContain("generate_formwork");
    expect(prompt).toContain("generate_shop_drawing");
  });

  it("preserves the existing retrieve_documents / escalate_to_human tool docs", () => {
    const prompt = build();
    expect(prompt).toContain("retrieve_documents");
    expect(prompt).toContain("escalate_to_human");
  });

  it("preserves the citation rule (bracketed indices)", () => {
    const prompt = build();
    expect(prompt).toMatch(/bracketed numbers/i);
    expect(prompt).toContain("[1]");
  });

  it("preserves the source-attribution rule (Dincel / Kalzen / em-dash labels)", () => {
    const prompt = build();
    expect(prompt).toContain("Dincel");
    expect(prompt).toMatch(/Attributing sources/i);
  });

  it("preserves the no-invented-facts hard rule", () => {
    const prompt = build();
    expect(prompt).toMatch(/no invented facts/i);
  });

  it("documents the four process_drawing result statuses", () => {
    const prompt = build();
    expect(prompt).toContain('status: "ready"');
    expect(prompt).toContain('status: "needs_classification"');
    expect(prompt).toContain('status: "scanned_pdf"');
    expect(prompt).toContain('status: "failed"');
  });

  it("teaches the bot to use application_hint on re-classification rounds", () => {
    const prompt = build();
    expect(prompt).toContain("application_hint");
    expect(prompt).toMatch(/needs_classification/);
    // mentions at least one concrete hint id so the bot has a worked example
    expect(prompt).toContain("villa_external");
  });

  it("documents the per-turn quota error code KOS_BOT_QUOTA_EXCEEDED", () => {
    const prompt = build();
    expect(prompt).toContain("KOS_BOT_QUOTA_EXCEEDED");
  });

  it("warns NOT to promise a download button yet (PR 4 territory)", () => {
    const prompt = build();
    expect(prompt).toMatch(/do not promise a download button|PR 4/i);
  });

  it("substitutes tenantName + customerDisplayName into the greeting", () => {
    const prompt = buildKalzenSystemPrompt({
      tenantName: "Acme",
      customerDisplayName: "Bob",
    });
    expect(prompt).toContain("Acme");
    expect(prompt).toContain("Bob");
  });

  it("falls back to defaults when names are empty", () => {
    const prompt = buildKalzenSystemPrompt({
      tenantName: "",
      customerDisplayName: "",
    });
    expect(prompt).toContain("Kalzen");
    expect(prompt).toContain("the customer");
  });

  // ── 5I PR 3 additions ───────────────────────────────────────────
  describe("PR 3 — visible-progress UI directive", () => {
    it("KALZEN_PROMPT_VERSION has the documented format <slice>-<YYYY.MM.DD>", () => {
      // Relaxed from the PR 3 `/^3-/` pin so subsequent PRs (PR 4
      // bumped to "4-…") don't require this test to be edited each
      // time. Format check stays strict: lower-case slug + dash + date.
      expect(KALZEN_PROMPT_VERSION).toMatch(/^[0-9a-z]+-\d{4}\.\d{2}\.\d{2}$/);
    });

    it("contains the 'Visible progress UI' section header", () => {
      const prompt = build();
      expect(prompt).toContain("Visible progress UI");
    });

    it("instructs the bot NOT to narrate parse/generate steps", () => {
      const prompt = build();
      expect(prompt).toMatch(/DO NOT narrate/i);
      expect(prompt).toMatch(/parse your drawing now|generating the BOQ now/i);
    });

    it("still preserves the post-tools natural-language summary expectation", () => {
      const prompt = build();
      expect(prompt).toMatch(/after all tools complete/i);
    });

    it("still preserves pre-PR-3 retrieval + citation rules (regression)", () => {
      const prompt = build();
      expect(prompt).toContain("retrieve_documents");
      expect(prompt).toContain("escalate_to_human");
      expect(prompt).toMatch(/bracketed numbers/i);
      expect(prompt).toMatch(/no invented facts/i);
    });
  });
});
