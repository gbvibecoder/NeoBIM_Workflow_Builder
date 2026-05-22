"use client";

/**
 * BD login form — controlled inputs, POSTs to /api/kos/bd/login,
 * redirects to /bd on success. Uses `sonner` for transient errors
 * (already in BuildFlow's deps); falls back to an inline error line
 * for accessibility / no-JS-toast scenarios.
 */

import { useState } from "react";
import { toast } from "sonner";

export default function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/kos/bd/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
        credentials: "same-origin",
      });

      let body: { error?: { code?: string; message?: string }; ok?: boolean } = {};
      try {
        body = await res.json();
      } catch {
        // Non-JSON body — treat as opaque network error.
      }

      if (!res.ok || !body.ok) {
        const message =
          body.error?.message ??
          `Login failed (HTTP ${res.status}). Try again.`;
        setError(message);
        toast.error(message);
        return;
      }

      // Success — hard redirect so the (authenticated) layout's
      // server-side session lookup re-runs with the fresh cookie.
      window.location.href = "/bd";
    } catch (err) {
      const message =
        err instanceof Error
          ? `Network error: ${err.message}`
          : "Network error during BD login.";
      setError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <div style={{ marginBottom: 14 }}>
        <label
          htmlFor="kos-bd-email"
          style={{
            display: "block",
            fontSize: 12,
            fontWeight: 600,
            marginBottom: 6,
            opacity: 0.8,
          }}
        >
          Email
        </label>
        <input
          id="kos-bd-email"
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError(null);
          }}
          placeholder="you@kalzen.com"
          style={inputStyle}
        />
      </div>

      <div style={{ marginBottom: 18 }}>
        <label
          htmlFor="kos-bd-password"
          style={{
            display: "block",
            fontSize: 12,
            fontWeight: 600,
            marginBottom: 6,
            opacity: 0.8,
          }}
        >
          Password
        </label>
        <input
          id="kos-bd-password"
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError(null);
          }}
          placeholder="••••••••"
          style={inputStyle}
        />
      </div>

      {error && (
        <div
          role="alert"
          style={{
            fontSize: 12.5,
            color: "#fca5a5",
            background: "rgba(220,38,38,0.08)",
            border: "1px solid rgba(220,38,38,0.25)",
            borderRadius: 8,
            padding: "8px 10px",
            marginBottom: 14,
          }}
        >
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || !email || !password}
        style={{
          width: "100%",
          padding: "10px 14px",
          borderRadius: 10,
          border: "none",
          cursor: submitting || !email || !password ? "not-allowed" : "pointer",
          background: "var(--kos-secondary, #c9a55a)",
          color: "var(--kos-primary, #0a3d2e)",
          fontSize: 14,
          fontWeight: 700,
          letterSpacing: "0.01em",
          opacity: submitting || !email || !password ? 0.6 : 1,
          transition: "opacity 120ms ease",
        }}
      >
        {submitting ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 10,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.4)",
  color: "#fafafa",
  fontSize: 14,
  outline: "none",
  boxSizing: "border-box",
};
