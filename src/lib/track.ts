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
  | "regeneration_used"
  // Template-lock-to-checkout funnel — see §X.
  // seen → hovered → clicked → opened → completed (or dismissed/failed).
  | "template_lock_seen"
  | "template_lock_hovered"
  | "template_upgrade_clicked"
  | "razorpay_checkout_opened"
  | "razorpay_checkout_completed"
  | "razorpay_checkout_dismissed"
  | "razorpay_checkout_failed"
  | "upgrade_verified";

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

export function trackRegenerationUsed(nodeId: string, catalogueId: string) {
  track("regeneration_used", { nodeId, catalogueId });
}
