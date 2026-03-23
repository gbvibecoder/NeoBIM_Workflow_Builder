"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Mail, ArrowLeft, CheckCircle, Loader2 } from "lucide-react";

const smoothEase: [number, number, number, number] = [0.22, 1, 0.36, 1];

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error || "Something went wrong. Please try again.");
      } else {
        setSent(true);
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: smoothEase }}
        style={{ textAlign: "center" }}
      >
        <div style={{
          width: 64, height: 64, borderRadius: "50%", margin: "0 auto 20px",
          background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <CheckCircle size={28} style={{ color: "#10B981" }} />
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#F0F0F5", marginBottom: 10 }}>
          Check your email
        </h1>
        <p style={{ fontSize: 14, color: "#7C7C96", lineHeight: 1.6, marginBottom: 24 }}>
          If an account exists for <strong style={{ color: "#9898B0" }}>{email}</strong>,
          we&apos;ve sent a password reset link. Check your inbox and spam folder.
        </p>
        <Link href="/login" style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          fontSize: 13, color: "#4F8AFF", textDecoration: "none",
        }}>
          <ArrowLeft size={14} />
          Back to login
        </Link>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: smoothEase }}
    >
      <h1 style={{ fontSize: 24, fontWeight: 700, color: "#F0F0F5", marginBottom: 6 }}>
        Reset your password
      </h1>
      <p style={{ fontSize: 13.5, color: "#7C7C96", marginBottom: 28, lineHeight: 1.5 }}>
        Enter the email address associated with your account and we&apos;ll send you a link to reset your password.
      </p>

      <form onSubmit={handleSubmit}>
        <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "#7C7C96", marginBottom: 6 }}>
          Email address
        </label>
        <div style={{ position: "relative", marginBottom: 16 }}>
          <Mail size={13} style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: "#3A3A50" }} />
          <input
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError(""); }}
            placeholder="you@company.com"
            required
            style={{
              width: "100%", padding: "12px 14px 12px 38px", borderRadius: 12,
              background: "#0D0D18", border: "1px solid rgba(255,255,255,0.06)",
              color: "#F0F0F5", fontSize: 14, outline: "none",
              boxSizing: "border-box",
            }}
          />
        </div>

        {error && (
          <div style={{
            padding: "10px 14px", borderRadius: 10, marginBottom: 16,
            background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)",
            fontSize: 13, color: "#F87171",
          }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !email}
          style={{
            width: "100%", padding: "12px 24px", borderRadius: 12,
            background: loading ? "rgba(79,138,255,0.3)" : "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)",
            color: "#fff", fontSize: 14, fontWeight: 600, border: "none",
            cursor: loading ? "wait" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            opacity: !email ? 0.5 : 1,
            boxSizing: "border-box",
          }}
        >
          {loading ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : null}
          {loading ? "Sending..." : "Send reset link"}
        </button>
      </form>

      <div style={{ textAlign: "center", marginTop: 20 }}>
        <Link href="/login" style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          fontSize: 13, color: "#5C5C78", textDecoration: "none",
        }}>
          <ArrowLeft size={13} />
          Back to login
        </Link>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </motion.div>
  );
}
