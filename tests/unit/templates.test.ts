import { describe, it, expect } from "vitest";
import { PREBUILT_WORKFLOWS } from "@/constants/prebuilt-workflows";
import { NODE_CATALOGUE } from "@/constants/node-catalogue";

const VALID_NODE_IDS = new Set(NODE_CATALOGUE.map((n) => n.id));

describe("Template Workflows — Validation", () => {
  it("should have at least 1 template defined", () => {
    expect(PREBUILT_WORKFLOWS.length).toBeGreaterThan(0);
  });

  for (const template of PREBUILT_WORKFLOWS) {
    describe(`Template: ${template.name} (${template.id})`, () => {
      it("should have required metadata", () => {
        expect(template.id).toBeTruthy();
        expect(template.name).toBeTruthy();
        expect(template.name.length).toBeGreaterThan(0);
        expect(template.description).toBeTruthy();
        expect(template.description.length).toBeGreaterThan(0);
        expect(template.category).toBeTruthy();
      });

      it("should have at least 2 nodes", () => {
        expect(template.tileGraph.nodes.length).toBeGreaterThanOrEqual(2);
      });

      it("should have at least 1 edge", () => {
        expect(template.tileGraph.edges.length).toBeGreaterThanOrEqual(1);
      });

      it("should reference only valid catalogue node IDs", () => {
        const invalidNodes: string[] = [];
        for (const node of template.tileGraph.nodes) {
          if (!VALID_NODE_IDS.has(node.data.catalogueId)) {
            invalidNodes.push(`${node.id} (${node.data.catalogueId})`);
          }
        }
        expect(invalidNodes).toEqual([]);
      });

      it("should have edges connecting valid node IDs within the template", () => {
        const nodeIds = new Set(template.tileGraph.nodes.map((n) => n.id));
        const brokenEdges: string[] = [];
        for (const edge of template.tileGraph.edges) {
          if (!nodeIds.has(edge.source)) {
            brokenEdges.push(`${edge.id}: source "${edge.source}" not found`);
          }
          if (!nodeIds.has(edge.target)) {
            brokenEdges.push(`${edge.id}: target "${edge.target}" not found`);
          }
        }
        expect(brokenEdges).toEqual([]);
      });

      it("should have unique node IDs within the template", () => {
        const ids = template.tileGraph.nodes.map((n) => n.id);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(ids.length);
      });

      it("should have each node with a label and category", () => {
        for (const node of template.tileGraph.nodes) {
          expect(node.data.label).toBeTruthy();
          expect(node.data.category).toBeTruthy();
        }
      });
    });
  }
});
