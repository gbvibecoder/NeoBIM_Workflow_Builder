"use client";

import { useState, useCallback, useMemo, useRef } from "react";
import { BOQHeader } from "./BOQHeader";
import { HeroStats } from "./HeroStats";
import { PriceControls } from "./PriceControls";
import { CostDonutChart } from "./CostDonutChart";
import { DivisionBarChart } from "./DivisionBarChart";
import { MEPBreakdown } from "./MEPBreakdown";
import { IFCQualityCard } from "./IFCQualityCard";
import { BOQTable } from "./BOQTable";
import { NLSummary } from "./NLSummary";
import { BOQFooter } from "./BOQFooter";
import type { BOQData, PriceOverrides, RateOverride } from "./types";
import { DEFAULT_PRICES, recalculateLines, computeTotals } from "./recalc-engine";

interface BOQVisualizerPageProps {
  data: BOQData;
  executionId: string;
}

export function BOQVisualizerPage({ data, executionId }: BOQVisualizerPageProps) {
  // Price control state
  const [prices, setPrices] = useState<PriceOverrides>(() => ({
    steel: data.market?.steelPerTonne ?? DEFAULT_PRICES.steel,
    cement: data.market?.cementPerBag ?? DEFAULT_PRICES.cement,
    mason: data.market?.masonRate ?? DEFAULT_PRICES.mason,
  }));

  const basePrices = useRef<PriceOverrides>({
    steel: data.market?.steelPerTonne ?? DEFAULT_PRICES.steel,
    cement: data.market?.cementPerBag ?? DEFAULT_PRICES.cement,
    mason: data.market?.masonRate ?? DEFAULT_PRICES.mason,
  });

  // Rate override state
  const [rateOverrides, setRateOverrides] = useState<Map<string, RateOverride>>(new Map());

  // Recalculated flash
  const [recalculated, setRecalculated] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Recalculate all lines when prices or overrides change
  const recalcLines = useMemo(() => {
    return recalculateLines(data.lines, basePrices.current, prices, rateOverrides);
  }, [data.lines, prices, rateOverrides]);

  const totals = useMemo(() => computeTotals(recalcLines), [recalcLines]);

  const costPerM2 = data.gfa > 0 ? totals.totalCost / data.gfa : data.benchmark.costPerM2;

  // Price change handler with flash animation
  const handlePriceChange = useCallback((newPrices: PriceOverrides) => {
    setPrices(newPrices);
    setRecalculated(true);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setRecalculated(false), 600);
  }, []);

  // Rate override handler
  const handleRateOverride = useCallback((lineId: string, newRate: number, originalRate: number) => {
    setRateOverrides((prev) => {
      const next = new Map(prev);
      next.set(lineId, { lineId, newRate, originalRate });
      return next;
    });
    setRecalculated(true);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setRecalculated(false), 600);
  }, []);

  // Export handlers
  const handleExportExcel = useCallback(() => {
    // Trigger download via the existing EX-002 node execution
    window.open(`/api/execute-node?export=excel&executionId=${executionId}`, "_blank");
  }, [executionId]);

  const handleExportPDF = useCallback(() => {
    window.open(`/api/execute-node?export=pdf&executionId=${executionId}`, "_blank");
  }, [executionId]);

  const handleExportCSV = useCallback(() => {
    // Generate CSV from current recalculated lines
    const headers = ["IS Code", "Description", "Unit", "Qty", "Rate", "Amount", "Source", "Confidence"];
    const csvRows = [
      headers.join(","),
      ...recalcLines.map((l) =>
        [l.isCode, `"${l.description}"`, l.unit, l.adjustedQty, l.unitRate, l.totalCost, l.source, `${l.confidence}%`].join(",")
      ),
    ];
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `BOQ_${data.projectName.replace(/\s+/g, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [recalcLines, data.projectName]);

  return (
    <div
      className="flex-1 overflow-y-auto"
      style={{ background: "#070809" }}
    >
      {/* Header */}
      <BOQHeader data={data} onExportExcel={handleExportExcel} />

      <div className="flex flex-col gap-6 py-6">
        {/* Hero Stats */}
        <HeroStats
          totalCost={totals.totalCost}
          costPerM2={costPerM2}
          hardCosts={totals.subtotalMaterial + totals.subtotalLabor + totals.subtotalEquipment}
          ifcQualityScore={data.ifcQuality?.score ?? 0}
          benchmarkLow={data.benchmark.benchmarkLow}
          benchmarkHigh={data.benchmark.benchmarkHigh}
          recalculated={recalculated}
        />

        {/* Price Controls */}
        <PriceControls
          prices={prices}
          onChange={handlePriceChange}
          market={data.market ? {
            steelSource: data.market.steelSource,
            steelConfidence: data.market.steelConfidence,
            cementBrand: data.market.cementBrand,
            cementConfidence: data.market.cementConfidence,
            masonSource: data.market.masonSource,
            masonConfidence: data.market.masonConfidence,
          } : undefined}
        />

        {/* Two Column Layout: Charts + Quality */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 px-6">
          {/* Left Column */}
          <div className="flex flex-col gap-6">
            <CostDonutChart
              material={totals.subtotalMaterial}
              labor={totals.subtotalLabor}
              equipment={totals.subtotalEquipment}
            />
            <DivisionBarChart lines={recalcLines} />
          </div>

          {/* Right Column */}
          <div className="flex flex-col gap-6">
            {data.mepBreakdown && (
              <MEPBreakdown mep={data.mepBreakdown} />
            )}
            {data.ifcQuality && (
              <IFCQualityCard quality={data.ifcQuality} />
            )}
          </div>
        </div>

        {/* BOQ Table */}
        <BOQTable
          lines={recalcLines}
          rateOverrides={rateOverrides}
          onRateOverride={handleRateOverride}
        />

        {/* NL Summary */}
        <NLSummary summary={data.summary} />

        {/* Footer */}
        <BOQFooter
          disclaimer={data.disclaimer}
          onExportExcel={handleExportExcel}
          onExportPDF={handleExportPDF}
          onExportCSV={handleExportCSV}
        />
      </div>
    </div>
  );
}
