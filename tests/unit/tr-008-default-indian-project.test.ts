/**
 * Regression test for Fix #1 + Phase B — Indian-only product.
 *
 * After Phase B: the isINR parameter in estimateMEPCosts() is always 1 (no FX conversion).
 * The 1/83.5 USD path was removed. All rates are always INR.
 * These tests verify MEP rates produce reasonable INR values regardless of isINR flag.
 */
import { describe, it, expect } from "vitest";
import { estimateMEPCosts } from "@/features/boq/services/boq-intelligence";

describe("Fix #1 + Phase B — Indian project (INR-only)", () => {
  it("produces MEP rates > ₹500/m² (no Location node, default Indian)", () => {
    const sums = estimateMEPCosts(1000, "commercial", 4, "city", true);
    expect(sums.length).toBeGreaterThan(0);

    const plumbing = sums.find(s => s.description.toLowerCase().includes("plumbing"));
    expect(plumbing).toBeDefined();
    expect(plumbing!.rate).toBeGreaterThan(500);
    expect(plumbing!.rate).toBeLessThan(2000);

    const electrical = sums.find(s => s.description.toLowerCase().includes("electrical"));
    expect(electrical).toBeDefined();
    expect(electrical!.rate).toBeGreaterThan(1000);

    const hvac = sums.find(s => s.description.toLowerCase().includes("hvac"));
    expect(hvac).toBeDefined();
    expect(hvac!.rate).toBeGreaterThan(1500);
  });

  it("isINR=false now produces SAME INR rates (USD path removed)", () => {
    // After Phase B: fx = 1 always (1/83.5 removed). Both paths produce identical results.
    const inr = estimateMEPCosts(1000, "commercial", 4, "tier-2", true);
    const usd = estimateMEPCosts(1000, "commercial", 4, "tier-2", false);

    const inrPlumb = inr.find(s => s.description.toLowerCase().includes("plumbing"))!;
    const usdPlumb = usd.find(s => s.description.toLowerCase().includes("plumbing"))!;

    // Rates should be identical now (no FX conversion)
    expect(inrPlumb.rate).toBe(usdPlumb.rate);
    expect(inrPlumb.rate).toBeGreaterThan(500);
  });

  it("foundation provisional uses INR rates", async () => {
    const { estimateFoundationCosts } = await import("@/features/boq/services/boq-intelligence");
    const sums = estimateFoundationCosts(1000, 4, "commercial", "city", true);
    expect(sums.length).toBeGreaterThan(0);
    expect(sums[0].rate).toBeGreaterThan(2000);
  });
});
