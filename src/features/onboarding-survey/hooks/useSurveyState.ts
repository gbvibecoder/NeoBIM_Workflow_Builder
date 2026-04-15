"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getUTMProperties } from "@/lib/utm";
import type { SceneNumber, SurveyPatch, SurveyRecord } from "@/features/onboarding-survey/types/survey";

/**
 * First-touch attribution: read UTM params from sessionStorage (populated by
 * <UTMCapture /> on landing) and document.referrer once. Attached to every
 * POST; the server only persists these on CREATE, so auto-save won't clobber
 * the real first-touch values.
 */
function collectAttribution(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const utms = getUTMProperties();
  const attribution: Record<string, string> = { ...utms };
  if (document.referrer) {
    // Truncate to 500 chars — some ad networks append giant query strings.
    attribution.referrer = document.referrer.slice(0, 500);
  }
  return attribution;
}

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

  /**
   * Flush whatever is in pendingPatchRef to the server and return a Promise
   * that resolves when the POST settles. Unlike the previous implementation,
   * the ref is NOT cleared until the POST succeeds (res.ok): if the network
   * drops or the server returns 4xx/5xx, the patch stays queued so a later
   * flush (or the pagehide keepalive) can retry it. Patches that accumulate
   * mid-flight are preserved — only the keys in the snapshot are cleared.
   */
  const flushSave = useCallback(async (): Promise<void> => {
    const snapshot: SurveyPatch = { ...pendingPatchRef.current };
    const snapshotKeys = Object.keys(snapshot) as (keyof SurveyPatch)[];
    if (!snapshotKeys.length) return;
    setSaving(true);
    try {
      const res = await fetch("/api/user/survey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...snapshot, ...collectAttribution() }),
      });
      if (res.ok) {
        for (const k of snapshotKeys) {
          delete (pendingPatchRef.current as Record<string, unknown>)[k];
        }
      }
      // Non-ok: pending data stays queued for the next attempt.
    } catch {
      // Network error: pending data stays queued for the next attempt.
    } finally {
      setSaving(false);
    }
  }, []);

  /**
   * Patch survey state. Two call shapes:
   *   - patch(p)                  → debounced 500ms save, fire-and-forget
   *     (use this for high-frequency input like "other" text typing)
   *   - patch(p, { immediate })   → cancels any pending debounce and awaits
   *     the POST. Callers SHOULD await the returned promise before advancing
   *     the UI, so the user's answer is durable before the scene moves on.
   *     This eliminates the "refresh within 500ms of picking → data lost"
   *     race that prod users were hitting.
   */
  const patch = useCallback(
    async (p: SurveyPatch, opts?: { immediate?: boolean }): Promise<void> => {
      setState((prev) => ({
        ...prev,
        ...("discoverySource" in p ? { discoverySource: p.discoverySource ?? null } : {}),
        ...("discoveryOther" in p ? { discoveryOther: p.discoveryOther ?? null } : {}),
        ...("profession" in p ? { profession: p.profession ?? null } : {}),
        ...("professionOther" in p ? { professionOther: p.professionOther ?? null } : {}),
        ...("teamSize" in p ? { teamSize: p.teamSize ?? null } : {}),
        ...("pricingAction" in p ? { pricingAction: p.pricingAction ?? null } : {}),
      }));
      pendingPatchRef.current = { ...pendingPatchRef.current, ...p };

      if (opts?.immediate) {
        if (saveTimerRef.current) {
          clearTimeout(saveTimerRef.current);
          saveTimerRef.current = null;
        }
        await flushSave();
        return;
      }

      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => void flushSave(), 500);
    },
    [flushSave]
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
          body: JSON.stringify({ ...merged, ...collectAttribution() }),
        });
      } catch {
        /* even if final save fails, redirect anyway — don't trap user */
      } finally {
        setSaving(false);
      }
    },
    []
  );

  // Mount-time rehydration: catch the race where the user refreshes faster
  // than the 500ms auto-save debounce settled. If SSR saw an empty row but
  // the server now has fields we're missing locally, merge them in and
  // jump scene forward. Never downgrades — user edits since mount win.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/user/survey", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.survey) return;
        const s = data.survey as Partial<SurveyRecord>;
        setState((prev) => ({
          ...prev,
          discoverySource: prev.discoverySource ?? s.discoverySource ?? null,
          discoveryOther:  prev.discoveryOther  ?? s.discoveryOther  ?? null,
          profession:      prev.profession      ?? s.profession      ?? null,
          professionOther: prev.professionOther ?? s.professionOther ?? null,
          teamSize:        prev.teamSize        ?? s.teamSize        ?? null,
        }));
        const fetchedScene = resumeScene({
          ...EMPTY,
          discoverySource: s.discoverySource ?? null,
          profession:      s.profession      ?? null,
          teamSize:        s.teamSize        ?? null,
        });
        setScene((cur) => (Math.max(cur, fetchedScene) as SceneNumber));
      })
      .catch(() => { /* best-effort */ });
    return () => { cancelled = true; };
  }, []);

  // Flush pending save on unmount / tab close.
  useEffect(() => {
    const onHide = () => {
      if (Object.keys(pendingPatchRef.current).length) {
        // keepalive lets the browser finish the POST after navigation.
        try {
          fetch("/api/user/survey", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...pendingPatchRef.current, ...collectAttribution() }),
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
