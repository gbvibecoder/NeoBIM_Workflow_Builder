/**
 * Lazy-load the Razorpay checkout script with a hard timeout.
 *
 * The script is normally injected by `<Script src="checkout.razorpay.com/v1/checkout.js"
 * strategy="lazyOnload" />` on /dashboard/billing — but the inline
 * lock-to-checkout flow can fire from /dashboard/templates where the script
 * isn't pre-injected. This helper covers both cases:
 *   • If `window.Razorpay` is already present (billing page mounted earlier),
 *     resolve immediately.
 *   • Otherwise, inject the script tag once and wait for `load`. Multiple
 *     concurrent callers share the same in-flight promise so we don't
 *     race-inject duplicate <script> elements.
 *   • An 8-second timeout rejects with a `RazorpayLoadError` so the UI can
 *     surface the "your network blocks our payment provider" fallback modal
 *     (edge case E4).
 *
 * Returns the global `Razorpay` constructor on success.
 */

const RAZORPAY_SCRIPT_URL = "https://checkout.razorpay.com/v1/checkout.js";
const LOAD_TIMEOUT_MS = 8000;

export class RazorpayLoadError extends Error {
  constructor(
    public readonly reason: "timeout" | "load-error" | "ssr",
    message: string,
  ) {
    super(message);
    this.name = "RazorpayLoadError";
  }
}

type RazorpayCtor = new (opts: Record<string, unknown>) => {
  open: () => void;
  on: (event: string, cb: (response?: unknown) => void) => void;
};

declare global {
  interface Window {
    Razorpay?: RazorpayCtor;
  }
}

let inFlight: Promise<RazorpayCtor> | null = null;

export function loadRazorpay(): Promise<RazorpayCtor> {
  if (typeof window === "undefined") {
    return Promise.reject(
      new RazorpayLoadError("ssr", "loadRazorpay called server-side."),
    );
  }
  if (window.Razorpay) {
    return Promise.resolve(window.Razorpay);
  }
  if (inFlight) return inFlight;

  inFlight = new Promise<RazorpayCtor>((resolve, reject) => {
    // Reuse an existing tag if one was injected by the billing page's
    // <Script> element. Otherwise create a fresh one.
    let script = document.querySelector<HTMLScriptElement>(
      `script[src="${RAZORPAY_SCRIPT_URL}"]`,
    );
    const ownsScript = !script;
    if (!script) {
      script = document.createElement("script");
      script.src = RAZORPAY_SCRIPT_URL;
      script.async = true;
      document.head.appendChild(script);
    }

    const timer = setTimeout(() => {
      cleanup();
      // Don't remove the script — it may finish loading later, just reject
      // *this* attempt so the user sees the fallback. Next call will succeed.
      inFlight = null;
      reject(
        new RazorpayLoadError(
          "timeout",
          `Razorpay checkout script did not load within ${LOAD_TIMEOUT_MS}ms.`,
        ),
      );
    }, LOAD_TIMEOUT_MS);

    function onLoad() {
      cleanup();
      if (window.Razorpay) {
        resolve(window.Razorpay);
      } else {
        inFlight = null;
        reject(
          new RazorpayLoadError(
            "load-error",
            "Razorpay script loaded but window.Razorpay is undefined.",
          ),
        );
      }
    }
    function onError() {
      cleanup();
      inFlight = null;
      // If we created the script tag, remove it so the next attempt can retry
      // cleanly; otherwise leave it (some other code owns it).
      if (ownsScript && script?.parentNode) script.parentNode.removeChild(script);
      reject(
        new RazorpayLoadError(
          "load-error",
          "Razorpay script failed to load (CDN blocked or network error).",
        ),
      );
    }
    function cleanup() {
      clearTimeout(timer);
      script?.removeEventListener("load", onLoad);
      script?.removeEventListener("error", onError);
    }
    script.addEventListener("load", onLoad);
    script.addEventListener("error", onError);
  });

  return inFlight;
}
