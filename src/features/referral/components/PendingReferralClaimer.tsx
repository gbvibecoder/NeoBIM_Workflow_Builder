"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";

/**
 * Checks localStorage for a referral code that was saved before an OAuth redirect.
 * If found, claims it via the API and removes it from storage.
 * Renders nothing — purely a side-effect component.
 */
export function PendingReferralClaimer() {
  const { data: session } = useSession();

  useEffect(() => {
    if (!session?.user?.id) return;

    const code = localStorage.getItem("pending_referral_code");
    if (!code) return;

    // Remove immediately to prevent duplicate claims on re-renders
    localStorage.removeItem("pending_referral_code");

    fetch("/api/referral/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, userId: session.user.id }),
    }).catch(() => {
      // Silently fail — not critical to block the user
    });
  }, [session?.user?.id]);

  return null;
}
