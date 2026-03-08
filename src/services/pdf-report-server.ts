/**
 * Server-side PDF report generator for EX-003 node.
 * Collects upstream artifacts and generates a professional PDF, returning base64 data.
 */

import { jsPDF } from "jspdf";

// ─── Types ───────────────────────────────────────────────────────────────────

interface ArtifactSummary {
  nodeLabel: string;
  type: string;
  data: Record<string, unknown>;
}

interface MetricItem {
  label: string;
  value: string | number;
  unit?: string;
}

const COLORS = {
  primary: [79, 138, 255] as [number, number, number],
  muted: [152, 152, 176] as [number, number, number],
  accent: [16, 185, 129] as [number, number, number],
  border: [40, 40, 60] as [number, number, number],
};

// ─── Main export ─────────────────────────────────────────────────────────────

export function generatePDFBase64(
  workflowName: string,
  artifacts: ArtifactSummary[],
): { base64: string; fileSize: number } {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pw = doc.internal.pageSize.getWidth();
  const ph = doc.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pw - margin * 2;
  let y = margin;

  function ensureSpace(needed: number) {
    if (y + needed > ph - 25) {
      doc.addPage();
      y = margin;
    }
  }

  // ─── Header ──────────────────────────────────────────────────────────
  doc.setFillColor(...COLORS.primary);
  doc.rect(0, 0, pw, 65, "F");

  doc.setFontSize(22);
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.text("BuildFlow Report", margin, 20);

  doc.setFontSize(13);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(220, 230, 255);
  doc.text("CONCEPT DESIGN REPORT", margin, 30);

  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "normal");
  doc.text(workflowName, margin, 42);

  const dateStr = new Date().toLocaleDateString("en-US", {
    year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
  doc.setFontSize(9);
  doc.text(dateStr, pw - margin, 42, { align: "right" });

  y = 77;

  // ─── Summary ─────────────────────────────────────────────────────────
  doc.setFontSize(14);
  doc.setTextColor(50, 50, 60);
  doc.setFont("helvetica", "bold");
  doc.text("Execution Summary", margin, y);
  y += 8;

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(80, 80, 100);
  doc.text(`Nodes executed: ${artifacts.length}`, margin, y);
  y += 5;
  doc.text(`Workflow: ${workflowName}`, margin, y);
  y += 5;
  doc.text(`Date: ${dateStr}`, margin, y);
  y += 12;

  doc.setDrawColor(...COLORS.border);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pw - margin, y);
  y += 10;

  // ─── Table of Contents ──────────────────────────────────────────────
  doc.setFontSize(14);
  doc.setTextColor(50, 50, 60);
  doc.setFont("helvetica", "bold");
  doc.text("Table of Contents", margin, y);
  y += 8;

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(80, 80, 100);
  for (let tocIdx = 0; tocIdx < artifacts.length; tocIdx++) {
    ensureSpace(6);
    doc.text(`${tocIdx + 1}. ${artifacts[tocIdx].nodeLabel}`, margin + 4, y);
    y += 6;
  }
  y += 12;

  doc.setDrawColor(...COLORS.border);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pw - margin, y);
  y += 10;

  // ─── Each artifact ───────────────────────────────────────────────────
  for (let idx = 0; idx < artifacts.length; idx++) {
    const artifact = artifacts[idx];
    ensureSpace(30);

    // Section header
    doc.setFontSize(12);
    doc.setTextColor(50, 50, 60);
    doc.setFont("helvetica", "bold");
    doc.text(`${idx + 1}. ${artifact.nodeLabel}`, margin, y);

    doc.setFontSize(8);
    doc.setTextColor(...COLORS.primary);
    doc.text(artifact.type.toUpperCase(), pw - margin, y, { align: "right" });
    y += 7;

    // Render based on type
    const data = artifact.data;

    if (artifact.type === "text" || artifact.type === "json") {
      const content = String(data?.content ?? data?.json ? JSON.stringify(data.json, null, 2) : JSON.stringify(data, null, 2));
      doc.setFontSize(9);
      doc.setTextColor(60, 60, 80);
      doc.setFont("helvetica", "normal");
      const lines = doc.splitTextToSize(content, contentWidth).slice(0, 40);
      for (const line of lines) {
        ensureSpace(5);
        doc.text(line, margin, y);
        y += 4;
      }
    }

    if (artifact.type === "kpi" || artifact.type === "3d") {
      const metrics = (data?.metrics as MetricItem[]) ?? [];
      const colWidth = contentWidth / Math.min(metrics.length || 1, 4);
      for (let i = 0; i < metrics.length; i++) {
        const m = metrics[i];
        const cx = margin + (i % 4) * colWidth;
        if (i > 0 && i % 4 === 0) y += 14;
        ensureSpace(14);
        doc.setFontSize(14);
        doc.setTextColor(50, 50, 60);
        doc.setFont("helvetica", "bold");
        doc.text(String(m.value), cx, y);
        if (m.unit) {
          doc.setFontSize(8);
          doc.setFont("helvetica", "normal");
          doc.text(String(m.unit), cx + doc.getTextWidth(String(m.value)) + 1, y);
        }
        doc.setFontSize(8);
        doc.setTextColor(...COLORS.muted);
        doc.setFont("helvetica", "normal");
        doc.text(m.label, cx, y + 4);
      }
      if (metrics.length > 0) y += 14 + Math.floor((metrics.length - 1) / 4) * 14;
    }

    if (artifact.type === "table") {
      const headers = (data?.headers as string[]) ?? [];
      const rows = (data?.rows as string[][]) ?? [];
      if (headers.length > 0) {
        const colCount = Math.min(headers.length, 6);
        const colW = contentWidth / colCount;

        // Header
        doc.setFillColor(240, 240, 245);
        doc.rect(margin, y - 3.5, contentWidth, 6, "F");
        doc.setFontSize(7);
        doc.setTextColor(80, 80, 100);
        doc.setFont("helvetica", "bold");
        headers.slice(0, colCount).forEach((h, i) => {
          doc.text(String(h).substring(0, 18), margin + i * colW + 1, y);
        });
        y += 6;

        doc.setFont("helvetica", "normal");
        doc.setTextColor(60, 60, 80);
        const maxRows = Math.min(rows.length, 30);
        for (let r = 0; r < maxRows; r++) {
          ensureSpace(5);
          if (r % 2 === 0) {
            doc.setFillColor(248, 248, 252);
            doc.rect(margin, y - 3.5, contentWidth, 5, "F");
          }
          doc.setFontSize(7);
          rows[r].slice(0, colCount).forEach((cell, i) => {
            doc.text(String(cell ?? "").substring(0, 20), margin + i * colW + 1, y);
          });
          y += 5;
        }

        const summary = data?.summary as { grandTotal?: number } | undefined;
        if (summary?.grandTotal != null) {
          y += 2;
          doc.setFontSize(9);
          doc.setTextColor(...COLORS.accent);
          doc.setFont("helvetica", "bold");
          doc.text(`Grand Total: $${summary.grandTotal.toLocaleString()}`, margin, y);
          y += 5;
        }
      }
    }

    y += 8;

    if (idx < artifacts.length - 1) {
      ensureSpace(5);
      doc.setDrawColor(220, 220, 230);
      doc.setLineWidth(0.15);
      doc.line(margin, y, pw - margin, y);
      y += 8;
    }
  }

  // ─── Disclaimer ────────────────────────────────────────────────────
  ensureSpace(30);
  y += 5;
  doc.setDrawColor(...COLORS.border);
  doc.setLineWidth(0.3);
  doc.line(margin, y, pw - margin, y);
  y += 8;

  doc.setFontSize(8);
  doc.setTextColor(...COLORS.muted);
  doc.setFont("helvetica", "italic");
  const disclaimer = "Disclaimer: This is a concept-level estimate generated by BuildFlow AI. Not for construction documentation. All quantities, costs, and specifications should be verified by qualified professionals before use in any contractual or construction context.";
  const disclaimerLines = doc.splitTextToSize(disclaimer, contentWidth);
  doc.text(disclaimerLines, margin, y);
  y += disclaimerLines.length * 3.5 + 5;

  // ─── Footers ─────────────────────────────────────────────────────────
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(...COLORS.muted);
    doc.text(`Page ${i} of ${totalPages}`, pw / 2, ph - 10, { align: "center" });
    doc.text("Generated by BuildFlow", pw - margin, ph - 10, { align: "right" });
  }

  // ─── Return as base64 ───────────────────────────────────────────────
  const base64 = doc.output("datauristring");
  // Estimate file size from base64 length
  const fileSize = Math.round(base64.length * 0.75);

  return { base64, fileSize };
}
