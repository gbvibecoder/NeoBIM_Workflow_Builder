import { useState, useEffect } from "react";

/**
 * Resolves the user's avatar image source.
 *
 * When sessionImage is "uploaded" (sentinel for a DB-stored data URL),
 * the actual image is fetched from /api/user/profile and then cached:
 *   1. In a module-level variable (`memoryCache`) so sibling hook
 *      instances and remounts within the same session render
 *      synchronously with no flash.
 *   2. In localStorage so a full reload still has the avatar instantly.
 *
 * For normal URLs (e.g. Google OAuth), the URL is returned directly.
 */

const STORAGE_KEY = "bf:avatar:uploaded";
let memoryCache: string | null | undefined = undefined;

function readStorage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStorage(value: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (value) window.localStorage.setItem(STORAGE_KEY, value);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* quota / privacy mode — fall back to memory cache only */
  }
}

export function useAvatar(sessionImage: string | null | undefined) {
  const isUploaded = sessionImage === "uploaded";
  const directSrc = !isUploaded && sessionImage ? sessionImage : null;

  // Lazy-init from cache so the very first render already has the image —
  // no spinner, no "GB" initials flash on tab switches or remounts.
  const [fetchedSrc, setFetchedSrc] = useState<string | null>(() => {
    if (!isUploaded) return null;
    if (memoryCache !== undefined) return memoryCache;
    const fromStorage = readStorage();
    memoryCache = fromStorage;
    return fromStorage;
  });
  const [refreshKey, setRefreshKey] = useState(0);

  // Listen for global avatar update events (fired from settings after save)
  useEffect(() => {
    const handler = () => setRefreshKey((k) => k + 1);
    window.addEventListener("avatar:updated", handler);
    return () => window.removeEventListener("avatar:updated", handler);
  }, []);

  useEffect(() => {
    if (!isUploaded) {
      // User no longer has an uploaded avatar — clear caches.
      if (memoryCache !== null) {
        memoryCache = null;
        writeStorage(null);
      }
      setFetchedSrc(null);
      return;
    }

    // We may already have a cached value; still revalidate in the background
    // so a save from another tab / device propagates.
    let cancelled = false;
    fetch("/api/user/profile", { cache: "no-store" })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        const img: string | null = data?.image ?? null;
        // Only update if the image actually changed — prevents pointless
        // re-renders that would briefly trigger an <img> reload.
        if (img !== memoryCache) {
          memoryCache = img;
          writeStorage(img);
          setFetchedSrc(img);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [isUploaded, refreshKey]);

  return isUploaded ? fetchedSrc : directSrc;
}

/** Clear the cached uploaded avatar — call from sign-out flows. */
export function clearAvatarCache() {
  memoryCache = null;
  writeStorage(null);
}

/**
 * Prime the avatar cache with a known value (e.g. immediately after a
 * successful upload), so any subsequent mount of `useAvatar` renders the
 * new image synchronously without waiting for a server round-trip.
 */
export function primeAvatarCache(value: string | null) {
  memoryCache = value;
  writeStorage(value);
}
