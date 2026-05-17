// Node type system for BuildFlow Workflow Builder

export type NodeCategory = "input" | "transform" | "generate" | "export";

export type PortType =
  | "text"
  | "json"
  | "pdf"
  | "image"
  | "geometry"
  | "ifc"
  | "csv"
  | "geojson"
  | "binary"
  | "any";

export type NodeStatus = "idle" | "running" | "success" | "error";

export interface NodePort {
  id: string;
  label: string;
  type: PortType;
}

export interface NodeCatalogueItem {
  id: string;            // e.g. "IN-001"
  name: string;          // e.g. "Text Prompt"
  description: string;
  category: NodeCategory;
  icon: string;          // Lucide icon name
  inputs: NodePort[];
  outputs: NodePort[];
  apiEngine: string;
  tags: string[];
  executionTime?: string; // e.g. "< 2s", "< 30s"
  viewType?: string;     // default view type for image generation nodes
  isLive?: boolean;      // true if node has real API implementation (not mock)
  // Deprecation surface — added 2026-05-17 for v2 IFC pipeline retirement.
  // Deprecated nodes stay in the catalogue (so workflows in the DB that
  // reference them still parse + load), but `hiddenFromPicker` removes
  // them from the node-library picker, and the canvas shows a banner
  // with an "Upgrade workflow" button per `replacedBy`.
  deprecated?: boolean;
  hiddenFromPicker?: boolean;
  replacedBy?: string;      // catalogueId of the replacement node, e.g. "TR-025"
  deprecationNote?: string; // human-readable note shown in tooltips / banner
}

export interface WorkflowNode {
  id: string;
  type: string;          // React Flow node type
  position: { x: number; y: number };
  data: WorkflowNodeData;
}

export interface WorkflowNodeData extends Record<string, unknown> {
  catalogueId: string;   // e.g. "IN-001"
  label: string;
  category: NodeCategory;
  status: NodeStatus;
  inputs: NodePort[];
  outputs: NodePort[];
  icon: string;
  executionTime?: string; // e.g. "< 2s"
  artifactId?: string;   // ID of artifact produced during execution
  inputValue?: string;   // User-editable value for IN-001 (text) and IN-004 (file path)
}

export interface WorkflowEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
  type?: string;
  animated?: boolean;
  data?: {
    sourceColor?: string;
    targetColor?: string;
    isFlowing?: boolean;
    [key: string]: unknown;
  };
}
