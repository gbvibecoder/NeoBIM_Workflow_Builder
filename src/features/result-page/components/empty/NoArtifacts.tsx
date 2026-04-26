"use client";

import { Inbox } from "lucide-react";
import { EmptyState } from "@/features/result-page/components/primitives/EmptyState";

export function NoArtifacts({ workflowId }: { workflowId: string | null }) {
  const back = workflowId ? `/dashboard/canvas?id=${workflowId}` : "/dashboard/canvas";
  return (
    <EmptyState
      icon={<Inbox size={28} />}
      title="No outputs yet"
      description="This run finished without producing any artifacts. Open the canvas to investigate or rerun the workflow."
      primaryHref={back}
      primaryLabel="Open canvas"
      secondaryHref="/dashboard"
      secondaryLabel="Dashboard"
    />
  );
}
