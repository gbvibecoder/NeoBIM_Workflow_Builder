import Pusher from "pusher";

// Server-side Pusher singleton. Used by API routes to trigger events.
// All env vars required at runtime; if missing, triggers no-op (logged) so the
// rest of the system keeps working — DB writes still succeed.

let _pusher: Pusher | null = null;

export function getPusherServer(): Pusher | null {
  if (_pusher) return _pusher;
  const { PUSHER_APP_ID, PUSHER_KEY, PUSHER_SECRET, PUSHER_CLUSTER } = process.env;
  if (!PUSHER_APP_ID || !PUSHER_KEY || !PUSHER_SECRET || !PUSHER_CLUSTER) {
    if (process.env.NODE_ENV === "production") {
      console.error("[pusher-server] Missing PUSHER_* env vars — realtime disabled");
    }
    return null;
  }
  _pusher = new Pusher({
    appId: PUSHER_APP_ID,
    key: PUSHER_KEY,
    secret: PUSHER_SECRET,
    cluster: PUSHER_CLUSTER,
    useTLS: true,
  });
  return _pusher;
}

/**
 * Fire-and-forget trigger. Never throws — Pusher failures must not break the
 * caller's HTTP response. If Pusher is down, the message still persists in DB.
 */
export async function pusherTrigger(
  channel: string | string[],
  event: string,
  data: unknown,
): Promise<void> {
  const p = getPusherServer();
  if (!p) {
    console.warn("[pusher-server] skipping trigger — Pusher not configured", event);
    return;
  }
  try {
    await p.trigger(channel, event, data);
    console.log("[pusher-server] triggered", event, "on", channel);
  } catch (err) {
    console.error("[pusher-server] trigger failed:", channel, event, err);
  }
}
