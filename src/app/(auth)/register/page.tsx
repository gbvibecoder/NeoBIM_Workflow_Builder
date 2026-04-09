"use client";

import { useState, useEffect, Suspense } from "react";
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

  // Track page view on mount
  useEffect(() => {
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
          callbackUrl: "/dashboard",
        });
      } else {
        await signIn("credentials", {
          phone: normalizePhone(identifier) ?? identifier,
          password,
          callbackUrl: "/dashboard",
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
      await signIn("google", { callbackUrl: "/dashboard" });
    } catch (err) {
      setError(extractErrorMessage(err, t('auth.somethingWentWrong')));
      setGoogleLoading(false);
    }
  }

  const inputStyle = {
    width: "100%", padding: "10px 14px 10px 36px", height: 44,
    borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)",
    background: "#08080f", color: "#F0F0F5",
    fontSize: 14, outline: "none", boxSizing: "border-box" as const,
    transition: "border-color 0.2s, box-shadow 0.2s",
  };

  const focusHandler = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = "rgba(79,138,255,0.4)";
    e.currentTarget.style.boxShadow = "0 0 0 3px rgba(79,138,255,0.08)";
  };
  const blurHandler = (e: React.FocusEvent<HTMLInputElement>) => {
    e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
    e.currentTarget.style.boxShadow = "none";
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
        <h2 style={{ fontSize: 22, fontWeight: 700, color: "#F0F0F5", marginBottom: 6, letterSpacing: "-0.02em" }}>
          {t('auth.createYourAccount')}
        </h2>
        <p style={{ fontSize: 13.5, color: "#6C6C8A" }}>
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
          width: "100%", padding: "10px 16px", height: 42,
          borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(26,26,42,0.8)", color: "#E0E0EE",
          fontSize: 13, fontWeight: 500, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          marginBottom: 22, transition: "all 0.2s ease",
          opacity: (loading || googleLoading) ? 0.5 : 1,
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
        <span style={{ fontSize: 10.5, color: "#3A3A50", letterSpacing: "0.04em", textTransform: "uppercase" as const, fontWeight: 500 }}>{t('auth.or')}</span>
        <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.04)" }} />
      </div>

      <form onSubmit={handleSubmit}>
        {/* Name */}
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
          <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "#7C7C96", marginBottom: 6, letterSpacing: "-0.005em" }}>
            Email or Phone Number
          </label>
          <div style={{ position: "relative" }}>
            <Mail size={13} style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: "#3A3A50" }} />
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
          <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "#7C7C96", marginBottom: 6, letterSpacing: "-0.005em" }}>
            {t('auth.password')}
          </label>
          <div style={{ position: "relative" }}>
            <Lock size={13} style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: "#3A3A50" }} />
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
          <p style={{ fontSize: 11, color: "#5C5C78", marginTop: 4, lineHeight: 1.4 }}>
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
          <label style={{ display: "block", fontSize: 12.5, fontWeight: 500, color: "#7C7C96", marginBottom: 6, letterSpacing: "-0.005em" }}>
            Confirm Password
          </label>
          <div style={{ position: "relative" }}>
            <Lock size={13} style={{ position: "absolute", left: 13, top: "50%", transform: "translateY(-50%)", color: "#3A3A50" }} />
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
                cursor: "pointer", color: "#3A3A50",
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
            width: "100%", padding: "11px", height: 44,
            borderRadius: 10, border: "none",
            background: (loading || googleLoading)
              ? "rgba(79,138,255,0.3)"
              : "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)",
            color: "#fff", fontSize: 13.5, fontWeight: 600, cursor: (loading || googleLoading) ? "not-allowed" : "pointer",
            opacity: (loading || googleLoading) ? 0.5 : 1, transition: "all 0.2s ease",
            boxShadow: (loading || googleLoading)
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
      </div>
    </motion.div>
  );
}
