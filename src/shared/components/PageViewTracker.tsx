"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";

function Tracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (typeof window === "undefined" || !pathname) return;

    const qs = searchParams?.toString();
    const fullPath = qs ? `${pathname}?${qs}` : pathname;
    const url = `${window.location.origin}${fullPath}`;

    window.gtag?.("event", "page_view", {
      page_path: fullPath,
      page_location: url,
      page_title: document.title,
    });

    window.fbq?.("track", "PageView");
  }, [pathname, searchParams]);

  return null;
}

/** Fires GA4 + Meta Pixel page_view on every App Router navigation. */
export function PageViewTracker() {
  return (
    <Suspense fallback={null}>
      <Tracker />
    </Suspense>
  );
}
