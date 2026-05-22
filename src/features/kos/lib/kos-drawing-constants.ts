/**
 * KOS drawing-parser constants (Week 5C-1, Phase 1).
 *
 * Single source of truth for the sidecar URL + upload cap shared by the
 * drawing-parser service and the test script. The sidecar is the SAME
 * Railway Python service that powers IFC generation — it just exposes the
 * new `/kos/parse-drawing` route. We keep a dedicated `KOS_SIDECAR_URL`
 * env knob so KOS can be pointed at a different host later without
 * disturbing the IFC pipeline's `IFC_SERVICE_URL`.
 */

/** Railway Python sidecar base URL. Override with `KOS_SIDECAR_URL`. */
export const KOS_SIDECAR_URL =
  process.env.KOS_SIDECAR_URL ?? "https://buildflow-python-server.up.railway.app";

/** Hard upload cap mirrored from the sidecar's 50 MB limit. */
export const KOS_DRAWING_MAX_FILE_SIZE_MB = 50;

/**
 * Bearer token for the sidecar. The drawing route inherits the same
 * `ApiKeyMiddleware` as every other sidecar endpoint, so we reuse the
 * existing `IFC_SERVICE_API_KEY`. When unset (local dev with auth off)
 * we send no Authorization header and the sidecar allows the request.
 */
export const KOS_SIDECAR_API_KEY = process.env.IFC_SERVICE_API_KEY ?? "";

/** Request timeout (ms). Generous to tolerate Railway cold starts. */
export const KOS_DRAWING_REQUEST_TIMEOUT_MS = 90_000;
