"use client";

import { WorkflowCanvas } from "@/components/canvas/WorkflowCanvas";

export default function CanvasPage() {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      <WorkflowCanvas />
    </div>
  );
}
