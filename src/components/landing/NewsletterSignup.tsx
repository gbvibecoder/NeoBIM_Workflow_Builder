"use client";

import { useState } from "react";
import { Mail, ArrowRight, Check, Loader2 } from "lucide-react";

export function NewsletterSignup() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || status === "loading") return;

    setStatus("loading");
    setErrorMsg("");

    try {
      const res = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to subscribe");
      }

      setStatus("success");
      setEmail("");
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong");
    }
  };

  if (status === "success") {
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "14px 20px", borderRadius: 12,
        background: "rgba(16, 185, 129, 0.08)",
        border: "1px solid rgba(16, 185, 129, 0.2)",
      }}>
        <Check size={18} style={{ color: "#10B981" }} />
        <span style={{ fontSize: 14, color: "#10B981", fontWeight: 500 }}>
          You're subscribed! We'll keep you updated.
        </span>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 440 }}>
      <div style={{
        display: "flex", gap: 8,
        padding: 4,
        borderRadius: 14,
        background: "rgba(255,255,255,0.03)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}>
        <div style={{ position: "relative", flex: 1 }}>
          <Mail
            size={16}
            style={{
              position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)",
              color: "#556070", pointerEvents: "none",
            }}
          />
          <input
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); if (status === "error") setStatus("idle"); }}
            placeholder="you@example.com"
            required
            style={{
              width: "100%",
              padding: "12px 14px 12px 40px",
              borderRadius: 10,
              border: "none",
              background: "transparent",
              color: "#E2E8F0",
              fontSize: 14,
              outline: "none",
              fontFamily: "inherit",
            }}
          />
        </div>
        <button
          type="submit"
          disabled={status === "loading"}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "10px 20px",
            borderRadius: 10,
            border: "none",
            background: "linear-gradient(135deg, #4F8AFF, #6366F1)",
            color: "white",
            fontSize: 13,
            fontWeight: 600,
            cursor: status === "loading" ? "wait" : "pointer",
            whiteSpace: "nowrap",
            fontFamily: "inherit",
            transition: "opacity 0.15s",
            opacity: status === "loading" ? 0.7 : 1,
          }}
        >
          {status === "loading" ? (
            <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
          ) : (
            <>Subscribe <ArrowRight size={14} /></>
          )}
        </button>
      </div>
      {status === "error" && (
        <p style={{ fontSize: 12, color: "#EF4444", marginTop: 8, paddingLeft: 4 }}>
          {errorMsg}
        </p>
      )}
      <p style={{ fontSize: 11, color: "#556070", marginTop: 10, paddingLeft: 4 }}>
        No spam, ever. Unsubscribe anytime.
      </p>
    </form>
  );
}
