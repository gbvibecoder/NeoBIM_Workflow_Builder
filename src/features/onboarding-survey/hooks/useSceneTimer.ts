"use client";

import { useEffect, useRef } from "react";

/** Tracks total time from mount → caller reads `elapsed()` on finish. */
export function useSceneTimer() {
  const startRef = useRef<number>(0);

  useEffect(() => {
    startRef.current = performance.now();
  }, []);

  return {
    elapsedSeconds: () => Math.max(0, Math.round((performance.now() - startRef.current) / 1000)),
  };
}
