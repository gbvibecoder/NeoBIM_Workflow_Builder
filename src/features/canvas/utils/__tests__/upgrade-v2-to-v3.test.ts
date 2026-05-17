/**
 * Upgrade utility — swap the retired v2 IFC pipeline for the 4-node v3
 * canvas chain (TR-025 → TR-026 → TR-027 → EX-007).
 *
 * Covers:
 *  • workflowUsesDeprecatedV2 correctly detects v2 chains
 *  • upgrade rewires upstream sources to TR-025.brief-in
 *  • upgrade rewires downstream consumers from EX-007.ifc-out
 *  • upgrade chains the 4 v3 nodes internally
 *  • upgrade removes every v2 node + every wholly-internal v2 edge
 *  • upgrade is a no-op for workflows without v2 nodes
 *  • input arrays are never mutated
 */

import { describe, expect, it } from "vitest";

import type { WorkflowNode, WorkflowEdge } from "@/types/nodes";

import {
  V3_BRIEF_ENRICHER_ID,
  V3_AGENT_BUILDER_ID,
  V3_VALIDATOR_ID,
  V3_EXPORT_PREVIEW_ID,
  upgradeWorkflowToV3,
  workflowUsesDeprecatedV2,
} from "../upgrade-v2-to-v3";

function makeNode(
  id: string,
  catalogueId: string,
  position = { x: 0, y: 0 },
): WorkflowNode {
  return {
    id,
    type: "default",
    position,
    data: {
      catalogueId,
      label: catalogueId,
      category: "transform",
      status: "idle",
      inputs: [],
      outputs: [],
      icon: "Square",
    },
  };
}

function makeEdge(
  source: string,
  target: string,
  sourceHandle = "out",
  targetHandle = "in",
): WorkflowEdge {
  return {
    id: `${source}-${target}`,
    source,
    sourceHandle,
    target,
    targetHandle,
  };
}

describe("workflowUsesDeprecatedV2", () => {
  it("returns false on a clean v3 workflow", () => {
    const nodes = [
      makeNode("brief", "IN-009"),
      makeNode("enricher", V3_BRIEF_ENRICHER_ID),
    ];
    expect(workflowUsesDeprecatedV2(nodes)).toBe(false);
  });

  it.each(["TR-024", "TR-022", "EX-006"])("flags %s as deprecated", (id) => {
    const nodes = [makeNode("brief", "IN-001"), makeNode("v2", id)];
    expect(workflowUsesDeprecatedV2(nodes)).toBe(true);
  });
});

