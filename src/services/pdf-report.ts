import { jsPDF } from "jspdf";
import type { ExecutionArtifact } from "@/types/execution";
import type {
  TextArtifactData,
  ImageArtifactData,
  KpiArtifactData,
  TableArtifactData,
} from "@/types/execution";

// ─── Professional AEC Color Palette ──────────────────────────────────────────

const C = {
  // Primary brand
  primary: [0, 180, 216] as [number, number, number],      // Teal/Cyan
  primaryDark: [0, 120, 150] as [number, number, number],
  accent: [183, 115, 51] as [number, number, number],       // Copper AEC accent
  // Backgrounds
  dark: [15, 18, 25] as [number, number, number],
  headerBg: [20, 25, 35] as [number, number, number],
  sectionBg: [245, 247, 250] as [number, number, number],
  cardBg: [250, 251, 253] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
  // Text
  textDark: [30, 35, 45] as [number, number, number],
  textBody: [55, 60, 75] as [number, number, number],
  textMuted: [130, 135, 150] as [number, number, number],
  textLight: [200, 205, 215] as [number, number, number],
  // Status
  success: [16, 185, 129] as [number, number, number],
  warning: [245, 158, 11] as [number, number, number],
  error: [239, 68, 68] as [number, number, number],
  // Borders
  border: [225, 228, 235] as [number, number, number],
  borderLight: [238, 240, 245] as [number, number, number],
};

interface ReportInput {
  workflowName: string;
  artifacts: Map<string, ExecutionArtifact>;
  nodeLabels: Map<string, string>;
  executedAt?: Date;
}

// ─── Main PDF Generator ─────────────────────────────────────────────────────

