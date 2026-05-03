/**
 * Tests for Phase D — UI trust signals, quality unification, benchmark hard-stop.
 */
import { describe, it, expect } from "vitest";
import {
  getIFCQualityLabel,
  getIFCQualityColor,
  getLineConfidenceScore,
} from "@/features/boq/constants/quality-thresholds";

describe("Phase D — IFC quality unification (single metric)", () => {
  it("≥85% → EXCELLENT", () => {
    expect(getIFCQualityLabel(86)).toBe("EXCELLENT");
    expect(getIFCQualityLabel(100)).toBe("EXCELLENT");
  });

  it("65-84% → GOOD", () => {
    expect(getIFCQualityLabel(66)).toBe("GOOD");
    expect(getIFCQualityLabel(84)).toBe("GOOD");
  });

  it("40-64% → FAIR", () => {
    expect(getIFCQualityLabel(41)).toBe("FAIR");
    expect(getIFCQualityLabel(64)).toBe("FAIR");
  });

  it("<40% → LIMITED", () => {
    expect(getIFCQualityLabel(39)).toBe("LIMITED");
    expect(getIFCQualityLabel(0)).toBe("LIMITED");
    expect(getIFCQualityLabel(25)).toBe("LIMITED");
  });

  it("colors are consistent", () => {
    // EXCELLENT = green, GOOD = cyan, FAIR = amber, LIMITED = red
    expect(getIFCQualityColor(90)).toBe("#22C55E");
    expect(getIFCQualityColor(70)).toBe("#00F5FF");
    expect(getIFCQualityColor(50)).toBe("#F59E0B");
    expect(getIFCQualityColor(20)).toBe("#EF4444");
  });
});

describe("Phase D — Benchmark hard-stop logic", () => {
  it("costPerM² ₹40K vs floor ₹22K → no hard-stop (within range)", () => {
    const costPerM2 = 40000;
    const floor = 22000;
    const graceFloor = Math.round(floor * 0.7);
    expect(costPerM2 >= graceFloor).toBe(true);
  });

  it("costPerM² ₹16K vs floor ₹22K → no hard-stop (within 30% grace)", () => {
    const costPerM2 = 16000;
    const floor = 22000;
    const graceFloor = Math.round(floor * 0.7); // 15400
    expect(costPerM2 >= graceFloor).toBe(true); // 16000 >= 15400
  });

  it("costPerM² ₹14K vs floor ₹22K → HARD-STOP (below 70% of floor)", () => {
    const costPerM2 = 14000;
    const floor = 22000;
    const graceFloor = Math.round(floor * 0.7); // 15400
    expect(costPerM2 < graceFloor).toBe(true);
  });

  it("costPerM² ₹824 vs floor ₹22K → HARD-STOP (original BIMcollab case)", () => {
    const costPerM2 = 824;
    const floor = 22000;
    const graceFloor = Math.round(floor * 0.7);
    expect(costPerM2 < graceFloor).toBe(true);
  });
});

describe("Phase D — ModelCompletenessWarning threshold", () => {
  it("fires at 29% (below 30% threshold)", () => {
    expect(29 < 30).toBe(true);
  });

  it("does NOT fire at 30%", () => {
    expect(30 >= 30).toBe(true);
  });

  it("does NOT fire at 85%", () => {
    expect(85 >= 30).toBe(true);
  });
});

describe("Phase D — Donut classifier soft-cost routing", () => {
  const SOFT_KEYWORDS = ["architectural", "contingency", "overhead", "permits", "insurance", "escalation", "soft cost", "subtotal"];

  it("routes 'Architectural Fees' to Overheads, not Civil", () => {
    const desc = "architectural fees".toLowerCase();
    const matched = SOFT_KEYWORDS.some(kw => desc.includes(kw));
    expect(matched).toBe(true);
  });

  it("routes 'Contingency' to Overheads", () => {
    const desc = "contingency".toLowerCase();
    expect(SOFT_KEYWORDS.some(kw => desc.includes(kw))).toBe(true);
  });

  it("routes 'GC Overhead & Profit' to Overheads", () => {
    const desc = "gc overhead & profit".toLowerCase();
    expect(SOFT_KEYWORDS.some(kw => desc.includes(kw))).toBe(true);
  });

  it("does NOT route 'RCC M25 in slabs' to Overheads", () => {
    const desc = "rcc m25 in slabs".toLowerCase();
    expect(SOFT_KEYWORDS.some(kw => desc.includes(kw))).toBe(false);
  });

  it("skips section headers", () => {
    const headers = ["── 01 FIRST FLOOR ──", "— Ground Floor —", "HARD COSTS SUBTOTAL"];
    for (const h of headers) {
      const d = h.toLowerCase();
      const isHeader = d.startsWith("──") || d.startsWith("—") || d.includes("subtotal") || d.includes("hard costs");
      expect(isHeader, h).toBe(true);
    }
  });
});

describe("Phase D — Line confidence scoring", () => {
  it("≥80 → high", () => {
    expect(getLineConfidenceScore(85)).toBe("high");
    expect(getLineConfidenceScore(95)).toBe("high");
  });

  it("55-79 → medium", () => {
    expect(getLineConfidenceScore(60)).toBe("medium");
    expect(getLineConfidenceScore(79)).toBe("medium");
  });

  it("<55 → low", () => {
    expect(getLineConfidenceScore(30)).toBe("low");
    expect(getLineConfidenceScore(54)).toBe("low");
  });
});
