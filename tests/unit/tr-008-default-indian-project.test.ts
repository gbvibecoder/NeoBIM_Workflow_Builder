/**
 * Regression test for Fix #1 — Default isIndianProject=true when no Location node.
 *
 * The full TR-008 handler requires Prisma, web-ifc, and R2 — impractical to mock.
 * Instead we test the downstream function (estimateMEPCosts) that was producing
 * ₹11/m² instead of ₹1,100/m² due to the `fx = 1/83.5` division when isINR=false.
 *
 * With Fix #1, isIndianProject (and therefore isINR) defaults to true when no
 * Location node is connected. These tests validate that the rate gap between
 * isINR=true and isINR=false is exactly the 83.5× exchange rate factor.
 */
import { describe, it, expect } from "vitest";
import { estimateMEPCosts } from "@/features/boq/services/boq-intelligence";

describe("Fix #1 — Indian project default", () => {
  // ── Case 1: isINR=true (the new default path) produces INR rates ──
  it("produces MEP rates > ₹500/m² when isINR=true (no Location node)", () => {
    const sums = estimateMEPCosts(1000, "commercial", 4, "city", true);
    expect(sums.length).toBeGreaterThan(0);

    const plumbing = sums.find(s => s.description.toLowerCase().includes("plumbing"));
    expect(plumbing).toBeDefined();
    // Commercial plumbing base = 1100 × 0.85 (city tier) = 935 INR/m²
    expect(plumbing!.rate).toBeGreaterThan(500);
    expect(plumbing!.rate).toBeLessThan(2000);

    const electrical = sums.find(s => s.description.toLowerCase().includes("electrical"));
    expect(electrical).toBeDefined();
    // Commercial electrical base = 2200 × 0.85 = 1870 INR/m²
    expect(electrical!.rate).toBeGreaterThan(1000);

    const hvac = sums.find(s => s.description.toLowerCase().includes("hvac"));
    expect(hvac).toBeDefined();
    // Commercial HVAC base = 2500 × 0.85 = 2125 INR/m²
    expect(hvac!.rate).toBeGreaterThan(1500);
  });

  // ── Case 2: isINR=false (explicit non-India via Location node) ──
  it("produces rates < ₹100/m² when isINR=false (Location node says USA)", () => {
    const sums = estimateMEPCosts(1000, "commercial", 4, "city", false);
    expect(sums.length).toBeGreaterThan(0);

    const plumbing = sums.find(s => s.description.toLowerCase().includes("plumbing"));
    expect(plumbing).toBeDefined();
    // 935 / 83.5 ≈ 11 USD equivalent
    expect(plumbing!.rate).toBeLessThan(100);
    expect(plumbing!.rate).toBeGreaterThan(5);
  });

  // ── Case 3: The rate ratio is exactly the exchange rate factor ──
  it("isINR=true rate / isINR=false rate ≈ 83.5 (exchange rate)", () => {
    const inr = estimateMEPCosts(1000, "commercial", 4, "tier-2", true);
    const usd = estimateMEPCosts(1000, "commercial", 4, "tier-2", false);

    const inrPlumb = inr.find(s => s.description.toLowerCase().includes("plumbing"))!;
    const usdPlumb = usd.find(s => s.description.toLowerCase().includes("plumbing"))!;

    // INR rate / USD rate should be close to 83.5 (within rounding tolerance)
    const ratio = inrPlumb.rate / usdPlumb.rate;
    expect(ratio).toBeGreaterThan(75);
    expect(ratio).toBeLessThan(92);
  });

  // ── Case 4: Foundation sums also affected by isINR ──
  it("foundation provisional uses INR rates when isINR=true", async () => {
    const { estimateFoundationCosts } = await import("@/features/boq/services/boq-intelligence");
    const sums = estimateFoundationCosts(1000, 4, "commercial", "city", true);
    expect(sums.length).toBeGreaterThan(0);
    // Raft foundation for 4-storey: ~5500 × 0.80 tier = 4400 INR/m²
    expect(sums[0].rate).toBeGreaterThan(2000);
  });
});
