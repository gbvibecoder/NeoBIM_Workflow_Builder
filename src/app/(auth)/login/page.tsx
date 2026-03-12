"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Mail, Lock, Chrome, Loader2, AlertCircle, Eye, EyeOff } from "lucide-react";
import { motion } from "framer-motion";
import { validateEmail } from "@/lib/form-validation";
import { useLocale } from "@/hooks/useLocale";
import { LanguageSwitcher } from "@/components/ui/LanguageSwitcher";
import { trackLead } from "@/lib/meta-pixel";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/dashboard";
  const { t } = useLocale();

  // Map NextAuth error codes to user-friendly messages
  const authErrorParam = searchParams.get("error");
  const expiredParam = searchParams.get("expired");
  const authErrorMessages: Record<string, string> = {
    OAuthAccountNotLinked: "This email is already registered with a password. Please sign in with your email and password instead.",
    OAuthCallback: "Something went wrong with Google sign-in. Please try again.",
    OAuthSignin: "Could not start Google sign-in. Please try again.",
    Default: "An authentication error occurred. Please try again.",
  };
  const initialError = expiredParam === "true"
    ? "Your session has expired. Please log in again."
    : authErrorParam
      ? authErrorMessages[authErrorParam] ?? authErrorMessages.Default
      : "";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState("");
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState({ email: false, password: false });

  function handleEmailChange(value: string) {
    setEmail(value);
    setError("");

    if (touched.email) {
      const validation = validateEmail(value);
      setEmailError(validation.isValid ? "" : validation.error || "");
    }
  }

  function handleEmailBlur() {
    setTouched(prev => ({ ...prev, email: true }));
    const validation = validateEmail(email);
    setEmailError(validation.isValid ? "" : validation.error || "");
  }

  function handlePasswordBlur() {
    setTouched(prev => ({ ...prev, password: true }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const emailValidation = validateEmail(email);
    if (!emailValidation.isValid) {
      setEmailError(emailValidation.error || "Invalid email");
      return;
    }

    if (!password || password.length === 0) {
      setError(t('auth.enterPassword'));
      return;
    }

    setLoading(true);

    try {
      const res = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (res?.error) {
        setError(t('auth.invalidCredentials'));
      } else {
        trackLead({ content_name: "email_login" });
        router.push(callbackUrl);
        router.refresh();
      }
    } catch {
      setError(t('auth.genericError'));
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setGoogleLoading(true);
    setError("");
    try {
      await signIn("google", { callbackUrl });
    } catch {
      setError(t('auth.googleError'));
      setGoogleLoading(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="node-card"
      style={{
        '--node-port-color': '#4F8AFF',
        background: "rgba(15,16,25,0.95)",
        boxShadow: "0 24px 64px rgba(0, 0, 0, 0.5), 0 0 40px rgba(79,138,255,0.03)",
      } as React.CSSProperties}
    >
      {/* Node header */}
      <div className="node-header" style={{
        background: "linear-gradient(135deg, rgba(79,138,255,0.1), rgba(99,102,241,0.04))",
        borderBottom: "1px solid rgba(79,138,255,0.08)",
        borderRadius: "16px 16px 0 0",
        justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#10B981", boxShadow: "0 0 8px #10B981" }} />
          <span style={{ color: "#4F8AFF" }}>AUTHENTICATE</span>
        </div>
        <LanguageSwitcher />
      </div>

      <div className="auth-form-inner" style={{ padding: "32px 36px 36px" }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: "#F0F0F5", marginBottom: 6, letterSpacing: "-0.02em" }}>
          {t('auth.welcomeBack')}
        </h2>
        <p style={{ fontSize: 13.5, color: "#6C6C8A" }}>
          {t('auth.signInToContinue')}
        </p>
      </div>

      {/* Google OAuth — completely separate from the credentials form */}
      <motion.button
        type="button"
        whileHover={{ scale: 1.008 }}
        whileTap={{ scale: 0.995 }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          handleGoogle();
        }}
        disabled={loading || googleLoading}
        style={{
          width: "100%", padding: "10px 16px", height: 42,
          borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(26,26,42,0.8)", color: "#E0E0EE",
          fontSize: 13, fontWeight: 500, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          marginBottom: 22, opacity: (loading || googleLoading) ? 0.5 : 1,
          transition: "all 0.2s ease",
          boxShadow: "0 1px 2px rgba(0,0,0,0.1), inset 0 1px 0 rgba(255,255,255,0.02)",
        }}
      >
        {googleLoading ? (
          <>
            <Loader2 size={14} className="animate-spin" />
            {t('auth.connecting')}
          </>
        ) : (
          <>
            <Chrome size={14} />
            {t('auth.continueWithGoogle')}
          </>
        )}
      </motion.button>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
        <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.04)" }} />
        <span style={{ fontSize: 10.5, color: "#3A3A50", letterSpacing: "0.04em", textTransform: "uppercase" as const, fontWeight: 500 }}>{t('auth.orEmail')}</span>
        <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.04)" }} />
      </div>

      <form onSubmit={handleSubmit}>
        {/* Email field */}
        <motion.div
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
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
              onChange={e => handleEmailChange(e.target.value)}
              onBlur={handleEmailBlur}
              onFocus={e => {
                if (!emailError) e.currentTarget.style.borderColor = "rgba(79,138,255,0.4)";
                e.currentTarget.style.boxShadow = "0 0 0 3px rgba(79,138,255,0.08)";
              }}
              required
              placeholder="you@example.com"
              aria-invalid={!!emailError}
              aria-describedby={emailError ? "email-error" : undefined}
              style={{
                width: "100%", padding: "10px 14px 10px 36px", height: 44,
                borderRadius: 10,
                border: `1px solid ${emailError ? "rgba(239,68,68,0.5)" : "rgba(255,255,255,0.06)"}`,
                background: "#08080f", color: "#F0F0F5",
                fontSize: 14, outline: "none", boxSizing: "border-box",
                transition: "border-color 0.2s, box-shadow 0.2s",
              }}
            />
          </div>
          {emailError && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              id="email-error"
              style={{
                marginTop: 6,
                fontSize: 11.5,
                color: "#EF4444",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <AlertCircle size={11} />
              {emailError}
            </motion.div>
          )}
        </motion.div>

        {/* Password field */}
        <motion.div
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
          style={{ marginBottom: 8 }}
        >
          <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "#7C7C96", marginBottom: 6, letterSpacing: "-0.005em" }}>
            {t('auth.password')}
          </label>
          <div style={{ position: "relative" }}>
            <Lock size={13} style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: "#3A3A50" }} />
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={e => { setPassword(e.target.value); setError(""); }}
              onBlur={handlePasswordBlur}
              onFocus={e => {
                e.currentTarget.style.borderColor = "rgba(79,138,255,0.4)";
                e.currentTarget.style.boxShadow = "0 0 0 3px rgba(79,138,255,0.08)";
              }}
              required
              placeholder="••••••••"
              style={{
                width: "100%", padding: "10px 40px 10px 36px", height: 44,
                borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)",
                background: "#08080f", color: "#F0F0F5",
                fontSize: 14, outline: "none", boxSizing: "border-box",
                transition: "border-color 0.2s, box-shadow 0.2s",
              }}
            />
            <button
              type="button"
              tabIndex={0}
              aria-label={showPassword ? "Hide password" : "Show password"}
              onClick={() => setShowPassword(v => !v)}
              style={{
                position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
                background: "none", border: "none", padding: 4,
                cursor: "pointer", color: "#3A3A50",
                display: "flex", alignItems: "center", justifyContent: "center",
                opacity: 0.7, transition: "opacity 0.15s ease",
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "1"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = "0.7"; }}
            >
              {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
        </motion.div>

        {/* Forgot password hint */}
        <div style={{ textAlign: "right", marginBottom: 14 }}>
          <span style={{ fontSize: 11.5, color: "#5C5C78" }}>
            Forgot password? Contact{" "}
            <a href="mailto:support@neobim.io" style={{ color: "#4F8AFF", textDecoration: "none" }}>
              support
            </a>
          </span>
        </div>

        {/* Form-level error */}
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
            <AlertCircle size={13} />
            {error}
          </motion.div>
        )}

        <motion.button
          whileHover={{ scale: 1.008 }}
          whileTap={{ scale: 0.995 }}
          type="submit"
          disabled={loading || googleLoading || !!emailError}
          style={{
            width: "100%", padding: "11px", height: 44, borderRadius: 10, border: "none",
            background: (loading || googleLoading || emailError)
              ? "rgba(79,138,255,0.3)"
              : "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)",
            color: "#fff", fontSize: 13.5, fontWeight: 600,
            cursor: (loading || googleLoading || emailError) ? "not-allowed" : "pointer",
            opacity: (loading || googleLoading || emailError) ? 0.5 : 1,
            boxShadow: (loading || googleLoading || emailError)
              ? "none"
              : "0 1px 3px rgba(79,138,255,0.3), 0 4px 12px rgba(79,138,255,0.15), inset 0 1px 0 rgba(255,255,255,0.1)",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            transition: "all 0.2s ease",
            letterSpacing: "-0.01em",
          }}
        >
          {loading ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              {t('auth.signingIn')}
            </>
          ) : (
            t('auth.signIn')
          )}
        </motion.button>
      </form>

      <p style={{ textAlign: "center", fontSize: 12.5, color: "#5C5C78", marginTop: 24 }}>
        {t('auth.noAccount')}{" "}
        <Link href="/register" style={{ color: "#4F8AFF", textDecoration: "none", fontWeight: 600, transition: "color 0.15s" }}>
          {t('auth.createAccount')}
        </Link>
      </p>
      </div>
    </motion.div>
  );
}

export default function LoginPage() {
  const { t } = useLocale();
  return (
    <Suspense fallback={
      <div style={{
        background: "rgba(18,18,30,0.95)", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 16,
        padding: 28, textAlign: "center", fontSize: 13, color: "#5C5C78",
      }}>
        {t('auth.loading')}
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
