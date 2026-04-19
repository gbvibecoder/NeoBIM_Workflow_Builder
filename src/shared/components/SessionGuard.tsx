"use client";

/**
 * SessionGuard — clears ALL user-specific client state when the
 * authenticated user changes.
 *
 * Prevents cross-user data leaks when two people share a device
 * or when switching accounts without a full page reload (SPA
 * navigation via NextAuth signOut → signIn).
 *
 * Must be rendered inside <SessionProvider> and on every protected
 * page (dashboard layout is sufficient).
 */

import { useSession } from "next-auth/react";
import { useEffect, useRef } from "react";

/** Wipe all user-scoped client state: Zustand stores + localStorage. */
function purgeClientState() {
  // ── 1. Floor plan Zustand store (in-memory) ──
  try {
    const { useFloorPlanStore } = require("@/features/floor-plan/stores/floor-plan-store");
    useFloorPlanStore.getState().resetToWelcome();
  } catch { /* store may not be loaded yet — fine */ }

  // ── 2. Floor plan localStorage (project-persistence.ts) ──
  try {
    const keys = Object.keys(localStorage);
    for (const key of keys) {
      if (key.startsWith("buildflow-fp-")) {
        localStorage.removeItem(key);
      }
    }
  } catch { /* localStorage unavailable */ }

  // ── 3. Workflow Zustand store (persisted to localStorage) ──
  try {
    localStorage.removeItem("neobim-workflow-state");
  } catch { /* best-effort */ }
  try {
    const { useWorkflowStore } = require("@/features/workflows/stores/workflow-store");
    const state = useWorkflowStore.getState();
    if (typeof state.resetWorkflowState === "function") {
      state.resetWorkflowState();
    }
  } catch { /* store may not be loaded */ }

  // ── 4. Execution store (in-memory) ──
  try {
    const { useExecutionStore } = require("@/features/execution/stores/execution-store");
    const state = useExecutionStore.getState();
    if (typeof state.reset === "function") {
      state.reset();
    }
  } catch { /* best-effort */ }

  // ── 5. Session-storage floor plan temp data ──
  try {
    sessionStorage.removeItem("floorPlanProject");
    sessionStorage.removeItem("fp-editor-geometry");
    sessionStorage.removeItem("fp-editor-prompt");
  } catch { /* best-effort */ }

  console.log("[SessionGuard] Purged all user-specific client state");
}

export function SessionGuard() {
  const { data: session, status } = useSession();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    // Wait for session to load
    if (status === "loading") return;

    const currentUserId = session?.user?.id ?? session?.user?.email ?? null;

    // First mount — just record the user ID, don't purge
    if (prevUserIdRef.current === undefined) {
      prevUserIdRef.current = currentUserId;
      return;
    }

    // User changed (including logout → null → new login)
    if (currentUserId !== prevUserIdRef.current) {
      console.warn(
        `[SessionGuard] User changed: ${prevUserIdRef.current ?? "none"} → ${currentUserId ?? "none"}. Purging client state.`,
      );
      purgeClientState();
      prevUserIdRef.current = currentUserId;
    }
  }, [session?.user?.id, session?.user?.email, status]);

  return null; // Invisible component — just runs the effect
}
