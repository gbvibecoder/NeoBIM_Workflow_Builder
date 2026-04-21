/**
 * Client-side feature flag hook.
 * Fetches /api/config/feature-flags once on mount, caches result.
 */

import { useState, useEffect } from "react";

interface FeatureFlags {
  vipJobsEnabled: boolean;
}

const DEFAULT_FLAGS: FeatureFlags = { vipJobsEnabled: false };

let cachedFlags: FeatureFlags | null = null;

export function useFeatureFlags(): FeatureFlags {
  const [flags, setFlags] = useState<FeatureFlags>(cachedFlags ?? DEFAULT_FLAGS);

  useEffect(() => {
    if (cachedFlags) return; // Already fetched

    let cancelled = false;
    fetch("/api/config/feature-flags")
      .then((r) => (r.ok ? r.json() : DEFAULT_FLAGS))
      .then((data: FeatureFlags) => {
        if (!cancelled) {
          cachedFlags = data;
          setFlags(data);
        }
      })
      .catch(() => {
        // Feature flags fetch failed — default to all off (safe)
      });

    return () => { cancelled = true; };
  }, []);

  return flags;
}
