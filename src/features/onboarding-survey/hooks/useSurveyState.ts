"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { SceneNumber, SurveyPatch, SurveyRecord } from "@/features/onboarding-survey/types/survey";

const EMPTY: SurveyRecord = {
  discoverySource: null,
  discoveryOther: null,
  profession: null,
  professionOther: null,
  teamSize: null,
  pricingAction: null,
  completedAt: null,
  skippedAt: null,
  skippedAtScene: null,
};

// Pick the first unfilled scene so "resume" lands the user back exactly
// where they bailed. If every slot is filled, stay on scene 4 (pricing).
function resumeScene(r: SurveyRecord): SceneNumber {
  if (!r.discoverySource) return 1;
  if (!r.profession) return 2;
  if (!r.teamSize) return 3;
  return 4;
}

export function useSurveyState(initial: SurveyRecord | null) {
  const seed = initial ?? EMPTY;
  const [state, setState] = useState<SurveyRecord>(seed);
  const [scene, setScene] = useState<SceneNumber>(resumeScene(seed));
  const [saving, setSaving] = useState(false);

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPatchRef = useRef<SurveyPatch>({});

  const flushSave = useCallback(async () => {
    const patch = pendingPatchRef.current;
    if (!Object.keys(patch).length) return;
    pendingPatchRef.current = {};
    setSaving(true);
    try {
      await fetch("/api/user/survey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
    } catch {
      /* auto-save is best-effort; user can still finish the flow */
    } finally {
      setSaving(false);
    }
  }, []);

  // Debounced autosave — 500ms per spec.
  const scheduleSave = useCallback(
    (patch: SurveyPatch) => {
      pendingPatchRef.current = { ...pendingPatchRef.current, ...patch };
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        void flushSave();
      }, 500);
    },
    [flushSave]
  );

  const patch = useCallback(
    (p: SurveyPatch) => {
      setState((prev) => ({
        ...prev,
        ...("discoverySource" in p ? { discoverySource: p.discoverySource ?? null } : {}),
        ...("discoveryOther" in p ? { discoveryOther: p.discoveryOther ?? null } : {}),
        ...("profession" in p ? { profession: p.profession ?? null } : {}),
        ...("professionOther" in p ? { professionOther: p.professionOther ?? null } : {}),
        ...("teamSize" in p ? { teamSize: p.teamSize ?? null } : {}),
        ...("pricingAction" in p ? { pricingAction: p.pricingAction ?? null } : {}),
      }));
      scheduleSave(p);
    },
    [scheduleSave]
  );

  // Terminal save — fire synchronously (no debounce) and wait for completion.
  const finalize = useCallback(
    async (p: SurveyPatch): Promise<void> => {
      // Flush any pending debounced patch first.
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      const merged = { ...pendingPatchRef.current, ...p };
      pendingPatchRef.current = {};
      setSaving(true);
      try {
        await fetch("/api/user/survey", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(merged),
        });
      } catch {
        /* even if final save fails, redirect anyway — don't trap user */
      } finally {
        setSaving(false);
      }
    },
    []
  );

  // Flush pending save on unmount / tab close.
  useEffect(() => {
    const onHide = () => {
      if (Object.keys(pendingPatchRef.current).length) {
        // keepalive lets the browser finish the POST after navigation.
        try {
          fetch("/api/user/survey", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(pendingPatchRef.current),
            keepalive: true,
          });
        } catch { /* best-effort */ }
      }
    };
    window.addEventListener("pagehide", onHide);
    window.addEventListener("beforeunload", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("beforeunload", onHide);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  return { state, scene, setScene, patch, finalize, saving };
}
