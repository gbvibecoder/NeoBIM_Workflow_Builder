/**
 * Upgrade a workflow that uses the retired v2 IFC pipeline
 * (TR-024 + TR-022 + EX-006) into the transparent 4-node v3 canvas
 * chain (TR-025 + TR-026 + TR-027 + EX-007).
 *
 * The v2 chain was:
 *
 *   [IN-001/IN-002: brief text or PDF]
 *           │
 *           ▼
 *   [TR-024 Brief Enricher]    ← Layer 1 enrichment
 *           │
 *           ▼
 *   [TR-022 IFC Architect]     ← script generation
 *           │
 *           ▼
 *   [EX-006 AI IFC Generator]  ← sandbox execution
 *           │
 *           ▼
 *      (IFC artifact)
 *
 * The v3 equivalent (Canvas Unification, 2026-05-17) is:
 *
 *   [upstream brief source — preserved]
 *           │
 *           ▼
 *   [TR-025 Brief Enricher]       ← Layer 1 (free text → BriefSpec)
 *           │
 *           ▼
 *   [TR-026 IFC Agent Builder]    ← Layer 2 (agent loop → IFC)
 *           │
 *           ▼
 *   [TR-027 Geometric Validator]  ← bbox + polygon + origin + element coverage
 *           │
 *           ▼
 *   [EX-007 IFC Export + Preview] ← R2 download + top/iso PNG previews
 *           │
 *           ▼
 *      (downstream consumers)
 *
 * Upgrade strategy:
 *   1. Find any node whose `data.catalogueId` is in the deprecated v2
 *      set ("TR-024" / "TR-022" / "EX-006").
 *   2. For each v2 chain, identify the upstream "brief source" (the
 *      node whose output feeds the FIRST v2 node in the chain) and the
 *      downstream "ifc consumer" (any node fed by EX-006's output).
 *   3. Insert the new 4-node chain centered on the average position
 *      of the v2 nodes it replaces.
 *   4. Re-route edges:
 *        upstream-source → TR-025.brief-in
 *        EX-007.ifc-out  → downstream-consumer
 *   5. Drop the v2 nodes and the edges between them.
 *
 * Returns a fresh `{ nodes, edges }` pair — never mutates input.
 */

import type { WorkflowNode, WorkflowEdge } from "@/types/nodes";

const V2_NODE_IDS = new Set(["TR-024", "TR-022", "EX-006"]);

/** Catalogue ids of the v3 replacement chain. */
export const V3_BRIEF_ENRICHER_ID = "TR-025";
export const V3_AGENT_BUILDER_ID = "TR-026";
export const V3_VALIDATOR_ID = "TR-027";
export const V3_EXPORT_PREVIEW_ID = "EX-007";

/** Did this graph use any retired v2 IFC pipeline node? */
export function workflowUsesDeprecatedV2(nodes: WorkflowNode[]): boolean {
  return nodes.some((n) => V2_NODE_IDS.has(String(n.data?.catalogueId)));
}

function genId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 9);
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

interface UpgradeResult {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  /** Catalogue ids of the v2 nodes that were removed. Empty if no upgrade happened. */
  removedV2NodeIds: string[];
  /** Newly added v3 tile-instance ids (in execution order). */
  addedV3NodeIds: string[];
}

/** Horizontal spacing between the 4 new v3 nodes when inserted. */
const V3_X_STRIDE = 220;

