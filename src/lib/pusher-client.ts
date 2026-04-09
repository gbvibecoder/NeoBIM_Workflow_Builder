"use client";

import PusherClient from "pusher-js";

// Browser Pusher singleton. Auth via /api/pusher/auth (cookie-based session).
// Channels are private/presence; subscriptions only succeed for authorized users.

let _client: PusherClient | null = null;

export function getPusherClient(): PusherClient | null {
  if (typeof window === "undefined") return null;
  if (_client) return _client;

  const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
  const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;
  if (!key || !cluster) {
    console.warn(
      "[pusher-client] NEXT_PUBLIC_PUSHER_KEY/CLUSTER missing — realtime disabled. " +
        "If you just added these to .env.local, RESTART the dev server (Next inlines NEXT_PUBLIC_* at start).",
    );
    return null;
  }

  _client = new PusherClient(key, {
    cluster,
    authEndpoint: "/api/pusher/auth",
    forceTLS: true,
  });

  // Visible connection diagnostics — surface in browser DevTools console.
  _client.connection.bind("connected", () => {
    console.log("[pusher-client] connected, socket_id =", _client?.connection.socket_id);
  });
  _client.connection.bind("error", (err: unknown) => {
    console.error("[pusher-client] connection error:", err);
  });
  _client.connection.bind("state_change", (states: { previous: string; current: string }) => {
    console.log("[pusher-client] state:", states.previous, "→", states.current);
  });

  return _client;
}
