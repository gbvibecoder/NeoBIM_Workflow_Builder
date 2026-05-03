"use client";

import { useState, useCallback, useMemo, useRef } from "react";
import { motion, useInView, useReducedMotion } from "framer-motion";
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
import { InteractiveDotGrid } from "@/features/boq/components/InteractiveDotGrid";

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

  // Total project cost — must match the result-page hero (which displays
  // data._totalCost = data.hardCosts + data.softCosts) when no price
  // overrides are applied. The BOQ artifact stores three buckets:
  //   data.hardCosts = lineSum + escalation
  //   data.softCosts = professional fees, contingency, PM, etc.
  //   data.totalCost = hardCosts + softCosts (the canonical project cost)
  // `totals.totalCost` is just the sum of recalculated line totals (no
  // escalation, no soft costs), so we scale the original hardCosts and
  // softCosts proportionally to how price sliders moved the line sum.
  // At baseline (no overrides) scale = 1 → recalcTotalProject = data.totalCost,
  // matching the result page exactly.
  const baseLineSum = data.subtotalMaterial + data.subtotalLabor + data.subtotalEquipment;
  const scale = baseLineSum > 0 ? totals.totalCost / baseLineSum : 1;
  const recalcHardCosts = data.hardCosts * scale;
  const recalcSoftCosts = data.softCosts * scale;
  const recalcTotalProject = recalcHardCosts + recalcSoftCosts;
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

  // Export handlers — use pre-generated artifact URLs from EX-002/EX-003, fallback to client-side generation
  const handleExportExcel = useCallback(async () => {
    if (data.excelUrl) {
      window.open(data.excelUrl, "_blank");
      return;
    }
    // Client-side fallback: generate Excel from loaded BOQ data
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();

      // BOQ sheet
      const boqHeaders = ["IS Code", "Description", "Unit", "Qty", "Waste %", "Adj Qty", "Rate (₹)", "Material (₹)", "Labour (₹)", "Equipment (₹)", "Amount (₹)", "Source", "Confidence"];
      const boqRows = recalcLines.map(l => [
        l.isCode || "", l.description, l.unit,
        l.quantity, `${(l.wasteFactor * 100).toFixed(0)}%`, l.adjustedQty,
        l.unitRate, l.materialCost, l.laborCost, l.equipmentCost, l.totalCost,
        l.source, `${l.confidence}%`,
      ]);
      const boqSheet = XLSX.utils.aoa_to_sheet([boqHeaders, ...boqRows]);
      boqSheet["!cols"] = [{ wch: 16 }, { wch: 40 }, { wch: 6 }, { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 10 }];
      XLSX.utils.book_append_sheet(wb, boqSheet, "Bill of Quantities");

      // Summary sheet — Hard/Soft costs scale with line totals so the
      // exported summary stays consistent with the on-screen hero.
      const summaryData = [
        ["Project", data.projectName],
        ["Location", data.location],
        ["Date", data.date],
        ["GFA (m²)", data.gfa],
        [""],
        ["Hard Costs (₹)", recalcHardCosts],
        ["Material (₹)", totals.subtotalMaterial],
        ["Labour (₹)", totals.subtotalLabor],
        ["Equipment (₹)", totals.subtotalEquipment],
        ["Soft Costs (₹)", recalcSoftCosts],
        ["Total Project Cost (₹)", recalcTotalProject],
        [""],
        ["AACE Class", data.aaceClass || "Class 4"],
        ["Confidence", data.confidenceLevel || "MEDIUM"],
        ["Line Items", recalcLines.length],
      ];
      const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
      summarySheet["!cols"] = [{ wch: 22 }, { wch: 30 }];
      XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");

      const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
      const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `BOQ_${data.projectName.replace(/\s+/g, "_")}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Excel generation failed", { description: "Could not generate Excel file. Try running the EX-002 node in your workflow." });
    }
  }, [data.excelUrl, data.projectName, data.location, data.date, data.gfa, data.aaceClass, data.confidenceLevel, recalcLines, recalcTotalProject, recalcHardCosts, recalcSoftCosts, totals]);

  const handleExportPDF = useCallback(async () => {
    if (data.pdfUrl) {
      window.open(data.pdfUrl, "_blank");
      return;
    }
    // Client-side fallback: generate PDF from loaded BOQ data
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pw = doc.internal.pageSize.getWidth();
      const margin = 16;
      let y = 20;

      const fmtINR = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
      const addPage = () => { doc.addPage(); y = 20; };
      const checkPage = (need: number) => { if (y + need > 275) addPage(); };

      // Header
      doc.setFontSize(18);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(17, 24, 39);
      doc.text("Bill of Quantities", margin, y);
      y += 8;
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(107, 114, 128);
      doc.text(`${data.projectName}  •  ${data.location}  •  ${data.date}`, margin, y);
      y += 5;
      doc.text(`AACE ${data.aaceClass || "Class 4"}  •  Confidence: ${data.confidenceLevel || "MEDIUM"}`, margin, y);
      y += 10;

      // Summary box
      doc.setFillColor(249, 250, 251);
      doc.roundedRect(margin, y, pw - margin * 2, 28, 3, 3, "F");
      doc.setFontSize(9);
      doc.setTextColor(75, 85, 99);
      doc.text("Total Project Cost", margin + 4, y + 6);
      doc.text("Hard Costs", margin + 55, y + 6);
      doc.text("Soft Costs", margin + 105, y + 6);
      doc.text("GFA", margin + 145, y + 6);
      doc.setFontSize(12);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(13, 148, 136);
      doc.text(fmtINR(recalcTotalProject), margin + 4, y + 14);
      doc.setTextColor(17, 24, 39);
      doc.text(fmtINR(recalcHardCosts), margin + 55, y + 14);
      doc.text(fmtINR(recalcSoftCosts), margin + 105, y + 14);
      doc.text(`${data.gfa.toLocaleString()} m²`, margin + 145, y + 14);
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(156, 163, 175);
      doc.text(`Material: ${fmtINR(totals.subtotalMaterial)}  •  Labour: ${fmtINR(totals.subtotalLabor)}  •  Equipment: ${fmtINR(totals.subtotalEquipment)}`, margin + 4, y + 22);
      y += 36;

      // Table header
      const cols = [
        { label: "IS CODE", x: margin, w: 22 },
        { label: "DESCRIPTION", x: margin + 22, w: 58 },
        { label: "UNIT", x: margin + 80, w: 12 },
        { label: "QTY", x: margin + 92, w: 18 },
        { label: "RATE", x: margin + 110, w: 22 },
        { label: "AMOUNT", x: margin + 132, w: 28 },
        { label: "CONFIDENCE", x: margin + 160, w: 20 },
      ];
      doc.setFillColor(249, 250, 251);
      doc.rect(margin, y, pw - margin * 2, 7, "F");
      doc.setFontSize(7);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(156, 163, 175);
      cols.forEach(c => doc.text(c.label, c.x + 1, y + 5));
      y += 9;

      // Table rows
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      for (let i = 0; i < recalcLines.length; i++) {
        checkPage(7);
        const l = recalcLines[i];
        if (i % 2 === 1) {
          doc.setFillColor(250, 250, 248);
          doc.rect(margin, y - 1.5, pw - margin * 2, 6, "F");
        }
        doc.setTextColor(156, 163, 175);
        doc.text((l.isCode || "—").substring(0, 18), cols[0].x + 1, y + 2);
        doc.setTextColor(17, 24, 39);
        doc.text(l.description.substring(0, 45), cols[1].x + 1, y + 2);
        doc.setTextColor(75, 85, 99);
        doc.text(l.unit, cols[2].x + 1, y + 2);
        doc.text(l.adjustedQty.toLocaleString("en-IN", { maximumFractionDigits: 1 }), cols[3].x + 1, y + 2);
        doc.text(fmtINR(l.unitRate), cols[4].x + 1, y + 2);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(17, 24, 39);
        doc.text(fmtINR(l.totalCost), cols[5].x + 1, y + 2);
        doc.setFont("helvetica", "normal");
        const confColor = l.confidence >= 80 ? [5, 150, 105] : l.confidence >= 55 ? [217, 119, 6] : [220, 38, 38];
        doc.setTextColor(confColor[0], confColor[1], confColor[2]);
        doc.text(l.confidence >= 80 ? "HIGH" : l.confidence >= 55 ? "MED" : "LOW", cols[6].x + 1, y + 2);
        y += 5.5;
      }

      // Grand total
      checkPage(10);
      doc.setDrawColor(13, 148, 136);
      doc.setLineWidth(0.4);
      doc.line(margin, y, pw - margin, y);
      y += 5;
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(13, 148, 136);
      doc.text("TOTAL", margin + 1, y);
      doc.text(fmtINR(totals.totalCost), cols[5].x + 1, y);
      y += 10;

      // Disclaimer
      checkPage(15);
      doc.setFontSize(7);
      doc.setFont("helvetica", "italic");
      doc.setTextColor(156, 163, 175);
      const disclaimer = data.disclaimer || "This is an AI-generated estimate for preliminary budgeting purposes only.";
      const splitDisclaimer = doc.splitTextToSize(disclaimer, pw - margin * 2);
      doc.text(splitDisclaimer, margin, y);
      y += splitDisclaimer.length * 3.5 + 5;
      doc.setFont("helvetica", "normal");
      doc.text(`Generated by BuildFlow  •  ${recalcLines.length} line items  •  ${new Date().toLocaleDateString("en-IN")}`, margin, y);

      doc.save(`BOQ_${data.projectName.replace(/\s+/g, "_")}.pdf`);
    } catch {
      toast.error("PDF generation failed", { description: "Could not generate PDF. Try running the EX-003 node in your workflow." });
    }
  }, [data.pdfUrl, data.projectName, data.location, data.date, data.gfa, data.aaceClass, data.confidenceLevel, data.disclaimer, recalcLines, recalcTotalProject, recalcHardCosts, recalcSoftCosts, totals]);

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
    <div className="h-full overflow-y-auto relative" style={{ background: "#FAFAF8" }}>
      <InteractiveDotGrid />

      <div className="relative" style={{ zIndex: 1 }}>
      {/* Header */}
      <BOQHeader data={data} onExportExcel={handleExportExcel} onExportPDF={handleExportPDF} onExportCSV={handleExportCSV} />

      <div className="max-w-[1360px] mx-auto flex flex-col gap-10 py-8 pb-16">
        {/* Hero Stats — the showpiece */}
        <ErrorBoundary fallback={<SectionFallback section="Hero Stats" />}>
          <HeroStats
            totalCost={recalcTotalProject}
            costPerM2={costPerM2}
            hardCosts={recalcHardCosts}
            ifcQualityScore={data.ifcQuality?.score ?? 0}
            benchmarkLow={data.benchmark.benchmarkLow}
            benchmarkHigh={data.benchmark.benchmarkHigh}
            recalculated={recalculated}
            costRange={data.costRange}
            projectDate={(data as unknown as Record<string, unknown>)._projectDate as string | undefined}
            stalenessWarning={(data as unknown as Record<string, unknown>)._stalenessWarning as { severity: string; years: number; message: string } | undefined}
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

        {/* Monsoon season info — informational only, costs NOT adjusted */}
        {data.seasonalAdjustment?.applied && (
          <ScrollReveal delay={0.1}>
            <div className="mx-6 px-5 py-3.5 rounded-xl flex items-center gap-3" style={{ background: "#EFF6FF", border: "1px solid #BFDBFE" }}>
              <span style={{ fontSize: 18 }}>🌧️</span>
              <div>
                <span className="text-sm font-semibold" style={{ color: "#1E40AF" }}>
                  Monsoon season note
                </span>
                <p className="text-xs mt-0.5" style={{ color: "#4B5563", lineHeight: 1.5 }}>
                  Labor productivity in {data.pricingMetadata?.stateUsed || "this region"} typically drops {Math.round((1 - 1 / data.seasonalAdjustment.laborMultiplier) * 100)}% during {data.seasonalAdjustment.month}. This estimate uses standard rates — factor this into project timelines.
                </p>
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
    </div>
  );
}

// ─── Scroll Reveal Wrapper ───────────────────────────────────────────────────
function ScrollReveal({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-60px" });
  const prefersReduced = useReducedMotion();
  return (
    <motion.div
      ref={ref}
      initial={prefersReduced ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }}
      animate={isInView ? { opacity: 1, y: 0 } : {}}
      transition={prefersReduced ? { duration: 0 } : { duration: 0.55, delay, ease: [0.25, 0.46, 0.45, 0.94] as const }}
    >
      {children}
    </motion.div>
  );
}