export function upgradeWorkflowToV3(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): UpgradeResult {
  if (!workflowUsesDeprecatedV2(nodes)) {
    return {
      nodes,
      edges,
      removedV2NodeIds: [],
      addedV3NodeIds: [],
    };
  }

  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const v2NodeIds = new Set(
    nodes
      .filter((n) => V2_NODE_IDS.has(String(n.data?.catalogueId)))
      .map((n) => n.id),
  );

  // Index edges for quick traversal.
  const incomingBy = new Map<string, WorkflowEdge[]>();
  const outgoingBy = new Map<string, WorkflowEdge[]>();
  for (const e of edges) {
    incomingBy.set(e.target, [...(incomingBy.get(e.target) ?? []), e]);
    outgoingBy.set(e.source, [...(outgoingBy.get(e.source) ?? []), e]);
  }

  // Walk every v2 node backwards to find its non-v2 upstream source(s)
  // and forwards to find its non-v2 downstream target(s). Edges are
  // tracked so we can remove every edge that lives entirely inside the
  // v2 chain (source-and-target both v2).
  const seenChain = new Set<string>();
  const upstreamSources: WorkflowEdge[] = []; // edges from non-v2 INTO the v2 chain
  const downstreamTargets: WorkflowEdge[] = []; // edges from the v2 chain INTO non-v2
  for (const id of v2NodeIds) {
    if (seenChain.has(id)) continue;
    const queue = [id];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (seenChain.has(cur)) continue;
      seenChain.add(cur);
      for (const e of incomingBy.get(cur) ?? []) {
        if (v2NodeIds.has(e.source)) {
          queue.push(e.source);
        } else {
          upstreamSources.push(e);
        }
      }
      for (const e of outgoingBy.get(cur) ?? []) {
        if (v2NodeIds.has(e.target)) {
          queue.push(e.target);
        } else {
          downstreamTargets.push(e);
        }
      }
    }
  }

  // Position the replacement chain centered on the average position of
  // the v2 nodes it replaces, so the canvas layout stays roughly intact.
  const v2NodesArr = Array.from(v2NodeIds).map((id) => nodesById.get(id)!);
  const avgX =
    v2NodesArr.reduce((s, n) => s + n.position.x, 0) / v2NodesArr.length;
  const avgY =
    v2NodesArr.reduce((s, n) => s + n.position.y, 0) / v2NodesArr.length;

  // The 4 new nodes laid out horizontally, centered on (avgX, avgY).
  // Chain x positions: -1.5, -0.5, +0.5, +1.5 strides from the centre.
  const baseY = Math.round(avgY);
  const enricherX = Math.round(avgX - 1.5 * V3_X_STRIDE);
  const agentX = Math.round(avgX - 0.5 * V3_X_STRIDE);
  const validatorX = Math.round(avgX + 0.5 * V3_X_STRIDE);
  const exportX = Math.round(avgX + 1.5 * V3_X_STRIDE);

  const enricherId = genId("tr025");
  const agentId = genId("tr026");
  const validatorId = genId("tr027");
  const exportId = genId("ex007");

  const enricherNode: WorkflowNode = {
    id: enricherId,
    type: "default",
    position: { x: enricherX, y: baseY },
    data: {
      catalogueId: V3_BRIEF_ENRICHER_ID,
      label: "Brief Enricher",
      category: "transform",
      status: "idle",
      icon: "Wand2",
      inputs: [{ id: "brief-in", label: "Brief Text", type: "text" }],
      outputs: [{ id: "spec-out", label: "BriefSpec", type: "json" }],
      executionTime: "15-30s",
    },
  };
  const agentNode: WorkflowNode = {
    id: agentId,
    type: "default",
    position: { x: agentX, y: baseY },
    data: {
      catalogueId: V3_AGENT_BUILDER_ID,
      label: "IFC Agent Builder",
      category: "transform",
      status: "idle",
      icon: "Bot",
      inputs: [{ id: "spec-in", label: "BriefSpec", type: "json" }],
      outputs: [
        { id: "ifc-out", label: "IFC File", type: "ifc" },
        { id: "kpi-out", label: "Stats", type: "json" },
      ],
      executionTime: "30-150s",
    },
  };
  const validatorNode: WorkflowNode = {
    id: validatorId,
    type: "default",
    position: { x: validatorX, y: baseY },
    data: {
      catalogueId: V3_VALIDATOR_ID,
      label: "Geometric Validator",
      category: "transform",
      status: "idle",
      icon: "ShieldCheck",
      inputs: [{ id: "ifc-in", label: "IFC File", type: "ifc" }],
      outputs: [
        { id: "verdict-out", label: "Verdict + Bbox", type: "json" },
        { id: "ifc-out", label: "IFC File (passthrough)", type: "ifc" },
      ],
      executionTime: "< 3s",
    },
  };
  const exportNode: WorkflowNode = {
    id: exportId,
    type: "default",
    position: { x: exportX, y: baseY },
    data: {
      catalogueId: V3_EXPORT_PREVIEW_ID,
      label: "IFC Export + Preview",
      category: "export",
      status: "idle",
      icon: "FileBox",
      inputs: [{ id: "ifc-in", label: "Validated IFC", type: "ifc" }],
      outputs: [
        { id: "ifc-out", label: "IFC File", type: "ifc" },
        { id: "previews-out", label: "Top + Iso PNGs", type: "image" },
      ],
      executionTime: "5-15s",
    },
  };

  // Remove v2 nodes and any edge that touches a v2 node.
  const survivingNodes = nodes.filter((n) => !v2NodeIds.has(n.id));
  const survivingEdges = edges.filter(
    (e) => !v2NodeIds.has(e.source) && !v2NodeIds.has(e.target),
  );

  const newEdges: WorkflowEdge[] = [];

  // Upstream brief sources → TR-025.brief-in
  for (const e of upstreamSources) {
    newEdges.push({
      id: genId("e"),
      source: e.source,
      sourceHandle: e.sourceHandle,
      target: enricherId,
      targetHandle: "brief-in",
      type: e.type,
      animated: e.animated,
      data: e.data,
    });
  }

  // Internal chain edges
  newEdges.push({
    id: genId("e"),
    source: enricherId,
    sourceHandle: "spec-out",
    target: agentId,
    targetHandle: "spec-in",
    type: "animatedEdge",
  });
  newEdges.push({
    id: genId("e"),
    source: agentId,
    sourceHandle: "ifc-out",
    target: validatorId,
    targetHandle: "ifc-in",
    type: "animatedEdge",
  });
  newEdges.push({
    id: genId("e"),
    source: validatorId,
    sourceHandle: "ifc-out",
    target: exportId,
    targetHandle: "ifc-in",
    type: "animatedEdge",
  });

  // EX-007.ifc-out → downstream consumers
  for (const e of downstreamTargets) {
    newEdges.push({
      id: genId("e"),
      source: exportId,
      sourceHandle: "ifc-out",
      target: e.target,
      targetHandle: e.targetHandle,
      type: e.type,
      animated: e.animated,
      data: e.data,
    });
  }

  return {
    nodes: [...survivingNodes, enricherNode, agentNode, validatorNode, exportNode],
    edges: [...survivingEdges, ...newEdges],
    removedV2NodeIds: Array.from(v2NodeIds),
    addedV3NodeIds: [enricherId, agentId, validatorId, exportId],
  };
}
