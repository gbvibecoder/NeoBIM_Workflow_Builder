"use client";

import { useState, useCallback, useMemo, useRef } from "react";
import { toast } from "sonner";
import { BOQHeader } from "@/features/boq/components/BOQHeader";
import { HeroStats } from "@/features/boq/components/HeroStats";
import { PriceControls } from "@/components/boq-visualizer/PriceControls";
import { CostDonutChart } from "@/features/boq/components/CostDonutChart";
import { DivisionBarChart } from "@/features/boq/components/DivisionBarChart";
import { MEPBreakdown } from "@/features/boq/components/MEPBreakdown";
import { IFCQualityCard } from "@/features/boq/components/IFCQualityCard";
import { BOQTable } from "@/features/boq/components/BOQTable";
import { NLSummary } from "@/components/boq-visualizer/NLSummary";
import { BOQFooter } from "@/features/boq/components/BOQFooter";
import type { BOQData, PriceOverrides, RateOverride } from "@/components/boq-visualizer/types";
import { DEFAULT_PRICES, recalculateLines, computeTotals } from "@/components/boq-visualizer/recalc-engine";

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
    bricks: DEFAULT_PRICES.bricks,
    sand: DEFAULT_PRICES.sand,
    timber: DEFAULT_PRICES.timber,
  }));

  const basePrices = useRef<PriceOverrides>({
    steel: data.market?.steelPerTonne ?? DEFAULT_PRICES.steel,
    cement: data.market?.cementPerBag ?? DEFAULT_PRICES.cement,
    mason: data.market?.masonRate ?? DEFAULT_PRICES.mason,
    bricks: DEFAULT_PRICES.bricks,
    sand: DEFAULT_PRICES.sand,
    timber: DEFAULT_PRICES.timber,
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

  // Total project cost = recalculated hard costs + original soft costs
  // Hard costs change with price sliders; soft costs stay fixed (% of original)
  const softCostRatio = data.totalCost > 0 ? data.softCosts / data.totalCost : 0;
  const recalcTotalProject = totals.totalCost + totals.totalCost * softCostRatio;
  const costPerM2 = data.gfa > 0 ? recalcTotalProject / data.gfa : data.benchmark.costPerM2;

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

  // Export handlers — use pre-generated artifact URLs from EX-002/EX-003
  const handleExportExcel = useCallback(() => {
    if (data.excelUrl) {
      window.open(data.excelUrl, "_blank");
    } else {
      toast.error("Excel not available", { description: "Run the BOQ Spreadsheet Exporter (EX-002) node in your workflow to generate the Excel file." });
    }
  }, [data.excelUrl]);

  const handleExportPDF = useCallback(() => {
    if (data.pdfUrl) {
      window.open(data.pdfUrl, "_blank");
    } else {
      toast.error("PDF not available", { description: "Run the PDF Report Exporter (EX-003) node in your workflow to generate the PDF." });
    }
  }, [data.pdfUrl]);

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
      className="h-full overflow-y-auto"
      style={{ background: "#070809" }}
    >
      {/* Header */}
      <BOQHeader data={data} onExportExcel={handleExportExcel} />

      <div className="flex flex-col gap-6 py-6">
        {/* Hero Stats */}
        <HeroStats
          totalCost={recalcTotalProject}
          costPerM2={costPerM2}
          hardCosts={totals.totalCost}
          ifcQualityScore={data.ifcQuality?.score ?? 0}
          benchmarkLow={data.benchmark.benchmarkLow}
          benchmarkHigh={data.benchmark.benchmarkHigh}
          recalculated={recalculated}
        />

        {/* Price Controls */}
        <PriceControls
          prices={prices}
          basePrices={basePrices.current}
          onChange={handlePriceChange}
          totalSavings={data.totalCost - recalcTotalProject}
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
