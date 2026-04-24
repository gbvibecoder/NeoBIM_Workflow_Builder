/**
 * Phase E — strip-price test suite.
 *
 * The $1.54 ban is structural; these tests lock the invariant so a future
 * refactor cannot silently regress the scrub.
 */

import { describe, it, expect } from "vitest";
import { stripPrice, isPriceLike } from "@/features/results-v2/lib/strip-price";

describe("stripPrice — defensive scrub", () => {
  it("returns primitives as-is", () => {
    expect(stripPrice(null)).toBe(null);
    expect(stripPrice(undefined)).toBe(undefined);
    expect(stripPrice(42)).toBe(42);
    expect(stripPrice("hello")).toBe("hello");
    expect(stripPrice(true)).toBe(true);
  });

  it("removes keys matching /cost/i", () => {
    const out = stripPrice({ cost: 1.54, keep: "yes" });
    expect(out).toEqual({ keep: "yes" });
  });

  it("removes keys matching /price/i (case-insensitive)", () => {
    const out = stripPrice({ PRICE: 1.54, Keep: "yes" });
    expect(out).toEqual({ Keep: "yes" });
  });

  it("removes every forbidden key family", () => {
    const poison = {
      cost: 1.54,
      price: 0.13,
      usd: 2.99,
      dollar: 4,
      amount: 5,
      spend: 6,
      costUsd: 7,
      PriceUsd: 8,
      label: "keep-me",
    };
    expect(stripPrice(poison)).toEqual({ label: "keep-me" });
  });

  it("removes string values that start with $N digit", () => {
    const out = stripPrice({ label: "$1.54", ok: "Premium" });
    expect(out).toEqual({ ok: "Premium" });
  });

  it("walks into nested objects", () => {
    const out = stripPrice({
      meta: { cost: 1.54, nested: { price: 0.2, ok: "yes" } },
      label: "Video",
    });
    expect(out).toEqual({
      meta: { nested: { ok: "yes" } },
      label: "Video",
    });
  });

  it("walks into arrays", () => {
    const out = stripPrice([
      { cost: 1, label: "a" },
      { price: 2, label: "b" },
      { keep: "only-this" },
    ]);
    expect(out).toEqual([{ label: "a" }, { label: "b" }, { keep: "only-this" }]);
  });

  it("handles deeply nested poison", () => {
    const out = stripPrice({
      a: { b: { c: { cost: 1, d: { price: "$1.54", ok: 1 } } } },
    });
    expect(out).toEqual({ a: { b: { c: { d: { ok: 1 } } } } });
  });

  it("tolerates null children", () => {
    const out = stripPrice({ a: null, b: { c: null, cost: 1 } });
    expect(out).toEqual({ a: null, b: { c: null } });
  });

  it("tolerates empty collections", () => {
    expect(stripPrice({})).toEqual({});
    expect(stripPrice([])).toEqual([]);
  });

  it("does not mutate the source", () => {
    const src = { cost: 1, keep: "yes" };
    const out = stripPrice(src);
    expect(src).toEqual({ cost: 1, keep: "yes" });
    expect(out).not.toBe(src);
  });

  it("keeps legit currency symbols that are not $ digit strings", () => {
    // ₹5120 is a qualitative BOQ scalar — not a forbidden `$N` literal.
    // The scrub is keyed on the `$[0-9]` regex + the cost/price/usd/dollar
    // family, so a rupee value attached to a legit label still passes.
    const out = stripPrice({ label: "Total GFA", value: 5120, currency: "₹" });
    expect(out.label).toBe("Total GFA");
    expect(out.value).toBe(5120);
    expect(out.currency).toBe("₹");
  });
});

describe("isPriceLike — label/value sniff for metrics", () => {
  it("flags explicit cost labels", () => {
    expect(isPriceLike("Cost", 1)).toBe(true);
    expect(isPriceLike("COST_USD", 1)).toBe(true);
    expect(isPriceLike("estimated cost", 1)).toBe(true);
  });

  it("flags price / usd / dollar families", () => {
    expect(isPriceLike("price", 1)).toBe(true);
    expect(isPriceLike("Total USD", 1)).toBe(true);
    expect(isPriceLike("dollar amount", 1)).toBe(true);
  });

  it("flags value-level $N strings even if label is innocuous", () => {
    expect(isPriceLike("Anything", "$1.54")).toBe(true);
    expect(isPriceLike("Anything", "$0.13")).toBe(true);
    expect(isPriceLike("Anything", " $ 2.00")).toBe(true);
  });

  it("does NOT flag durations", () => {
    expect(isPriceLike("Duration (s)", 90)).toBe(false);
    expect(isPriceLike("duration", 15)).toBe(false);
  });

  it("does NOT flag room counts", () => {
    expect(isPriceLike("Room count", 7)).toBe(false);
    expect(isPriceLike("Rooms", 5)).toBe(false);
  });

  it("does NOT flag floor or area metrics", () => {
    expect(isPriceLike("Floors", 8)).toBe(false);
    expect(isPriceLike("GFA", 5120)).toBe(false);
    expect(isPriceLike("Total Area", 96)).toBe(false);
  });

  it("does NOT flag numeric values without a $", () => {
    expect(isPriceLike("Anything", 5120)).toBe(false);
    expect(isPriceLike("Anything", "5120")).toBe(false);
    expect(isPriceLike("Anything", "1,218")).toBe(false);
  });
});
