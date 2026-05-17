/**
 * Client-side feature flag hook (cross-cutting).
 *
 * Fetches `/api/config/feature-flags` once per page load and caches the
 * result in a module-scoped variable so multiple consumers don't each
 * issue their own request. Defaults to "all flags off" until the
 * response lands — components MUST treat the default as the safe
 * "feature is hidden" branch to avoid a brief flash of beta UI.
 *
 * Lives in `src/hooks/` (cross-cutting hotspot) because both
 * `src/features/dashboard/components/Sidebar.tsx` and
 * `src/features/brief-renders/components/*` import it. Per the
 * folder-structure rule, anything used by 2+ features must live in
 * `src/hooks/` or `src/shared/`.
 */

"use client";

import { useEffect, useState } from "react";

export interface FeatureFlags {
  vipJobsEnabled: boolean;
  briefRendersEnabled: boolean;
  /** Brief-to-IFC v3 generator-agent pipeline — the only AI IFC pipeline
   *  as of 2026-05-17. Defaults to true server-side; `false` here is
   *  only the pre-network value used before the flag endpoint replies.
   *  (The v2 queued pipeline was retired the same day — its flag and
   *  routing branch have been removed.) */
  briefToIfcV3Enabled: boolean;
}

const DEFAULT_FLAGS: FeatureFlags = {
  vipJobsEnabled: false,
  briefRendersEnabled: false,
  briefToIfcV3Enabled: false,
};

let cachedFlags: FeatureFlags | null = null;
let inflightPromise: Promise<FeatureFlags> | null = null;

function fetchFlagsOnce(): Promise<FeatureFlags> {
  if (inflightPromise) return inflightPromise;
  inflightPromise = fetch("/api/config/feature-flags", {
    credentials: "include",
  })
    .then((r) => (r.ok ? r.json() : DEFAULT_FLAGS))
    .then((data: Partial<FeatureFlags>) => {
      const merged: FeatureFlags = { ...DEFAULT_FLAGS, ...data };
      cachedFlags = merged;
      return merged;
    })
    .catch(() => DEFAULT_FLAGS);
  return inflightPromise;
}

export function useFeatureFlags(): FeatureFlags {
  const [flags, setFlags] = useState<FeatureFlags>(cachedFlags ?? DEFAULT_FLAGS);

  useEffect(() => {
    if (cachedFlags) {
      // Late-mount consumer: pick up the cached value without issuing
      // a fresh request.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot cache propagation on late mount
      setFlags(cachedFlags);
      return;
    }

    let cancelled = false;
    void fetchFlagsOnce().then((resolved) => {
      if (cancelled) return;
      setFlags(resolved);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return flags;
}

/** Test-only — clear the module cache so the hook re-fetches. */
export function _resetFeatureFlagsCache(): void {
  cachedFlags = null;
  inflightPromise = null;
}
