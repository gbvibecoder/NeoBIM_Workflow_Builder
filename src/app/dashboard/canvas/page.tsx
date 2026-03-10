"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

// ─── Lazy Load Heavy Canvas Component ─────────────────────────────
// @xyflow/react is 260KB - only load when user navigates to canvas
const WorkflowCanvas = dynamic(
  () => import("@/components/canvas/WorkflowCanvas").then((m) => ({ default: m.WorkflowCanvas })),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen w-full items-center justify-center bg-[#07070D]">
        <div className="flex flex-col items-center gap-4">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500/20 border-t-blue-500" />
          <p className="text-sm text-white/60">Loading workflow canvas...</p>
        </div>
      </div>
    ),
  }
);

export default function CanvasPage() {
  const searchParams = useSearchParams();
  const workflowId = searchParams.get("id") ?? undefined;

  return (
    <Suspense
      fallback={
        <div className="flex h-screen w-full items-center justify-center bg-[#07070D]">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500/20 border-t-blue-500" />
        </div>
      }
    >
      <WorkflowCanvas workflowId={workflowId} />
    </Suspense>
  );
}
