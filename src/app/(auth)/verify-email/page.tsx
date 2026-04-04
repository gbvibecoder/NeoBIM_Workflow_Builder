"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { motion } from "framer-motion";
import { CheckCircle, XCircle, Loader2 } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";

const smoothEase: [number, number, number, number] = [0.22, 1, 0.36, 1];

function VerifyEmailContent() {
  const { t } = useLocale();
  const searchParams = useSearchParams();
  const { update: updateSession } = useSession();
  const token = searchParams.get("token") || "";
  const email = searchParams.get("email") || "";

  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const didVerify = useRef(false);

  useEffect(() => {
    if (!token || !email) {
      setStatus("error");
      setErrorMsg(t('auth.invalidVerificationLink'));
      return;
    }

    // Prevent re-running after session refresh changes updateSession identity
    if (didVerify.current) return;
    didVerify.current = true;

    fetch("/api/auth/verify-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, email }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (res.ok) {
          setStatus("success");
          // Refresh session so emailVerified is immediately reflected
          await updateSession();
        } else {
          setStatus("error");
          setErrorMsg(data?.error || t('auth.verificationFailed'));
        }
      })
      .catch(() => {
        setStatus("error");
        setErrorMsg(t('auth.networkError'));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, email]);

  if (status === "loading") {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        style={{ textAlign: "center", padding: "40px 0" }}
      >
        <Loader2 size={32} style={{ color: "#4F8AFF", animation: "spin 1s linear infinite", marginBottom: 16 }} />
        <p style={{ fontSize: 14, color: "#7C7C96" }}>{t('auth.verifyingEmail')}</p>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      </motion.div>
    );
  }

  if (status === "success") {
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
          {t('auth.emailVerified')}
        </h1>
        <p style={{ fontSize: 14, color: "#7C7C96", lineHeight: 1.6, marginBottom: 24 }}>
          {t('auth.emailVerifiedDesc')}
        </p>
        <Link href="/dashboard" style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "10px 20px", borderRadius: 10,
          background: "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)",
          color: "#fff", fontSize: 13, fontWeight: 600, textDecoration: "none",
        }}>
          {t('auth.goToDashboard')}
        </Link>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: smoothEase }}
      style={{ textAlign: "center" }}
    >
      <div style={{
        width: 64, height: 64, borderRadius: "50%", margin: "0 auto 20px",
        background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        <XCircle size={28} style={{ color: "#EF4444" }} />
      </div>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: "#F0F0F5", marginBottom: 10 }}>
        {t('auth.verificationFailed')}
      </h1>
      <p style={{ fontSize: 14, color: "#7C7C96", lineHeight: 1.6, marginBottom: 8 }}>
        {errorMsg}
      </p>
      <p style={{ fontSize: 12, color: "#55556A", lineHeight: 1.5, marginBottom: 24 }}>
        If you resent the email, make sure to click the link in the <strong style={{ color: "#9898B0" }}>newest</strong> email. Older links are automatically invalidated.
      </p>
      <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
        <Link href="/dashboard/settings" style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "10px 20px", borderRadius: 10,
          background: "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)",
          color: "#fff", fontSize: 13, fontWeight: 600, textDecoration: "none",
        }}>
          Resend from Settings
        </Link>
        <Link href="/dashboard" style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "10px 20px", borderRadius: 10,
          border: "1px solid rgba(79,138,255,0.2)", background: "rgba(79,138,255,0.06)",
          color: "#4F8AFF", fontSize: 13, fontWeight: 600, textDecoration: "none",
        }}>
          {t('auth.goToDashboard')}
        </Link>
      </div>
    </motion.div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div style={{ color: "#7C7C96", textAlign: "center", padding: 40 }}>...</div>}>
      <VerifyEmailContent />
    </Suspense>
  );
}
