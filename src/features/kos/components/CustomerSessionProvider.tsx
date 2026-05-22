"use client";

/**
 * KOS customer-session bootstrap (Phase 3B).
 *
 * On mount it POSTs to `/api/kos/customer/session/start` exactly once.
 * That endpoint is idempotent: if a valid `kos_customer_session` cookie
 * is already present it returns the existing customer (HTTP 200,
 * `reused: true`); otherwise it mints a fresh anonymous customer and
 * sets the cookie (HTTP 201). Either outcome is treated identically —
 * we just need a resolved `customer`.
 *
 * The cookie is `HttpOnly`, so the browser manages it; we never read it
 * from JS. `credentials: "include"` guarantees the cookie round-trips
 * even if a future deployment serves the API from a different origin.
 *
 * Resilience: one automatic retry after a 1 s backoff on transport
 * failure. After that the error is surfaced via the context and the
 * consuming UI offers a manual retry.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { KosCustomerView } from "@/features/kos/types/chat";

interface KosCustomerContextValue {
  customer: KosCustomerView | null;
  isLoading: boolean;
  error: string | null;
  /** Re-run the bootstrap (used by the manual retry button + 401 recovery). */
  retry: () => void;
}

const KosCustomerContext = createContext<KosCustomerContextValue | null>(null);

const SESSION_START_ENDPOINT = "/api/kos/customer/session/start";
const RETRY_BACKOFF_MS = 1000;

interface SessionStartResponse {
  customer?: KosCustomerView;
  error?: { code?: string; message?: string };
}

/**
 * Single bootstrap attempt. Returns the customer or throws an Error
 * whose message is specific enough to surface directly in the UI.
 */
async function bootstrapOnce(signal: AbortSignal): Promise<KosCustomerView> {
  const res = await fetch(SESSION_START_ENDPOINT, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    signal,
  });

  let body: SessionStartResponse = {};
  try {
    body = (await res.json()) as SessionStartResponse;
  } catch {
    // Non-JSON body — fall through to the status-based error below.
  }

  if (!res.ok) {
    const message =
      body.error?.message ??
      `Session start failed (HTTP ${res.status}).`;
    throw new Error(
      body.error?.code ? `${body.error.code}: ${message}` : message,
    );
  }

  // Defensive: 200/201 with no customer should never happen, but guard
  // so we don't hand a null customer to the chat surface.
  if (!body.customer) {
    throw new Error(
      "Session endpoint returned success without a customer object.",
    );
  }

  return body.customer;
}

export function CustomerSessionProvider({ children }: { children: ReactNode }) {
  const [customer, setCustomer] = useState<KosCustomerView | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attemptKey, setAttemptKey] = useState(0);

  // Guards against double-invocation in React 18/19 StrictMode dev mode.
  const inFlight = useRef(false);

  const retry = useCallback(() => {
    setAttemptKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (inFlight.current) return;
    inFlight.current = true;

    const controller = new AbortController();
    let cancelled = false;

    async function run() {
      setIsLoading(true);
      setError(null);
      try {
        const result = await bootstrapOnce(controller.signal);
        if (!cancelled) setCustomer(result);
      } catch (firstErr) {
        if (cancelled || controller.signal.aborted) return;
        // One retry after a short backoff.
        await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
        if (cancelled || controller.signal.aborted) return;
        try {
          const result = await bootstrapOnce(controller.signal);
          if (!cancelled) setCustomer(result);
        } catch (secondErr) {
          if (cancelled || controller.signal.aborted) return;
          const message =
            secondErr instanceof Error
              ? secondErr.message
              : String(secondErr ?? firstErr);
          setError(
            `Couldn't connect to Kalzen chat: ${message} Check your connection and retry.`,
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
        inFlight.current = false;
      }
    }

    void run();

    return () => {
      cancelled = true;
      inFlight.current = false;
      controller.abort();
    };
  }, [attemptKey]);

  return (
    <KosCustomerContext.Provider value={{ customer, isLoading, error, retry }}>
      {children}
    </KosCustomerContext.Provider>
  );
}

export function useKosCustomer(): KosCustomerContextValue {
  const ctx = useContext(KosCustomerContext);
  if (!ctx) {
    throw new Error(
      "useKosCustomer must be used within a <CustomerSessionProvider>.",
    );
  }
  return ctx;
}
