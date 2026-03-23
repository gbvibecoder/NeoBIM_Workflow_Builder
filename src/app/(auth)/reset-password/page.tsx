"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Lock, ArrowLeft, CheckCircle, Loader2, Eye, EyeOff } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";

const smoothEase: [number, number, number, number] = [0.22, 1, 0.36, 1];

function ResetPasswordForm() {
  const { t } = useLocale();
  const searchParams = useSearchParams();
  const token = searchParams.get("token") || "";
  const email = searchParams.get("email") || "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError(t('auth.passwordsDoNotMatch'));
      return;
    }

    if (password.length < 8) {
      setError(t('auth.passwordMinLength'));
      return;
    }

    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/;
    if (!passwordRegex.test(password)) {
      setError(t('auth.passwordRequirements'));
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, email, password }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data?.error || t('auth.somethingWentWrong'));
      } else {
        setSuccess(true);
      }
    } catch {
      setError(t('auth.networkError'));
    } finally {
      setLoading(false);
    }
  };

  if (!token || !email) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: smoothEase }}
        style={{ textAlign: "center" }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#F0F0F5", marginBottom: 10 }}>
          {t('auth.invalidResetLink')}
        </h1>
        <p style={{ fontSize: 14, color: "#7C7C96", lineHeight: 1.6, marginBottom: 24 }}>
          {t('auth.invalidResetLinkDesc')}
        </p>
        <Link href="/forgot-password" style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "10px 20px", borderRadius: 10,
          background: "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)",
          color: "#fff", fontSize: 13, fontWeight: 600, textDecoration: "none",
        }}>
          {t('auth.requestNewLink')}
        </Link>
      </motion.div>
    );
  }

  if (success) {
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
          {t('auth.passwordResetSuccess')}
        </h1>
        <p style={{ fontSize: 14, color: "#7C7C96", lineHeight: 1.6, marginBottom: 24 }}>
          {t('auth.passwordResetSuccessDesc')}
        </p>
        <Link href="/login" style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "10px 20px", borderRadius: 10,
          background: "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)",
          color: "#fff", fontSize: 13, fontWeight: 600, textDecoration: "none",
        }}>
          {t('auth.signIn')}
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
        {t('auth.chooseNewPassword')}
      </h1>
      <p style={{ fontSize: 13.5, color: "#7C7C96", marginBottom: 28, lineHeight: 1.5 }}>
        {t('auth.chooseNewPasswordDesc')}
      </p>

      <form onSubmit={handleSubmit}>
        <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "#7C7C96", marginBottom: 6 }}>
          {t('auth.newPassword')}
        </label>
        <div style={{ position: "relative", marginBottom: 16 }}>
          <Lock size={13} style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: "#3A3A50" }} />
          <input
            type={showPassword ? "text" : "password"}
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(""); }}
            placeholder={t('auth.newPassword')}
            required
            style={{
              width: "100%", padding: "12px 40px 12px 38px", borderRadius: 12,
              background: "#0D0D18", border: "1px solid rgba(255,255,255,0.06)",
              color: "#F0F0F5", fontSize: 14, outline: "none", boxSizing: "border-box",
            }}
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            style={{
              position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
              background: "none", border: "none", cursor: "pointer", color: "#5C5C78", display: "flex",
            }}
          >
            {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>

        <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "#7C7C96", marginBottom: 6 }}>
          {t('auth.confirmPassword')}
        </label>
        <div style={{ position: "relative", marginBottom: 16 }}>
          <Lock size={13} style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: "#3A3A50" }} />
          <input
            type={showPassword ? "text" : "password"}
            value={confirmPassword}
            onChange={(e) => { setConfirmPassword(e.target.value); setError(""); }}
            placeholder={t('auth.confirmNewPassword')}
            required
            style={{
              width: "100%", padding: "12px 14px 12px 38px", borderRadius: 12,
              background: "#0D0D18", border: "1px solid rgba(255,255,255,0.06)",
              color: "#F0F0F5", fontSize: 14, outline: "none", boxSizing: "border-box",
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
          disabled={loading || !password || !confirmPassword}
          style={{
            width: "100%", padding: "12px 24px", borderRadius: 12,
            background: loading ? "rgba(79,138,255,0.3)" : "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)",
            color: "#fff", fontSize: 14, fontWeight: 600, border: "none",
            cursor: loading ? "wait" : "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            opacity: (!password || !confirmPassword) ? 0.5 : 1,
            boxSizing: "border-box",
          }}
        >
          {loading ? <Loader2 size={16} style={{ animation: "spin 1s linear infinite" }} /> : null}
          {loading ? t('auth.resetting') : t('auth.resetPassword')}
        </button>
      </form>

      <div style={{ textAlign: "center", marginTop: 20 }}>
        <Link href="/login" style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          fontSize: 13, color: "#5C5C78", textDecoration: "none",
        }}>
          <ArrowLeft size={13} />
          {t('auth.backToLogin')}
        </Link>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </motion.div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div style={{ color: "#7C7C96", textAlign: "center", padding: 40 }}>...</div>}>
      <ResetPasswordForm />
    </Suspense>
  );
}
