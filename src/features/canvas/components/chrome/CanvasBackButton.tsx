"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useCanvasToken } from "@/features/canvas/lib/canvas-tokens";
import { useWorkflowStore, selectIsDirty } from "@/features/workflows/stores/workflow-store";

interface CanvasBackButtonProps {
  /** Where to navigate to. Defaults to /dashboard. */
  href?: string;
}

/**
 * Floating back-arrow pill anchored to the canvas top-left.
 *
 * Sits outside the centered toolbar so it's always findable and doesn't
 * crowd the workflow controls. If the workflow has unsaved changes, the
 * browser confirm dialog runs before navigation — same UX guarantee the
 * native beforeunload prompt gives, since SPA navigation skips it.
 */
export function CanvasBackButton({ href = "/dashboard" }: CanvasBackButtonProps) {
  const router = useRouter();
  const tk = useCanvasToken();
  const isDirty = useWorkflowStore(selectIsDirty);

  const handleClick = () => {
    if (isDirty) {
      const ok = window.confirm(
        "You have unsaved changes. Leave the canvas anyway?"
      );
      if (!ok) return;
    }
    router.push(href);
  };

  return (
    <button
      onClick={handleClick}
      title="Back to dashboard"
      aria-label="Back to dashboard"
      style={{
        position: "absolute",
        top: 16,
        left: 16,
        zIndex: 20,
        height: 40,
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "0 12px 0 10px",
        border: `1px solid ${tk.line2}`,
        borderRadius: 12,
        background: tk.surface1,
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        boxShadow: tk.shadowMd,
        color: tk.text1,
        fontSize: 12,
        fontWeight: 500,
        cursor: "pointer",
        transition: "background 150ms ease, transform 150ms ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = tk.hoverBg;
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = tk.surface1;
      }}
    >
      <ArrowLeft size={14} />
      Back
    </button>
  );
}
