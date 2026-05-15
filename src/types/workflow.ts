import type { WorkflowNode, WorkflowEdge } from "./nodes";

export type CreationMode = "manual" | "prompt" | "hybrid";
export type WorkflowComplexity = "simple" | "intermediate" | "advanced";

export interface TileGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface Workflow {
  id: string;
  ownerId: string;
  name: string;
  description?: string;
  tags: string[];
  tileGraph: TileGraph;
  version: number;
  isPublished: boolean;
  isTemplate: boolean;
  thumbnail?: string;
  category?: string;
  complexity: WorkflowComplexity;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  tags: string[];
  category: string;
  complexity: WorkflowComplexity;
  tileGraph: TileGraph;
  thumbnail?: string;
  estimatedRunTime?: string;
  requiredInputs: string[];
  expectedOutputs: string[];
  /** Plan tier required to use this template. Optional — undefined or
   *  "FREE" means accessible to every signed-in user. Compared against the
   *  user's role via canAccessTemplate() — see
   *  src/features/billing/lib/template-access.ts. */
  requiredTier?: "FREE" | "MINI" | "STARTER" | "PRO" | "TEAM";
  /** Execution model. Default (undefined) is the synchronous canvas
   *  node-loop. `"queued"` routes the workflow through the async
   *  QStash-backed pipeline instead — see useExecution.ts's wf-13 branch
   *  and src/features/ifc/services/brief-to-ifc-v2/. */
  executionMode?: "sync" | "queued";
}

export interface CommunityPublication {
  id: string;
  workflowId: string;
  authorId: string;
  authorName: string;
  authorImage?: string;
  title: string;
  description: string;
  tags: string[];
  thumbnailUri?: string;
  ratingAvg: number;
  cloneCount: number;
  version: number;
  isFeatured: boolean;
  createdAt: Date;
  updatedAt: Date;
}
