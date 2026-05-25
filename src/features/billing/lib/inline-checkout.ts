/**
 * Inline Razorpay checkout from a locked-template "Upgrade to {tier}"
 * button. Reuses the existing /api/razorpay/checkout + /api/razorpay/verify
 * routes — no new server infra. The whole point of "inline" is to skip the
 * /dashboard/billing intermediate page so the user goes
 *   click → script-load → Razorpay popup → success → unlocked
 * in one continuous flow.
 *
 * Edge cases this helper handles (mapped to the §X spec):
 *
 *   E1  session expired pre-click — fetch /api/auth/session first, redirect
 *       to /login?next=...&intent=upgrade-{tier} on null
 *   E3  network failure on subscription create — caller catches reject, shows
 *       toast with retry CTA, no state mutation
 *   E4  Razorpay CDN blocked — RazorpayLoadError surfaced to caller for
 *       fallback-modal copy
 *   E5  mobile redirect flow — Razorpay handles this internally; on return,
 *       window.location carries razorpay_payment_id and a sibling helper
 *       (see resumePendingMobileVerify) calls verify
 *   E6  user dismisses modal — modal.ondismiss → resolves with kind:"dismissed"
 *   E7  verify endpoint times out — caller can poll /api/user/profile (this
 *       helper just rejects with kind:"verify-timeout" after 15s)
 *   E14 button mash — `runId` token + `inflightRunId` guards re-entry; second
 *       call rejects with kind:"already-in-flight"
 *   E15 server cold-start — 30s abort timeout on the create-subscription
 *       fetch, matching the proven /dashboard/billing path
 *
 * Telemetry: emits `template_lock_*` and `razorpay_checkout_*` events via
 * the existing `track()` helper — no new analytics infra.
 *
 * The success handler refreshes NextAuth via `getSession()` so the JWT
 * carries the new role on the next render. Cross-tab sync is broadcast on
 * the `buildflow-auth` channel (E8) — listeners on the templates page
 * re-fetch their tier on `role-updated`.
 */
"use client";

import { getSession } from "next-auth/react";
import type { TemplateTier } from "@/features/billing/lib/template-access";
import { loadRazorpay, RazorpayLoadError } from "@/features/billing/lib/load-razorpay";
import { track } from "@/lib/track";

// ── Plan-key normalization (matches /api/razorpay/checkout) ────────────────
// The route accepts "MINI" | "STARTER" | "PRO" | "TEAM_ADMIN".
// Templates use TemplateTier ("FREE" | "MINI" | "STARTER" | "PRO" | "TEAM").
function tierToPlanKey(tier: TemplateTier): "MINI" | "STARTER" | "PRO" | "TEAM_ADMIN" | null {
  switch (tier) {
    case "MINI": return "MINI";
    case "STARTER": return "STARTER";
    case "PRO": return "PRO";
    // TEAM is sales-only — no self-serve checkout. Returning null blocks the
    // inline checkout flow; the caller should show "Contact Sales" instead.
    case "TEAM": return null;
    default: return null;
  }
}

// ── Result variants ────────────────────────────────────────────────────────
//
// The caller pattern-matches on `kind`. Every non-success terminal state
// carries a `userMessage` string that is safe to render verbatim in a toast.

export type InlineCheckoutResult =
  | {
      kind: "success";
      role: string;
      previousRole: string;
      paymentId: string;
      subscriptionId: string;
    }
  | {
      kind: "dismissed"; // user closed the Razorpay modal — no charge
    }
  | {
      kind: "session-expired"; // E1 — redirect handled by helper
      redirectedTo: string;
    }
  | {
      kind: "already-in-flight"; // E14
      userMessage: string;
    }
  | {
      kind: "create-failed"; // server 4xx/5xx on /razorpay/checkout
      userMessage: string;
      errorCode?: string;
    }
  | {
      kind: "script-blocked"; // E4
      userMessage: string;
    }
  | {
      kind: "payment-failed"; // Razorpay payment.failed event
      userMessage: string;
    }
  | {
      kind: "verify-failed"; // /api/razorpay/verify returned 4xx/5xx
      userMessage: string;
    }
  | {
      kind: "verify-timeout"; // E7 — request hung > 15s, payment may still process via webhook
      userMessage: string;
    };

