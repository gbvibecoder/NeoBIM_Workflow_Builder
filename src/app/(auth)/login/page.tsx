"use client";

import { Suspense, useState, useRef, useEffect } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Mail, Lock, Chrome, Loader2, AlertCircle, Eye, EyeOff } from "lucide-react";
import { motion } from "framer-motion";
import { validateEmail, validatePhone, normalizePhone } from "@/lib/form-validation";
import { useLocale } from "@/hooks/useLocale";
import { LanguageSwitcher } from "@/shared/components/ui/LanguageSwitcher";
import { trackLead } from "@/lib/meta-pixel";

/** Returns "email" if input contains @, otherwise "phone" */
function detectIdentifierType(value: string): "email" | "phone" {
  return value.includes("@") ? "email" : "phone";
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/dashboard";
  const { t } = useLocale();
  const identifierInputRef = useRef<HTMLInputElement>(null);

  // Map NextAuth error codes to user-friendly messages
  const authErrorParam = searchParams.get("error");
  const expiredParam = searchParams.get("expired");
  const authErrorMessages: Record<string, string> = {
    OAuthAccountNotLinked: t('auth.oauthAccountNotLinked'),
    OAuthCallback: t('auth.oauthCallback'),
    OAuthSignin: t('auth.oauthSignin'),
    Default: t('auth.defaultAuthError'),
  };
  const initialError = expiredParam === "true"
    ? t('auth.sessionExpired')
    : authErrorParam
      ? authErrorMessages[authErrorParam] ?? authErrorMessages.Default
      : "";

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [identifierError, setIdentifierError] = useState("");
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState({ identifier: false, password: false });

  // Autofocus identifier field on mount
  useEffect(() => {
    identifierInputRef.current?.focus();
  }, []);

  function handleIdentifierChange(value: string) {
    setIdentifier(value);
    setError("");
    if (touched.identifier && value.trim()) {
      const type = detectIdentifierType(value);
      if (type === "email") {
        const v = validateEmail(value);
        setIdentifierError(v.isValid ? "" : v.error || "");
      } else {
        const v = validatePhone(value);
        setIdentifierError(v.isValid ? "" : v.error || "");
      }
    } else if (touched.identifier && !value.trim()) {
      setIdentifierError("Email or phone number is required");
    }
  }

  function handleIdentifierBlur() {
    setTouched(prev => ({ ...prev, identifier: true }));
    if (!identifier.trim()) {
      setIdentifierError("Email or phone number is required");
      return;
    }
    const type = detectIdentifierType(identifier);
    if (type === "email") {
      const v = validateEmail(identifier);
      setIdentifierError(v.isValid ? "" : v.error || "");
    } else {
      const v = validatePhone(identifier);
      setIdentifierError(v.isValid ? "" : v.error || "");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!identifier.trim()) {
      setIdentifierError("Email or phone number is required");
      return;
    }

    const type = detectIdentifierType(identifier);

    if (type === "email") {
      const v = validateEmail(identifier);
      if (!v.isValid) { setIdentifierError(v.error || "Invalid email"); return; }
    } else {
      const v = validatePhone(identifier);
      if (!v.isValid) { setIdentifierError(v.error || "Invalid phone number"); return; }
    }

    if (!password || password.length === 0) {
      setError(t('auth.enterPassword'));
      return;
    }

    setLoading(true);

    try {
      const credentials = type === "email"
        ? { email: identifier.trim().toLowerCase(), password, redirect: false as const }
        : { phone: normalizePhone(identifier) ?? identifier, password, redirect: false as const };

      const res = await signIn("credentials", credentials);

      if (res?.error) {
        setError("Invalid email/phone or password. Please try again.");
      } else {
        trackLead({ content_name: type === "email" ? "email_login" : "phone_login" });
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

  const inputStyle = {
    width: "100%", padding: "12px 14px 12px 38px", height: 48,
    borderRadius: 12, border: "1px solid rgba(255,255,255,0.12)",
    background: "linear-gradient(180deg, rgba(14,15,24,0.95), rgba(10,11,20,0.95))",
    color: "#FFFFFF",
    fontSize: 15, fontWeight: 500, outline: "none", boxSizing: "border-box" as const,
    transition: "border-color 0.2s, box-shadow 0.2s, background 0.2s",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 2px rgba(0,0,0,0.3)",
  };

  const labelStyle = {
    display: "block", fontSize: 13, fontWeight: 600,
    color: "#D4D4E8", marginBottom: 8, letterSpacing: "0.005em",
  } as const;

  const focusHandler = (e: React.FocusEvent<HTMLInputElement>) => {
    if (!identifierError || e.currentTarget.name !== "identifier") {
      e.currentTarget.style.borderColor = "rgba(99,102,241,0.6)";
    }
    e.currentTarget.style.boxShadow = "0 0 0 4px rgba(99,102,241,0.12), inset 0 1px 0 rgba(255,255,255,0.06)";
  };
  const blurHandler = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = "rgba(255,255,255,0.12)";
    e.currentTarget.style.boxShadow = "inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 2px rgba(0,0,0,0.3)";
  };

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
          <span style={{ color: "#4F8AFF" }}>{t('auth.authenticate')}</span>
        </div>
        <LanguageSwitcher />
      </div>

      <div className="auth-form-inner" style={{ padding: "32px 36px 36px" }}>
      <style>{`
        .auth-form-inner input::placeholder { color: #7878A0 !important; opacity: 1; font-weight: 500; }
        .auth-form-inner input:-webkit-autofill { -webkit-text-fill-color: #FFFFFF !important; -webkit-box-shadow: 0 0 0 1000px #0E0F18 inset !important; }
      `}</style>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h2 style={{
          fontSize: 28, fontWeight: 800, marginBottom: 8, letterSpacing: "-0.03em",
          background: "linear-gradient(135deg, #FFFFFF 0%, #E0E7FF 50%, #A5B4FC 100%)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          backgroundClip: "text", lineHeight: 1.15,
        }}>
          {t('auth.welcomeBack')}
        </h2>
        <p style={{ fontSize: 14.5, color: "#A8A8C4", fontWeight: 500, lineHeight: 1.5 }}>
          {t('auth.signInToContinue')}
        </p>
      </div>

      {/* Google OAuth */}
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
          width: "100%", padding: "12px 16px", height: 48,
          borderRadius: 12, border: "1px solid rgba(255,255,255,0.14)",
          background: "linear-gradient(180deg, rgba(36,38,58,0.95), rgba(26,28,46,0.95))",
          color: "#FFFFFF",
          fontSize: 14.5, fontWeight: 600, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
          marginBottom: 22, transition: "all 0.2s ease",
          opacity: (loading || googleLoading) ? 0.5 : 1,
          boxShadow: "0 2px 8px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.08)",
          letterSpacing: "-0.005em",
        }}
      >
        {googleLoading ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            {t('auth.connecting')}
          </>
        ) : (
          <>
            <Chrome size={16} />
            {t('auth.continueWithGoogle')}
          </>
        )}
      </motion.button>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
        <div style={{ flex: 1, height: 1, background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.12))" }} />
        <span style={{ fontSize: 11.5, color: "#9494B4", letterSpacing: "0.12em", textTransform: "uppercase" as const, fontWeight: 700 }}>{t('auth.orEmail')}</span>
        <div style={{ flex: 1, height: 1, background: "linear-gradient(90deg, rgba(255,255,255,0.12), transparent)" }} />
      </div>

      <form onSubmit={handleSubmit}>
        {/* Email or Phone — single field */}
        <motion.div
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          style={{ marginBottom: 14 }}
        >
          <label style={labelStyle}>
            Email or Phone Number
          </label>
          <div style={{ position: "relative" }}>
            <Mail size={15} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "#818CF8" }} />
            <input
              ref={identifierInputRef}
              name="identifier"
              type="text"
              value={identifier}
              onChange={e => handleIdentifierChange(e.target.value)}
              onBlur={(e) => {
                handleIdentifierBlur();
                blurHandler(e);
              }}
              onFocus={focusHandler}
              required
              autoFocus
              placeholder="you@email.com or +91 phone number"
              autoComplete="username"
              aria-invalid={!!identifierError}
              aria-describedby={identifierError ? "identifier-error" : undefined}
              style={{
                ...inputStyle,
                border: `1px solid ${identifierError ? "rgba(239,68,68,0.5)" : "rgba(255,255,255,0.12)"}`,
              }}
            />
          </div>
          {identifierError && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              id="identifier-error"
              style={{
                marginTop: 6, fontSize: 11.5, color: "#EF4444",
                display: "flex", alignItems: "center", gap: 4,
              }}
            >
              <AlertCircle size={11} />
              {identifierError}
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
          <label style={labelStyle}>
            {t('auth.password')}
          </label>
          <div style={{ position: "relative" }}>
            <Lock size={15} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "#818CF8" }} />
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={e => { setPassword(e.target.value); setError(""); }}
              onFocus={focusHandler}
              onBlur={blurHandler}
              required
              placeholder="Enter your password"
              autoComplete="current-password"
              style={{ ...inputStyle, paddingRight: 40 }}
            />
            <button
              type="button"
              tabIndex={0}
              aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
              onClick={() => setShowPassword(v => !v)}
              style={{
                position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
                background: "none", border: "none", padding: 4,
                cursor: "pointer", color: "#A5B4FC",
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
        <div style={{ textAlign: "right", marginBottom: 22 }}>
          <a
            href="/forgot-password"
            style={{
              fontSize: 12.5, color: "#A5B4FC", textDecoration: "none", fontWeight: 600,
              transition: "color 0.15s",
            }}
          >
            {t('auth.forgotPassword')}
          </a>
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
          disabled={loading || googleLoading || !!identifierError}
          style={{
            width: "100%", padding: "14px", height: 52,
            borderRadius: 12, border: "none",
            background: (loading || googleLoading || identifierError)
              ? "rgba(99,102,241,0.3)"
              : "linear-gradient(135deg, #4F8AFF 0%, #6366F1 50%, #8B5CF6 100%)",
            color: "#fff", fontSize: 15.5, fontWeight: 700,
            cursor: (loading || googleLoading || identifierError) ? "not-allowed" : "pointer",
            opacity: (loading || googleLoading || identifierError) ? 0.5 : 1,
            boxShadow: (loading || googleLoading || identifierError)
              ? "none"
              : "0 4px 16px rgba(99,102,241,0.4), 0 8px 32px rgba(99,102,241,0.2), inset 0 1px 0 rgba(255,255,255,0.2)",
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

      <p style={{ textAlign: "center", fontSize: 13.5, color: "#A8A8C4", marginTop: 24, fontWeight: 500 }}>
        {t('auth.noAccount')}{" "}
        <Link href="/register" style={{ color: "#A5B4FC", textDecoration: "none", fontWeight: 700, transition: "color 0.15s" }}>
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
