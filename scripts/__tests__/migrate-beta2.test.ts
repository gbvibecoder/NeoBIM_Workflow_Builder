/**
 * Tests for the Beta 2 workflow migration script.
 */

import { describe, it, expect } from "vitest";
import {
  isBriefToIfcV3Pipeline,
  isAlreadyMigrated,
  buildTargetGraph,
} from "../migrate-add-beta2-nodes-to-workflows";

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** Post-alpha 6-node topology: IN-009 → TR-025 → TR-028 → TR-026 → TR-027 → EX-007 */
function makeSixNodeGraph() {
  return {
    nodes: [
      { id: "n1", type: "workflowNode", position: { x: 100, y: 300 }, data: { catalogueId: "IN-009", label: "Brief", category: "input", status: "idle", inputs: [], outputs: [{ id: "brief-out", label: "Brief Text", type: "text" }], icon: "FileText", briefText: "Design a modern 3BHK apartment" } },
      { id: "n2", type: "workflowNode", position: { x: 400, y: 300 }, data: { catalogueId: "TR-025", label: "Brief Enricher", category: "transform", status: "idle", inputs: [{ id: "brief-in", label: "Brief Text", type: "text" }], outputs: [{ id: "spec-out", label: "BriefSpec", type: "json" }], icon: "Wand2" } },
      { id: "n3", type: "workflowNode", position: { x: 680, y: 300 }, data: { catalogueId: "TR-028", label: "Item Decomposer", category: "transform", status: "idle", inputs: [{ id: "spec-in", label: "BriefSpec", type: "json" }], outputs: [{ id: "spec-out", label: "BriefSpec", type: "json" }], icon: "Wand2" } },
      { id: "n4", type: "workflowNode", position: { x: 960, y: 300 }, data: { catalogueId: "TR-026", label: "IFC Agent Builder", category: "transform", status: "idle", inputs: [{ id: "spec-in", label: "BriefSpec", type: "json" }], outputs: [{ id: "ifc-out", label: "IFC", type: "ifc" }], icon: "Bot" } },
      { id: "n5", type: "workflowNode", position: { x: 1240, y: 300 }, data: { catalogueId: "TR-027", label: "Geometric Validator", category: "transform", status: "idle", inputs: [{ id: "ifc-in", label: "IFC", type: "ifc" }], outputs: [{ id: "ifc-out", label: "IFC", type: "ifc" }], icon: "ShieldCheck" } },
      { id: "n6", type: "workflowNode", position: { x: 1520, y: 300 }, data: { catalogueId: "EX-007", label: "IFC Export", category: "export", status: "idle", inputs: [{ id: "ifc-in", label: "IFC", type: "ifc" }], outputs: [{ id: "ifc-out", label: "IFC", type: "ifc" }], icon: "FileBox" } },
    ],
    edges: [
      { id: "e1", source: "n1", sourceHandle: "brief-out", target: "n2", targetHandle: "brief-in", type: "animatedEdge" },
      { id: "e2", source: "n2", sourceHandle: "spec-out", target: "n3", targetHandle: "spec-in", type: "animatedEdge" },
      { id: "e3", source: "n3", sourceHandle: "spec-out", target: "n4", targetHandle: "spec-in", type: "animatedEdge" },
      { id: "e4", source: "n4", sourceHandle: "ifc-out", target: "n5", targetHandle: "ifc-in", type: "animatedEdge" },
      { id: "e5", source: "n5", sourceHandle: "ifc-out", target: "n6", targetHandle: "ifc-in", type: "animatedEdge" },
    ],
  };
}

