"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useExecutionStore } from "@/stores/execution-store";
import { BOQVisualizerPage, parseArtifactToBOQ, getMockBOQData } from "@/components/boq-visualizer";
import type { BOQData } from "@/components/boq-visualizer";

export default function BOQVisualizerRoute() {
  const params = useParams<{ executionId: string }>();
  const executionId = params.executionId;
  const [boqData, setBOQData] = useState<BOQData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const artifacts = useExecutionStore((s) => s.artifacts);

  useEffect(() => {
    // Try to find BOQ artifact in the store
    let found = false;

    for (const [, artifact] of artifacts) {
      if (artifact.type === "table" && artifact.data) {
        const data = artifact.data as Record<string, unknown>;
        if (data._boqData || data._totalCost) {
          const parsed = parseArtifactToBOQ(data);
          if (parsed && parsed.lines.length > 0) {
            setBOQData(parsed);
            found = true;
            break;
          }
        }
      }
    }

    // If not in store, try fetching from API
    if (!found && executionId && executionId !== "demo") {
      fetch(`/api/executions/${executionId}`)
        .then((res) => {
          if (!res.ok) throw new Error("Execution not found");
          return res.json();
        })
        .then((exec) => {
          // Search through tileResults for BOQ artifact
          const results = exec.tileResults || [];
          for (const result of results) {
            if (result.artifact?.type === "table" && result.artifact?.data) {
              const data = result.artifact.data;
              if (data._boqData || data._totalCost) {
                const parsed = parseArtifactToBOQ(data);
                if (parsed && parsed.lines.length > 0) {
                  setBOQData(parsed);
                  found = true;
                  break;
                }
              }
            }
          }

          if (!found) {
            // Use mock data for development
            setBOQData(getMockBOQData());
          }
        })
        .catch(() => {
          // Fallback to mock data
          setBOQData(getMockBOQData());
        })
        .finally(() => setLoading(false));
      return;
    }

    // Demo mode or no artifact found — use mock
    if (!found) {
      setBOQData(getMockBOQData());
    }

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
