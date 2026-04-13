"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Mail, Lock, User, Chrome, Loader2, Eye, EyeOff, Gift } from "lucide-react";
import { motion } from "framer-motion";
import { useLocale } from "@/hooks/useLocale";
import { LanguageSwitcher } from "@/shared/components/ui/LanguageSwitcher";
import { trackCompleteRegistration, trackRegisterPageView } from "@/lib/meta-pixel";
import { validateEmail, validatePhone, normalizePhone } from "@/lib/form-validation";

const PASSWORD_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/;

/** Returns "email" if input contains @, otherwise "phone" */
function detectIdentifierType(value: string): "email" | "phone" {
  return value.includes("@") ? "email" : "phone";
}

function extractErrorMessage(err: unknown, fallback: string): string {
  if (!err) return fallback;
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
  return fallback;
}

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterForm />
    </Suspense>
  );
}

function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const referralCode = searchParams.get("ref") || "";
  const { t } = useLocale();
  const [name, setName] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // Autofocus name field and track page view on mount
  useEffect(() => {
    nameInputRef.current?.focus();
    trackRegisterPageView();
  }, []);

  function validateForm(): string | null {
    if (!name.trim()) return t('auth.nameRequired');
    if (!identifier.trim()) return "Email or phone number is required";

    const type = detectIdentifierType(identifier);
    if (type === "email") {
      const v = validateEmail(identifier);
      if (!v.isValid) return v.error || "Invalid email";
    } else {
      const v = validatePhone(identifier);
      if (!v.isValid) return v.error || "Invalid phone number";
    }

    if (!password) return t('auth.passwordRequired');
    if (password.length < 8) return t('auth.passwordMinLength');
    if (!PASSWORD_REGEX.test(password)) return t('auth.passwordComplexity');
    if (!confirmPassword) return "Please confirm your password";
    if (password !== confirmPassword) return "Passwords don't match";
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);

    try {
      const type = detectIdentifierType(identifier);
      const isEmail = type === "email";

      // Build the request body
      // If email: send email field. If phone: send a placeholder email + phoneNumber.
      // The backend requires email, so for phone-only registration we need to handle this.
      // For now, email is always required by the backend, so if the user enters a phone,
      // we'll send the phone as phoneNumber and require them to also have an email.
      // Actually — let's detect and send properly:
      const body: Record<string, string> = { name, password };
      if (isEmail) {
        body.email = identifier.trim().toLowerCase();
      } else {
        // Phone-only registration: generate a placeholder email from the phone number
        // This keeps backward compatibility with the email-required User model
        const normalized = normalizePhone(identifier) ?? identifier;
        body.email = `${normalized.replace("+", "")}@phone.buildflow.app`;
        body.phoneNumber = normalized;
      }
      if (referralCode) body.referralCode = referralCode;

      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(extractErrorMessage(data.error ?? data, t('auth.somethingWentWrong')));
        return;
      }

      trackCompleteRegistration({
        content_name: isEmail ? "email_signup" : "phone_signup",
        ...(isEmail && { user_email: identifier.trim().toLowerCase() }),
        user_name: name.trim()
      });

      // Auto-login: for email use email creds, for phone use phone creds
      if (isEmail) {
        await signIn("credentials", {
          email: identifier.trim().toLowerCase(),
          password,
          callbackUrl: "/welcome",
        });
      } else {
        await signIn("credentials", {
          phone: normalizePhone(identifier) ?? identifier,
          password,
          callbackUrl: "/welcome",
        });
      }
    } catch (err) {
      setError(extractErrorMessage(err, t('auth.somethingWentWrong')));
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setGoogleLoading(true);
    setError("");
    try {
      if (referralCode) {
        localStorage.setItem("pending_referral_code", referralCode);
      }
      trackCompleteRegistration({ content_name: "google_signup" });
      await signIn("google", { callbackUrl: "/welcome" });
    } catch (err) {
      setError(extractErrorMessage(err, t('auth.somethingWentWrong')));
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
    e.currentTarget.style.borderColor = "rgba(99,102,241,0.6)";
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
        '--node-port-color': '#10B981',
        background: "rgba(15,16,25,0.95)",
        boxShadow: "0 24px 64px rgba(0, 0, 0, 0.5), 0 0 40px rgba(16,185,129,0.03)",
      } as React.CSSProperties}
    >
      {/* Node header */}
      <div className="node-header" style={{
        background: "linear-gradient(135deg, rgba(16,185,129,0.1), rgba(16,185,129,0.03))",
        borderBottom: "1px solid rgba(16,185,129,0.08)",
        borderRadius: "16px 16px 0 0",
        justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#10B981", boxShadow: "0 0 8px #10B981" }} />
          <span style={{ color: "#10B981" }}>{t('auth.newAccount')}</span>
        </div>
        <LanguageSwitcher />
      </div>

      <div className="auth-form-inner" style={{ padding: "32px 36px 36px" }}>
      <style>{`
        .auth-form-inner input::placeholder { color: #7878A0 !important; opacity: 1; font-weight: 500; }
        .auth-form-inner input:-webkit-autofill { -webkit-text-fill-color: #FFFFFF !important; -webkit-box-shadow: 0 0 0 1000px #0E0F18 inset !important; }
      `}</style>
      {/* Referral welcome banner */}
      {referralCode && (
        <div style={{
          display: "flex", alignItems: "center", gap: 10,
          padding: "10px 14px", borderRadius: 10, marginBottom: 16,
          background: "rgba(16,185,129,0.08)",
          border: "1px solid rgba(16,185,129,0.15)",
        }}>
          <Gift size={16} style={{ color: "#10B981", flexShrink: 0 }} />
          <span style={{ fontSize: 12.5, color: "#6EE7B7", lineHeight: 1.4 }}>
            You were invited! Sign up and you both get a bonus execution.
          </span>
        </div>
      )}

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h2 style={{
          fontSize: 28, fontWeight: 800, marginBottom: 8, letterSpacing: "-0.03em",
          background: "linear-gradient(135deg, #FFFFFF 0%, #E0E7FF 50%, #A5B4FC 100%)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          backgroundClip: "text", lineHeight: 1.15,
        }}>
          {t('auth.createYourAccount')}
        </h2>
        <p style={{ fontSize: 14.5, color: "#A8A8C4", fontWeight: 500, lineHeight: 1.5 }}>
          {t('auth.startBuilding')}
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
        <span style={{ fontSize: 11.5, color: "#9494B4", letterSpacing: "0.12em", textTransform: "uppercase" as const, fontWeight: 700 }}>{t('auth.or')}</span>
        <div style={{ flex: 1, height: 1, background: "linear-gradient(90deg, rgba(255,255,255,0.12), transparent)" }} />
      </div>

      <form onSubmit={handleSubmit}>
        {/* Name */}
        <motion.div
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
          style={{ marginBottom: 14 }}
        >
          <label style={labelStyle}>
            {t('auth.nameOptional')}
          </label>
          <div style={{ position: "relative" }}>
            <User size={15} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "#818CF8" }} />
            <input
              ref={nameInputRef}
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Jane Smith"
              autoFocus
              style={inputStyle}
              onFocus={focusHandler}
              onBlur={blurHandler}
            />
          </div>
        </motion.div>

        {/* Email or Phone — single field */}
        <motion.div
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
          style={{ marginBottom: 14 }}
        >
          <label style={labelStyle}>
            Email or Phone Number
          </label>
          <div style={{ position: "relative" }}>
            <Mail size={15} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "#818CF8" }} />
            <input
              type="text"
              value={identifier}
              onChange={e => { setIdentifier(e.target.value); setError(""); }}
              required
              placeholder="you@email.com or +91 phone number"
              autoComplete="username"
              style={inputStyle}
              onFocus={focusHandler}
              onBlur={blurHandler}
            />
          </div>
        </motion.div>

        {/* Password */}
        <motion.div
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
          style={{ marginBottom: 14 }}
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
              required
              minLength={8}
              placeholder={t('auth.minChars')}
              autoComplete="new-password"
              style={{ ...inputStyle, paddingRight: 40 }}
              onFocus={focusHandler}
              onBlur={blurHandler}
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
          <p style={{ fontSize: 12, color: "#9494B4", marginTop: 6, lineHeight: 1.5, fontWeight: 500 }}>
            {t('auth.passwordRequirements')}
          </p>
        </motion.div>

        {/* Confirm Password */}
        <motion.div
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.25, ease: [0.22, 1, 0.36, 1] }}
          style={{ marginBottom: 22 }}
        >
          <label style={labelStyle}>
            Confirm Password
          </label>
          <div style={{ position: "relative" }}>
            <Lock size={15} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "#818CF8" }} />
            <input
              type={showConfirm ? "text" : "password"}
              value={confirmPassword}
              onChange={e => { setConfirmPassword(e.target.value); setError(""); }}
              required
              minLength={8}
              placeholder="Re-enter password"
              autoComplete="new-password"
              style={{ ...inputStyle, paddingRight: 40 }}
              onFocus={focusHandler}
              onBlur={blurHandler}
            />
            <button
              type="button"
              tabIndex={0}
              aria-label={showConfirm ? t('auth.hidePassword') : t('auth.showPassword')}
              onClick={() => setShowConfirm(v => !v)}
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
              {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          {confirmPassword && password !== confirmPassword && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              style={{
                marginTop: 6, fontSize: 11.5, color: "#EF4444",
                display: "flex", alignItems: "center", gap: 4,
              }}
            >
              <span>Passwords don&apos;t match</span>
            </motion.div>
          )}
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
          disabled={loading || googleLoading}
          style={{
            width: "100%", padding: "14px", height: 52,
            borderRadius: 12, border: "none",
            background: (loading || googleLoading)
              ? "rgba(99,102,241,0.3)"
              : "linear-gradient(135deg, #4F8AFF 0%, #6366F1 50%, #8B5CF6 100%)",
            color: "#fff", fontSize: 15.5, fontWeight: 700, cursor: (loading || googleLoading) ? "not-allowed" : "pointer",
            opacity: (loading || googleLoading) ? 0.5 : 1, transition: "all 0.2s ease",
            boxShadow: (loading || googleLoading)
              ? "none"
              : "0 4px 16px rgba(99,102,241,0.4), 0 8px 32px rgba(99,102,241,0.2), inset 0 1px 0 rgba(255,255,255,0.2)",
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

      <p style={{ textAlign: "center", fontSize: 13.5, color: "#A8A8C4", marginTop: 24, fontWeight: 500 }}>
        {t('auth.hasAccount')}{" "}
        <Link href="/login" style={{ color: "#A5B4FC", textDecoration: "none", fontWeight: 700, transition: "color 0.15s" }}>
          {t('auth.signIn')}
        </Link>
      </p>
      </div>
    </motion.div>
  );
}
