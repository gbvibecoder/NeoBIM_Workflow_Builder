"use client";

import { useState, useCallback, useMemo, useRef } from "react";
import { motion, useInView } from "framer-motion";
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
import { DataSourcesSummary } from "@/features/boq/components/DataSourcesSummary";
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
    <div className="h-full overflow-y-auto" style={{ background: "#FAFAF8" }}>
      {/* Header */}
      <BOQHeader data={data} onExportExcel={handleExportExcel} />

      <div className="max-w-[1360px] mx-auto flex flex-col gap-10 py-8 pb-16">
        {/* Hero Stats — the showpiece */}
        <ErrorBoundary fallback={<SectionFallback section="Hero Stats" />}>
          <HeroStats
            totalCost={recalcTotalProject}
            costPerM2={costPerM2}
            hardCosts={totals.totalCost}
            ifcQualityScore={data.ifcQuality?.score ?? 0}
            benchmarkLow={data.benchmark.benchmarkLow}
            benchmarkHigh={data.benchmark.benchmarkHigh}
            recalculated={recalculated}
            costRange={data.costRange}
          />
        </ErrorBoundary>

        {/* Transparency Row: Model Quality + Data Sources + Pricing Source */}
        <ScrollReveal delay={0.1}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 px-6">
            <ErrorBoundary fallback={<SectionFallback section="Data Sources" />}>
              <DataSourcesSummary data={data} />
            </ErrorBoundary>
            <div className="flex flex-col gap-4">
              {data.modelQualityReport && <ModelQualityCard report={data.modelQualityReport} />}
              {data.pricingMetadata && <PricingSourceBanner metadata={data.pricingMetadata} />}
            </div>
          </div>
        </ScrollReveal>

        {/* Seasonal Adjustment Badge */}
        {data.seasonalAdjustment?.applied && (
          <ScrollReveal delay={0.15}>
            <div className="mx-6 px-5 py-3.5 rounded-xl flex items-center gap-3" style={{ background: "#EFF6FF", border: "1px solid #BFDBFE" }}>
              <span style={{ fontSize: 20 }}>🌧️</span>
              <div>
                <span className="text-sm font-semibold" style={{ color: "#1D4ED8" }}>
                  Monsoon adjustment: +{data.seasonalAdjustment.overallImpactPercent.toFixed(1)}%
                </span>
                <span className="text-xs ml-2" style={{ color: "#6B7280" }}>
                  {data.seasonalAdjustment.month} — labor productivity at {(1 / data.seasonalAdjustment.laborMultiplier * 100).toFixed(0)}%
                </span>
              </div>
            </div>
          </ScrollReveal>
        )}

        {/* Price Controls */}
        <ScrollReveal delay={0.1}>
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
        </ScrollReveal>

        {/* Charts + Quality — Two Column */}
        <ScrollReveal delay={0.1}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 px-6">
            <div className="flex flex-col gap-6">
              <ErrorBoundary fallback={<SectionFallback section="Cost Chart" />}>
                <CostDonutChart material={totals.subtotalMaterial} labor={totals.subtotalLabor} equipment={totals.subtotalEquipment} />
              </ErrorBoundary>
              <ErrorBoundary fallback={<SectionFallback section="Division Chart" />}>
                <DivisionBarChart lines={recalcLines} />
              </ErrorBoundary>
            </div>
            <div className="flex flex-col gap-6">
              {data.mepBreakdown && (
                <ErrorBoundary fallback={<SectionFallback section="MEP" />}>
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
        </ScrollReveal>

        {/* BOQ Table */}
        <ScrollReveal delay={0.05}>
          <ErrorBoundary fallback={<SectionFallback section="BOQ Table" />}>
            <BOQTable lines={recalcLines} rateOverrides={rateOverrides} onRateOverride={handleRateOverride} grandTotal={totals.totalCost} />
          </ErrorBoundary>
        </ScrollReveal>

        {/* Summary + Footer */}
        <ScrollReveal delay={0.1}>
          <NLSummary summary={data.summary} />
        </ScrollReveal>

        <ScrollReveal delay={0.05}>
          <BOQFooter disclaimer={data.disclaimer} onExportExcel={handleExportExcel} onExportPDF={handleExportPDF} onExportCSV={handleExportCSV} />
        </ScrollReveal>
      </div>
    </div>
  );
}

// ─── Scroll Reveal Wrapper ───────────────────────────────────────────────────
function ScrollReveal({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 24 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={{ duration: 0.55, delay, ease: [0.25, 0.46, 0.45, 0.94] as const }}
    >
      {children}
    </motion.div>
  );
}
