/**
 * Upgrade a workflow that uses the retired v2 IFC pipeline
 * (TR-024 + TR-022 + EX-006) into the single-node v3 path (GN-013).
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
 * The v3 equivalent collapses everything between the brief source and
 * the IFC artifact into one node — GN-013 runs enrichment + agent loop
 * + sandbox + geometric validators internally.
 *
 * Upgrade strategy:
 *   1. Find any node whose `data.catalogueId` is in the deprecated v2
 *      set ("TR-024" / "TR-022" / "EX-006").
 *   2. For each v2 chain, identify the upstream "brief source" (the
 *      node whose output feeds the FIRST v2 node in the chain) and the
 *      downstream "ifc consumer" (any node fed by EX-006's output).
 *   3. Insert a new GN-013 node at the position of the FIRST v2 node
 *      in the chain (keeps the layout coherent).
 *   4. Re-route edges:
 *        upstream-source → GN-013.brief-in
 *        GN-013.ifc-out  → downstream-consumer
 *   5. Drop the v2 nodes and the edges between them.
 *
 * Returns a fresh `{ nodes, edges }` pair — never mutates input.
 */

import type { WorkflowNode, WorkflowEdge } from "@/types/nodes";

const V2_NODE_IDS = new Set(["TR-024", "TR-022", "EX-006"]);

/** Catalogue id of the v3 replacement node. */
export const V3_AI_IFC_CATALOGUE_ID = "GN-013";

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
  /** Newly added GN-013 tile-instance ids. */
  addedV3NodeIds: string[];
}

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
    // BFS through v2 neighbours
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

  // Position the replacement node at the average position of the v2
  // nodes it replaces, so the canvas layout stays roughly intact.
  const v2NodesArr = Array.from(v2NodeIds).map((id) => nodesById.get(id)!);
  const avgX =
    v2NodesArr.reduce((s, n) => s + n.position.x, 0) / v2NodesArr.length;
  const avgY =
    v2NodesArr.reduce((s, n) => s + n.position.y, 0) / v2NodesArr.length;

  // Build the new GN-013 node. The data shape matches what the canvas
  // executor expects (catalogueId + label + category + inputs/outputs
  // are read by BaseNode + the run dispatcher).
  const newNodeId = genId("gn013");
  const newNode: WorkflowNode = {
    id: newNodeId,
    type: "default",
    position: { x: Math.round(avgX), y: Math.round(avgY) },
    data: {
      catalogueId: V3_AI_IFC_CATALOGUE_ID,
      label: "AI IFC Generator",
      category: "generate",
      status: "idle",
      icon: "Sparkles",
      inputs: [
        { id: "brief-in", label: "Brief (text)", type: "text" },
        { id: "json-in", label: "BriefSpec (JSON)", type: "json" },
      ],
      outputs: [
        { id: "ifc-out", label: "IFC File", type: "ifc" },
        { id: "kpi-out", label: "Stats", type: "json" },
      ],
      executionTime: "30-150s",
    },
  };

  // Remove v2 nodes and any edge that touches a v2 node.
  const survivingNodes = nodes.filter((n) => !v2NodeIds.has(n.id));
  const survivingEdges = edges.filter(
    (e) => !v2NodeIds.has(e.source) && !v2NodeIds.has(e.target),
  );

  // Re-wire: upstream brief sources go to GN-013.brief-in; downstream
  // consumers come from GN-013.ifc-out.
  const newEdges: WorkflowEdge[] = [];
  for (const e of upstreamSources) {
    newEdges.push({
      id: genId("e"),
      source: e.source,
      sourceHandle: e.sourceHandle,
      target: newNodeId,
      targetHandle: "brief-in",
      type: e.type,
      animated: e.animated,
      data: e.data,
    });
  }
  for (const e of downstreamTargets) {
    newEdges.push({
      id: genId("e"),
      source: newNodeId,
      sourceHandle: "ifc-out",
      target: e.target,
      targetHandle: e.targetHandle,
      type: e.type,
      animated: e.animated,
      data: e.data,
    });
  }

  return {
    nodes: [...survivingNodes, newNode],
    edges: [...survivingEdges, ...newEdges],
    removedV2NodeIds: Array.from(v2NodeIds),
    addedV3NodeIds: [newNodeId],
  };
}
