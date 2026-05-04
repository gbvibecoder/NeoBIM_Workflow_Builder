"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";

/**
 * Handles two scenarios:
 * 1. OAuth signup: claims a referral code stored in localStorage before the redirect.
 * 2. Credentials signup: shows a welcome toast when sessionStorage flag is set.
 * Renders nothing — purely a side-effect component.
 */
export function PendingReferralClaimer() {
  const { data: session } = useSession();

  useEffect(() => {
    if (!session?.user?.id) return;

    // ── Path 1: Credentials signup already claimed on the server ────────
    // The register page sets this flag when a referral code was present.
    const credentialsClaimed = sessionStorage.getItem("bf_referral_claimed");
    if (credentialsClaimed) {
      sessionStorage.removeItem("bf_referral_claimed");
      toast.success("Welcome! Your invite bonus is active.", {
        description: "You have 1 bonus workflow execution ready to use.",
        duration: 6000,
      });
      return; // Don't also try the OAuth path
    }

    // ── Path 2: OAuth signup — claim the code that was saved pre-redirect ─
    const code = localStorage.getItem("pending_referral_code");
    if (!code) return;

    // Remove immediately to prevent duplicate claims on re-renders
    localStorage.removeItem("pending_referral_code");

    fetch("/api/referral/claim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, userId: session.user.id }),
    })
      .then((res) => {
        if (res.ok) {
          toast.success("Welcome! Your invite bonus is active.", {
            description: "You have 1 bonus workflow execution ready to use.",
            duration: 6000,
          });
        }
        // Silent on failure — not critical to block the user
      })
      .catch(() => {});
  }, [session?.user?.id]);

  return null;
}
