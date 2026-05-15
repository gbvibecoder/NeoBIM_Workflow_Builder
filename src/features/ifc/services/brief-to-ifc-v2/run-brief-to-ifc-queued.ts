/**
 * Canvas dispatcher for the Brief-to-IFC v2 queued pipeline (Phase 2).
 *
 * `useExecution.runWorkflow` calls `runBriefToIfcQueued` instead of its
 * synchronous node-loop when (a) the `briefToIfcV2QueueEnabled` canary
 * flag is on AND (b) the canvas is the wf-13 composition. This file holds
 * the whole queued-run dispatch so `useExecution` only carries a thin
 * branch.
 *
 * Flow (mirrors the brief-renders two-step client shape):
 *   1. Pull the brief file off the IN-002 node.
 *   2. POST it to `/api/upload-brief` → `briefUrl`.
 *   3. POST `/api/brief-to-ifc-job` `{ briefUrl, executionId }` → `jobId`.
 *   4. Poll `GET /api/brief-to-ifc-job/:id` until terminal, driving the
 *      four canvas node statuses (IN-002 → TR-024 → TR-022 → EX-006) off
 *      the job's `status` as it advances through the three server stages.
 *   5. On COMPLETED, publish the enriched-spec text artifact (TR-024) and
 *      the generated-IFC file artifact (EX-006) into the execution store
 *      so the result showcase renders them. On FAILED, mark the failing
 *      node red.
 *
 * Client-only. Imports `job-types` for the shared contracts but NEVER the
 * server modules (orchestrator / stages / canary all read server env).
 */

"use client";

import { useWorkflowStore } from "@/features/workflows/stores/workflow-store";
import { useExecutionStore } from "@/features/execution/stores/execution-store";
import { inputFileStore } from "@/features/canvas/components/nodes/InputNode";
import { generateId } from "@/lib/utils";
import type { WorkflowNode } from "@/types/nodes";
import type { ExecutionArtifact } from "@/types/execution";

import {
  isBriefToIfcTerminal,
  type BriefToIfcJobView,
} from "./job-types";

type LogType = "start" | "running" | "success" | "error" | "info";
export type BriefToIfcLogFn = (
  type: LogType,
  message: string,
  detail?: string,
) => void;

export interface RunBriefToIfcQueuedArgs {
  /** The live canvas nodes (post-id-remap from loadFromTemplate). */
  nodes: WorkflowNode[];
  /** Client-generated execution correlation id (also stored on the job row). */
  executionId: string;
  /** The canvas execution-log sink from `useExecution`. */
  log: BriefToIfcLogFn;
}

/** Catalogue ids that make up the wf-13 "Brief → AI-Powered IFC" pipeline. */
const WF13_CATALOGUE_IDS = ["IN-002", "TR-024", "TR-022", "EX-006"] as const;

/** Hard client-side polling cap. The server's cleanup cron marks any
 *  stuck job FAILED within ~15 min, so a healthy run terminates long
 *  before this — but the cap stops the poll loop from running forever if
 *  something pathological happens. */
const MAX_POLL_MS = 25 * 60_000;

/**
 * True when the canvas is the wf-13 composition. Detected by NODE
 * COMPOSITION, not workflow id — `loadFromTemplate` remaps node ids, so a
 * workflow-id match would be unreliable.
 */
export function isBriefToIfcV2Composition(nodes: WorkflowNode[]): boolean {
  const ids = new Set(
    nodes.map((n) => (n.data as { catalogueId?: string }).catalogueId),
  );
  return WF13_CATALOGUE_IDS.every((id) => ids.has(id));
}

function findNode(
  nodes: WorkflowNode[],
  catalogueId: string,
): WorkflowNode | undefined {
  return nodes.find(
    (n) => (n.data as { catalogueId?: string }).catalogueId === catalogueId,
  );
}

/** Decode a base64 string into a Blob without an intermediate data URI. */
function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteChars = atob(base64);
  const bytes = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    bytes[i] = byteChars.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

