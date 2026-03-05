"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { useWorkflowStore } from "@/stores/workflow-store";
import { useExecutionStore } from "@/stores/execution-store";
import { executeNode as mockExecuteNode } from "@/services/mock-executor";
import { generateId } from "@/lib/utils";
import type { Execution, ExecutionArtifact } from "@/types/execution";
import type { WorkflowNode } from "@/types/nodes";
import type { LogEntry } from "@/components/canvas/ExecutionLog";

// Node IDs that have real API implementations
const REAL_NODE_IDS = new Set(["TR-003", "GN-003", "IN-004", "TR-007", "TR-008", "EX-002"]);

interface APIErrorResponse {
  error: {
    title: string;
    message: string;
    code: string;
    action?: string;
    actionUrl?: string;
  };
  details?: string;
}

// Input node IDs whose user-supplied value should pass through directly
const INPUT_NODE_IDS = new Set(["IN-001", "IN-005", "IN-006"]);

// Route execution to real API or mock
async function executeNode(
  node: WorkflowNode,
  executionId: string,
  previousArtifact?: ExecutionArtifact | null,
  useRealExecution = false
): Promise<ExecutionArtifact> {
  const { catalogueId, inputValue } = node.data as { catalogueId: string; inputValue?: string };

  // For input nodes, pass through the user's actual typed/selected value
  // instead of using the mock executor (which returns hardcoded placeholder text)
  if (INPUT_NODE_IDS.has(catalogueId)) {
    await new Promise(r => setTimeout(r, 400)); // brief delay for UX
    return {
      id: generateId(),
      executionId,
      tileInstanceId: node.id,
      type: "text",
      data: {
        content: inputValue ?? "",
        prompt: inputValue ?? "",
        label: "User Input",
      },
      metadata: { source: "user-input" },
      createdAt: new Date(),
    };
  }

  if (useRealExecution && REAL_NODE_IDS.has(catalogueId)) {
    const res = await fetch("/api/execute-node", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        catalogueId,
        executionId,
        tileInstanceId: node.id,
        inputData: previousArtifact?.data ?? { prompt: inputValue ?? "" },
      }),
    });

    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ 
        error: { 
          title: "Request failed", 
          message: "Unable to complete request",
          code: "UNKNOWN"
        }
      })) as APIErrorResponse;
      
      // Extract user-friendly error info
      const error = errorData.error;
      
      // Special handling for 429 Rate Limit errors
      if (res.status === 429) {
        const rateLimitError = new Error(error.message);
        (rateLimitError as any).status = 429;
        (rateLimitError as any).title = error.title;
        (rateLimitError as any).action = error.action;
        (rateLimitError as any).actionUrl = error.actionUrl;
        throw rateLimitError;
      }
      
      // Throw error with user-friendly message
      const err = new Error(error.message);
      (err as any).title = error.title;
      (err as any).code = error.code;
      (err as any).action = error.action;
      (err as any).actionUrl = error.actionUrl;
      throw err;
    }

    const { artifact } = await res.json() as { artifact: ExecutionArtifact };
    return { ...artifact, createdAt: new Date() };
  }

  // Fall back to mock — pass upstream data so mocks can reflect user input
  return mockExecuteNode(
    catalogueId,
    executionId,
    node.id,
    (previousArtifact?.data ?? {}) as Record<string, unknown>
  );
}

const FLOW_DURATION_MS = 1600;

interface UseExecutionOptions {
  onLog?: (entry: LogEntry) => void;
}

interface RateLimitInfo {
  title: string;
  message: string;
  action?: string;
  actionUrl?: string;
}

