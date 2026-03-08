"use client";

/**
 * Client-side analytics tracker.
 * Fires events to /api/analytics endpoint (fire-and-forget).
 * Designed for use in hooks and components — lightweight, non-blocking.
 */

type TrackableEvent =
  | "workflow_executed"
  | "node_used"
  | "feature_used"
  | "template_loaded"
  | "regeneration_used";

interface TrackPayload {
  event: TrackableEvent;
  properties?: Record<string, unknown>;
}

const QUEUE: TrackPayload[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, 1000);
}

async function flush() {
  flushTimer = null;
  if (QUEUE.length === 0) return;

  const batch = QUEUE.splice(0, QUEUE.length);
  try {
    await fetch("/api/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: batch }),
      keepalive: true,
    });
  } catch {
    // Non-critical — analytics should never block UX
  }
}

export function track(event: TrackableEvent, properties?: Record<string, unknown>) {
  QUEUE.push({ event, properties });
  scheduleFlush();
}

// Convenience helpers
export function trackWorkflowExecuted(nodeCount: number, catalogueIds: string[], duration?: number) {
  track("workflow_executed", { nodeCount, catalogueIds, durationMs: duration });
}

export function trackNodeUsed(catalogueId: string, nodeLabel: string) {
  track("node_used", { catalogueId, nodeLabel });
}

export function trackFeatureUsed(feature: string, detail?: string) {
  track("feature_used", { feature, detail });
}

export function trackTemplateLoaded(templateId: string, templateName: string) {
  track("template_loaded", { templateId, templateName });
}

export function trackRegenerationUsed(nodeId: string, catalogueId: string) {
  track("regeneration_used", { nodeId, catalogueId });
}
