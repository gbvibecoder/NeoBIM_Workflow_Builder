import { useState, useEffect } from "react";

/**
 * Resolves the user's avatar image source.
 * When sessionImage is "uploaded" (sentinel for DB-stored data URL),
 * fetches the actual image from /api/user/profile.
 * For normal URLs (e.g. Google OAuth), returns them directly.
 */
export function useAvatar(sessionImage: string | null | undefined) {
  const isUploaded = sessionImage === "uploaded";
  const directSrc = !isUploaded && sessionImage ? sessionImage : null;
  const [fetchedSrc, setFetchedSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!isUploaded) return;

    let cancelled = false;
    fetch("/api/user/profile")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data.image) setFetchedSrc(data.image);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [isUploaded]);

  return isUploaded ? fetchedSrc : directSrc;
}