describe("upgradeWorkflowToV3", () => {
  it("is a no-op when there are no v2 nodes", () => {
    const nodes = [
      makeNode("brief", "IN-009"),
      makeNode("enricher", V3_BRIEF_ENRICHER_ID),
    ];
    const edges = [makeEdge("brief", "enricher", "brief-out", "brief-in")];
    const result = upgradeWorkflowToV3(nodes, edges);
    expect(result.removedV2NodeIds).toEqual([]);
    expect(result.addedV3NodeIds).toEqual([]);
    expect(result.nodes).toBe(nodes);
    expect(result.edges).toBe(edges);
  });

  it("collapses the full v2 chain (IN→TR-024→TR-022→EX-006→export) into the v3 4-node chain", () => {
    const nodes = [
      makeNode("brief", "IN-001", { x: 0, y: 0 }),
      makeNode("enrich", "TR-024", { x: 100, y: 0 }),
      makeNode("architect", "TR-022", { x: 200, y: 0 }),
      makeNode("sandbox", "EX-006", { x: 300, y: 0 }),
      makeNode("export", "EX-001", { x: 400, y: 0 }),
    ];
    const edges = [
      makeEdge("brief", "enrich", "text-out", "brief-in"),
      makeEdge("enrich", "architect", "enriched-out", "brief-in"),
      makeEdge("architect", "sandbox", "script-out", "script-in"),
      makeEdge("sandbox", "export", "ifc-out", "ifc-in"),
    ];

    const result = upgradeWorkflowToV3(nodes, edges);

    expect(result.removedV2NodeIds.sort()).toEqual(
      ["architect", "enrich", "sandbox"].sort(),
    );
    expect(result.addedV3NodeIds).toHaveLength(4);
    const [enricherId, agentId, validatorId, exportId] = result.addedV3NodeIds;

    // All 4 v3 nodes exist in the result with correct catalogue ids.
    const find = (id: string) => result.nodes.find((n) => n.id === id);
    expect(find(enricherId)?.data.catalogueId).toBe(V3_BRIEF_ENRICHER_ID);
    expect(find(agentId)?.data.catalogueId).toBe(V3_AGENT_BUILDER_ID);
    expect(find(validatorId)?.data.catalogueId).toBe(V3_VALIDATOR_ID);
    expect(find(exportId)?.data.catalogueId).toBe(V3_EXPORT_PREVIEW_ID);

    // Upstream brief source now feeds TR-025.brief-in.
    const upstreamEdge = result.edges.find(
      (e) => e.source === "brief" && e.target === enricherId,
    );
    expect(upstreamEdge).toBeDefined();
    expect(upstreamEdge!.targetHandle).toBe("brief-in");

    // Internal chain edges land in the correct order.
    const internalEdge = (src: string, tgt: string) =>
      result.edges.find((e) => e.source === src && e.target === tgt);
    expect(internalEdge(enricherId, agentId)).toBeDefined();
    expect(internalEdge(enricherId, agentId)?.targetHandle).toBe("spec-in");
    expect(internalEdge(agentId, validatorId)).toBeDefined();
    expect(internalEdge(agentId, validatorId)?.targetHandle).toBe("ifc-in");
    expect(internalEdge(validatorId, exportId)).toBeDefined();
    expect(internalEdge(validatorId, exportId)?.targetHandle).toBe("ifc-in");

    // Downstream consumer is now fed by EX-007.ifc-out.
    const downstreamEdge = result.edges.find(
      (e) => e.source === exportId && e.target === "export",
    );
    expect(downstreamEdge).toBeDefined();
    expect(downstreamEdge!.sourceHandle).toBe("ifc-out");

    // No v2 nodes remain.
    expect(result.nodes.filter((n) => n.id === "enrich")).toHaveLength(0);
    expect(result.nodes.filter((n) => n.id === "architect")).toHaveLength(0);
    expect(result.nodes.filter((n) => n.id === "sandbox")).toHaveLength(0);
    expect(result.nodes.find((n) => n.id === "brief")).toBeDefined();
    expect(result.nodes.find((n) => n.id === "export")).toBeDefined();
  });

  it("handles a v2 chain with no downstream consumer (terminal EX-006)", () => {
    const nodes = [
      makeNode("brief", "IN-001"),
      makeNode("enrich", "TR-024"),
      makeNode("architect", "TR-022"),
      makeNode("sandbox", "EX-006"),
    ];
    const edges = [
      makeEdge("brief", "enrich", "text-out", "brief-in"),
      makeEdge("enrich", "architect", "enriched-out", "brief-in"),
      makeEdge("architect", "sandbox", "script-out", "script-in"),
    ];
    const result = upgradeWorkflowToV3(nodes, edges);
    expect(result.addedV3NodeIds).toHaveLength(4);
    const [enricherId, , , exportId] = result.addedV3NodeIds;
    // One upstream wire into TR-025; nothing leaving EX-007.
    expect(result.edges.filter((e) => e.target === enricherId)).toHaveLength(1);
    expect(
      result.edges.filter((e) => e.source === exportId && e.target !== exportId),
    ).toHaveLength(0);
  });

  it("handles a v2 chain with no upstream source (orphan TR-022)", () => {
    const nodes = [
      makeNode("architect", "TR-022"),
      makeNode("sandbox", "EX-006"),
      makeNode("export", "EX-001"),
    ];
    const edges = [
      makeEdge("architect", "sandbox", "script-out", "script-in"),
      makeEdge("sandbox", "export", "ifc-out", "ifc-in"),
    ];
    const result = upgradeWorkflowToV3(nodes, edges);
    expect(result.addedV3NodeIds).toHaveLength(4);
    const [enricherId, , , exportId] = result.addedV3NodeIds;
    // Nothing upstream of TR-025; one downstream wire from EX-007.
    expect(result.edges.filter((e) => e.target === enricherId)).toHaveLength(0);
    expect(
      result.edges.filter((e) => e.source === exportId && e.target === "export"),
    ).toHaveLength(1);
  });

  it("does not mutate the input arrays", () => {
    const nodes = [
      makeNode("brief", "IN-001"),
      makeNode("v2", "EX-006"),
    ];
    const edges = [makeEdge("brief", "v2", "text-out", "script-in")];
    const originalNodes = [...nodes];
    const originalEdges = [...edges];
    upgradeWorkflowToV3(nodes, edges);
    expect(nodes).toEqual(originalNodes);
    expect(edges).toEqual(originalEdges);
  });
});
