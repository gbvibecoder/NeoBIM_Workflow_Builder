/**
 * LegacyV2Banner
 *
 * Renders at the top of the canvas when the loaded workflow uses any
 * retired v2 IFC pipeline node (TR-022 / TR-024 / EX-006). Two actions:
 *
 *   1. **Upgrade workflow** (primary) — runs `upgradeWorkflowToV3` on
 *      the current graph, sets the workflow store's nodes/edges to the
 *      upgraded 5-node chain (IN-009 → TR-025 → TR-026 → TR-027 → EX-007),
 *      and forces a save. Reloads the page so every store + selection
 *      bookkeeping starts fresh.
 *   2. **Dismiss** — hide the banner THIS session for THIS workflow
 *      (localStorage key keyed on workflow id; user-clearable).
 *
 * The "Open form instead" CTA was removed on 2026-05-17 (Canvas
 * Unification) — the form was deleted; the canvas IS the only path.
 *
 * The banner intentionally avoids jargon — uses "old pipeline" /
 * "retired" instead of "TR-022" / "v2".
 */

"use client";

import { useState } from "react";
import { Sparkles, X } from "lucide-react";

import type { WorkflowNode, WorkflowEdge } from "@/types/nodes";

import { workflowUsesDeprecatedV2, upgradeWorkflowToV3 } from "../utils/upgrade-v2-to-v3";

const DISMISS_STORAGE_KEY = "bf:legacy-v2-banner:dismissed";

function readDismissed(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(DISMISS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeDismissed(workflowId: string): void {
  if (typeof window === "undefined") return;
  try {
    const current = readDismissed();
    current[workflowId] = true;
    window.localStorage.setItem(DISMISS_STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* ignore — best-effort */
  }
}

interface LegacyV2BannerProps {
  workflowId: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  /** Caller persists the upgraded graph + reloads. Receives the new
   *  nodes/edges; should call the workflow store's set + save methods. */
  onApplyUpgrade: (
    upgraded: { nodes: WorkflowNode[]; edges: WorkflowEdge[] },
  ) => void;
}

export function LegacyV2Banner({
  workflowId,
  nodes,
  edges,
  onApplyUpgrade,
}: LegacyV2BannerProps): React.ReactElement | null {
  const [hidden, setHidden] = useState<boolean>(() => {
    const map = readDismissed();
    return Boolean(map[workflowId]);
  });
  const [busy, setBusy] = useState(false);

  if (hidden) return null;
  if (!workflowUsesDeprecatedV2(nodes)) return null;

  function handleUpgrade() {
    setBusy(true);
    const upgraded = upgradeWorkflowToV3(nodes, edges);
    onApplyUpgrade({ nodes: upgraded.nodes, edges: upgraded.edges });
    // Caller resets busy via its own re-render; if it doesn't, we
    // never time-out — better to show the spinner than to flap.
  }

  function handleDismiss() {
    writeDismissed(workflowId);
    setHidden(true);
  }

  return (
    <div
      data-testid="legacy-v2-banner"
      className="mx-auto my-3 flex w-full max-w-4xl flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50/80 p-4 text-sm shadow-sm sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div className="min-w-0">
          <p className="font-medium text-amber-900">
            This workflow uses an old IFC pipeline that produced broken files.
          </p>
          <p className="mt-0.5 text-xs text-amber-800">
            We replaced it with a transparent 4-stage canvas pipeline
            (Brief Enricher → IFC Agent Builder → Geometric Validator →
            IFC Export + Preview). Upgrade in one click — your upstream
            input node is preserved.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
        <button
          type="button"
          onClick={handleUpgrade}
          disabled={busy}
          data-testid="legacy-v2-upgrade"
          className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Upgrading…" : "Upgrade workflow"}
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss this banner for this workflow"
          data-testid="legacy-v2-dismiss"
          className="rounded-md p-1.5 text-amber-700 transition-colors hover:bg-amber-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