/** Already-migrated 11-node Beta 2 topology */
function makeElevenNodeGraph() {
  return {
    nodes: [
      { id: "n1", type: "workflowNode", position: { x: 100, y: 300 }, data: { catalogueId: "IN-009", label: "Brief", category: "input", status: "idle", inputs: [], outputs: [{ id: "brief-out", label: "Brief Text", type: "text" }], icon: "FileText" } },
      { id: "n2", type: "workflowNode", position: { x: 400, y: 300 }, data: { catalogueId: "TR-025", label: "Brief Enricher", category: "transform", status: "idle", inputs: [{ id: "brief-in", label: "Brief Text", type: "text" }], outputs: [{ id: "spec-out", label: "BriefSpec", type: "json" }], icon: "Wand2" } },
      { id: "n3", type: "workflowNode", position: { x: 680, y: 300 }, data: { catalogueId: "TR-029", label: "Architectural Reasoner", category: "transform", status: "idle", inputs: [{ id: "spec-in", label: "BriefSpec", type: "json" }], outputs: [{ id: "spec-out", label: "BriefSpec", type: "json" }], icon: "Compass" } },
      { id: "n4a", type: "workflowNode", position: { x: 960, y: 160 }, data: { catalogueId: "TR-028", label: "Item Decomposer", category: "transform", status: "idle", inputs: [{ id: "spec-in", label: "BriefSpec", type: "json" }], outputs: [{ id: "spec-out", label: "BriefSpec", type: "json" }], icon: "Wand2" } },
      { id: "n4b", type: "workflowNode", position: { x: 960, y: 300 }, data: { catalogueId: "TR-030", label: "Trim Specifier", category: "transform", status: "idle", inputs: [{ id: "spec-in", label: "BriefSpec", type: "json" }], outputs: [{ id: "spec-out", label: "BriefSpec", type: "json" }], icon: "Wrench" } },
      { id: "n4c", type: "workflowNode", position: { x: 960, y: 440 }, data: { catalogueId: "TR-031", label: "Material Resolver", category: "transform", status: "idle", inputs: [{ id: "spec-in", label: "BriefSpec", type: "json" }], outputs: [{ id: "spec-out", label: "BriefSpec", type: "json" }], icon: "Palette" } },
      { id: "n5", type: "workflowNode", position: { x: 1240, y: 300 }, data: { catalogueId: "TR-034", label: "Spec Validator", category: "transform", status: "idle", inputs: [{ id: "spec-in", label: "BriefSpec", type: "json" }], outputs: [{ id: "spec-out", label: "BriefSpec", type: "json" }], icon: "ShieldCheck" } },
      { id: "n6", type: "workflowNode", position: { x: 1520, y: 300 }, data: { catalogueId: "TR-026", label: "IFC Agent Builder", category: "transform", status: "idle", inputs: [{ id: "spec-in", label: "BriefSpec", type: "json" }], outputs: [{ id: "ifc-out", label: "IFC", type: "ifc" }], icon: "Bot" } },
      { id: "n7", type: "workflowNode", position: { x: 1800, y: 300 }, data: { catalogueId: "TR-027", label: "Geometric Validator", category: "transform", status: "idle", inputs: [{ id: "ifc-in", label: "IFC", type: "ifc" }], outputs: [{ id: "ifc-out", label: "IFC", type: "ifc" }], icon: "ShieldCheck" } },
      { id: "n8", type: "workflowNode", position: { x: 2080, y: 300 }, data: { catalogueId: "TR-032", label: "Vision Inspector", category: "transform", status: "idle", inputs: [{ id: "ifc-in", label: "IFC", type: "ifc" }], outputs: [{ id: "ifc-out", label: "IFC", type: "ifc" }], icon: "Eye" } },
      { id: "n9", type: "workflowNode", position: { x: 2360, y: 300 }, data: { catalogueId: "EX-007", label: "IFC Export", category: "export", status: "idle", inputs: [{ id: "ifc-in", label: "IFC", type: "ifc" }], outputs: [{ id: "ifc-out", label: "IFC", type: "ifc" }], icon: "FileBox" } },
    ],
    edges: [
      { id: "e1-2", source: "n1", sourceHandle: "brief-out", target: "n2", targetHandle: "brief-in", type: "animatedEdge" },
      { id: "e2-3", source: "n2", sourceHandle: "spec-out", target: "n3", targetHandle: "spec-in", type: "animatedEdge" },
      { id: "e3-4a", source: "n3", sourceHandle: "spec-out", target: "n4a", targetHandle: "spec-in", type: "animatedEdge" },
      { id: "e3-4b", source: "n3", sourceHandle: "spec-out", target: "n4b", targetHandle: "spec-in", type: "animatedEdge" },
      { id: "e3-4c", source: "n3", sourceHandle: "spec-out", target: "n4c", targetHandle: "spec-in", type: "animatedEdge" },
      { id: "e4a-5", source: "n4a", sourceHandle: "spec-out", target: "n5", targetHandle: "spec-in", type: "animatedEdge" },
      { id: "e4b-5", source: "n4b", sourceHandle: "spec-out", target: "n5", targetHandle: "spec-in", type: "animatedEdge" },
      { id: "e4c-5", source: "n4c", sourceHandle: "spec-out", target: "n5", targetHandle: "spec-in", type: "animatedEdge" },
      { id: "e5-6", source: "n5", sourceHandle: "spec-out", target: "n6", targetHandle: "spec-in", type: "animatedEdge" },
      { id: "e6-7", source: "n6", sourceHandle: "ifc-out", target: "n7", targetHandle: "ifc-in", type: "animatedEdge" },
      { id: "e7-8", source: "n7", sourceHandle: "ifc-out", target: "n8", targetHandle: "ifc-in", type: "animatedEdge" },
      { id: "e8-9", source: "n8", sourceHandle: "ifc-out", target: "n9", targetHandle: "ifc-in", type: "animatedEdge" },
    ],
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Beta 2 migration — detection", () => {
  it("identifies a brief-to-ifc v3 pipeline", () => {
    expect(isBriefToIfcV3Pipeline(makeSixNodeGraph())).toBe(true);
    // Non-v3 pipeline (no IN-009)
    const nonV3 = { nodes: [{ id: "n1", type: "workflowNode", position: { x: 0, y: 0 }, data: { catalogueId: "IN-001", label: "Text", category: "input", status: "idle", inputs: [], outputs: [], icon: "Type" } }], edges: [] };
    expect(isBriefToIfcV3Pipeline(nonV3)).toBe(false);
  });

  it("detects already-migrated 11-node workflow as up-to-date", () => {
    expect(isAlreadyMigrated(makeElevenNodeGraph())).toBe(true);
    expect(isAlreadyMigrated(makeSixNodeGraph())).toBe(false);
  });
});