// ── Re-entry guard (E14) ───────────────────────────────────────────────────
let inflightRunId: string | null = null;

// ── Cross-tab broadcast (E8) ───────────────────────────────────────────────
const AUTH_CHANNEL = "buildflow-auth";
function broadcastRoleUpdate(role: string) {
  try {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel(AUTH_CHANNEL);
    ch.postMessage({ type: "role-updated", role, at: Date.now() });
    // Close after a tick so subscribers receive it.
    setTimeout(() => ch.close(), 50);
  } catch {
    /* no-op — BroadcastChannel unavailable in some embedded webviews */
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

interface OpenInlineUpgradeCheckoutArgs {
  /** The template's required tier (the user is below this). */
  targetTier: TemplateTier;
  /** Used for telemetry + the `notes.source` audit field. */
  templateId?: string;
  /** Current user role for telemetry only. */
  currentTier?: string;
  /** Pre-fill the Razorpay modal. Falls back to /api/razorpay/checkout's
   *  server-side prefill when omitted. */
  userEmail?: string;
  userName?: string;
}

export async function openInlineUpgradeCheckout(
  args: OpenInlineUpgradeCheckoutArgs,
): Promise<InlineCheckoutResult> {
  const { targetTier, templateId, currentTier, userEmail, userName } = args;

  // E14 — second call while one is in flight
  if (inflightRunId) {
    return {
      kind: "already-in-flight",
      userMessage: "An upgrade is already in progress. Please wait.",
    };
  }
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  inflightRunId = runId;

  const planKey = tierToPlanKey(targetTier);
  if (!planKey) {
    inflightRunId = null;
    return {
      kind: "create-failed",
      userMessage: "Selected tier is not available for upgrade.",
      errorCode: "INVALID_TIER",
    };
  }

  track("template_upgrade_clicked", { templateId, targetTier, currentTier, runId });

  try {
    // ── E1: pre-flight session check ──────────────────────────────────────
    // /api/razorpay/checkout will 401 anyway, but redirecting BEFORE we
    // create a subscription saves a Razorpay API call + lets us preserve
    // the user's intent across the login round-trip.
    const session = await getSession();
    if (!session?.user?.id) {
      const next = encodeURIComponent(
        typeof window !== "undefined"
          ? window.location.pathname + window.location.search
          : "/dashboard/templates",
      );
      const intent = `upgrade-${planKey}`;
      const redirectTo = `/login?next=${next}&intent=${intent}`;
      if (typeof window !== "undefined" && templateId) {
        try {
          sessionStorage.setItem(
            "buildflow:pending-upgrade",
            JSON.stringify({ templateId, targetTier, at: Date.now() }),
          );
        } catch {
          /* sessionStorage may be blocked — non-fatal */
        }
      }
      if (typeof window !== "undefined") window.location.href = redirectTo;
      return { kind: "session-expired", redirectedTo: redirectTo };
    }

    // ── Step 1: create subscription on the server (existing route) ────────
    // 30s abort timeout matches the billing page's proven pattern.
    const controller = new AbortController();
    const createTimeout = setTimeout(() => controller.abort(), 30_000);
    let createRes: Response;
    try {
      createRes = await fetch("/api/razorpay/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan: planKey }),
        signal: controller.signal,
      });
    } catch (fetchErr) {
      const aborted =
        fetchErr instanceof DOMException && fetchErr.name === "AbortError";
      track("razorpay_checkout_failed", {
        stage: "create",
        reason: aborted ? "timeout" : "network",
        targetTier,
      });
      return {
        kind: "create-failed",
        userMessage: aborted
          ? "Checkout request timed out. Please try again."
          : "We couldn't reach our payment service. Check your connection and try again.",
        errorCode: aborted ? "TIMEOUT" : "NETWORK",
      };
    } finally {
      clearTimeout(createTimeout);
    }

    let createData: {
      subscriptionId?: string;
      razorpayKeyId?: string;
      email?: string;
      name?: string;
      error?: { code?: string; message?: string };
    } = {};
    try {
      createData = await createRes.json();
    } catch {
      /* non-JSON body — fall through to error path below */
    }

    if (!createRes.ok || !createData.subscriptionId || !createData.razorpayKeyId) {
      const code = createData.error?.code || `HTTP_${createRes.status}`;
      const message =
        createData.error?.message ||
        (createRes.status === 429
          ? "Too many attempts. Please wait a moment and try again."
          : createRes.status >= 500
            ? "Our payment partner is temporarily unavailable. Please try again."
            : "We couldn't start checkout. Please try again.");
      track("razorpay_checkout_failed", {
        stage: "create",
        status: createRes.status,
        code,
        targetTier,
      });
      return { kind: "create-failed", userMessage: message, errorCode: code };
    }

    const subscriptionId = createData.subscriptionId;

    // ── Step 2: load the Razorpay script (E4) ─────────────────────────────
    let Razorpay: Awaited<ReturnType<typeof loadRazorpay>>;
    try {
      Razorpay = await loadRazorpay();
    } catch (loadErr) {
      const reason =
        loadErr instanceof RazorpayLoadError ? loadErr.reason : "load-error";
      track("razorpay_checkout_failed", {
        stage: "script-load",
        reason,
        targetTier,
      });
      return {
        kind: "script-blocked",
        userMessage:
          "Your network appears to be blocking our payment provider. Try a different network, or contact support@buildflow.app.",
      };
    }

    // ── Step 3: open Razorpay widget ──────────────────────────────────────
    track("razorpay_checkout_opened", {
      subscriptionId,
      targetTier,
      templateId,
    });

    return await new Promise<InlineCheckoutResult>((resolve) => {
      let settled = false;
      const settle = (r: InlineCheckoutResult) => {
        if (settled) return;
        settled = true;
        resolve(r);
      };

      let rzp: ReturnType<RazorpayCtorReturn>;
      try {
        rzp = new Razorpay({
          key: createData.razorpayKeyId,
          subscription_id: subscriptionId,
          name: "BuildFlow",
          description: `${planKey} · monthly`,
          prefill: {
            email: createData.email || userEmail || session.user?.email || "",
            name: createData.name || userName || session.user?.name || "",
          },
          theme: { color: "#1A4D5C" },
          notes: {
            source: "template_lock_inline",
            templateId: templateId ?? "",
            targetTier,
          },
          retry: { enabled: true, max_count: 3 },
          modal: {
            ondismiss: () => {
              track("razorpay_checkout_dismissed", { subscriptionId, targetTier });
              settle({ kind: "dismissed" });
            },
            escape: true,
            backdropclose: false,
          },
          handler: async (response: {
            razorpay_payment_id: string;
            razorpay_subscription_id: string;
            razorpay_signature: string;
          }) => {
            // ── Step 4: verify on server (E7 timeout) ─────────────────────
            const verifyController = new AbortController();
            const verifyTimer = setTimeout(() => verifyController.abort(), 15_000);
            try {
              const verifyRes = await fetch("/api/razorpay/verify", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(response),
                signal: verifyController.signal,
              });
              const verifyData = await verifyRes.json().catch(() => ({}));

              if (!verifyRes.ok || !verifyData.success) {
                track("razorpay_checkout_failed", {
                  stage: "verify",
                  status: verifyRes.status,
                  targetTier,
                });
                settle({
                  kind: "verify-failed",
                  userMessage:
                    verifyData?.error?.message ||
                    "Payment verification failed. Your payment is safe — please refresh in a moment or contact support.",
                });
                return;
              }

              // E8 — broadcast to other open tabs
              broadcastRoleUpdate(verifyData.role);

              track("razorpay_checkout_completed", {
                paymentId: response.razorpay_payment_id,
                subscriptionId,
                targetTier,
                fromRole: verifyData.previousRole,
                toRole: verifyData.role,
              });

              // Force NextAuth to re-fetch the session so the JWT carries the
              // new role. The next render of the templates page will show
              // the unlocked state.
              try {
                await getSession();
              } catch {
                /* non-fatal */
              }

              settle({
                kind: "success",
                role: verifyData.role,
                previousRole: verifyData.previousRole,
                paymentId: response.razorpay_payment_id,
                subscriptionId,
              });
            } catch (verifyErr) {
              const aborted =
                verifyErr instanceof DOMException && verifyErr.name === "AbortError";
              track("razorpay_checkout_failed", {
                stage: "verify",
                reason: aborted ? "timeout" : "network",
                targetTier,
              });
              settle({
                kind: aborted ? "verify-timeout" : "verify-failed",
                userMessage: aborted
                  ? "Payment received — activation pending. Refresh in a minute or check your email."
                  : "Couldn't verify payment. Your payment is safe — please refresh or contact support.",
              });
            } finally {
              clearTimeout(verifyTimer);
            }
          },
        });

        // Razorpay can fire payment.failed for declined/cancelled bank flows
        // and payment.error for SDK-internal issues. Cover both.
        const onFailure = (eventName: string) => (resp?: unknown) => {
          const failure = resp as { error?: { description?: string; reason?: string } } | undefined;
          const reason = failure?.error?.description || failure?.error?.reason || "Payment did not complete.";
          track("razorpay_checkout_failed", {
            stage: "widget",
            event: eventName,
            targetTier,
          });
          settle({ kind: "payment-failed", userMessage: reason });
        };
        rzp.on("payment.failed", onFailure("payment.failed"));
        rzp.on("payment.error", onFailure("payment.error"));

        rzp.open();
      } catch (openErr) {
        track("razorpay_checkout_failed", {
          stage: "open",
          error: String(openErr),
          targetTier,
        });
        settle({
          kind: "create-failed",
          userMessage: "Payment gateway failed to initialize. Please try again.",
          errorCode: "OPEN_FAILED",
        });
      }
    });
  } finally {
    if (inflightRunId === runId) inflightRunId = null;
  }
}

