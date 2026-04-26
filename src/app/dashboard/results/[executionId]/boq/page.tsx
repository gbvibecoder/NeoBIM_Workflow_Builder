"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useExecutionStore, selectHydrateDiagnostics } from "@/features/execution/stores/execution-store";
import { BOQVisualizerPage, parseArtifactToBOQ, getMockBOQData } from "@/features/boq/components";
import type { BOQData } from "@/features/boq/components";
import { BOQSkeleton } from "@/features/boq/components/BOQSkeleton";
import { ExecutionDiagnosticsPanel } from "@/components/diagnostics/ExecutionDiagnosticsPanel";

// Shape we scan from both the in-memory store and the API-mapped artifacts.
// `data` is the artifact payload — for TR-008 this carries _boqData / _totalCost.
type ScannableArtifact = { type?: string; data?: Record<string, unknown> | null };

/**
 * Walk a list of artifacts (in-memory or API) and pull out the first usable
 * BOQ table plus any sibling Excel/PDF download URLs from EX-002 / EX-003.
 * Two passes so file URL ordering doesn't matter.
 */
function extractBOQ(items: ScannableArtifact[]): BOQData | null {
  let excelUrl: string | undefined;
  let pdfUrl: string | undefined;

  for (const a of items) {
    if (a.type !== "file" || !a.data) continue;
    const fd = a.data;
    const name = (fd.name as string) || (fd.fileName as string) || "";
    const url = (fd.downloadUrl as string) || "";
    if (!url) continue;
    if (name.endsWith(".xlsx")) excelUrl = url;
    else if (name.endsWith(".pdf")) pdfUrl = url;
  }

  for (const a of items) {
    if (a.type !== "table" || !a.data) continue;
    const data = a.data;
    if (!data._boqData && !data._totalCost) continue;
    const parsed = parseArtifactToBOQ(data);
    if (parsed && parsed.lines.length > 0) {
      return {
        ...parsed,
        excelUrl: parsed.excelUrl ?? excelUrl,
        pdfUrl: parsed.pdfUrl ?? pdfUrl,
      };
    }
  }
  return null;
}

export default function BOQVisualizerRoute() {
  const params = useParams<{ executionId: string }>();
  const executionId = params.executionId;
  const [boqData, setBOQData] = useState<BOQData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const artifacts = useExecutionStore((s) => s.artifacts);
  const hydrateDiagnostics = useExecutionStore(selectHydrateDiagnostics);

  // Hydrate the universal execution trace from server metadata if the user
  // is opening this page fresh (no in-memory trace from a live run).
  useEffect(() => {
    if (!executionId || executionId === "demo") return;
    const existing = useExecutionStore.getState().currentTrace;
    if (existing && existing.executionId === executionId) return;
    let cancelled = false;
    fetch(`/api/executions/${executionId}`)
      .then(r => r.ok ? r.json() : null)
      .then((json) => {
        if (cancelled || !json?.execution?.metadata?.diagnostics) return;
        hydrateDiagnostics(json.execution.metadata.diagnostics);
      })
      .catch(() => { /* non-fatal */ });
    return () => { cancelled = true; };
  }, [executionId, hydrateDiagnostics]);

  useEffect(() => {
    // Demo mode → mock data (showcases the visualizer with no execution behind it).
    if (!executionId || executionId === "demo") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot demo seed
      setBOQData(getMockBOQData());
      setError(null);
      setLoading(false);
      return;
    }

    setError(null);
    setLoading(true);

    // 1. Try in-memory store first (live execution flow).
    const memoryItems: ScannableArtifact[] = [];
    for (const [, art] of artifacts) {
      memoryItems.push({ type: art.type, data: art.data as Record<string, unknown> });
    }
    const fromMemory = extractBOQ(memoryItems);
    if (fromMemory) {
      setBOQData(fromMemory);
      setLoading(false);
      return;
    }

    // 2. Cold load → fetch from API. Response shape is { execution: { ...,
    //    artifacts: [{ type, data, ... }, ...] } } per /api/executions/[id].
    let cancelled = false;
    fetch(`/api/executions/${executionId}`, { cache: "no-store" })
      .then(async (res) => {
        if (res.status === 404) throw new Error("not-found");
        if (res.status === 401 || res.status === 403) throw new Error("forbidden");
        if (!res.ok) throw new Error(`fetch-${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (cancelled) return;
        const apiArtifacts = (json?.execution?.artifacts ?? []) as ScannableArtifact[];
        const fromApi = extractBOQ(apiArtifacts);
        if (fromApi) {
          setBOQData(fromApi);
        } else {
          setBOQData(null);
          setError("This run didn't produce a BOQ artifact.");
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : "";
        setBOQData(null);
        if (msg === "not-found") setError("This execution couldn't be found — it may have been deleted.");
        else if (msg === "forbidden") setError("You don't have access to this execution.");
        else setError("Couldn't load this BOQ — please try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [executionId, artifacts]);

  if (loading) {
    return <BOQSkeleton />;
  }

  if (error || !boqData) {
    const backHref = executionId && executionId !== "demo"
      ? `/dashboard/results/${executionId}`
      : "/dashboard";
    return (
      <div className="flex-1 flex items-center justify-center" style={{ background: "#FAFAF8" }}>
        <div className="text-center" style={{ maxWidth: 420 }}>
          <p className="text-base font-semibold" style={{ color: "#111827" }}>
            BOQ unavailable
          </p>
          <p className="text-sm mt-2" style={{ color: "#6B7280", lineHeight: 1.6 }}>
            {error || "No BOQ data available for this run."}
          </p>
          <Link
            href={backHref}
            style={{
              display: "inline-block",
              marginTop: 20,
              padding: "10px 18px",
              borderRadius: 10,
              background: "#0D9488",
              color: "#FFFFFF",
              fontSize: 13,
              fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Back to result
          </Link>
        </div>
      </div>
    );
  }

  return (
    <>
      <BOQVisualizerPage data={boqData} executionId={executionId} />
      {/* Universal execution diagnostics — floating "Behind the Scenes" launcher */}
      <ExecutionDiagnosticsPanel />
    </>
  );
}
