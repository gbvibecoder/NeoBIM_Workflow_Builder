"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Mail, Lock, User, Chrome, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { useLocale } from "@/hooks/useLocale";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";

function extractErrorMessage(err: unknown): string {
  if (!err) return "Something went wrong. Please try again.";
  if (typeof err === "string") return err;
  if (typeof err === "object") {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;
    if (typeof obj.error === "string") return obj.error;
    if (typeof obj.error === "object" && obj.error !== null) {
      const nested = obj.error as Record<string, unknown>;
      if (typeof nested.message === "string") return nested.message;
    }
    if (typeof obj.title === "string") return obj.title;
  }
  return "Something went wrong. Please try again.";
}

export default function RegisterPage() {
  const router = useRouter();
  const { t } = useLocale();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(extractErrorMessage(data.error ?? data));
        return;
      }

      const signInRes = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (signInRes?.error) {
        router.push("/login");
      } else {
        router.push("/dashboard");
        router.refresh();
      }
    } catch (err) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setLoading(true);
    try {
      await signIn("google", { callbackUrl: "/dashboard" });
    } catch (err) {
      setError(extractErrorMessage(err));
      setLoading(false);
    }
  }

  const inputStyle = {
    width: "100%", padding: "10px 14px 10px 36px", height: 44,
    borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)",
    background: "#08080f", color: "#F0F0F5",
    fontSize: 14, outline: "none", boxSizing: "border-box" as const,
    transition: "border-color 0.2s, box-shadow 0.2s",
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      style={{
        background: "#0f1019",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 16,
        padding: "40px",
        boxShadow: "0 24px 64px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(255,255,255,0.02) inset",
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <LanguageSwitcher />
      </div>

      {/* Header */}
      <div style={{ marginBottom: 30 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: "#F0F0F5", marginBottom: 6, letterSpacing: "-0.02em" }}>
          {t('auth.createYourAccount')}
        </h2>
        <p style={{ fontSize: 13.5, color: "#6C6C8A" }}>
          {t('auth.startBuilding')}
        </p>
      </div>

      {/* Google OAuth */}
      <motion.button
        whileHover={{ scale: 1.008 }}
        whileTap={{ scale: 0.995 }}
        onClick={handleGoogle}
        disabled={loading}
        style={{
          width: "100%", padding: "10px 16px", height: 42,
          borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(26,26,42,0.8)", color: "#E0E0EE",
          fontSize: 13, fontWeight: 500, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          marginBottom: 22, transition: "all 0.2s ease",
          opacity: loading ? 0.5 : 1,
          boxShadow: "0 1px 2px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.02)",
        }}
      >
        <Chrome size={14} />
        {t('auth.continueWithGoogle')}
      </motion.button>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
        <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.04)" }} />
        <span style={{ fontSize: 10.5, color: "#3A3A50", letterSpacing: "0.04em", textTransform: "uppercase" as const, fontWeight: 500 }}>{t('auth.or')}</span>
        <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.04)" }} />
      </div>

      <form onSubmit={handleSubmit}>
        <motion.div
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          style={{ marginBottom: 14 }}
        >
          <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "#7C7C96", marginBottom: 6, letterSpacing: "-0.005em" }}>
            {t('auth.nameOptional')}
          </label>
          <div style={{ position: "relative" }}>
            <User size={13} style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: "#3A3A50" }} />
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Jane Smith"
              style={inputStyle}
              onFocus={e => {
                e.currentTarget.style.borderColor = "rgba(79,138,255,0.4)";
                e.currentTarget.style.boxShadow = "0 0 0 3px rgba(79,138,255,0.08)";
              }}
              onBlur={e => {
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
                e.currentTarget.style.boxShadow = "none";
              }}
            />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
          style={{ marginBottom: 14 }}
        >
          <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "#7C7C96", marginBottom: 6, letterSpacing: "-0.005em" }}>
            {t('auth.email')}
          </label>
          <div style={{ position: "relative" }}>
            <Mail size={13} style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: "#3A3A50" }} />
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="you@example.com"
              style={inputStyle}
              onFocus={e => {
                e.currentTarget.style.borderColor = "rgba(79,138,255,0.4)";
                e.currentTarget.style.boxShadow = "0 0 0 3px rgba(79,138,255,0.08)";
              }}
              onBlur={e => {
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
                e.currentTarget.style.boxShadow = "none";
              }}
            />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
          style={{ marginBottom: 22 }}
        >
          <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "#7C7C96", marginBottom: 6, letterSpacing: "-0.005em" }}>
            {t('auth.password')}
          </label>
          <div style={{ position: "relative" }}>
            <Lock size={13} style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: "#3A3A50" }} />
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={8}
              placeholder={t('auth.minChars')}
              style={inputStyle}
              onFocus={e => {
                e.currentTarget.style.borderColor = "rgba(79,138,255,0.4)";
                e.currentTarget.style.boxShadow = "0 0 0 3px rgba(79,138,255,0.08)";
              }}
              onBlur={e => {
                e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
                e.currentTarget.style.boxShadow = "none";
              }}
            />
          </div>
        </motion.div>

        {error && (
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            style={{
              padding: "10px 14px", borderRadius: 10,
              background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)",
              fontSize: 12.5, color: "#F87171", marginBottom: 16,
              display: "flex", alignItems: "center", gap: 8,
            }}
          >
            {String(error)}
          </motion.div>
        )}

        <motion.button
          whileHover={{ scale: 1.008 }}
          whileTap={{ scale: 0.995 }}
          type="submit"
          disabled={loading}
          style={{
            width: "100%", padding: "11px", height: 44,
            borderRadius: 10, border: "none",
            background: loading
              ? "rgba(79,138,255,0.3)"
              : "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)",
            color: "#fff", fontSize: 13.5, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer",
            opacity: loading ? 0.5 : 1, transition: "all 0.2s ease",
            boxShadow: loading
              ? "none"
              : "0 1px 3px rgba(79,138,255,0.3), 0 4px 12px rgba(79,138,255,0.15), inset 0 1px 0 rgba(255,255,255,0.1)",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            letterSpacing: "-0.01em",
          }}
        >
          {loading ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              {t('auth.creatingAccount')}
            </>
          ) : (
            t('auth.createAccount')
          )}
        </motion.button>
      </form>

      <p style={{ textAlign: "center", fontSize: 12.5, color: "#5C5C78", marginTop: 24 }}>
        {t('auth.hasAccount')}{" "}
        <Link href="/login" style={{ color: "#4F8AFF", textDecoration: "none", fontWeight: 600, transition: "color 0.15s" }}>
          {t('auth.signIn')}
        </Link>
      </p>
    </motion.div>
  );
}
