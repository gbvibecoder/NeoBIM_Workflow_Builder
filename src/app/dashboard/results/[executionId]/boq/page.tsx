"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useExecutionStore } from "@/stores/execution-store";
import { BOQVisualizerPage, parseArtifactToBOQ, getMockBOQData } from "@/features/boq/components";
import type { BOQData } from "@/features/boq/components";

export default function BOQVisualizerRoute() {
  const params = useParams<{ executionId: string }>();
  const executionId = params.executionId;
  const [boqData, setBOQData] = useState<BOQData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const artifacts = useExecutionStore((s) => s.artifacts);

  useEffect(() => {
    // Scan all artifacts for BOQ table data + Excel/PDF download URLs
    let found = false;
    let excelUrl: string | undefined;
    let pdfUrl: string | undefined;

    for (const [, artifact] of artifacts) {
      // Find Excel/PDF file artifacts from EX-002/EX-003
      if (artifact.type === "file" && artifact.data) {
        const fd = artifact.data as Record<string, unknown>;
        const name = (fd.name as string) || (fd.fileName as string) || "";
        const url = (fd.downloadUrl as string) || "";
        if (name.endsWith(".xlsx") && url) excelUrl = url;
        if (name.endsWith(".pdf") && url) pdfUrl = url;
      }

      // Find BOQ table artifact from TR-008
      if (artifact.type === "table" && artifact.data) {
        const data = artifact.data as Record<string, unknown>;
        if (data._boqData || data._totalCost) {
          const parsed = parseArtifactToBOQ(data);
          if (parsed && parsed.lines.length > 0) {
            parsed.excelUrl = excelUrl;
            parsed.pdfUrl = pdfUrl;
            setBOQData(parsed);
            found = true;
          }
        }
      }
    }

    // Attach URLs found after the BOQ artifact (second pass)
    if (found && (excelUrl || pdfUrl)) {
      setBOQData(prev => prev ? { ...prev, excelUrl: prev.excelUrl || excelUrl, pdfUrl: prev.pdfUrl || pdfUrl } : prev);
    }

    // If not in store, try fetching from API
    if (!found && executionId && executionId !== "demo") {
      fetch(`/api/executions/${executionId}`)
        .then((res) => {
          if (!res.ok) throw new Error("Execution not found");
          return res.json();
        })
        .then((exec) => {
          const results = exec.tileResults || [];
          let apiExcelUrl: string | undefined;
          let apiPdfUrl: string | undefined;

          // First pass: find file URLs
          for (const result of results) {
            if (result.artifact?.type === "file" && result.artifact?.data) {
              const fd = result.artifact.data;
              const name = fd.name || fd.fileName || "";
              const url = fd.downloadUrl || "";
              if (name.endsWith(".xlsx") && url) apiExcelUrl = url;
              if (name.endsWith(".pdf") && url) apiPdfUrl = url;
            }
          }

          // Second pass: find BOQ table
          for (const result of results) {
            if (result.artifact?.type === "table" && result.artifact?.data) {
              const data = result.artifact.data;
              if (data._boqData || data._totalCost) {
                const parsed = parseArtifactToBOQ(data);
                if (parsed && parsed.lines.length > 0) {
                  parsed.excelUrl = apiExcelUrl;
                  parsed.pdfUrl = apiPdfUrl;
                  setBOQData(parsed);
                  found = true;
                  break;
                }
              }
            }
          }

          if (!found) setBOQData(getMockBOQData());
        })
        .catch(() => setBOQData(getMockBOQData()))
        .finally(() => setLoading(false));
      return;
    }

    if (!found) setBOQData(getMockBOQData());
    setLoading(false);
  }, [executionId, artifacts]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ background: "#070809" }}>
        <div className="flex flex-col items-center gap-4">
          <div
            className="w-10 h-10 rounded-full border-2 border-t-transparent"
            style={{
              borderColor: "rgba(0, 245, 255, 0.3)",
              borderTopColor: "transparent",
              animation: "spin 1s linear infinite",
            }}
          />
          <span className="text-sm" style={{ color: "#9898B0" }}>
            Loading BOQ data...
          </span>
        </div>
      </div>
    );
  }

  if (error || !boqData) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ background: "#070809" }}>
        <div className="text-center">
          <p className="text-sm" style={{ color: "#EF4444" }}>
            {error || "No BOQ data available"}
          </p>
          <p className="text-xs mt-2" style={{ color: "#5C5C78" }}>
            Run an IFC → BOQ workflow to generate cost data.
          </p>
        </div>
      </div>
    );
  }

  return <BOQVisualizerPage data={boqData} executionId={executionId} />;
}