export async function generatePDFReport({
  workflowName,
  artifacts,
  nodeLabels,
  executedAt,
}: ReportInput): Promise<void> {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pw = doc.internal.pageSize.getWidth();  // 210
  const ph = doc.internal.pageSize.getHeight(); // 297
  const margin = 18;
  const contentWidth = pw - margin * 2;
  let y = margin;
  const date = executedAt ?? new Date();
  const dateStr = date.toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
  });
  const timeStr = date.toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit",
  });

  // Collect artifacts
  const entries = Array.from(artifacts.entries());
  const textArtifacts = entries.filter(([, a]) => a.type === "text");
  const imageArtifacts = entries.filter(([, a]) => a.type === "image");
  const kpiArtifacts = entries.filter(([, a]) => a.type === "kpi");
  const tableArtifacts = entries.filter(([, a]) => a.type === "table");
  const jsonArtifacts = entries.filter(([, a]) => a.type === "json");
  const videoArtifacts = entries.filter(([, a]) => a.type === "video");
  const svgArtifacts = entries.filter(([, a]) => a.type === "svg");
  const fileArtifacts = entries.filter(([, a]) => a.type === "file");
  const threeDArtifacts = entries.filter(([, a]) => a.type === "3d");

  // Track pages for TOC
  const tocEntries: Array<{ title: string; page: number }> = [];
  let currentSection = "";

  // ─── Helper Functions ─────────────────────────────────────────────────

  function ensureSpace(needed: number) {
    if (y + needed > ph - 22) {
      doc.addPage();
      y = 25;
    }
  }

  function drawLine(x1: number, yPos: number, x2: number, color = C.border, width = 0.3) {
    doc.setDrawColor(...color);
    doc.setLineWidth(width);
    doc.line(x1, yPos, x2, yPos);
  }

  function pageNum() {
    return doc.getNumberOfPages();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE 1: COVER PAGE
  // ═══════════════════════════════════════════════════════════════════════

  // Full-page dark header band
  doc.setFillColor(...C.dark);
  doc.rect(0, 0, pw, 120, "F");

  // Accent stripe
  doc.setFillColor(...C.primary);
  doc.rect(0, 120, pw, 3, "F");

  // Brand mark - top left
  doc.setFontSize(9);
  doc.setTextColor(...C.textLight);
  doc.setFont("helvetica", "normal");
  doc.text("NEOBIM", margin, 18);

  // Thin rule under brand
  doc.setDrawColor(...C.primary);
  doc.setLineWidth(0.5);
  doc.line(margin, 21, margin + 18, 21);

  // Report type label
  doc.setFontSize(10);
  doc.setTextColor(...C.primary);
  doc.setFont("helvetica", "bold");
  doc.text("CONCEPT DESIGN REPORT", margin, 38);

  // Project name
  doc.setFontSize(26);
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  const titleLines = doc.splitTextToSize(workflowName, contentWidth);
  doc.text(titleLines.slice(0, 2), margin, 55);

  // Date & metadata row
  const metaY = 80;
  doc.setFontSize(9);
  doc.setTextColor(...C.textLight);
  doc.setFont("helvetica", "normal");
  doc.text(`${dateStr}  |  ${timeStr}`, margin, metaY);

  // Stats on right side of header
  const statsX = pw - margin;
  doc.setFontSize(28);
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.text(String(artifacts.size), statsX, 45, { align: "right" });
  doc.setFontSize(8);
  doc.setTextColor(...C.textLight);
  doc.setFont("helvetica", "normal");
  doc.text("DELIVERABLES", statsX, 50, { align: "right" });

  doc.setFontSize(28);
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.text(String(nodeLabels.size), statsX, 68, { align: "right" });
  doc.setFontSize(8);
  doc.setTextColor(...C.textLight);
  doc.setFont("helvetica", "normal");
  doc.text("NODES EXECUTED", statsX, 73, { align: "right" });

  // Quality stamp
  doc.setFontSize(8);
  doc.setTextColor(...C.textLight);
  doc.text("AEC-GRADE OUTPUT  |  CONCEPT-LEVEL", margin, metaY + 12);

  // ─── Below header: Executive Summary ──────────────────────────────────

  y = 133;

  // Section: Executive Summary
  doc.setFontSize(14);
  doc.setTextColor(...C.textDark);
  doc.setFont("helvetica", "bold");
  doc.text("Executive Summary", margin, y);
  y += 3;
  drawLine(margin, y, margin + 36, C.primary, 0.8);
  y += 8;

  // Summary description
  doc.setFontSize(9.5);
  doc.setTextColor(...C.textBody);
  doc.setFont("helvetica", "normal");
  const summaryText = `This report documents the outputs of the "${workflowName}" workflow executed on ${dateStr}. ` +
    `The pipeline comprised ${nodeLabels.size} processing nodes, generating ${artifacts.size} deliverables across ` +
    `${new Set(entries.map(([, a]) => a.type)).size} artifact categories. ` +
    `All outputs are concept-level and intended for early-stage design exploration.`;
  const summaryLines = doc.splitTextToSize(summaryText, contentWidth);
  doc.text(summaryLines, margin, y);
  y += summaryLines.length * 4.2 + 4;

  // ─── Artifact Breakdown Table ─────────────────────────────────────────

  const typeCounts: Record<string, number> = {};
  entries.forEach(([, a]) => { typeCounts[a.type] = (typeCounts[a.type] ?? 0) + 1; });

  const typeLabels: Record<string, string> = {
    text: "Documents", image: "Renders", video: "Video Walkthroughs",
    kpi: "KPI Dashboards", table: "Data Tables", json: "Structured Data",
    svg: "Floor Plans", "3d": "3D Models", file: "Export Files",
  };

  // Breakdown header
  doc.setFillColor(...C.sectionBg);
  doc.roundedRect(margin, y, contentWidth, 8, 1, 1, "F");
  doc.setFontSize(7.5);
  doc.setTextColor(...C.textMuted);
  doc.setFont("helvetica", "bold");
  doc.text("ARTIFACT TYPE", margin + 4, y + 5.5);
  doc.text("COUNT", margin + 80, y + 5.5);
  doc.text("STATUS", pw - margin - 4, y + 5.5, { align: "right" });
  y += 10;

  Object.entries(typeCounts).forEach(([type, count]) => {
    ensureSpace(7);
    doc.setFontSize(9);
    doc.setTextColor(...C.textBody);
    doc.setFont("helvetica", "normal");
    doc.text(typeLabels[type] ?? type, margin + 4, y + 4);

    doc.setFont("helvetica", "bold");
    doc.text(String(count), margin + 80, y + 4);

    // Status dot
    doc.setFillColor(...C.success);
    doc.circle(pw - margin - 6, y + 3, 1.5, "F");
    doc.setFontSize(8);
    doc.setTextColor(...C.success);
    doc.setFont("helvetica", "normal");
    doc.text("Complete", pw - margin - 10, y + 4, { align: "right" });

    drawLine(margin + 2, y + 7, pw - margin - 2, C.borderLight, 0.15);
    y += 8;
  });
  y += 6;

  // ─── Pipeline Overview ────────────────────────────────────────────────

  ensureSpace(35);
  doc.setFontSize(12);
  doc.setTextColor(...C.textDark);
  doc.setFont("helvetica", "bold");
  doc.text("Processing Pipeline", margin, y);
  y += 3;
  drawLine(margin, y, margin + 32, C.primary, 0.8);
  y += 7;

  // Pipeline steps as compact list
  let stepIdx = 0;
  for (const [tileId] of entries) {
    const label = nodeLabels.get(tileId) ?? "Node";
    const artifact = artifacts.get(tileId);
    ensureSpace(8);

    // Step number circle
    doc.setFillColor(...C.primary);
    doc.circle(margin + 4, y + 2, 3, "F");
    doc.setFontSize(7);
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.text(String(stepIdx + 1), margin + 4, y + 3, { align: "center" });

    // Step label
    doc.setFontSize(9);
    doc.setTextColor(...C.textDark);
    doc.setFont("helvetica", "bold");
    doc.text(label, margin + 12, y + 3);

    // Artifact type badge
    if (artifact) {
      const badgeText = artifact.type.toUpperCase();
      doc.setFontSize(6.5);
      doc.setTextColor(...C.primary);
      doc.setFont("helvetica", "normal");
      const tw = doc.getTextWidth(badgeText) + 4;
      const bx = pw - margin - tw - 2;
      doc.setFillColor(230, 245, 250);
      doc.roundedRect(bx, y - 0.5, tw + 2, 5.5, 1, 1, "F");
      doc.text(badgeText, bx + (tw + 2) / 2, y + 3, { align: "center" });
    }

    // Connector line
    if (stepIdx < entries.length - 1) {
      doc.setDrawColor(...C.borderLight);
      doc.setLineWidth(0.3);
      doc.line(margin + 4, y + 5, margin + 4, y + 8);
    }

    y += 9;
    stepIdx++;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TABLE OF CONTENTS (New page)
  // ═══════════════════════════════════════════════════════════════════════

  doc.addPage();
  y = 25;

  doc.setFontSize(16);
  doc.setTextColor(...C.textDark);
  doc.setFont("helvetica", "bold");
  doc.text("Table of Contents", margin, y);
  y += 3;
  drawLine(margin, y, margin + 32, C.primary, 0.8);
  y += 10;

  // Build TOC entries list (will be filled as we render)
  const tocStartPage = pageNum();
  const plannedSections: string[] = [];
  if (kpiArtifacts.length > 0) plannedSections.push("Key Performance Indicators");
  if (tableArtifacts.length > 0) plannedSections.push("Data Tables & Quantities");
  if (textArtifacts.length > 0) plannedSections.push("Documents & Reports");
  if (imageArtifacts.length > 0) plannedSections.push("Concept Renders");
  if (svgArtifacts.length > 0) plannedSections.push("Floor Plans");
  if (videoArtifacts.length > 0) plannedSections.push("Video Walkthroughs");
  if (threeDArtifacts.length > 0) plannedSections.push("3D Models");
  if (jsonArtifacts.length > 0) plannedSections.push("Structured Data");
  if (fileArtifacts.length > 0) plannedSections.push("Export Files");
  plannedSections.push("Disclaimer & Notes");

  // Placeholder TOC (we'll fill page numbers after render)
  const tocY = y;
  plannedSections.forEach((section, i) => {
    doc.setFontSize(10);
    doc.setTextColor(...C.textBody);
    doc.setFont("helvetica", "normal");
    doc.text(`${i + 1}.  ${section}`, margin + 2, y);
    // Dots leader
    doc.setTextColor(...C.textMuted);
    doc.setFontSize(8);
    doc.text("· · · · · · · · · · · · · · · · · · · · · · · ·", margin + 75, y);
    y += 7;
  });
  y += 8;

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION: KPI DASHBOARD
  // ═══════════════════════════════════════════════════════════════════════

  if (kpiArtifacts.length > 0) {
    doc.addPage();
    y = 25;
    currentSection = "Key Performance Indicators";
    tocEntries.push({ title: currentSection, page: pageNum() });

    renderSectionHeader(doc, "Key Performance Indicators", "1", margin, y, contentWidth);
    y += 16;

    for (const [tileId, artifact] of kpiArtifacts) {
      const label = nodeLabels.get(tileId) ?? "KPI Dashboard";
      const data = artifact.data as KpiArtifactData;
      const metrics = data?.metrics ?? [];

      if (metrics.length === 0) continue;

      ensureSpace(20);

      // Sub-header
      doc.setFontSize(10);
      doc.setTextColor(...C.textDark);
      doc.setFont("helvetica", "bold");
      doc.text(label, margin, y);
      y += 6;

      // KPI cards in grid (3 per row)
      const cols = 3;
      const cardW = (contentWidth - (cols - 1) * 4) / cols;
      const cardH = 22;

      for (let i = 0; i < metrics.length; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);

        if (col === 0 && row > 0) {
          y += cardH + 4;
          ensureSpace(cardH + 4);
        }

        const cx = margin + col * (cardW + 4);
        const cy = y;

        // Card background
        doc.setFillColor(...C.sectionBg);
        doc.roundedRect(cx, cy, cardW, cardH, 2, 2, "F");

        // Top accent line
        doc.setFillColor(...C.primary);
        doc.rect(cx + 3, cy, cardW - 6, 0.8, "F");

        // Value
        const m = metrics[i];
        doc.setFontSize(16);
        doc.setTextColor(...C.textDark);
        doc.setFont("helvetica", "bold");
        const valStr = String(m.value);
        doc.text(valStr, cx + 5, cy + 11);

        // Unit
        if (m.unit) {
          const valW = doc.getTextWidth(valStr);
          doc.setFontSize(8);
          doc.setTextColor(...C.textMuted);
          doc.setFont("helvetica", "normal");
          doc.text(m.unit, cx + 5 + valW + 1, cy + 11);
        }

        // Trend arrow
        if (m.trend) {
          const arrow = m.trend === "up" ? "▲" : m.trend === "down" ? "▼" : "—";
          const trendColor = m.trend === "up" ? C.success : m.trend === "down" ? C.error : C.textMuted;
          doc.setFontSize(7);
          doc.setTextColor(...trendColor);
          doc.text(arrow, cx + cardW - 8, cy + 10);
        }

        // Label
        doc.setFontSize(7);
        doc.setTextColor(...C.textMuted);
        doc.setFont("helvetica", "normal");
        const labelText = m.label.length > 28 ? m.label.substring(0, 26) + "…" : m.label;
        doc.text(labelText, cx + 5, cy + 17);
      }

      const totalRows = Math.ceil(metrics.length / cols);
      y += totalRows * (cardH + 4) + 6;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION: DATA TABLES
  // ═══════════════════════════════════════════════════════════════════════

  if (tableArtifacts.length > 0) {
    doc.addPage();
    y = 25;
    currentSection = "Data Tables & Quantities";
    tocEntries.push({ title: currentSection, page: pageNum() });

    renderSectionHeader(doc, "Data Tables & Quantities", "2", margin, y, contentWidth);
    y += 16;

    for (const [tileId, artifact] of tableArtifacts) {
      const label = nodeLabels.get(tileId) ?? "Data Table";
      const data = artifact.data as TableArtifactData;
      const headers = data?.headers ?? [];
      const rows = data?.rows ?? [];
      if (headers.length === 0) continue;

      ensureSpace(30);

      // Table title
      doc.setFontSize(10);
      doc.setTextColor(...C.textDark);
      doc.setFont("helvetica", "bold");
      doc.text(label, margin, y);
      doc.setFontSize(8);
      doc.setTextColor(...C.textMuted);
      doc.setFont("helvetica", "normal");
      doc.text(`${rows.length} rows × ${headers.length} columns`, pw - margin, y, { align: "right" });
      y += 6;

      // Smart column width calculation
      const isWide = headers.length > 7;
      const displayHeaders = isWide
        ? [headers[0], ...headers.slice(1, 5), headers[headers.length - 1]]
        : headers;
      const displayRows = isWide
        ? rows.map(row => [row[0], ...row.slice(1, 5), row[row.length - 1]])
        : rows;

      const colCount = displayHeaders.length;
      const colWidths = calculateColumnWidths(displayHeaders, displayRows.slice(0, 5), contentWidth);

      // Table header row
      doc.setFillColor(...C.primary);
      doc.rect(margin, y, contentWidth, 7, "F");
      doc.setFontSize(7);
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");

      let xPos = margin;
      displayHeaders.forEach((h, i) => {
        doc.text(String(h).substring(0, 22), xPos + 2, y + 5);
        xPos += colWidths[i];
      });
      y += 7;

      // Table body rows (limit to 40 for PDF)
      const maxRows = Math.min(displayRows.length, 40);
      doc.setFont("helvetica", "normal");

      for (let r = 0; r < maxRows; r++) {
        ensureSpace(6);

        // Alternating row background
        if (r % 2 === 0) {
          doc.setFillColor(248, 250, 252);
          doc.rect(margin, y, contentWidth, 5.5, "F");
        }

        doc.setFontSize(7);
        doc.setTextColor(...C.textBody);

        xPos = margin;
        const row = displayRows[r];
        for (let ci = 0; ci < colCount; ci++) {
          const cellVal = String(row[ci] ?? "").substring(0, 24);
          doc.text(cellVal, xPos + 2, y + 4);
          xPos += colWidths[ci];
        }
        y += 5.5;
      }

      // Grand total row
      if (rows.length > 0) {
        const lastColIdx = headers.length - 1;
        const lastColValues = rows.map(r => {
          const val = r[lastColIdx];
          return typeof val === "number" ? val : parseFloat(String(val).replace(/[,$]/g, ""));
        });
        if (lastColValues.every(v => !isNaN(v))) {
          const grandTotal = lastColValues.reduce((a, b) => a + b, 0);
          ensureSpace(8);
          doc.setFillColor(230, 245, 250);
          doc.rect(margin, y, contentWidth, 7, "F");
          doc.setFontSize(8);
          doc.setTextColor(...C.textDark);
          doc.setFont("helvetica", "bold");
          doc.text("TOTAL", margin + 2, y + 5);
          doc.text(
            grandTotal.toLocaleString(undefined, { maximumFractionDigits: 2 }),
            pw - margin - 2, y + 5, { align: "right" }
          );
          y += 7;
        }
      }

      // Truncation notice
      if (displayRows.length > maxRows) {
        doc.setFontSize(7);
        doc.setTextColor(...C.textMuted);
        doc.setFont("helvetica", "italic");
        doc.text(`Showing ${maxRows} of ${rows.length} rows. See application for complete data.`, margin, y + 4);
        y += 7;
      }

      y += 10;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION: DOCUMENTS & REPORTS
  // ═══════════════════════════════════════════════════════════════════════

  if (textArtifacts.length > 0) {
    doc.addPage();
    y = 25;
    currentSection = "Documents & Reports";
    tocEntries.push({ title: currentSection, page: pageNum() });

    const sectionNum = tocEntries.length;
    renderSectionHeader(doc, "Documents & Reports", String(sectionNum), margin, y, contentWidth);
    y += 16;

    for (const [tileId, artifact] of textArtifacts) {
      const label = nodeLabels.get(tileId) ?? "Document";
      const data = artifact.data as TextArtifactData;
      const content = data?.content ?? "";

      ensureSpace(20);

      // Document header card
      doc.setFillColor(...C.sectionBg);
      doc.roundedRect(margin, y, contentWidth, 8, 1, 1, "F");
      doc.setFontSize(9);
      doc.setTextColor(...C.textDark);
      doc.setFont("helvetica", "bold");
      doc.text(label, margin + 4, y + 5.5);
      doc.setFontSize(7);
      doc.setTextColor(...C.textMuted);
      doc.setFont("helvetica", "normal");
      const wordCount = content.split(/\s+/).length;
      doc.text(`${wordCount} words`, pw - margin - 4, y + 5.5, { align: "right" });
      y += 12;

      // Content with proper word wrapping
      doc.setFontSize(9);
      doc.setTextColor(...C.textBody);
      doc.setFont("helvetica", "normal");

      const lines = doc.splitTextToSize(content, contentWidth - 4);
      const maxLines = 80;
      const displayLines = lines.slice(0, maxLines);

      for (let li = 0; li < displayLines.length; li++) {
        ensureSpace(5);
        doc.text(displayLines[li], margin + 2, y);
        y += 4;
      }

      if (lines.length > maxLines) {
        doc.setFontSize(8);
        doc.setTextColor(...C.textMuted);
        doc.setFont("helvetica", "italic");
        doc.text(`[…${lines.length - maxLines} additional lines — see application for full text]`, margin + 2, y);
        y += 5;
      }

      y += 8;
      drawLine(margin, y, pw - margin, C.borderLight, 0.2);
      y += 8;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION: CONCEPT RENDERS
  // ═══════════════════════════════════════════════════════════════════════

  if (imageArtifacts.length > 0) {
    doc.addPage();
    y = 25;
    currentSection = "Concept Renders";
    tocEntries.push({ title: currentSection, page: pageNum() });

    const sectionNum = tocEntries.length;
    renderSectionHeader(doc, "Concept Renders", String(sectionNum), margin, y, contentWidth);
    y += 16;

    for (let imgIdx = 0; imgIdx < imageArtifacts.length; imgIdx++) {
      const [tileId, artifact] = imageArtifacts[imgIdx];
      const label = nodeLabels.get(tileId) ?? `Render ${imgIdx + 1}`;
      const data = artifact.data as ImageArtifactData;

      if (!data?.url) continue;

      ensureSpace(100);

      try {
        const imgWidth = Math.min(contentWidth, 160);
        const imgHeight = imgWidth * 0.6;

        if (y + imgHeight + 15 > ph - 22) {
          doc.addPage();
          y = 25;
        }

        // Image label
        doc.setFontSize(10);
        doc.setTextColor(...C.textDark);
        doc.setFont("helvetica", "bold");
        doc.text(label, margin, y);
        y += 6;

        // Image with border
        doc.setDrawColor(...C.border);
        doc.setLineWidth(0.3);
        doc.rect(margin, y, imgWidth, imgHeight);
        doc.addImage(data.url, "JPEG", margin + 0.5, y + 0.5, imgWidth - 1, imgHeight - 1);
        y += imgHeight + 3;

        // Caption
        if (data.label || data.style) {
          doc.setFontSize(8);
          doc.setTextColor(...C.textMuted);
          doc.setFont("helvetica", "italic");
          const caption = [data.label, data.style ? `Style: ${data.style}` : null]
            .filter(Boolean).join(" — ");
          doc.text(caption, margin, y);
          y += 5;
        }

        // Image metadata
        doc.setFontSize(7);
        doc.setTextColor(...C.textMuted);
        doc.setFont("helvetica", "normal");
        const meta = [
          data.width && data.height ? `${data.width}×${data.height}px` : null,
          `Render ${imgIdx + 1} of ${imageArtifacts.length}`,
        ].filter(Boolean).join("  |  ");
        doc.text(meta, margin, y);
        y += 10;
      } catch {
        doc.setFontSize(9);
        doc.setTextColor(...C.textMuted);
        doc.text(`[Image "${label}" could not be embedded — see application]`, margin, y);
        y += 8;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION: FLOOR PLANS
  // ═══════════════════════════════════════════════════════════════════════

  if (svgArtifacts.length > 0) {
    doc.addPage();
    y = 25;
    currentSection = "Floor Plans";
    tocEntries.push({ title: currentSection, page: pageNum() });

    const sectionNum = tocEntries.length;
    renderSectionHeader(doc, "Floor Plans", String(sectionNum), margin, y, contentWidth);
    y += 16;

    for (const [tileId] of svgArtifacts) {
      const label = nodeLabels.get(tileId) ?? "Floor Plan";
      doc.setFontSize(10);
      doc.setTextColor(...C.textDark);
      doc.setFont("helvetica", "bold");
      doc.text(label, margin, y);
      y += 6;

      doc.setFontSize(9);
      doc.setTextColor(...C.textMuted);
      doc.setFont("helvetica", "italic");
      doc.text("[SVG floor plan — view in application for interactive vector display]", margin, y);
      y += 4;
      doc.text("[Download available in Export tab as SVG file]", margin, y);
      y += 10;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION: VIDEO WALKTHROUGHS
  // ═══════════════════════════════════════════════════════════════════════

  if (videoArtifacts.length > 0) {
    doc.addPage();
    y = 25;
    currentSection = "Video Walkthroughs";
    tocEntries.push({ title: currentSection, page: pageNum() });

    const sectionNum = tocEntries.length;
    renderSectionHeader(doc, "Video Walkthroughs", String(sectionNum), margin, y, contentWidth);
    y += 16;

    for (const [tileId, artifact] of videoArtifacts) {
      const label = nodeLabels.get(tileId) ?? "Video Walkthrough";
      const data = artifact.data as Record<string, unknown>;

      ensureSpace(35);

      // Video info card
      doc.setFillColor(...C.sectionBg);
      doc.roundedRect(margin, y, contentWidth, 28, 2, 2, "F");

      // Play icon placeholder
      doc.setFillColor(...C.primary);
      doc.roundedRect(margin + 5, y + 5, 40, 18, 2, 2, "F");
      doc.setFontSize(14);
      doc.setTextColor(255, 255, 255);
      doc.text("▶", margin + 22, y + 17, { align: "center" });

      // Video metadata
      doc.setFontSize(11);
      doc.setTextColor(...C.textDark);
      doc.setFont("helvetica", "bold");
      doc.text(label, margin + 52, y + 10);

      doc.setFontSize(8);
      doc.setTextColor(...C.textMuted);
      doc.setFont("helvetica", "normal");
      const vidMeta = [
        `Duration: ${data.durationSeconds ?? 15}s`,
        `Shots: ${data.shotCount ?? 3}`,
        data.pipeline ? `Pipeline: ${data.pipeline}` : null,
        data.costUsd != null ? `Cost: $${Number(data.costUsd).toFixed(2)}` : null,
      ].filter(Boolean).join("  |  ");
      doc.text(vidMeta, margin + 52, y + 16);

      doc.setFontSize(7);
      doc.setTextColor(...C.primary);
      doc.text("[Download video from application Export tab]", margin + 52, y + 22);

      y += 35;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION: 3D MODELS
  // ═══════════════════════════════════════════════════════════════════════

  if (threeDArtifacts.length > 0) {
    doc.addPage();
    y = 25;
    currentSection = "3D Models";
    tocEntries.push({ title: currentSection, page: pageNum() });

    const sectionNum = tocEntries.length;
    renderSectionHeader(doc, "3D Models", String(sectionNum), margin, y, contentWidth);
    y += 16;

    for (const [tileId, artifact] of threeDArtifacts) {
      const label = nodeLabels.get(tileId) ?? "3D Model";
      const data = artifact.data as Record<string, unknown>;

      ensureSpace(40);

      doc.setFontSize(10);
      doc.setTextColor(...C.textDark);
      doc.setFont("helvetica", "bold");
      doc.text(label, margin, y);
      y += 7;

      // Model specs
      const specs: string[][] = [];
      if (data.buildingType) specs.push(["Building Type", String(data.buildingType)]);
      if (data.floors) specs.push(["Floors", String(data.floors)]);
      if (data.height) specs.push(["Height", `${data.height}m`]);
      if (data.footprint) specs.push(["Footprint", `${data.footprint} m²`]);
      if (data.gfa) specs.push(["GFA", `${Number(data.gfa).toLocaleString()} m²`]);
      if (data.glbUrl) specs.push(["Format", "GLB / glTF Binary"]);
      if (data.polycount) specs.push(["Polycount", Number(data.polycount).toLocaleString()]);

      if (specs.length > 0) {
        // Specs table
        const specColW = contentWidth / 2;
        for (let i = 0; i < specs.length; i += 2) {
          ensureSpace(7);
          if (i % 2 === 0) {
            doc.setFillColor(i % 4 === 0 ? 248 : 255, i % 4 === 0 ? 250 : 255, i % 4 === 0 ? 252 : 255);
            doc.rect(margin, y - 1, contentWidth, 6, "F");
          }

          doc.setFontSize(8);
          doc.setTextColor(...C.textMuted);
          doc.setFont("helvetica", "normal");
          doc.text(specs[i][0], margin + 3, y + 3);
          doc.setTextColor(...C.textDark);
          doc.setFont("helvetica", "bold");
          doc.text(specs[i][1], margin + 50, y + 3);

          if (specs[i + 1]) {
            doc.setTextColor(...C.textMuted);
            doc.setFont("helvetica", "normal");
            doc.text(specs[i + 1][0], margin + specColW + 3, y + 3);
            doc.setTextColor(...C.textDark);
            doc.setFont("helvetica", "bold");
            doc.text(specs[i + 1][1], margin + specColW + 50, y + 3);
          }

          y += 7;
        }
      }

      doc.setFontSize(8);
      doc.setTextColor(...C.primary);
      doc.setFont("helvetica", "italic");
      doc.text("[View interactive 3D model in application]", margin, y + 3);
      y += 12;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION: STRUCTURED DATA (JSON)
  // ═══════════════════════════════════════════════════════════════════════

  if (jsonArtifacts.length > 0) {
    doc.addPage();
    y = 25;
    currentSection = "Structured Data";
    tocEntries.push({ title: currentSection, page: pageNum() });

    const sectionNum = tocEntries.length;
    renderSectionHeader(doc, "Structured Data", String(sectionNum), margin, y, contentWidth);
    y += 16;

    for (const [tileId, artifact] of jsonArtifacts) {
      const label = nodeLabels.get(tileId) ?? "Structured Data";

      ensureSpace(20);

      doc.setFontSize(10);
      doc.setTextColor(...C.textDark);
      doc.setFont("helvetica", "bold");
      doc.text(label, margin, y);
      y += 7;

      // Render JSON as formatted code block
      const jsonStr = JSON.stringify(
        (artifact.data as { json?: unknown })?.json ?? artifact.data,
        null, 2
      );

      // Code block background
      const codeLines = doc.splitTextToSize(jsonStr, contentWidth - 8);
      const maxCodeLines = 50;
      const displayCodeLines = codeLines.slice(0, maxCodeLines);
      const blockHeight = Math.min(displayCodeLines.length * 3.2 + 6, 180);

      ensureSpace(blockHeight + 5);

      doc.setFillColor(245, 245, 250);
      doc.roundedRect(margin, y, contentWidth, blockHeight, 2, 2, "F");
      doc.setDrawColor(...C.border);
      doc.setLineWidth(0.2);
      doc.roundedRect(margin, y, contentWidth, blockHeight, 2, 2, "S");

      doc.setFontSize(6.5);
      doc.setTextColor(80, 80, 110);
      doc.setFont("courier", "normal");

      let codeY = y + 4;
      for (const line of displayCodeLines) {
        if (codeY > y + blockHeight - 2) break;
        doc.text(line, margin + 4, codeY);
        codeY += 3.2;
      }

      y += blockHeight + 2;

      if (codeLines.length > maxCodeLines) {
        doc.setFontSize(7);
        doc.setTextColor(...C.textMuted);
        doc.setFont("helvetica", "italic");
        doc.text(`[…${codeLines.length - maxCodeLines} more lines — export as JSON from application]`, margin, y + 3);
        y += 7;
      }

      y += 8;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SECTION: EXPORT FILES
  // ═══════════════════════════════════════════════════════════════════════

  if (fileArtifacts.length > 0) {
    doc.addPage();
    y = 25;
    currentSection = "Export Files";
    tocEntries.push({ title: currentSection, page: pageNum() });

    const sectionNum = tocEntries.length;
    renderSectionHeader(doc, "Export Files", String(sectionNum), margin, y, contentWidth);
    y += 16;

    for (const [tileId, artifact] of fileArtifacts) {
      const label = nodeLabels.get(tileId) ?? "File";
      const data = artifact.data as Record<string, unknown>;

      ensureSpace(12);

      doc.setFillColor(...C.sectionBg);
      doc.roundedRect(margin, y, contentWidth, 10, 1, 1, "F");

      doc.setFontSize(9);
      doc.setTextColor(...C.textDark);
      doc.setFont("helvetica", "bold");
      doc.text(label, margin + 4, y + 6.5);

      if (data.type || data.size) {
        doc.setFontSize(7);
        doc.setTextColor(...C.textMuted);
        doc.setFont("helvetica", "normal");
        const meta = [
          data.type ? String(data.type) : null,
          data.size ? formatBytes(Number(data.size)) : null,
        ].filter(Boolean).join(" · ");
        doc.text(meta, pw - margin - 4, y + 6.5, { align: "right" });
      }

      y += 14;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // FINAL PAGE: DISCLAIMER & NOTES
  // ═══════════════════════════════════════════════════════════════════════

  doc.addPage();
  y = 25;
  tocEntries.push({ title: "Disclaimer & Notes", page: pageNum() });

  renderSectionHeader(doc, "Disclaimer & Notes", String(tocEntries.length), margin, y, contentWidth);
  y += 16;

  // Disclaimer box
  doc.setFillColor(255, 250, 240);
  doc.roundedRect(margin, y, contentWidth, 42, 2, 2, "F");
  doc.setDrawColor(245, 180, 80);
  doc.setLineWidth(0.4);
  doc.roundedRect(margin, y, contentWidth, 42, 2, 2, "S");

  // Warning accent
  doc.setFillColor(245, 180, 80);
  doc.rect(margin, y, 3, 42, "F");

  doc.setFontSize(9);
  doc.setTextColor(140, 100, 20);
  doc.setFont("helvetica", "bold");
  doc.text("IMPORTANT NOTICE", margin + 8, y + 8);

  doc.setFontSize(8.5);
  doc.setTextColor(100, 75, 15);
  doc.setFont("helvetica", "normal");
  const disclaimerText = "This report presents concept-level outputs generated by NeoBIM AI-assisted workflow engine. " +
    "All quantities, cost estimates, dimensions, specifications, and design proposals contained herein are preliminary " +
    "and intended solely for early-stage design exploration and feasibility assessment.\n\n" +
    "These outputs should NOT be used for construction documentation, regulatory submissions, contractual purposes, " +
    "or any application requiring certified professional review. All data must be independently verified by qualified " +
    "AEC professionals (architects, engineers, quantity surveyors) before use in any binding or construction context.";
  const disclLines = doc.splitTextToSize(disclaimerText, contentWidth - 14);
  doc.text(disclLines, margin + 8, y + 14);
  y += 50;

  // Report metadata
  doc.setFontSize(10);
  doc.setTextColor(...C.textDark);
  doc.setFont("helvetica", "bold");
  doc.text("Report Metadata", margin, y);
  y += 7;

  const metaItems = [
    ["Project", workflowName],
    ["Generated", `${dateStr} at ${timeStr}`],
    ["Engine", "NeoBIM Workflow Engine v2.0"],
    ["Total Deliverables", String(artifacts.size)],
    ["Processing Nodes", String(nodeLabels.size)],
    ["Artifact Types", Object.keys(typeCounts).map(t => typeLabels[t] ?? t).join(", ")],
    ["Report Format", "PDF/A-compatible, A4 Portrait"],
    ["Classification", "CONCEPT-LEVEL — Not for Construction"],
  ];

  metaItems.forEach(([key, val], i) => {
    ensureSpace(7);
    if (i % 2 === 0) {
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, y - 1, contentWidth, 6.5, "F");
    }
    doc.setFontSize(8);
    doc.setTextColor(...C.textMuted);
    doc.setFont("helvetica", "normal");
    doc.text(key, margin + 3, y + 3.5);
    doc.setTextColor(...C.textDark);
    doc.setFont("helvetica", "bold");
    const valLines = doc.splitTextToSize(val, contentWidth - 60);
    doc.text(valLines[0], margin + 55, y + 3.5);
    y += 6.5;
  });

  // ═══════════════════════════════════════════════════════════════════════
  // UPDATE TOC PAGE NUMBERS
  // ═══════════════════════════════════════════════════════════════════════

  doc.setPage(tocStartPage);
  let tocUpdateY = tocY;
  plannedSections.forEach((section) => {
    const entry = tocEntries.find(e => e.title === section);
    if (entry) {
      doc.setFontSize(9);
      doc.setTextColor(...C.textDark);
      doc.setFont("helvetica", "bold");
      doc.text(String(entry.page), pw - margin, tocUpdateY, { align: "right" });
    }
    tocUpdateY += 7;
  });

  // ═══════════════════════════════════════════════════════════════════════
  // PAGE HEADERS & FOOTERS (all pages)
  // ═══════════════════════════════════════════════════════════════════════

  const totalPages = doc.getNumberOfPages();
  for (let i = 2; i <= totalPages; i++) {
    doc.setPage(i);

    // Top rule
    doc.setDrawColor(...C.borderLight);
    doc.setLineWidth(0.3);
    doc.line(margin, 18, pw - margin, 18);

    // Header left: project name
    doc.setFontSize(7);
    doc.setTextColor(...C.textMuted);
    doc.setFont("helvetica", "normal");
    doc.text(workflowName.substring(0, 50), margin, 15);

    // Header right: NEOBIM
    doc.setTextColor(...C.primary);
    doc.setFont("helvetica", "bold");
    doc.text("NEOBIM", pw - margin, 15, { align: "right" });

    // Footer
    doc.setDrawColor(...C.borderLight);
    doc.line(margin, ph - 15, pw - margin, ph - 15);

    doc.setFontSize(7);
    doc.setTextColor(...C.textMuted);
    doc.setFont("helvetica", "normal");
    doc.text(`Page ${i} of ${totalPages}`, pw / 2, ph - 10, { align: "center" });
    doc.text("CONCEPT-LEVEL — Not for Construction", margin, ph - 10);
    doc.text(dateStr, pw - margin, ph - 10, { align: "right" });
  }

  // ─── Save ──────────────────────────────────────────────────────────────
  const safeName = workflowName.replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 40);
  const filename = `NeoBIM_Report_${safeName}_${new Date().toISOString().split("T")[0]}.pdf`;
  doc.save(filename);
}

// ─── Render Helpers ─────────────────────────────────────────────────────────

function renderSectionHeader(
  doc: jsPDF,
  title: string,
  num: string,
  x: number,
  y: number,
  width: number
) {
  // Section number badge
  doc.setFillColor(...C.primary);
  doc.roundedRect(x, y, 8, 8, 1.5, 1.5, "F");
  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.text(num, x + 4, y + 5.8, { align: "center" });

  // Title
  doc.setFontSize(16);
  doc.setTextColor(...C.textDark);
  doc.setFont("helvetica", "bold");
  doc.text(title, x + 12, y + 6);

  // Underline
  doc.setDrawColor(...C.primary);
  doc.setLineWidth(0.8);
  doc.line(x, y + 10, x + 40, y + 10);

  // Light full-width rule
  doc.setDrawColor(...C.borderLight);
  doc.setLineWidth(0.2);
  doc.line(x + 42, y + 10, x + width, y + 10);
}

function calculateColumnWidths(
  headers: string[],
  sampleRows: (string | number)[][],
  totalWidth: number
): number[] {
  const colCount = headers.length;
  const minCol = totalWidth / colCount;
  // Simple equal distribution for now
  return Array(colCount).fill(minCol);
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}