/** Resolve the brief file from the IN-002 node — either a `File` parked in
 *  `inputFileStore` or a base64 `fileData` blob on the node's data. */
function resolveBriefFile(in002: WorkflowNode): File | null {
  const stored = inputFileStore.get(in002.id);
  if (stored) return stored;

  const data = in002.data as Record<string, unknown>;
  const base64 = typeof data.fileData === "string" ? data.fileData : null;
  if (!base64) return null;
  const fileName =
    (typeof data.fileName === "string" && data.fileName) ||
    (typeof data.inputValue === "string" && data.inputValue) ||
    "brief.pdf";
  const mimeType =
    (typeof data.mimeType === "string" && data.mimeType) ||
    (fileName.toLowerCase().endsWith(".docx")
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : "application/pdf");
  return new File([base64ToBlob(base64, mimeType)], fileName, {
    type: mimeType,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Adaptive poll cadence — tighter early, looser as the run ages. */
function pollIntervalMs(elapsedMs: number): number {
  if (elapsedMs < 5 * 60_000) return 4_000;
  if (elapsedMs < 10 * 60_000) return 8_000;
  return 15_000;
}

interface Wf13Nodes {
  in002: WorkflowNode;
  tr024: WorkflowNode;
  tr022: WorkflowNode;
  ex006: WorkflowNode;
}

/** Drive the four canvas node statuses off the job's current status. */
function applyStatusToCanvas(view: BriefToIfcJobView, n: Wf13Nodes): void {
  const ws = useWorkflowStore.getState();
  const set = ws.updateNodeStatus;
  switch (view.status) {
    case "QUEUED":
    case "RUNNING_ENRICH":
      set(n.in002.id, "success");
      set(n.tr024.id, "running");
      break;
    case "RUNNING_ARCHITECT":
      set(n.in002.id, "success");
      set(n.tr024.id, "success");
      set(n.tr022.id, "running");
      break;
    case "RUNNING_GENERATE":
      set(n.in002.id, "success");
      set(n.tr024.id, "success");
      set(n.tr022.id, "success");
      set(n.ex006.id, "running");
      break;
    case "AWAITING_RETRY":
      // A stage hit a transient fault and is queued to retry — keep the
      // node for `currentStage` showing "running" rather than flipping it
      // red; the retry usually clears within the backoff window.
      if (view.currentStage === "architect") set(n.tr022.id, "running");
      else if (view.currentStage === "generate") set(n.ex006.id, "running");
      else set(n.tr024.id, "running");
      break;
    default:
      break;
  }
}

/** Build the EX-006-equivalent file artifact for a completed job. */
function buildIfcArtifact(
  view: BriefToIfcJobView,
  executionId: string,
  ex006: WorkflowNode,
): ExecutionArtifact {
  const ifcUrl = view.ifcR2Url ?? "";
  const entityCount = view.ifcEntityCount ?? view.ifcAudit?.total_entities ?? 0;
  const fileName = `ai-ifc-${view.id.slice(0, 12)}.ifc`;
  return {
    id: generateId(),
    executionId,
    tileInstanceId: ex006.id,
    type: "file",
    data: {
      files: [
        {
          name: fileName,
          type: "IFC 4",
          size: 0,
          downloadUrl: ifcUrl,
          label: "AI-Generated IFC",
          discipline: "architectural",
        },
      ],
      label: "AI-Powered IFC",
      totalSize: 0,
      name: fileName,
      type: "IFC 4",
      size: 0,
      downloadUrl: ifcUrl,
      _ifc: {
        entityCount,
        audit: view.ifcAudit ?? { total_entities: entityCount, by_class: {} },
        expectedEntityCount: entityCount,
      },
    },
    metadata: {
      engine: "ifcopenshell",
      real: true,
      schema: "IFC4",
      ifcServicePath: "ai-sandbox-queued",
      entityCount,
      jobId: view.id,
      stageLog: view.stageLog,
    },
    createdAt: new Date(),
  };
}

/** Build the TR-024-equivalent enriched-spec text artifact. */
function buildEnrichedSpecArtifact(
  view: BriefToIfcJobView,
  executionId: string,
  tr024: WorkflowNode,
): ExecutionArtifact {
  const spec = view.enrichedSpec ?? "";
  return {
    id: generateId(),
    executionId,
    tileInstanceId: tr024.id,
    type: "text",
    data: { content: spec, label: "Enriched Spec" },
    metadata: { real: true, jobId: view.id, charCount: spec.length },
    createdAt: new Date(),
  };
}

/** Map a failed job's `error.stage` to the node that should turn red. */
function failingNodeId(view: BriefToIfcJobView, n: Wf13Nodes): string {
  const stage = view.error?.stage ?? view.currentStage ?? "";
  if (stage === "enrich") return n.tr024.id;
  if (stage === "architect") return n.tr022.id;
  if (stage === "generate") return n.ex006.id;
  return n.ex006.id;
}

/**
 * Run wf-13 through the queued pipeline. Resolves `true` when the job
 * reaches COMPLETED, `false` on any failure (upload error, job-creation
 * error, FAILED status, or the client-side poll cap). Never throws — all
 * failure modes are surfaced through the canvas + log and a `false`
 * return so `useExecution` can call `completeExecution("failed")`.
 */
export async function runBriefToIfcQueued(
  args: RunBriefToIfcQueuedArgs,
): Promise<boolean> {
  const { nodes, executionId, log } = args;

  const in002 = findNode(nodes, "IN-002");
  const tr024 = findNode(nodes, "TR-024");
  const tr022 = findNode(nodes, "TR-022");
  const ex006 = findNode(nodes, "EX-006");
  if (!in002 || !tr024 || !tr022 || !ex006) {
    log("error", "Brief-to-IFC pipeline is missing a required node");
    return false;
  }
  const wf13: Wf13Nodes = { in002, tr024, tr022, ex006 };

  const ws = useWorkflowStore.getState();
  const es = useExecutionStore.getState();

  // ── 1. Resolve + upload the brief ──────────────────────────────────
  ws.updateNodeStatus(in002.id, "running");
  log("running", "Uploading brief", in002.data.label);

  const briefFile = resolveBriefFile(in002);
  if (!briefFile) {
    ws.updateNodeStatus(in002.id, "error");
    log("error", "No brief file found on the upload node");
    es.addTileResult({
      tileInstanceId: in002.id,
      catalogueId: "IN-002",
      status: "error",
      startedAt: new Date(),
      completedAt: new Date(),
      errorMessage: "No brief file found on the upload node.",
    });
    return false;
  }

  let briefUrl: string;
  try {
    const form = new FormData();
    form.append("file", briefFile, briefFile.name);
    const uploadRes = await fetch("/api/upload-brief", {
      method: "POST",
      body: form,
      credentials: "include",
    });
    if (!uploadRes.ok) {
      const txt = await uploadRes.text().catch(() => "");
      throw new Error(`upload-brief HTTP ${uploadRes.status} ${txt.slice(0, 200)}`);
    }
    const uploadJson = (await uploadRes.json()) as { briefUrl?: string };
    if (!uploadJson.briefUrl) throw new Error("upload-brief returned no briefUrl");
    briefUrl = uploadJson.briefUrl;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ws.updateNodeStatus(in002.id, "error");
    log("error", "Brief upload failed", msg);
    es.addTileResult({
      tileInstanceId: in002.id,
      catalogueId: "IN-002",
      status: "error",
      startedAt: new Date(),
      completedAt: new Date(),
      errorMessage: msg,
    });
    return false;
  }

  ws.updateNodeStatus(in002.id, "success");
  ws.setEdgeFlowing(in002.id, true);
  log("success", "Brief uploaded", briefFile.name);

  // ── 2. Create the queued job ───────────────────────────────────────
  let jobId: string;
  try {
    const createRes = await fetch("/api/brief-to-ifc-job", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ briefUrl, executionId }),
    });
    if (!createRes.ok) {
      const errJson = await createRes
        .json()
        .catch(() => ({}) as { error?: { message?: string } });
      throw new Error(
        errJson?.error?.message ?? `brief-to-ifc-job HTTP ${createRes.status}`,
      );
    }
    const createJson = (await createRes.json()) as { jobId?: string };
    if (!createJson.jobId) throw new Error("job creation returned no jobId");
    jobId = createJson.jobId;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ws.updateNodeStatus(tr024.id, "error");
    log("error", "Could not start the AI IFC pipeline", msg);
    es.addTileResult({
      tileInstanceId: tr024.id,
      catalogueId: "TR-024",
      status: "error",
      startedAt: new Date(),
      completedAt: new Date(),
      errorMessage: msg,
    });
    return false;
  }

  ws.updateNodeStatus(tr024.id, "running");
  log("info", "AI IFC pipeline queued", `job ${jobId}`);

  // ── 3. Poll until terminal, driving canvas statuses ────────────────
  const startedAt = Date.now();
  while (true) {
    const elapsed = Date.now() - startedAt;
    if (elapsed > MAX_POLL_MS) {
      ws.updateNodeStatus(ex006.id, "error");
      log(
        "error",
        "AI IFC pipeline timed out",
        "The job did not finish within the polling window — check back later.",
      );
      return false;
    }

    let view: BriefToIfcJobView;
    try {
      const res = await fetch(`/api/brief-to-ifc-job/${jobId}`, {
        method: "GET",
        credentials: "include",
      });
      if (!res.ok) {
        // Transient — back off and keep polling. The server stays the
        // source of truth for terminal status.
        await sleep(pollIntervalMs(elapsed));
        continue;
      }
      view = (await res.json()) as BriefToIfcJobView;
    } catch {
      await sleep(pollIntervalMs(elapsed));
      continue;
    }

    es.setProgress(Math.max(0, Math.min(100, view.progress)));

    if (!isBriefToIfcTerminal(view.status)) {
      applyStatusToCanvas(view, wf13);
      await sleep(pollIntervalMs(elapsed));
      continue;
    }

    // ── Terminal ─────────────────────────────────────────────────────
    if (view.status === "COMPLETED") {
      const now = new Date();
      ws.updateNodeStatus(in002.id, "success");
      ws.updateNodeStatus(tr024.id, "success");
      ws.updateNodeStatus(tr022.id, "success");
      ws.updateNodeStatus(ex006.id, "success");

      const specArtifact = buildEnrichedSpecArtifact(view, executionId, tr024);
      es.addArtifact(tr024.id, specArtifact);
      es.addTileResult({
        tileInstanceId: tr024.id,
        catalogueId: "TR-024",
        status: "success",
        startedAt: now,
        completedAt: now,
        artifact: specArtifact,
      });

      const ifcArtifact = buildIfcArtifact(view, executionId, ex006);
      es.addArtifact(ex006.id, ifcArtifact);
      es.addTileResult({
        tileInstanceId: ex006.id,
        catalogueId: "EX-006",
        status: "success",
        startedAt: now,
        completedAt: now,
        artifact: ifcArtifact,
      });

      es.setProgress(100);
      log(
        "success",
        "AI IFC generated",
        `${view.ifcEntityCount ?? "?"} entities`,
      );
      return true;
    }

    // FAILED
    const failNodeId = failingNodeId(view, wf13);
    const failCatalogueId =
      failNodeId === tr024.id
        ? "TR-024"
        : failNodeId === tr022.id
          ? "TR-022"
          : "EX-006";
    ws.updateNodeStatus(failNodeId, "error");
    const errMsg = view.error?.message ?? "The AI IFC pipeline failed.";
    log("error", "AI IFC pipeline failed", `${view.error?.code ?? ""} ${errMsg}`);
    es.addTileResult({
      tileInstanceId: failNodeId,
      catalogueId: failCatalogueId,
      status: "error",
      startedAt: new Date(),
      completedAt: new Date(),
      errorMessage: errMsg,
    });
    return false;
  }
}
