"use client";

import { useState, useCallback, useMemo, useRef } from "react";
import { toast } from "sonner";
import { BOQHeader } from "@/features/boq/components/BOQHeader";
import { HeroStats } from "@/features/boq/components/HeroStats";
import { PriceControls } from "@/features/boq/components/PriceControls";
import { CostDonutChart } from "@/features/boq/components/CostDonutChart";
import { DivisionBarChart } from "@/features/boq/components/DivisionBarChart";
import { MEPBreakdown } from "@/features/boq/components/MEPBreakdown";
import { IFCQualityCard } from "@/features/boq/components/IFCQualityCard";
import { BOQTable } from "@/features/boq/components/BOQTable";
import { NLSummary } from "@/features/boq/components/NLSummary";
import { BOQFooter } from "@/features/boq/components/BOQFooter";
import { ModelQualityCard } from "@/features/boq/components/ModelQualityCard";
import { PricingSourceBanner } from "@/features/boq/components/PricingSourceBanner";
import type { BOQData, PriceOverrides, RateOverride } from "@/features/boq/components/types";
import { DEFAULT_PRICES, recalculateLines, computeTotals } from "@/features/boq/components/recalc-engine";
import { ErrorBoundary } from "@/shared/components/ErrorBoundary";
import { SectionFallback } from "@/features/boq/components/SectionFallback";

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
    bricks: data.market?.bricksPerNos ?? DEFAULT_PRICES.bricks,
    sand: data.market?.sandPerCft ?? DEFAULT_PRICES.sand,
    timber: data.market?.timberPerSqm ?? DEFAULT_PRICES.timber,
  }));

  const basePrices = useRef<PriceOverrides>({
    steel: data.market?.steelPerTonne ?? DEFAULT_PRICES.steel,
    cement: data.market?.cementPerBag ?? DEFAULT_PRICES.cement,
    mason: data.market?.masonRate ?? DEFAULT_PRICES.mason,
    bricks: data.market?.bricksPerNos ?? DEFAULT_PRICES.bricks,
    sand: data.market?.sandPerCft ?? DEFAULT_PRICES.sand,
    timber: data.market?.timberPerSqm ?? DEFAULT_PRICES.timber,
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

  // Total project cost = recalculated hard costs + proportional soft costs
  // Soft cost ratio is relative to hard costs (not total), so when hard costs
  // change via price sliders the soft costs scale proportionally.
  const softCostRatio = data.hardCosts > 0 ? data.softCosts / data.hardCosts : 0;
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
        {/* Transparency: Model Quality + Pricing Source */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 px-6">
          {data.modelQualityReport && (
            <ModelQualityCard report={data.modelQualityReport} />
          )}
          {data.pricingMetadata && (
            <div className="flex flex-col justify-center">
              <PricingSourceBanner metadata={data.pricingMetadata} />
            </div>
          )}
        </div>

        {/* Hero Stats */}
        <ErrorBoundary fallback={<SectionFallback section="Hero Stats" />}>
          <HeroStats
            totalCost={recalcTotalProject}
            costPerM2={costPerM2}
            hardCosts={totals.totalCost}
            ifcQualityScore={data.ifcQuality?.score ?? 0}
            benchmarkLow={data.benchmark.benchmarkLow}
            benchmarkHigh={data.benchmark.benchmarkHigh}
            recalculated={recalculated}
          />
        </ErrorBoundary>

        {/* Price Controls */}
        <ErrorBoundary fallback={<SectionFallback section="Price Controls" />}>
          <PriceControls
            prices={prices}
            basePrices={basePrices.current}
            onChange={handlePriceChange}
            totalSavings={data.totalCost - recalcTotalProject}
            baseTotal={data.totalCost}
            market={data.market ? {
              steelSource: data.market.steelSource,
              steelConfidence: data.market.steelConfidence,
              cementBrand: data.market.cementBrand,
              cementConfidence: data.market.cementConfidence,
              masonSource: data.market.masonSource,
              masonConfidence: data.market.masonConfidence,
            } : undefined}
          />
        </ErrorBoundary>

        {/* Two Column Layout: Charts + Quality */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 px-6">
          {/* Left Column */}
          <div className="flex flex-col gap-6">
            <ErrorBoundary fallback={<SectionFallback section="Cost Breakdown Chart" />}>
              <CostDonutChart
                material={totals.subtotalMaterial}
                labor={totals.subtotalLabor}
                equipment={totals.subtotalEquipment}
              />
            </ErrorBoundary>
            <ErrorBoundary fallback={<SectionFallback section="Division Chart" />}>
              <DivisionBarChart lines={recalcLines} />
            </ErrorBoundary>
          </div>

          {/* Right Column */}
          <div className="flex flex-col gap-6">
            {data.mepBreakdown && (
              <ErrorBoundary fallback={<SectionFallback section="MEP Breakdown" />}>
                <MEPBreakdown mep={data.mepBreakdown} />
              </ErrorBoundary>
            )}
            {data.ifcQuality && (
              <ErrorBoundary fallback={<SectionFallback section="IFC Quality" />}>
                <IFCQualityCard quality={data.ifcQuality} />
              </ErrorBoundary>
            )}
          </div>
        </div>

        {/* BOQ Table */}
        <ErrorBoundary fallback={<SectionFallback section="BOQ Table" />}>
          <BOQTable
            lines={recalcLines}
            rateOverrides={rateOverrides}
            onRateOverride={handleRateOverride}
            grandTotal={totals.totalCost}
          />
        </ErrorBoundary>

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