export function useExecution({ onLog }: UseExecutionOptions = {}) {
  const { nodes, currentWorkflow, updateNodeStatus, setEdgeFlowing } = useWorkflowStore();
  const {
    startExecution,
    addTileResult,
    addArtifact,
    completeExecution,
    setProgress,
    isExecuting,
  } = useExecutionStore();
  
  const [rateLimitHit, setRateLimitHit] = useState<RateLimitInfo | null>(null);

  const log = useCallback((type: LogEntry["type"], message: string, detail?: string) => {
    onLog?.({ timestamp: new Date(), type, message, detail });
  }, [onLog]);

  const runWorkflow = useCallback(async () => {
    if (isExecuting) return;
    if (nodes.length === 0) {
      toast.error("Add some nodes to the canvas first");
      return;
    }

    const executionId = generateId();
    const execution: Execution = {
      id: executionId,
      workflowId: currentWorkflow?.id ?? "unsaved",
      userId: "demo",
      status: "running",
      startedAt: new Date(),
      tileResults: [],
      createdAt: new Date(),
    };

    startExecution(execution);
    log("start", "Workflow execution started", `${nodes.length} nodes queued`);

    // Determine if we should use real execution (OPENAI_API_KEY configured)
    const useReal = process.env.NEXT_PUBLIC_ENABLE_MOCK_EXECUTION !== "true";

    toast.success("Workflow running…", { duration: 2000 });

    // Persist execution to DB if workflow is saved
    let dbExecutionId: string | null = null;
    const workflowId = currentWorkflow?.id;
    if (workflowId && workflowId !== "unsaved") {
      try {
        const res = await fetch("/api/executions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workflowId, triggerType: "manual" }),
        });
        if (res.ok) {
          const { execution: dbEx } = await res.json() as { execution: { id: string } };
          dbExecutionId = dbEx.id;
          log("info", "Execution record created", dbExecutionId);
        }
      } catch {
        // Non-fatal — DB save is best-effort
      }
    }

    // Left-to-right topological order based on x position
    const orderedNodes = [...nodes].sort((a, b) => a.position.x - b.position.x);

    let hasError = false;
    let previousArtifact: ExecutionArtifact | null = null;

    for (let i = 0; i < orderedNodes.length; i++) {
      const node = orderedNodes[i] as WorkflowNode;
      setProgress(Math.round((i / orderedNodes.length) * 100));

      updateNodeStatus(node.id, "running");
      log("running", `Running: ${node.data.label}`, node.data.catalogueId);

      try {
        const artifact = await executeNode(node, executionId, previousArtifact, useReal);
        previousArtifact = artifact;

        addArtifact(node.id, artifact);
        addTileResult({
          tileInstanceId: node.id,
          catalogueId: node.data.catalogueId,
          status: "success",
          startedAt: new Date(),
          completedAt: new Date(),
          artifact,
        });

        updateNodeStatus(node.id, "success");
        log("success", `${node.data.label} completed`, String(artifact.type));

        // Show warnings if any
        if (artifact.metadata?.warnings && Array.isArray(artifact.metadata.warnings)) {
          for (const warning of artifact.metadata.warnings) {
            toast.warning(warning, { duration: 4000 });
            // log("warning", warning); // Skipped - not a standard log type
          }
        }

        // Persist artifact to DB (stored in tileResults JSON on the Execution)
        if (dbExecutionId) {
          fetch(`/api/executions/${dbExecutionId}/artifacts`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              nodeId: node.id,
              nodeLabel: node.data.label,
              type: artifact.type,
              title: String(artifact.type),
              data: artifact.data,
            }),
          }).catch(() => {/* best-effort */});
        }

        // Animate outgoing edges as data flows to the next node
        setEdgeFlowing(node.id, true);
        setTimeout(() => setEdgeFlowing(node.id, false), FLOW_DURATION_MS);

      } catch (error) {
        hasError = true;
        updateNodeStatus(node.id, "error");
        
        const errTitle = (error as any).title || "Error";
        const errMsg = error instanceof Error ? error.message : "Unknown error";
        const errAction = (error as any).action;
        const errActionUrl = (error as any).actionUrl;
        
        // Check if this is a rate limit error
        if ((error as any).status === 429) {
          log("error", "Rate limit exceeded", errMsg);
          
          // Set rate limit info to trigger modal
          setRateLimitHit({
            title: errTitle,
            message: errMsg,
            action: errAction,
            actionUrl: errActionUrl,
          });
        } else {
          log("error", `${node.data.label} failed`, errMsg);
          
          // Show user-friendly error toast
          toast.error(errTitle, {
            description: errMsg,
            duration: 6000,
            action: errAction && errActionUrl ? {
              label: errAction,
              onClick: () => window.location.href = errActionUrl,
            } : undefined,
          });
        }
        
        addTileResult({
          tileInstanceId: node.id,
          catalogueId: node.data.catalogueId,
          status: "error",
          startedAt: new Date(),
          completedAt: new Date(),
          errorMessage: errMsg,
        });
        
        break;
      }
    }

    setProgress(100);
    completeExecution(hasError ? "partial" : "success");
    log(hasError ? "error" : "success",
      hasError ? "Workflow completed with errors" : "Workflow completed successfully",
      `${orderedNodes.length} nodes executed`
    );

    // Update DB execution status
    if (dbExecutionId) {
      fetch(`/api/executions/${dbExecutionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: hasError ? "PARTIAL" : "SUCCESS" }),
      }).catch(() => {/* best-effort */});
    }

    if (!hasError) {
      toast.success("Workflow completed", {
        description: `${orderedNodes.length} nodes executed`,
        duration: 4000,
      });
    }
  }, [
    nodes,
    currentWorkflow,
    isExecuting,
    startExecution,
    updateNodeStatus,
    setEdgeFlowing,
    addArtifact,
    addTileResult,
    completeExecution,
    setProgress,
    log,
  ]);

  const resetExecution = useCallback(() => {
    nodes.forEach((node) => updateNodeStatus(node.id, "idle"));
  }, [nodes, updateNodeStatus]);
  
  const clearRateLimitError = useCallback(() => {
    setRateLimitHit(null);
  }, []);

  return { 
    runWorkflow, 
    resetExecution, 
    isExecuting, 
    rateLimitHit, 
    clearRateLimitError 
  };
}
