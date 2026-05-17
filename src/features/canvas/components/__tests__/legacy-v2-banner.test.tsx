/**
 * LegacyV2Banner — render + interaction.
 * @vitest-environment happy-dom
 *
 * Covers:
 *  • renders when the workflow has v2 nodes
 *  • does NOT render for a clean v3 workflow
 *  • clicking "Upgrade" invokes onApplyUpgrade with the new graph
 *  • clicking "Dismiss" hides the banner for this workflow id
 *  • the dismissed flag persists in localStorage
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import type { WorkflowEdge, WorkflowNode } from "@/types/nodes";

import { LegacyV2Banner } from "../LegacyV2Banner";

function v2Workflow(): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const nodes: WorkflowNode[] = [
    {
      id: "brief",
      type: "default",
      position: { x: 0, y: 0 },
      data: {
        catalogueId: "IN-001",
        label: "Brief",
        category: "input",
        status: "idle",
        inputs: [],
        outputs: [],
        icon: "Type",
      },
    },
    {
      id: "v2",
      type: "default",
      position: { x: 100, y: 0 },
      data: {
        catalogueId: "EX-006",
        label: "v2 IFC",
        category: "export",
        status: "idle",
        inputs: [],
        outputs: [],
        icon: "Boxes",
      },
    },
  ];
  const edges: WorkflowEdge[] = [
    {
      id: "brief-v2",
      source: "brief",
      sourceHandle: "text-out",
      target: "v2",
      targetHandle: "script-in",
    },
  ];
  return { nodes, edges };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("LegacyV2Banner", () => {
  it("renders when the workflow uses a deprecated v2 node", () => {
    const { nodes, edges } = v2Workflow();
    render(
      <LegacyV2Banner
        workflowId="wf-1"
        nodes={nodes}
        edges={edges}
        onApplyUpgrade={() => {}}
      />,
    );
    expect(screen.queryByTestId("legacy-v2-banner")).toBeTruthy();
    expect(screen.queryByTestId("legacy-v2-upgrade")).toBeTruthy();
    // "Open form instead" CTA removed in Canvas Unification (2026-05-17) —
    // the form was deleted; Upgrade is the only primary action.
    expect(screen.queryByTestId("legacy-v2-open-form")).toBeNull();
  });

  it("does NOT render when the workflow has no v2 nodes", () => {
    const { container } = render(
      <LegacyV2Banner
        workflowId="wf-clean"
        nodes={[
          {
            id: "v3",
            type: "default",
            position: { x: 0, y: 0 },
            data: {
              catalogueId: "TR-026",
              label: "IFC Agent Builder",
              category: "transform",
              status: "idle",
              inputs: [],
              outputs: [],
              icon: "Bot",
            },
          },
        ]}
        edges={[]}
        onApplyUpgrade={() => {}}
      />,
    );
    expect(container.querySelector("[data-testid='legacy-v2-banner']")).toBeNull();
  });

  it("invokes onApplyUpgrade with the upgraded graph when clicked", () => {
    const { nodes, edges } = v2Workflow();
    const onApply = vi.fn();
    render(
      <LegacyV2Banner
        workflowId="wf-2"
        nodes={nodes}
        edges={edges}
        onApplyUpgrade={onApply}
      />,
    );
    fireEvent.click(screen.getByTestId("legacy-v2-upgrade"));
    expect(onApply).toHaveBeenCalledTimes(1);
    const upgraded = onApply.mock.calls[0][0] as {
      nodes: WorkflowNode[];
      edges: WorkflowEdge[];
    };
    expect(upgraded.nodes.find((n) => n.id === "v2")).toBeUndefined();
    // The v3 chain replaces the single v2 node with 4 transparent nodes.
    expect(
      upgraded.nodes.find((n) => n.data.catalogueId === "TR-025"),
    ).toBeDefined();
    expect(
      upgraded.nodes.find((n) => n.data.catalogueId === "TR-026"),
    ).toBeDefined();
    expect(
      upgraded.nodes.find((n) => n.data.catalogueId === "TR-027"),
    ).toBeDefined();
    expect(
      upgraded.nodes.find((n) => n.data.catalogueId === "EX-007"),
    ).toBeDefined();
  });

  it("hides for this workflow on Dismiss and persists in localStorage", () => {
    const { nodes, edges } = v2Workflow();
    const onApply = vi.fn();
    const { rerender, container } = render(
      <LegacyV2Banner
        workflowId="wf-dismiss"
        nodes={nodes}
        edges={edges}
        onApplyUpgrade={onApply}
      />,
    );
    fireEvent.click(screen.getByTestId("legacy-v2-dismiss"));
    expect(container.querySelector("[data-testid='legacy-v2-banner']")).toBeNull();

    // localStorage carries the dismissed flag
    const stored = JSON.parse(
      window.localStorage.getItem("bf:legacy-v2-banner:dismissed") || "{}",
    );
    expect(stored["wf-dismiss"]).toBe(true);

    // A re-render with the same workflowId starts with the banner hidden.
    rerender(
      <LegacyV2Banner
        workflowId="wf-dismiss"
        nodes={nodes}
        edges={edges}
        onApplyUpgrade={onApply}
      />,
    );
    expect(container.querySelector("[data-testid='legacy-v2-banner']")).toBeNull();
  });
});
