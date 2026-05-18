/**
 * Beta 3 migration script tests.
 */

import { describe, it, expect } from "vitest";
import { isBriefToIfcV3Pipeline, isAlreadyMigrated, buildBeta3Graph } from "../migrate-add-beta3-nodes-to-workflows";

function make11NodeGraph() {
  return {
    nodes: [
      { id: "n1", type: "workflowNode", position: { x: 100, y: 300 }, data: { catalogueId: "IN-009", label: "Brief", category: "input", status: "idle", inputs: [], outputs: [], icon: "FileText", briefText: "Test brief" } },
      { id: "n2", type: "workflowNode", position: { x: 400, y: 300 }, data: { catalogueId: "TR-025", label: "Enricher", category: "transform", status: "idle", inputs: [], outputs: [], icon: "Wand2" } },
      { id: "n3", type: "workflowNode", position: { x: 680, y: 300 }, data: { catalogueId: "TR-029", label: "Reasoner", category: "transform", status: "idle", inputs: [], outputs: [], icon: "Compass" } },
      { id: "n4a", type: "workflowNode", position: { x: 960, y: 160 }, data: { catalogueId: "TR-028", label: "Decomposer", category: "transform", status: "idle", inputs: [], outputs: [], icon: "Wand2" } },
      { id: "n4b", type: "workflowNode", position: { x: 960, y: 300 }, data: { catalogueId: "TR-030", label: "Trim", category: "transform", status: "idle", inputs: [], outputs: [], icon: "Wrench" } },
      { id: "n4c", type: "workflowNode", position: { x: 960, y: 440 }, data: { catalogueId: "TR-031", label: "Material", category: "transform", status: "idle", inputs: [], outputs: [], icon: "Palette" } },
      { id: "n5", type: "workflowNode", position: { x: 1240, y: 300 }, data: { catalogueId: "TR-034", label: "Validator", category: "transform", status: "idle", inputs: [], outputs: [], icon: "ShieldCheck" } },
      { id: "n6", type: "workflowNode", position: { x: 1520, y: 300 }, data: { catalogueId: "TR-026", label: "Builder", category: "transform", status: "idle", inputs: [], outputs: [], icon: "Bot" } },
      { id: "n7", type: "workflowNode", position: { x: 1800, y: 300 }, data: { catalogueId: "TR-027", label: "GeoVal", category: "transform", status: "idle", inputs: [], outputs: [], icon: "ShieldCheck" } },
      { id: "n8", type: "workflowNode", position: { x: 2080, y: 300 }, data: { catalogueId: "TR-032", label: "Vision", category: "transform", status: "idle", inputs: [], outputs: [], icon: "Eye" } },
      { id: "n9", type: "workflowNode", position: { x: 2360, y: 300 }, data: { catalogueId: "EX-007", label: "Export", category: "export", status: "idle", inputs: [], outputs: [], icon: "FileBox" } },
    ],
    edges: [],
  };
}

function make13NodeGraph() {
  const g = buildBeta3Graph(make11NodeGraph());
  return g;
}

describe("Beta 3 migration", () => {
  it("identifies v3 pipeline", () => {
    expect(isBriefToIfcV3Pipeline(make11NodeGraph())).toBe(true);
  });

  it("11-node → 13-node migration", () => {
    const target = buildBeta3Graph(make11NodeGraph());
    expect(target.nodes).toHaveLength(13);
    expect(target.edges).toHaveLength(14);
    const ids = new Set(target.nodes.map(n => n.data.catalogueId));
    expect(ids.has("TR-035")).toBe(true);
    expect(ids.has("TR-033")).toBe(true);
    // Brief text preserved
    const in009 = target.nodes.find(n => n.data.catalogueId === "IN-009")!;
    expect(in009.data.briefText).toBe("Test brief");
  });

  it("already-13-node → skip (idempotent)", () => {
    expect(isAlreadyMigrated(make13NodeGraph())).toBe(true);
    expect(isAlreadyMigrated(make11NodeGraph())).toBe(false);
  });

  it("corrupt graph throws", () => {
    expect(() => buildBeta3Graph({ nodes: null as unknown as [], edges: [] })).toThrow(/invalid graph/);
  });
});