describe("Beta 2 migration — graph transform", () => {
  it("transforms 6-node post-alpha workflow to 11-node target topology", () => {
    const source = makeSixNodeGraph();
    const target = buildTargetGraph(source);

    // Should have 11 nodes
    expect(target.nodes).toHaveLength(11);

    // Should have 12 edges (matching prebuilt-workflows.ts)
    expect(target.edges).toHaveLength(12);

    // All Beta 2 catalogue IDs present
    const catalogueIds = new Set(target.nodes.map(n => n.data.catalogueId));
    expect(catalogueIds.has("TR-029")).toBe(true);
    expect(catalogueIds.has("TR-030")).toBe(true);
    expect(catalogueIds.has("TR-031")).toBe(true);
    expect(catalogueIds.has("TR-032")).toBe(true);
    expect(catalogueIds.has("TR-034")).toBe(true);

    // Original nodes still present
    expect(catalogueIds.has("IN-009")).toBe(true);
    expect(catalogueIds.has("TR-025")).toBe(true);
    expect(catalogueIds.has("TR-028")).toBe(true);
    expect(catalogueIds.has("TR-026")).toBe(true);
    expect(catalogueIds.has("TR-027")).toBe(true);
    expect(catalogueIds.has("EX-007")).toBe(true);

    // User's brief text preserved
    const in009 = target.nodes.find(n => n.data.catalogueId === "IN-009")!;
    expect(in009.data.briefText).toBe("Design a modern 3BHK apartment");

    // Parallel branch fan-out edges exist (TR-029 → TR-028, TR-030, TR-031)
    const fanOutSources = target.edges.filter(e => e.source === "n3").map(e => e.target);
    expect(fanOutSources.sort()).toEqual(["n4a", "n4b", "n4c"]);

    // Fan-in edges exist (TR-028, TR-030, TR-031 → TR-034)
    const fanInTargets = target.edges.filter(e => e.target === "n5").map(e => e.source);
    expect(fanInTargets.sort()).toEqual(["n4a", "n4b", "n4c"]);
  });

  it("throws on corrupt graph with null nodes (isBriefToIfcV3Pipeline)", () => {
    const corrupt = { nodes: null, edges: [] } as unknown as Parameters<typeof isBriefToIfcV3Pipeline>[0];
    expect(() => isBriefToIfcV3Pipeline(corrupt)).toThrow();
  });

  it("throws on corrupt graph with null nodes (buildTargetGraph)", () => {
    const corrupt = { nodes: null, edges: [] } as unknown as Parameters<typeof buildTargetGraph>[0];
    expect(() => buildTargetGraph(corrupt)).toThrow(/invalid graph/);
  });
});
