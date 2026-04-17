"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";

/**
 * Silent, fire-and-forget self-heal.
 *
 * Mounts in the dashboard layout. If the user's role looks stale (FREE), we
 * ask the server to search Stripe and Razorpay for any live subscription
 * tied to this user (by customerId, subscriptionId, notes.userId,
 * notes.email, or payment.email/contact). If a match is found the server
 * binds it and our call-site's session refreshes to pick up the new role.
 *
 * The endpoint is rate-limited (5 per 10 min per user) so repeated mounts
 * are harmless. No UI — this component is invisible.
 */
export function SubscriptionSelfHeal() {
  const { data: session, status, update } = useSession();

  useEffect(() => {
    if (status !== "authenticated") return;
    const role = (session?.user as { role?: string })?.role ?? "FREE";
    // Only spend an API call when there's something to potentially fix.
    if (role !== "FREE") return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/user/self-reconcile", { method: "POST" });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        if (data?.outcome?.status === "reconciled") {
          // Pull the fresh role into the session JWT without a reload.
          update().catch(() => {});
        }
      } catch {
        // Silent — worst case the user's next session refresh (15s) picks it up.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status, session, update]);

  return null;
}
