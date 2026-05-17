/**
 * Upgrade utility — swap retired v2 IFC pipeline for a single GN-013 node.
 *
 * Covers:
 *  • workflowUsesDeprecatedV2 correctly detects v2 chains
 *  • upgrade rewires upstream sources to GN-013.brief-in
 *  • upgrade rewires downstream consumers from GN-013.ifc-out
 *  • upgrade removes every v2 node + every wholly-internal v2 edge
 *  • upgrade is a no-op for workflows without v2 nodes
 *  • input arrays are never mutated
 */

import { describe, expect, it } from "vitest";

import type { WorkflowNode, WorkflowEdge } from "@/types/nodes";

import {
  V3_AI_IFC_CATALOGUE_ID,
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
      makeNode("brief", "IN-001"),
      makeNode("ai", V3_AI_IFC_CATALOGUE_ID),
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
      makeNode("brief", "IN-001"),
      makeNode("ai", V3_AI_IFC_CATALOGUE_ID),
    ];
    const edges = [makeEdge("brief", "ai", "text-out", "brief-in")];
    const result = upgradeWorkflowToV3(nodes, edges);
    expect(result.removedV2NodeIds).toEqual([]);
    expect(result.addedV3NodeIds).toEqual([]);
    expect(result.nodes).toBe(nodes);
    expect(result.edges).toBe(edges);
  });

  it("collapses the full v2 chain (IN→TR-024→TR-022→EX-006→export) into one GN-013", () => {
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
    expect(result.addedV3NodeIds).toHaveLength(1);
    const newId = result.addedV3NodeIds[0];

    // Replacement GN-013 node exists in the result.
    const newNode = result.nodes.find((n) => n.id === newId);
    expect(newNode).toBeDefined();
    expect(newNode!.data.catalogueId).toBe(V3_AI_IFC_CATALOGUE_ID);

    // Upstream brief source now feeds GN-013.brief-in.
    const upstreamEdge = result.edges.find(
      (e) => e.source === "brief" && e.target === newId,
    );
    expect(upstreamEdge).toBeDefined();
    expect(upstreamEdge!.targetHandle).toBe("brief-in");

    // Downstream consumer is now fed by GN-013.ifc-out.
    const downstreamEdge = result.edges.find(
      (e) => e.source === newId && e.target === "export",
    );
    expect(downstreamEdge).toBeDefined();
    expect(downstreamEdge!.sourceHandle).toBe("ifc-out");

    // No v2 nodes remain.
    expect(result.nodes.filter((n) => n.id === "enrich")).toHaveLength(0);
    expect(result.nodes.filter((n) => n.id === "architect")).toHaveLength(0);
    expect(result.nodes.filter((n) => n.id === "sandbox")).toHaveLength(0);
    // Surviving non-v2 nodes are preserved.
    expect(result.nodes.find((n) => n.id === "brief")).toBeDefined();
    expect(result.nodes.find((n) => n.id === "export")).toBeDefined();

    // Wholly-internal v2 edges (enrich→architect, architect→sandbox) are gone.
    expect(
      result.edges.filter(
        (e) => ["enrich", "architect", "sandbox"].includes(e.source) ||
              ["enrich", "architect", "sandbox"].includes(e.target),
      ),
    ).toHaveLength(0);
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
    expect(result.addedV3NodeIds).toHaveLength(1);
    // One upstream wire, zero downstream wires.
    const newId = result.addedV3NodeIds[0];
    expect(result.edges.filter((e) => e.target === newId)).toHaveLength(1);
    expect(result.edges.filter((e) => e.source === newId)).toHaveLength(0);
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
    expect(result.addedV3NodeIds).toHaveLength(1);
    const newId = result.addedV3NodeIds[0];
    expect(result.edges.filter((e) => e.target === newId)).toHaveLength(0);
    expect(result.edges.filter((e) => e.source === newId)).toHaveLength(1);
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
