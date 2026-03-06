"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Mail, Lock, Chrome, Loader2, AlertCircle } from "lucide-react";
import { motion } from "framer-motion";
import { validateEmail } from "@/lib/form-validation";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState({ email: false, password: false });

  function handleEmailChange(value: string) {
    setEmail(value);
    setError(""); // Clear form-level error
    
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
    
    // Validate before submission
    const emailValidation = validateEmail(email);
    if (!emailValidation.isValid) {
      setEmailError(emailValidation.error || "Invalid email");
      return;
    }
    
    if (!password || password.length === 0) {
      setError("Please enter your password");
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
        setError("Invalid email or password. Please try again.");
      } else {
        router.push(callbackUrl);
        router.refresh();
      }
    } catch (err) {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setLoading(true);
    try {
      await signIn("google", { callbackUrl });
    } catch {
      setError("Google sign-in failed. Please try again.");
      setLoading(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.25, 0.4, 0.25, 1] }}
      style={{
        background: "#12121E",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 16,
        padding: 40,
        boxShadow: "0 24px 64px rgba(0, 0, 0, 0.4)",
      }}
    >
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 24, fontWeight: 700, color: "#F0F0F5", marginBottom: 6 }}>
          Welcome back
        </h2>
        <p style={{ fontSize: 14, color: "#9898B0" }}>
          Sign in to continue to Workflow Builder
        </p>
      </div>

      {/* Google OAuth */}
      <motion.button
        whileHover={{ scale: 1.01 }}
        whileTap={{ scale: 0.99 }}
        onClick={handleGoogle}
        disabled={loading}
        style={{
          width: "100%", padding: "11px 16px",
          borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)",
          background: "#1A1A2A", color: "#F0F0F5",
          fontSize: 13, fontWeight: 500, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          marginBottom: 20, opacity: loading ? 0.6 : 1,
          transition: "all 0.15s ease",
        }}
      >
        <Chrome size={15} />
        Continue with Google
      </motion.button>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.06)" }} />
        <span style={{ fontSize: 11, color: "#3A3A4E" }}>or email</span>
        <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.06)" }} />
      </div>

      <form onSubmit={handleSubmit}>
        {/* Email field with validation */}
        <motion.div
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1 }}
          style={{ marginBottom: 14 }}
        >
          <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#9898B0", marginBottom: 6 }}>
            Email
          </label>
          <div style={{ position: "relative" }}>
            <Mail size={13} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "#3A3A50" }} />
            <input
              type="email"
              value={email}
              onChange={e => handleEmailChange(e.target.value)}
              onBlur={handleEmailBlur}
              onFocus={e => { 
                if (!emailError) e.currentTarget.style.borderColor = "#4F8AFF"; 
              }}
              required
              placeholder="you@example.com"
              aria-invalid={!!emailError}
              aria-describedby={emailError ? "email-error" : undefined}
              style={{
                width: "100%", padding: "10px 14px 10px 38px", height: 42,
                borderRadius: 8, 
                border: `1px solid ${emailError ? "#EF4444" : "rgba(255,255,255,0.08)"}`,
                background: "#0B0B13", color: "#F0F0F5",
                fontSize: 14, outline: "none", boxSizing: "border-box",
                transition: "border-color 0.15s",
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
                fontSize: 12,
                color: "#EF4444",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <AlertCircle size={12} />
              {emailError}
            </motion.div>
          )}
        </motion.div>

        {/* Password field */}
        <motion.div
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.15 }}
          style={{ marginBottom: 20 }}
        >
          <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#9898B0", marginBottom: 6 }}>
            Password
          </label>
          <div style={{ position: "relative" }}>
            <Lock size={13} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "#3A3A50" }} />
            <input
              type="password"
              value={password}
              onChange={e => { setPassword(e.target.value); setError(""); }}
              onBlur={handlePasswordBlur}
              onFocus={e => { e.currentTarget.style.borderColor = "#4F8AFF"; }}
              required
              placeholder="••••••••"
              style={{
                width: "100%", padding: "10px 14px 10px 38px", height: 42,
                borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)",
                background: "#0B0B13", color: "#F0F0F5",
                fontSize: 14, outline: "none", boxSizing: "border-box",
                transition: "border-color 0.15s",
              }}
            />
          </div>
        </motion.div>

        {/* Form-level error */}
        {error && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            style={{
              padding: "10px 14px", borderRadius: 8,
              background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.25)",
              fontSize: 13, color: "#F87171", marginBottom: 16,
              display: "flex", alignItems: "center", gap: 8,
            }}
          >
            <AlertCircle size={14} />
            {error}
          </motion.div>
        )}

        <motion.button
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
          type="submit"
          disabled={loading || !!emailError}
          style={{
            width: "100%", padding: "11px", height: 42, borderRadius: 8, border: "none",
            background: (loading || emailError) 
              ? "rgba(79,138,255,0.4)" 
              : "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)",
            color: "#fff", fontSize: 14, fontWeight: 600, 
            cursor: (loading || emailError) ? "not-allowed" : "pointer",
            opacity: (loading || emailError) ? 0.6 : 1,
            boxShadow: "0 0 0 1px rgba(79,138,255,0.3), 0 2px 8px rgba(79,138,255,0.2)",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            transition: "all 0.15s ease",
          }}
        >
          {loading ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Signing in…
            </>
          ) : (
            "Sign in"
          )}
        </motion.button>
      </form>

      <p style={{ textAlign: "center", fontSize: 13, color: "#5C5C78", marginTop: 24 }}>
        Don&apos;t have an account?{" "}
        <Link href="/register" style={{ color: "#4F8AFF", textDecoration: "none", fontWeight: 600 }}>
          Create account
        </Link>
      </p>
    </motion.div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div style={{
        background: "#12121A", border: "1px solid #1E1E2E", borderRadius: 16,
        padding: 28, textAlign: "center", fontSize: 13, color: "#55556A",
      }}>
        Loading…
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
