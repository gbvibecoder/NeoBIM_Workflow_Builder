/**
 * Server-side conversion tracking.
 *
 * Sends conversion events directly from the server to ad platforms,
 * bypassing ad blockers and cookie consent gaps. Platforms deduplicate
 * against client-side events using the event_id.
 *
 * - Meta Conversions API (CAPI): requires META_CAPI_ACCESS_TOKEN
 * - Google Enhanced Conversions: handled client-side via dataLayer
 *   (hashed email sent from the register and thank-you pages)
 */

import crypto from "crypto";
import { getPurchaseEventId } from "@/lib/plan-pricing";

const META_PIXEL_ID = "2072969213494487";
const META_API_VERSION = "v21.0";
const META_CAPI_URL = `https://graph.facebook.com/${META_API_VERSION}/${META_PIXEL_ID}/events`;

// ── Helpers ──────────────────────────────────────────────────────────────────

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

// ── Meta Conversions API ─────────────────────────────────────────────────────

interface MetaUserData {
  email?: string;
  phone?: string;
  firstName?: string;
  clientIpAddress?: string;
  clientUserAgent?: string;
  fbc?: string;   // _fbc cookie value
  fbp?: string;   // _fbp cookie value
}

interface MetaConversionEvent {
  eventName: "CompleteRegistration" | "Purchase" | "Lead" | "Contact";
  eventId: string;
  userData: MetaUserData;
  customData?: Record<string, unknown>;
  eventSourceUrl?: string;
}

export async function sendMetaConversion(event: MetaConversionEvent): Promise<void> {
  const accessToken = process.env.META_CAPI_ACCESS_TOKEN;
  if (!accessToken) return; // Silently skip if not configured

  const userData: Record<string, string> = {};
  if (event.userData.email) userData.em = sha256(event.userData.email);
  if (event.userData.phone) userData.ph = sha256(event.userData.phone.replace(/\D/g, ""));
  if (event.userData.firstName) userData.fn = sha256(event.userData.firstName);
  if (event.userData.clientIpAddress) userData.client_ip_address = event.userData.clientIpAddress;
  if (event.userData.clientUserAgent) userData.client_user_agent = event.userData.clientUserAgent;
  if (event.userData.fbc) userData.fbc = event.userData.fbc;
  if (event.userData.fbp) userData.fbp = event.userData.fbp;

  const payload = {
    data: [
      {
        event_name: event.eventName,
        event_time: nowUnix(),
        event_id: event.eventId,
        event_source_url: event.eventSourceUrl || "https://trybuildflow.in",
        action_source: "website",
        user_data: userData,
        ...(event.customData && { custom_data: event.customData }),
      },
    ],
    // test_event_code: "TEST12345", // Uncomment for testing in Meta Events Manager
  };

  try {
    const res = await fetch(`${META_CAPI_URL}?access_token=${accessToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[meta-capi] Failed:", res.status, err);
    }
  } catch (error) {
    console.error("[meta-capi] Network error:", error);
  }
}

// ── Convenience wrappers ─────────────────────────────────────────────────────

export async function trackServerSignup(params: {
  email: string;
  phone?: string | null;
  firstName?: string;
  ip?: string;
  userAgent?: string;
  /** Pass the same event_id from the client pixel so Meta dedups both fires. */
  eventId?: string;
}): Promise<void> {
  const eventId = params.eventId || `signup_${crypto.randomUUID()}`;

  await sendMetaConversion({
    eventName: "CompleteRegistration",
    eventId,
    userData: {
      email: params.email,
      phone: params.phone || undefined,
      firstName: params.firstName,
      clientIpAddress: params.ip,
      clientUserAgent: params.userAgent,
    },
    customData: {
      content_name: "BuildFlow Signup",
      status: "complete",
    },
    eventSourceUrl: "https://trybuildflow.in/register",
  });
}

export async function trackServerPurchase(params: {
  userId: string;
  email: string;
  phone?: string | null;
  firstName?: string;
  plan: string;
  currency?: string;
  value?: number;
  ip?: string;
  userAgent?: string;
}): Promise<void> {
  const eventId = getPurchaseEventId(params.userId, params.plan);

  await sendMetaConversion({
    eventName: "Purchase",
    eventId,
    userData: {
      email: params.email,
      phone: params.phone || undefined,
      firstName: params.firstName,
      clientIpAddress: params.ip,
      clientUserAgent: params.userAgent,
    },
    customData: {
      content_name: `BuildFlow ${params.plan} Plan`,
      currency: params.currency || "INR",
      value: params.value || 0,
    },
    eventSourceUrl: "https://trybuildflow.in/thank-you/subscription",
  });
}

// ── Hash utility for client-side Enhanced Conversions ─────────────────────────

/**
 * SHA-256 hash an email for Google Enhanced Conversions.
 * Exported so client pages can hash before pushing to dataLayer.
 * (Note: this is the server-side version; client uses SubtleCrypto.)
 */
export { sha256 as hashForConversions };