// Helper type — Razorpay constructor return shape, mirrors the dynamic typing.
type RazorpayCtorReturn = (...args: unknown[]) => {
  open: () => void;
  on: (event: string, cb: (response?: unknown) => void) => void;
};

// ── Mobile redirect-flow resumption (E5) ───────────────────────────────────
//
// On mobile webviews Razorpay sometimes uses a redirect flow instead of an
// in-page popup. On return, the URL carries razorpay_payment_id /
// _subscription_id / _signature query params. Call this from a useEffect on
// /dashboard/templates to detect + verify the pending payment.
//
// Returns true when a verification was attempted (success OR failure), false
// when there was nothing to verify. The caller should refresh the user's
// role + show a toast based on the result.

export interface PendingMobileVerifyResult {
  attempted: boolean;
  result?: InlineCheckoutResult;
}

export async function resumePendingMobileVerify(): Promise<PendingMobileVerifyResult> {
  if (typeof window === "undefined") return { attempted: false };
  const params = new URLSearchParams(window.location.search);
  const paymentId = params.get("razorpay_payment_id");
  const subscriptionId = params.get("razorpay_subscription_id");
  const signature = params.get("razorpay_signature");
  if (!paymentId || !subscriptionId || !signature) return { attempted: false };

  // Strip the params so a back-button doesn't re-trigger the verify.
  const url = new URL(window.location.href);
  url.searchParams.delete("razorpay_payment_id");
  url.searchParams.delete("razorpay_subscription_id");
  url.searchParams.delete("razorpay_signature");
  window.history.replaceState({}, "", url.toString());

  try {
    const verifyRes = await fetch("/api/razorpay/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        razorpay_payment_id: paymentId,
        razorpay_subscription_id: subscriptionId,
        razorpay_signature: signature,
      }),
    });
    const data = await verifyRes.json().catch(() => ({}));
    if (verifyRes.ok && data.success) {
      broadcastRoleUpdate(data.role);
      try {
        await getSession();
      } catch {
        /* non-fatal */
      }
      return {
        attempted: true,
        result: {
          kind: "success",
          role: data.role,
          previousRole: data.previousRole,
          paymentId,
          subscriptionId,
        },
      };
    }
    return {
      attempted: true,
      result: {
        kind: "verify-failed",
        userMessage:
          data?.error?.message ||
          "Payment received but verification failed. Refresh or contact support.",
      },
    };
  } catch {
    return {
      attempted: true,
      result: {
        kind: "verify-failed",
        userMessage: "Couldn't verify payment. Please refresh or contact support.",
      },
    };
  }
}
