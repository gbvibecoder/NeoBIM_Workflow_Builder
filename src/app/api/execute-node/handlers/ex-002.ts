import {
  generateId,
  uploadBase64ToR2,
  COST_DISCLAIMERS,
} from "./deps";
import type { NodeHandler } from "./types";

/**
 * EX-002 — BOQ Excel Export (interactive 6-sheet XLSX workbook)
 * Pure copy from execute-node/route.ts (lines 3172-3760 of the pre-decomposition file).
 *
 * Builds Cover Page, Control Panel, Rate Card, BoQ, Summary, Assumptions sheets.
 */
export const handleEX002: NodeHandler = async (ctx) => {
  const { inputData, tileInstanceId, executionId } = ctx;
  // BOQ Excel Export — Interactive 6-sheet XLSX workbook
  // Builder can change cement brand, steel supplier, contingency %, labor rates
  // and see all costs recalculate via Excel formulas.
  const XLSX = await import("xlsx");
  const boqData = inputData?._boqData as {
    lines: Array<{
      division: string; csiCode: string; description: string; unit: string;
      quantity: number; wasteFactor?: number; adjustedQty?: number;
      materialRate: number; laborRate: number; equipmentRate: number; unitRate: number;
      materialCost: number; laborCost: number; equipmentCost: number; totalCost: number;
      is1200Code?: string; storey?: string; elementCount?: number;
    }>;
    subtotalMaterial: number; subtotalLabor: number; subtotalEquipment: number;
    escalation?: number; projectType?: string; projectMultiplier?: number;
    grandTotal: number; disclaimer?: string;
  } | undefined;
  const boqLines = boqData?.lines ?? [];
  const dateStr = new Date().toISOString().split("T")[0];
  const currencyCode = String(inputData?._currency ?? "USD");
  const currencySymbol = String(inputData?._currencySymbol ?? "$");
  const isINR = currencyCode === "INR";
  const projectType = boqData?.projectType ?? "commercial";
  const projectMultiplier = boqData?.projectMultiplier ?? 1.0;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const escalationAmt = boqData?.escalation ?? 0;
  const hardTotal = (boqData?.subtotalMaterial ?? 0) + (boqData?.subtotalLabor ?? 0) + (boqData?.subtotalEquipment ?? 0);
  const pricingMeta = (inputData as Record<string, unknown>)?._pricingIntelligence ?? (inputData as Record<string, unknown>)?.pricingIntelligence;
  const pricingInfo = pricingMeta as Record<string, unknown> | undefined;

  // Extract market intelligence + benchmark data from upstream TR-008 metadata
  // Try both _marketIntelligence (from _boqData flow) and marketIntelligence (from metadata)
  const upstreamMI = ((inputData as Record<string, unknown>)?._marketIntelligence
    ?? (inputData as Record<string, unknown>)?.marketIntelligence) as Record<string, unknown> | undefined;
  const upstreamBenchmark = ((inputData as Record<string, unknown>)?._benchmark
    ?? (inputData as Record<string, unknown>)?.benchmark) as Record<string, unknown> | undefined;

  // Extract numeric market prices for populating Excel cells
  const liveSteelPrice = upstreamMI ? Number(upstreamMI.steelPerTonne ?? 0) : 0;
  const liveCementPrice = upstreamMI ? Number(upstreamMI.cementPerBag ?? 0) : 0;
  const liveCementBrand = upstreamMI ? String(upstreamMI.cementBrand ?? "") : "";
  const liveSteelSource = upstreamMI ? String(upstreamMI.steelSource ?? "") : "";
  const liveCementSource = upstreamMI ? String(upstreamMI.cementSource ?? "") : "";
  const liveSteelConf = upstreamMI ? String(upstreamMI.steelConfidence ?? "") : "";
  const liveCementConf = upstreamMI ? String(upstreamMI.cementConfidence ?? "") : "";
  const hasLivePrices = liveSteelPrice > 0 || liveCementPrice > 0;

  const wb = XLSX.utils.book_new();

  // ═══════════════════════════════════════════════════════════════════════
  // SHEET 1: CONTROL PANEL — Builder edits this sheet only
  // ═══════════════════════════════════════════════════════════════════════
  const cpRows: (string | number | null)[][] = [
    ["BUILDFLOW — PROJECT CONTROL PANEL", "", "", ""],
    ["Edit the yellow cells below. All costs recalculate automatically.", "", "", ""],
    [""],
    ["PROJECT INFORMATION", "", "", ""],
    ["Project Name:", String(inputData?.label ?? "Building Project"), "", ""],
    ["Location:", String(inputData?._region ?? "India"), "", ""],
    ["Date:", dateStr, "", ""],
    ["Prepared By:", "BuildFlow (trybuildflow.in)", "", ""],
    [""],
  ];

  // ── Benchmark validation (prominent if warning) ──
  if (upstreamBenchmark) {
    const bSeverity = String(upstreamBenchmark.severity ?? "ok");
    if (bSeverity !== "ok") {
      cpRows.push(["BENCHMARK VALIDATION", "", "", ""]);
      cpRows.push([String(upstreamBenchmark.message ?? ""), "", "", ""]);
      cpRows.push([`Cost/m²: ₹${upstreamBenchmark.costPerM2 ?? "N/A"}`, "", `Range: ₹${upstreamBenchmark.rangeLow ?? "?"} – ₹${upstreamBenchmark.rangeHigh ?? "?"}`, ""]);
      cpRows.push([""]);
    }
  }

  // ── Market intelligence prices with sources ──
  if (upstreamMI) {
    const miDuration = Number(upstreamMI.durationMs ?? 0);
    const miSearches = Number(upstreamMI.searchCount ?? 0);
    const miFallbacks = Number(upstreamMI.fallbacksUsed ?? 0);
    cpRows.push(["LIVE MARKET PRICES (AI web-search agent)", "", "", ""]);
    cpRows.push(["Steel:", String(upstreamMI.steel ?? "N/A"), "Source:", String(upstreamMI.steelSource ?? "N/A")]);
    cpRows.push(["Cement:", String(upstreamMI.cement ?? "N/A"), "Source:", String(upstreamMI.cementSource ?? "N/A")]);
    cpRows.push(["Sand:", String(upstreamMI.sand ?? "N/A"), "", ""]);
    cpRows.push([
      `Agent: ${String(upstreamMI.status ?? "N/A")}`,
      `Searches: ${miSearches}`,
      `Time: ${(miDuration / 1000).toFixed(1)}s`,
      `Fallbacks: ${miFallbacks}`,
    ]);
    cpRows.push([`Fetched: ${String(upstreamMI.fetchedAt ?? dateStr).split("T")[0]}`, "", "", ""]);
    // Sources list
    const sources = upstreamMI.sources as string[] | undefined;
    if (sources && sources.length > 0) {
      cpRows.push(["Sources:", "", "", ""]);
      for (const src of sources.slice(0, 5)) {
        cpRows.push([`  ${src}`, "", "", ""]);
      }
    }
    cpRows.push([""]);
  }

  // Use live prices if available, otherwise fall back to static defaults
  const cementDefault = liveCementPrice > 0 ? liveCementPrice : 390;
  const cementBrandDefault = liveCementBrand || "UltraTech";
  const steelDefault = liveSteelPrice > 0 ? liveSteelPrice : 72000;

  cpRows.push(
    // ── Cement pricing ──
    ["CEMENT PRICING", "", "Price/Bag (50kg)", "₹/m³ concrete"],
    [`Selected Brand:`, cementBrandDefault, cementDefault, null], // C = price, D = formula
    hasLivePrices && liveCementPrice > 0
      ? [`  Source: ${liveCementSource}`, `${liveCementConf} confidence`, "", ""]
      : ["", "", "", ""],
    ["Available Brands:", "Price/Bag", "", ""],
    ["UltraTech", liveCementPrice > 0 ? Math.round(cementDefault * 1.03) : 390, "", ""],
    ["Ambuja", liveCementPrice > 0 ? Math.round(cementDefault * 0.97) : 380, "", ""],
    ["ACC", liveCementPrice > 0 ? Math.round(cementDefault * 0.96) : 375, "", ""],
    ["Shree Cement", liveCementPrice > 0 ? Math.round(cementDefault * 0.95) : 370, "", ""],
    ["JK Cement", liveCementPrice > 0 ? Math.round(cementDefault * 0.93) : 365, "", ""],
    ["Dalmia", liveCementPrice > 0 ? Math.round(cementDefault * 0.92) : 360, "", ""],
    [""],
    // ── Steel pricing ──
    ["STEEL PRICING (TMT Fe500)", "", "₹/Tonne", "₹/kg"],
    ["Selected Supplier:", "Tata Tiscon", steelDefault, null], // C = price, D = formula
    hasLivePrices && liveSteelPrice > 0
      ? [`  Source: ${liveSteelSource}`, `${liveSteelConf} confidence`, "", ""]
      : ["", "", "", ""],
    ["Available Suppliers:", "₹/Tonne", "", ""],
    ["Tata Tiscon", liveSteelPrice > 0 ? steelDefault : 72000, "", ""],
    ["SAIL", liveSteelPrice > 0 ? Math.round(steelDefault * 0.94) : 68000, "", ""],
    ["JSW Neosteel", liveSteelPrice > 0 ? Math.round(steelDefault * 0.97) : 70000, "", ""],
    ["Kamdhenu", liveSteelPrice > 0 ? Math.round(steelDefault * 0.92) : 66000, "", ""],
    ["Shyam Steel", liveSteelPrice > 0 ? Math.round(steelDefault * 0.90) : 65000, "", ""],
    ["Local / Unbranded", liveSteelPrice > 0 ? Math.round(steelDefault * 0.86) : 62000, "", ""],
    [""],
    // ── Adjustments ──
    ["PROJECT ADJUSTMENTS", "", "Value", ""],
    ["Contractor Overhead %:", "", 15, ""],
    ["Contingency %:", "", 10, ""],
    ["GST on Material (avg) %:", "", 18, ""],
    ["Labour Cess %:", "", 1, ""],
    ["Site Difficulty:", "", "Normal", "Normal / Congested (+10%) / Remote (+15%)"],
    [""],
    // ── Regional factors (auto-populated, overridable) ──
    ["REGIONAL FACTORS (auto-populated)", "", "Factor", "Source"],
    ["State PWD Factor:", "", Number(pricingInfo?.overallFactor ?? 1.0), String(pricingInfo?.statePWD ?? "CPWD National")],
    ["City Tier:", "", String(pricingInfo?.cityTier ?? "N/A"), ""],
    ["Seasonal Adjustment:", "", String(pricingInfo?.seasonalNotes ?? "Standard"), ""],
    ["Confidence Level:", "", String(pricingInfo?.confidence ?? "MEDIUM"), ""],
    [""],
  );

  // ── Labor rates (live from market agent → city-tier fallback → CPWD static) ──
  {
    const ct = String(pricingInfo?.cityTier ?? "tier-2").toLowerCase();
    const laborMult = ct === "metro" ? 1.35 : ct === "tier-1" ? 1.15 : ct === "tier-2" ? 1.00 : (ct === "tier-3" || ct === "town") ? 0.85 : 0.70;
    const tier = ct === "metro" ? "Metro" : ct === "tier-1" ? "Tier-1" : ct === "tier-2" ? "Tier-2" : (ct === "tier-3" || ct === "town") ? "Tier-3" : "Rural";
    // Use live labor rates from market intelligence if available
    const ml = upstreamMI?.labor as Record<string, { value?: number; source?: string; confidence?: string }> | undefined;
    const lr = (role: string, base: number): [number, string] => {
      const live = ml?.[role];
      if (live?.value && live.value > 0 && live.confidence !== "LOW") {
        return [live.value, `${live.source ?? "AI"} (${live.confidence})`];
      }
      return [Math.round(base * laborMult), `₹${base} base × ${laborMult} (${tier})`];
    };
    const [mason, masonSrc] = lr("mason", 800);
    const [helper, helperSrc] = lr("helper", 450);
    const [carpenter, carpSrc] = lr("carpenter", 900);
    const [steelFixer, sfSrc] = lr("steelFixer", 750);
    const [electrician, elecSrc] = lr("electrician", 1000);
    const [plumber, plumbSrc] = lr("plumber", 850);
    const laborSource = ml?.mason?.confidence !== "LOW" ? "Live (AI-sourced)" : `${tier} tier (${laborMult}x)`;
    cpRows.push(
      ["LABOR RATES (daily)", "", "₹/day", laborSource],
      ["Mason (skilled):", "", mason, masonSrc],
      ["Helper (unskilled):", "", helper, helperSrc],
      ["Carpenter:", "", carpenter, carpSrc],
      ["Steel Fixer:", "", steelFixer, sfSrc],
      ["Painter:", "", Math.round(650 * laborMult), `₹650 base × ${laborMult} (${tier})`],
      ["Electrician:", "", electrician, elecSrc],
      ["Plumber:", "", plumber, plumbSrc],
    );
  }

  // Find actual row indices for cement and steel "Selected" rows (dynamic due to market intel/benchmark sections)
  const cpSheet = XLSX.utils.aoa_to_sheet(cpRows);
  for (let ri = 0; ri < cpRows.length; ri++) {
    const row = cpRows[ri];
    if (!row || !row[0]) continue;
    const cell0 = String(row[0]);
    // Cement: "Selected Brand:" row — set D column formula: price × 6.5 bags/m³
    if (cell0 === "Selected Brand:") {
      const excelRow = ri + 1; // Excel is 1-indexed
      const cPrice = Number(row[2]) || cementDefault;
      cpSheet[`D${excelRow}`] = { t: "n", f: `C${excelRow}*6.5`, v: cPrice * 6.5 };
    }
    // Steel: "Selected Supplier:" row — set D column formula: price/1000 for ₹/kg
    if (cell0 === "Selected Supplier:") {
      const excelRow = ri + 1;
      const sPrice = Number(row[2]) || steelDefault;
      cpSheet[`D${excelRow}`] = { t: "n", f: `C${excelRow}/1000`, v: sPrice / 1000 };
    }
  }
  cpSheet["!cols"] = [{ wch: 28 }, { wch: 22 }, { wch: 16 }, { wch: 35 }];
  XLSX.utils.book_append_sheet(wb, cpSheet, "Control Panel");

  // ═══════════════════════════════════════════════════════════════════════
  // SHEET 2: BRAND RATE CARD
  // ═══════════════════════════════════════════════════════════════════════
  const brandRows = [
    ["CURRENT MARKET RATES — Update when you get fresh quotes", "", "", "", ""],
    [""],
    ["CEMENT (50kg bag)", "", "", "", ""],
    ["Brand", "Grade", "₹/Bag", "₹/m³ (M25)", "Last Updated"],
    ["UltraTech", "OPC 53", 390, 2535, dateStr],
    ["Ambuja", "OPC 53", 380, 2470, dateStr],
    ["ACC", "OPC 53", 375, 2438, dateStr],
    ["Shree Cement", "OPC 53", 370, 2405, dateStr],
    ["JK Cement", "OPC 53", 365, 2373, dateStr],
    ["Dalmia", "OPC 53", 360, 2340, dateStr],
    [""],
    ["STEEL TMT BARS", "", "", "", ""],
    ["Supplier", "Grade", "₹/Tonne", "₹/kg", "Last Updated"],
    ["Tata Tiscon", "Fe500D", 72000, 72, dateStr],
    ["SAIL", "Fe500", 68000, 68, dateStr],
    ["JSW Neosteel", "Fe500D", 70000, 70, dateStr],
    ["Kamdhenu", "Fe500", 66000, 66, dateStr],
    ["Shyam Steel", "Fe500", 65000, 65, dateStr],
    ["Local/Unbranded", "Fe500", 62000, 62, dateStr],
    [""],
    ["AGGREGATES & SAND", "", "", "", ""],
    ["Material", "Size/Type", "Unit", "₹/unit", "Last Updated"],
    ["Coarse Aggregate", "20mm", "Tonne", 1200, dateStr],
    ["Coarse Aggregate", "10mm", "Tonne", 1400, dateStr],
    ["River Sand", "Zone II", "Cu.ft", 45, dateStr],
    ["M-Sand", "Manufactured", "Cu.ft", 35, dateStr],
    ["P-Sand", "Plastering", "Cu.ft", 40, dateStr],
    [""],
    ["GST RATES BY MATERIAL", "", "", "", ""],
    ["Material Category", "", "GST %", "", ""],
    ["Steel & Iron", "", "18%", "", ""],
    ["Cement", "", "28%", "", ""],
    ["Sand, Aggregate, Bricks", "", "5%", "", ""],
    ["Tiles & Flooring", "", "18%", "", ""],
    ["Paints & Coatings", "", "18%", "", ""],
    ["Doors & Windows", "", "18%", "", ""],
    ["Works Contract (Labour)", "", "12%", "", ""],
  ];
  const brandSheet = XLSX.utils.aoa_to_sheet(brandRows);
  brandSheet["!cols"] = [{ wch: 22 }, { wch: 16 }, { wch: 12 }, { wch: 14 }, { wch: 14 }];
  XLSX.utils.book_append_sheet(wb, brandSheet, "Rate Card");

  // ═══════════════════════════════════════════════════════════════════════
  // SHEET 3: BILL OF QUANTITIES with GST column
  // ═══════════════════════════════════════════════════════════════════════
  if (boqLines.length > 0) {
    const hasIS1200 = boqLines.some(l => l.is1200Code);

    // GST rates by subcategory
    // All BOQ line items are WORKS CONTRACTS (supply + apply) → 18% GST
    // Exception: raw material procurement (cement bags as goods → 28%, sand/aggregate → 5%)
    // In a BOQ, concrete/plaster/tile work is a works contract, not goods sale
    const getGSTRate = (desc: string, division: string): number => {
      const d = (desc + " " + division).toLowerCase();
      // Works contracts (supply + labour + apply) — 18% GST
      if (d.includes("concrete") || d.includes("rcc") || d.includes("pcc")) return 0.18;
      if (d.includes("steel") || d.includes("rebar") || d.includes("metal")) return 0.18;
      if (d.includes("plaster") || d.includes("paint")) return 0.18;
      if (d.includes("tile") || d.includes("flooring") || d.includes("marble") || d.includes("granite")) return 0.18;
      if (d.includes("door") || d.includes("window") || d.includes("curtain") || d.includes("aluminium")) return 0.18;
      if (d.includes("formwork") || d.includes("centering")) return 0.18;
      if (d.includes("waterproof")) return 0.18;
      // Raw materials as goods (used in Rate Card, not in BOQ line items)
      if (d.includes("brick") || d.includes("block") || d.includes("sand") || d.includes("aggregate") || d.includes("masonry")) return 0.12;
      // Labour-only contracts (pure labour supply)
      if (d.includes("labour") || d.includes("labor")) return 0.18;
      return 0.18; // default for works contracts
    };

    const boqHeaders = hasIS1200
      ? ["IS 1200 Code", "Division", "Description", "Unit", "Base Qty", "Waste %", "Adj Qty",
         "Mat Rate", "Lab Rate", "Eqp Rate", "Unit Rate",
         "Material ₹", "Labour ₹", "Equip ₹", "Subtotal ₹", "GST %", "GST ₹", "Total incl GST", "Data Source", "Confidence"]
      : ["Division", "Description", "Unit", "Base Qty", "Waste %", "Adj Qty",
         "Mat Rate", "Lab Rate", "Eqp Rate", "Unit Rate",
         "Material ₹", "Labour ₹", "Equip ₹", "Subtotal ₹", "GST %", "GST ₹", "Total incl GST", "Data Source", "Confidence"];

    const boqTableRows: (string | number)[][] = [];
    let grandTotalInclGST = 0;
    let totalGST = 0;

    // ── Track row positions for Excel formula injection ──
    // Formula cells (Adj Qty, Unit Rate, Costs) reference editable cells (Qty, Waste%, Rates)
    // so when a QS changes any input, all dependent values recalculate automatically.
    const dataRowNums: number[] = [];  // Excel row numbers (1-indexed) for data rows
    const divBounds: Array<{ headerRow: number; subtotalRow: number }> = [];
    let curDivHeaderRow = -1;

    // Column positions (0-indexed) — differ by 1 when IS1200 code column is present
    const FC = hasIS1200
      ? { qty: 4, waste: 5, adjQty: 6, matRate: 7, labRate: 8, eqpRate: 9, unitRate: 10,
          matCost: 11, labCost: 12, eqpCost: 13, subtotal: 14, gstPct: 15, gstAmt: 16, total: 17 }
      : { qty: 3, waste: 4, adjQty: 5, matRate: 6, labRate: 7, eqpRate: 8, unitRate: 9,
          matCost: 10, labCost: 11, eqpCost: 12, subtotal: 13, gstPct: 14, gstAmt: 15, total: 16 };

    // Group by division
    const divGroups = new Map<string, typeof boqLines>();
    for (const l of boqLines) {
      const div = l.division || "General";
      if (!divGroups.has(div)) divGroups.set(div, []);
      divGroups.get(div)!.push(l);
    }

    for (const [divName, lines] of divGroups) {
      const emptyCols = hasIS1200 ? 20 : 19;
      boqTableRows.push([divName.toUpperCase(), ...Array(emptyCols).fill("")]);
      curDivHeaderRow = boqTableRows.length + 1; // Excel row (row 1 = header)

      let divMat = 0, divLab = 0, divEqp = 0, divSub = 0, divGST = 0, divTotal = 0;

      for (const l of lines) {
        // Waste% as decimal (0.07) — Excel formula reads this directly. Format: 0%.
        const wasteNum = l.wasteFactor ?? 0;
        const adjQty = l.adjustedQty ?? l.quantity;
        const countLabel = l.elementCount ? ` (${l.elementCount} nr)` : "";
        const subtotal = l.totalCost;
        // GST% as decimal (0.18) — Excel formula reads this directly. Format: 0%.
        const gstRate = getGSTRate(l.description, l.division);
        const gstAmt = Math.round(l.materialCost * gstRate * 100) / 100;
        const totalInclGST = Math.round((subtotal + gstAmt) * 100) / 100;

        // Determine data source for transparency column
        const dataSource = l.division.includes("Structural IFC") ? "Structural IFC"
          : l.division.includes("MEP IFC") ? "MEP IFC"
          : l.division.includes("PROVISIONAL") || l.division.includes("Provisional") ? "Provisional"
          : l.division.includes("Formwork") || l.division.includes("Rebar") || l.division.includes("Plaster") || l.division.includes("Reinforcement") ? "IFC Derived"
          : l.csiCode?.startsWith("IS1200") ? "IFC Geometry"
          : "Benchmark";
        const lineConf = (l as Record<string, unknown>).confidence as { score?: string; factors?: string[] } | undefined;
        const confidence = lineConf?.score
          ? `${lineConf.score.toUpperCase()}${lineConf.factors?.length ? " — " + lineConf.factors[0] : ""}`
          : (dataSource === "IFC Geometry" ? "HIGH 90%"
            : dataSource === "Structural IFC" ? "HIGH 88%"
            : dataSource === "MEP IFC" ? "HIGH 85%"
            : dataSource === "IFC Derived" ? "MED 72%"
            : dataSource === "Provisional" ? "LOW 45%"
            : "MED 60%");

        const divStr = String(l.division || "General");
        const divShort = divStr.includes("Concrete") || divStr.includes("Part 2") ? "Structural"
          : divStr.includes("Masonry") || divStr.includes("Part 3") ? "Masonry"
          : divStr.includes("Steel") || divStr.includes("Part 6") || divStr.includes("Part 7") ? "Steel"
          : divStr.includes("Plaster") || divStr.includes("Part 8") || divStr.includes("Paint") || divStr.includes("Part 10") || divStr.includes("Flooring") || divStr.includes("Part 13") ? "Finishes"
          : divStr.includes("MEP") || divStr.includes("Part 14") || divStr.includes("Part 15") || divStr.includes("Part 16") || divStr.includes("Part 17") ? "MEP"
          : divStr.includes("SUBSTRUCTURE") || divStr.includes("Part 1") ? "Foundation"
          : divStr.includes("EXTERNAL") ? "External"
          : divStr.includes("Formwork") || divStr.includes("Part 5") ? "Formwork"
          : divStr.includes("Reinforcement") ? "Rebar"
          : divStr.includes("PROVISIONAL") ? "Provisional"
          : divStr.split("—")[0]?.trim().slice(0, 15) || "General";

        const safeNum = (v: number) => (Number.isFinite(v) ? v : 0);

        // Numeric waste% and GST% (not strings) — required for Excel formulas
        const row: (string | number)[] = hasIS1200
          ? [l.is1200Code ?? "", divShort, `${l.description}${countLabel}`, l.unit,
             safeNum(l.quantity), wasteNum, safeNum(adjQty),
             safeNum(l.materialRate), safeNum(l.laborRate), safeNum(l.equipmentRate), safeNum(l.unitRate),
             safeNum(l.materialCost), safeNum(l.laborCost), safeNum(l.equipmentCost), safeNum(subtotal),
             gstRate, safeNum(gstAmt), safeNum(totalInclGST), dataSource, confidence]
          : [divShort, `${l.description}${countLabel}`, l.unit,
             safeNum(l.quantity), wasteNum, safeNum(adjQty),
             safeNum(l.materialRate), safeNum(l.laborRate), safeNum(l.equipmentRate), safeNum(l.unitRate),
             safeNum(l.materialCost), safeNum(l.laborCost), safeNum(l.equipmentCost), safeNum(subtotal),
             gstRate, safeNum(gstAmt), safeNum(totalInclGST), dataSource, confidence];

        boqTableRows.push(row);
        dataRowNums.push(boqTableRows.length + 1); // Excel row (header = row 1)
        divMat += l.materialCost; divLab += l.laborCost; divEqp += l.equipmentCost;
        divSub += subtotal; divGST += gstAmt; divTotal += totalInclGST;
      }

      // Division subtotal row — values are cached; formulas injected after sheet creation
      const subRow = hasIS1200
        ? ["", "", `${divName} SUBTOTAL`, "", "", "", "",
           "", "", "", "", Math.round(divMat), Math.round(divLab), Math.round(divEqp),
           Math.round(divSub), "", Math.round(divGST), Math.round(divTotal), "", ""]
        : ["", `${divName} SUBTOTAL`, "", "", "", "",
           "", "", "", "", Math.round(divMat), Math.round(divLab), Math.round(divEqp),
           Math.round(divSub), "", Math.round(divGST), Math.round(divTotal), "", ""];
      boqTableRows.push(subRow);
      divBounds.push({ headerRow: curDivHeaderRow, subtotalRow: boqTableRows.length + 1 });

      boqTableRows.push(Array(hasIS1200 ? 21 : 20).fill(""));
      grandTotalInclGST += divTotal;
      totalGST += divGST;
    }

    // Grand total row — values are cached; formulas injected after sheet creation
    const gtRow = hasIS1200
      ? ["", "", "GRAND TOTAL", "", "", "", "", "", "", "", "",
         Math.round(boqData?.subtotalMaterial ?? 0), Math.round(boqData?.subtotalLabor ?? 0),
         Math.round(boqData?.subtotalEquipment ?? 0), Math.round(hardTotal),
         "", Math.round(totalGST), Math.round(grandTotalInclGST), "", ""]
      : ["", "GRAND TOTAL", "", "", "", "", "", "", "", "",
         Math.round(boqData?.subtotalMaterial ?? 0), Math.round(boqData?.subtotalLabor ?? 0),
         Math.round(boqData?.subtotalEquipment ?? 0), Math.round(hardTotal),
         "", Math.round(totalGST), Math.round(grandTotalInclGST), "", ""];
    boqTableRows.push(gtRow);
    const gtExcelRow = boqTableRows.length + 1;

    const boqSheet = XLSX.utils.aoa_to_sheet([boqHeaders, ...boqTableRows]);

    // ══════════════════════════════════════════════════════════════════════
    // FORMULA INJECTION — Makes Qty × Rate = Amount recalculate in Excel
    // ══════════════════════════════════════════════════════════════════════
    const cl = XLSX.utils.encode_col; // column index → letter ("A", "B", ...)
    const ec = XLSX.utils.encode_cell; // {r, c} → "A1" (0-indexed r,c)

    // ── Per-line-item formulas: Adj Qty, Unit Rate, all Cost columns ──
    for (const r of dataRowNums) {
      const ri = r - 1; // 0-indexed row for encode_cell

      const setF = (col: number, f: string, fmt: string, cached?: number) => {
        const cell: { t: string; f: string; z: string; v?: number } = { t: "n", f, z: fmt };
        if (cached !== undefined && Number.isFinite(cached)) cell.v = cached;
        boqSheet[ec({ r: ri, c: col })] = cell;
      };

      // Read cached values from the static row for v (pre-calculated fallback)
      const cv = (col: number): number => {
        const ref = ec({ r: ri, c: col });
        const cell = boqSheet[ref] as { v?: number } | undefined;
        return Number(cell?.v ?? 0);
      };

      // Adj Qty = Base Qty × (1 + Waste%)
      setF(FC.adjQty, `${cl(FC.qty)}${r}*(1+${cl(FC.waste)}${r})`, "#,##0.00", cv(FC.adjQty));
      // Unit Rate = Mat Rate + Lab Rate + Eqp Rate
      setF(FC.unitRate, `${cl(FC.matRate)}${r}+${cl(FC.labRate)}${r}+${cl(FC.eqpRate)}${r}`, "#,##0.00", cv(FC.unitRate));
      // Material Cost = Adj Qty × Mat Rate
      setF(FC.matCost, `${cl(FC.adjQty)}${r}*${cl(FC.matRate)}${r}`, "#,##0", cv(FC.matCost));
      // Labor Cost = Adj Qty × Lab Rate
      setF(FC.labCost, `${cl(FC.adjQty)}${r}*${cl(FC.labRate)}${r}`, "#,##0", cv(FC.labCost));
      // Equipment Cost = Adj Qty × Eqp Rate
      setF(FC.eqpCost, `${cl(FC.adjQty)}${r}*${cl(FC.eqpRate)}${r}`, "#,##0", cv(FC.eqpCost));
      // Subtotal = Adj Qty × Unit Rate
      setF(FC.subtotal, `${cl(FC.adjQty)}${r}*${cl(FC.unitRate)}${r}`, "#,##0", cv(FC.subtotal));
      // GST Amount = Material Cost × GST%
      setF(FC.gstAmt, `${cl(FC.matCost)}${r}*${cl(FC.gstPct)}${r}`, "#,##0", cv(FC.gstAmt));
      // Total incl GST = Subtotal + GST Amount
      setF(FC.total, `${cl(FC.subtotal)}${r}+${cl(FC.gstAmt)}${r}`, "#,##0", cv(FC.total));

      // Apply percentage format to waste% and GST% cells
      const wasteCellRef = ec({ r: ri, c: FC.waste });
      if (boqSheet[wasteCellRef]) (boqSheet[wasteCellRef] as { z?: string }).z = "0%";
      const gstCellRef = ec({ r: ri, c: FC.gstPct });
      if (boqSheet[gstCellRef]) (boqSheet[gstCellRef] as { z?: string }).z = "0%";
    }

    // ── Division subtotal formulas: SUM over data rows in each division ──
    for (const db of divBounds) {
      const si = db.subtotalRow - 1; // 0-indexed
      const divDataRows = dataRowNums.filter(r => r > db.headerRow && r < db.subtotalRow);
      if (divDataRows.length === 0) continue;
      const first = divDataRows[0];
      const last = divDataRows[divDataRows.length - 1];

      for (const col of [FC.matCost, FC.labCost, FC.eqpCost, FC.subtotal, FC.gstAmt, FC.total]) {
        const ref = ec({ r: si, c: col });
        const cached = Number((boqSheet[ref] as { v?: number } | undefined)?.v ?? 0);
        boqSheet[ref] = { t: "n", f: `SUM(${cl(col)}${first}:${cl(col)}${last})`, z: "#,##0", v: cached };
      }
    }

    // ── Grand total formulas: sum of division subtotals ──
    if (divBounds.length > 0) {
      const gti = gtExcelRow - 1; // 0-indexed
      for (const col of [FC.matCost, FC.labCost, FC.eqpCost, FC.subtotal, FC.gstAmt, FC.total]) {
        const refs = divBounds.map(d => `${cl(col)}${d.subtotalRow}`).join("+");
        const ref = ec({ r: gti, c: col });
        const cached = Number((boqSheet[ref] as { v?: number } | undefined)?.v ?? 0);
        boqSheet[ref] = { t: "n", f: refs, z: "#,##0", v: cached };
      }
    }

    // ── Column widths (optimized for readability) ──
    boqSheet["!cols"] = [
      ...(hasIS1200 ? [{ wch: 18 }] : []),  // IS 1200 Code
      { wch: 12 },   // Division
      { wch: 45 },   // Description
      { wch: 6 },    // Unit
      { wch: 12 },   // Base Qty
      { wch: 8 },    // Waste %
      { wch: 12 },   // Adj Qty
      { wch: 12 },   // Mat Rate
      { wch: 12 },   // Lab Rate
      { wch: 12 },   // Eqp Rate
      { wch: 12 },   // Unit Rate
      { wch: 14 },   // Material ₹
      { wch: 14 },   // Labour ₹
      { wch: 14 },   // Equip ₹
      { wch: 14 },   // Subtotal ₹
      { wch: 7 },    // GST %
      { wch: 14 },   // GST ₹
      { wch: 15 },   // Total incl GST
      { wch: 14 },   // Data Source
      { wch: 12 },   // Confidence
    ];

    // ── Auto-filter on header row ──
    const lastColLetter = cl(boqHeaders.length - 1);
    boqSheet["!autofilter"] = { ref: `A1:${lastColLetter}${gtExcelRow}` };

    XLSX.utils.book_append_sheet(wb, boqSheet, "Bill of Quantities");

    // ═════════════════════════════════════════════════════════════════════
    // SHEET 4: COST SUMMARY
    // ═════════════════════════════════════════════════════════════════════
    // GFA from TR-008 (sum of slab areas) — never use hardcoded ₹35,000 fallback
    const gfa = Number(inputData?._gfa ?? 0) || 100; // 100m² absolute minimum fallback
    // Use total project cost (hard + soft) for cost/m² — matches TR-008 NL summary
    const tr008Total = Number(inputData?._totalCost ?? 0);
    const totalForPerSqm = tr008Total > 0 ? tr008Total : hardTotal;
    const costPerSqm = totalForPerSqm > 0 ? Math.round(totalForPerSqm / gfa) : 0;
    // GST: use hardTotal + estimated GST (18% on materials ≈ 55% of hard cost)
    const estimatedGST = Math.round(hardTotal * 0.55 * 0.18); // 18% GST on ~55% material component
    const hardTotalInclGST = hardTotal + (totalGST > 0 ? totalGST : estimatedGST);
    const totalInclGST = totalForPerSqm + (totalGST > 0 ? totalGST : estimatedGST);
    const costPerSqmInclGST = totalInclGST > 0 ? Math.round(totalInclGST / gfa) : 0;
    // FIX 4: Use TR-008's computed soft costs when available, not hardcoded 44%
    const tr008TotalCost = Number(inputData?._totalCost ?? 0);
    const tr008SoftCosts = Number(inputData?._softCosts ?? 0);
    const softCostTotal = tr008SoftCosts > 0 ? tr008SoftCosts : Math.round(hardTotal * 0.44);
    const totalExclGST = tr008TotalCost > 0 ? tr008TotalCost : Math.round(hardTotal + softCostTotal);
    const contingencyAmt = Math.round(hardTotal * 0.10);
    const overheadAmt = Math.round(hardTotal * 0.15);
    // Sanity: incl GST must ALWAYS be > excl GST
    if (costPerSqmInclGST <= costPerSqm && hardTotal > 0) {
      console.error(`[EX-002] GST SANITY FAIL: inclGST ₹${costPerSqmInclGST} <= exclGST ₹${costPerSqm}. Forcing recalc.`);
    }

    const summaryRows = [
      ["COST ESTIMATE SUMMARY"],
      [""],
      ["Project:", String(inputData?.label ?? "Building Project")],
      ["Location:", String(inputData?._region ?? "India")],
      ["Date:", dateStr],
      ["Type:", `${projectType} (${projectMultiplier}x)`],
      ["Estimate Confidence:", String(pricingInfo?.confidence ?? "MEDIUM")],
      [""],
      ["COST BREAKDOWN", "", `Amount (${currencyCode})`, "% of Hard Cost"],
      ["Material Costs", "", Math.round(boqData?.subtotalMaterial ?? 0), hardTotal > 0 ? `${(((boqData?.subtotalMaterial ?? 0) / hardTotal) * 100).toFixed(1)}%` : "—"],
      ["Labour Costs", "", Math.round(boqData?.subtotalLabor ?? 0), hardTotal > 0 ? `${(((boqData?.subtotalLabor ?? 0) / hardTotal) * 100).toFixed(1)}%` : "—"],
      ["Equipment Costs", "", Math.round(boqData?.subtotalEquipment ?? 0), hardTotal > 0 ? `${(((boqData?.subtotalEquipment ?? 0) / hardTotal) * 100).toFixed(1)}%` : "—"],
      ["HARD COST SUBTOTAL", "", Math.round(hardTotal), "100%"],
      [""],
      ["GST on Materials (est. 18%)", "", Math.round(totalGST > 0 ? totalGST : estimatedGST), ""],
      ["HARD COSTS + GST", "", Math.round(hardTotalInclGST), ""],
      [""],
      ["SOFT COSTS & OVERHEADS"],
      ["Contractor Overhead (15%)", "", overheadAmt, "Editable in Control Panel"],
      ["Contingency (10%)", "", contingencyAmt, "Editable in Control Panel"],
      ["Architectural Fees (8%)", "", Math.round(hardTotal * 0.08), ""],
      ["Structural + MEP Engineering (5.5%)", "", Math.round(hardTotal * 0.055), ""],
      ["Permits & Inspections (2%)", "", Math.round(hardTotal * 0.02), ""],
      ["Insurance & Bonding (2.5%)", "", Math.round(hardTotal * 0.025), ""],
      ["Labour Cess (1%)", "", Math.round(hardTotal * 0.01), ""],
      [""],
      ["TOTAL SOFT COSTS", "", Math.round(softCostTotal), ""],
      [""],
      ["TOTAL PROJECT COST (excl GST)", "", Math.round(totalExclGST), ""],
      ["TOTAL PROJECT COST (incl GST)", "", Math.round(totalExclGST + (totalGST > 0 ? totalGST : estimatedGST)), ""],
      [""],
      ["COST PER m² GFA", "", `${currencySymbol}${costPerSqm.toLocaleString()}`, "excl GST"],
      ["COST PER m² (incl GST)", "", `${currencySymbol}${costPerSqmInclGST.toLocaleString()}`, "incl GST"],
      [""],
      (() => {
        if (!isINR) return [""];
        // City-tier-aware benchmark ranges for Summary sheet
        const tier = String(pricingInfo?.cityTier ?? upstreamBenchmark?.cityTier ?? "tier-2");
        const bt = projectType.toLowerCase();
        const tierRanges: Record<string, Record<string, [number, number]>> = {
          metro:    { commercial: [45000, 90000], residential: [28000, 55000], wellness: [55000, 110000], healthcare: [55000, 100000], hospitality: [55000, 110000] },
          "tier-1": { commercial: [35000, 70000], residential: [22000, 42000], wellness: [45000, 85000], healthcare: [45000, 85000], hospitality: [45000, 85000] },
          "tier-2": { commercial: [26000, 52000], residential: [18000, 36000], wellness: [35000, 65000], healthcare: [35000, 65000], hospitality: [35000, 65000] },
          "tier-3": { commercial: [18000, 38000], residential: [14000, 28000], wellness: [25000, 50000], healthcare: [25000, 50000], hospitality: [25000, 50000] },
          city:     { commercial: [26000, 52000], residential: [18000, 36000], wellness: [35000, 65000], healthcare: [35000, 65000], hospitality: [35000, 65000] },
        };
        const range = tierRanges[tier]?.[bt] ?? tierRanges[tier]?.commercial ?? tierRanges["tier-2"].commercial;
        // Use upstream benchmark if available (more accurate), else use tier-based range
        const low = upstreamBenchmark ? Number(upstreamBenchmark.rangeLow ?? range[0]) : range[0];
        const high = upstreamBenchmark ? Number(upstreamBenchmark.rangeHigh ?? range[1]) : range[1];
        const status = upstreamBenchmark ? String(upstreamBenchmark.status ?? "within range") : "benchmark";
        return ["BENCHMARK", "", `₹${low.toLocaleString()} - ₹${high.toLocaleString()} /m²`, `${projectType} in ${tier} city — ${status}`];
      })(),
      [""],
      ["DISCLAIMER"],
      [boqData?.disclaimer ?? String(inputData?._disclaimer ?? COST_DISCLAIMERS.full)],
    ];
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
    summarySheet["!cols"] = [{ wch: 34 }, { wch: 5 }, { wch: 22 }, { wch: 28 }];
    XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");

  } else {
    // Fallback for empty BOQ
    const fallbackRows = (inputData?.rows ?? []) as unknown[][];
    const fallbackHeaders = (inputData?.headers ?? ["Description", "Unit", "Qty", "Rate", "Total"]) as string[];
    const fallbackSheet = XLSX.utils.aoa_to_sheet([fallbackHeaders, ...fallbackRows]);
    XLSX.utils.book_append_sheet(wb, fallbackSheet, "Bill of Quantities");
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SHEET 5: ASSUMPTIONS LOG — Audit trail
  // ═══════════════════════════════════════════════════════════════════════
  // Phase 3: Read pricing metadata for transparency
  const pricingMd = (inputData as Record<string, unknown>)?._pricingMetadata as Record<string, unknown> | undefined;
  const pricingSourceLabel = pricingMd?.source === "market_intelligence" ? "Live Market Intelligence (AI web search)"
    : pricingMd?.source === "mixed" ? "Mixed — partial market intelligence + CPWD static rates"
    : `CPWD DSR ${pricingMd?.staticRateVersion ?? "2025-26"} static rates`;

  // Phase 3: Read model quality report
  const mqReport = (inputData as Record<string, unknown>)?._modelQualityReport as Record<string, unknown> | undefined;

  const assumptionRows = [
    ["ASSUMPTIONS & BASIS OF ESTIMATE"],
    [""],
    ["PRICING SOURCE"],
    ["", pricingSourceLabel, "", ""],
    ["", isINR ? `Rate basis: ${String(pricingMd?.staticRateVersion ?? "CPWD DSR 2025-26")}` : "RSMeans 2024/2025", "", ""],
    ["", isINR ? "IS 1200 Method of Measurement" : "CSI MasterFormat", "", ""],
    ...(pricingMd?.staleDateWarning ? [["", `⚠ ${pricingMd.staleDateWarning}`, "", ""]] as (string | number)[][] : []),
    ...(pricingMd?.lastMarketUpdate ? [["", `Last market update: ${pricingMd.lastMarketUpdate}`, "", ""]] as (string | number)[][] : []),
    ...(pricingInfo ? [["", `State PWD: ${pricingInfo.statePWD}`, "", ""], ["", `City: ${pricingInfo.cityTier}`, "", ""], ["", `Season: ${pricingInfo.seasonalNotes}`, "", ""]] as (string | number)[][] : []),
    [""],
    ["WASTE FACTORS APPLIED (Element-Specific, Phase 2 Upgrade)"],
    ["Element", "Waste %", "Notes", ""],
    ["Slab concrete", "4%", "Ground floor pumping loss", ""],
    ["Column concrete", "7%", "Formwork spillage, compaction loss", ""],
    ["Beam concrete", "5%", "Standard formwork loss", ""],
    ["Wall concrete", "6%", "Standard formwork loss", ""],
    ["Foundation concrete", "3%", "Open excavation, lower loss", ""],
    ["Rebar (TMT Fe500)", "4%", "Cutting waste, lap lengths", ""],
    ["Structural steel sections", "6%", "Fabrication waste", ""],
    ["Brick masonry 230mm", "6%", "Breakage, cutting, mortar waste", ""],
    ["AAC block", "4%", "Lightweight, less breakage", ""],
    ["Plaster (12mm/20mm)", "11%", "Mixing loss, surface waste", ""],
    ["Paint (emulsion/weathercoat)", "7%", "Application loss, touch-up", ""],
    ["Vitrified tile 600×600", "13%", "Cutting, pattern matching, breakage", ""],
    ["Marble flooring", "20%", "High breakage, irregular veining", ""],
    ["Granite flooring", "16%", "Hard material, cutting waste", ""],
    [""],
    ["GST RATES APPLIED (all BOQ items are works contracts)"],
    ["Steel & Iron works", "18%", "Works contract rate", ""],
    ["Concrete works (RCC, PCC)", "18%", "Works contract rate", ""],
    ["Masonry (bricks, blocks)", "12%", "Composite supply", ""],
    ["Finishes (tiles, paint, plaster)", "18%", "Works contract rate", ""],
    ["MEP works", "18%", "Works contract rate", ""],
    [""],
    ...(mqReport ? [
      ["IFC MODEL QUALITY REPORT"],
      ["Overall Grade", String(mqReport.overallGrade ?? "—"), "", ""],
      ["Total Elements", String(mqReport.totalElements ?? 0), "", ""],
      ...((mqReport.recommendations as string[] || []).map((r: string) => ["Recommendation", r, "", ""])),
      [""],
    ] as (string | number)[][] : []),
    ["EXCLUSIONS"],
    ["", "Land acquisition, financing, FF&E, specialty systems", "", ""],
    ["", "Off-site infrastructure, hazardous material abatement", "", ""],
    [""],
    ["ACCURACY"],
    ["", `AACE ${String(inputData?._aaceClass ?? "Class 4")} estimate: ${String(inputData?._aaceAccuracy ?? "±25-30%")} accuracy`
      + (!!(inputData?._hasStructuralFoundation) && !!(inputData?._hasMEPData) ? " (structural + MEP IFC provided)"
        : !!(inputData?._hasStructuralFoundation) ? " (structural IFC provided)"
        : !!(inputData?._hasMEPData) ? " (MEP IFC provided)"
        : " (architectural IFC only)"), "", ""],
    ["", "Valid for 90 days from date of preparation", "", ""],
    ["", "Engage a RICS/AACE certified QS for contract-grade pricing", "", ""],
    [""],
    ["DISCLAIMER"],
    ["", String((inputData as Record<string, unknown>)?._disclaimer ?? boqData?.disclaimer ?? COST_DISCLAIMERS.full), "", ""],
  ];
  const assumSheet = XLSX.utils.aoa_to_sheet(assumptionRows);
  assumSheet["!cols"] = [{ wch: 22 }, { wch: 40 }, { wch: 30 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, assumSheet, "Assumptions");

  // ═══════════════════════════════════════════════════════════════════════
  // SHEET 6: COVER PAGE
  // ═══════════════════════════════════════════════════════════════════════
  const coverRows = [
    [""],
    [""],
    ["BILL OF QUANTITIES"],
    ["PRELIMINARY COST ESTIMATE"],
    [""],
    [""],
    ["Project:", String(inputData?.label ?? "Building Project")],
    ["Location:", String(inputData?._region ?? "India")],
    ["Date:", dateStr],
    ["Prepared By:", "BuildFlow — trybuildflow.in"],
    [""],
    ["Estimate Class:", `AACE ${String(inputData?._aaceClass ?? "Class 4")} (${String(inputData?._aaceAccuracy ?? "±25-30%")})`],
    ["Confidence:", String(pricingInfo?.confidence ?? "MEDIUM")],
    isINR ? ["Rate Basis:", `IS 1200 / CPWD DSR 2023-24 + ${pricingInfo?.statePWD ?? "State"} PWD SOR + AI market intelligence`] : ["Rate Basis:", "CSI MasterFormat + regional factors"],
    [""],
    ["Total Cost:", `${currencySymbol}${Math.round(Number(inputData?._totalCost ?? 0) || (boqData?.grandTotal ?? 0)).toLocaleString()} ${currencyCode}`],
    ["Cost/m² GFA:", `${currencySymbol}${Math.round((Number(inputData?._totalCost ?? 0) || hardTotal) / Math.max(1, Number(inputData?._gfa ?? 100))).toLocaleString()}`],
    [""],
    [""],
    ["This estimate is for preliminary budgeting only."],
    ["Not suitable for contract bidding or procurement."],
    ["Engage a certified Quantity Surveyor for detailed estimate."],
  ];
  const coverSheet = XLSX.utils.aoa_to_sheet(coverRows);
  coverSheet["!cols"] = [{ wch: 20 }, { wch: 55 }];
  XLSX.utils.book_append_sheet(wb, coverSheet, "Cover Page");

  const xlsxBuffer = XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer;
  const base64 = xlsxBuffer.toString("base64");
  const dataUri = "data:application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;base64," + base64;
  const filename = `BuildFlow_BOQ_${dateStr}.xlsx`;

  // Upload to R2 (falls back to base64 data URI if R2 unavailable)
  const downloadUrl = await uploadBase64ToR2(
    dataUri,
    filename,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );

  return {
    id: generateId(),
    executionId: executionId ?? "local",
    tileInstanceId,
    type: "file",
    data: {
      name: filename,
      type: "XLSX Spreadsheet",
      size: xlsxBuffer.length,
      downloadUrl,
      label: "BOQ Export (Professional Excel)",
      content: `BOQ Export: ${boqLines.length} line items across 4 sheets. Grand Total: ${currencySymbol}${(boqData?.grandTotal ?? 0).toLocaleString()} ${currencyCode}. AACE ${String(inputData?._aaceClass ?? "Class 4")} (${String(inputData?._aaceAccuracy ?? "±25-30%")}).`,
    },
    metadata: { real: true },
    createdAt: new Date(),
  };
};
