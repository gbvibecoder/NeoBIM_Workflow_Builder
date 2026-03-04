"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { LogIn, Mail, Lock, Chrome } from "lucide-react";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });

      if (res?.error) {
        setError("Invalid email or password");
      } else {
        router.push(callbackUrl);
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogle() {
    setLoading(true);
    await signIn("google", { callbackUrl });
  }

  return (
    <div style={{
      background: "#12121E",
      border: "1px solid rgba(255,255,255,0.06)",
      borderRadius: 16,
      padding: 40,
      boxShadow: "0 24px 64px rgba(0, 0, 0, 0.4)",
    }}>
      {/* Google OAuth */}
      <button
        onClick={handleGoogle}
        disabled={loading}
        style={{
          width: "100%", padding: "11px 16px",
          borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)",
          background: "#1A1A2A", color: "#F0F0F5",
          fontSize: 13, fontWeight: 500, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          marginBottom: 20, opacity: loading ? 0.6 : 1,
        }}
      >
        <Chrome size={15} />
        Continue with Google
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
        <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.06)" }} />
        <span style={{ fontSize: 11, color: "#3A3A4E" }}>or email</span>
        <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.06)" }} />
      </div>

      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#9898B0", marginBottom: 6 }}>
            Email
          </label>
          <div style={{ position: "relative" }}>
            <Mail size={13} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "#3A3A50" }} />
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              placeholder="you@example.com"
              style={{
                width: "100%", padding: "10px 14px 10px 38px", height: 42,
                borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)",
                background: "#0B0B13", color: "#F0F0F5",
                fontSize: 14, outline: "none", boxSizing: "border-box",
              }}
            />
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#9898B0", marginBottom: 6 }}>
            Password
          </label>
          <div style={{ position: "relative" }}>
            <Lock size={13} style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", color: "#3A3A50" }} />
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              placeholder="••••••••"
              style={{
                width: "100%", padding: "10px 14px 10px 38px", height: 42,
                borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)",
                background: "#0B0B13", color: "#F0F0F5",
                fontSize: 14, outline: "none", boxSizing: "border-box",
              }}
            />
          </div>
        </div>

        {error && (
          <div style={{
            padding: "9px 12px", borderRadius: 8,
            background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)",
            fontSize: 13, color: "#F87171", marginBottom: 16,
          }}>
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            width: "100%", padding: "11px", height: 42, borderRadius: 8, border: "none",
            background: "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)",
            color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer",
            opacity: loading ? 0.7 : 1,
            boxShadow: "0 0 0 1px rgba(79,138,255,0.3), 0 2px 8px rgba(79,138,255,0.2)",
          }}
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div>
      {/* Logo */}
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: "linear-gradient(135deg, #4F8AFF 0%, #8B5CF6 100%)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <LogIn size={18} color="#fff" />
          </div>
          <span style={{ fontSize: 22, fontWeight: 800, color: "#F0F0F5", letterSpacing: "-0.5px" }}>
            NeoBIM
          </span>
        </div>
        <p style={{ fontSize: 13, color: "#5C5C78" }}>Sign in to continue</p>
      </div>

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

      <p style={{ textAlign: "center", fontSize: 13, color: "#5C5C78", marginTop: 20 }}>
        Don&apos;t have an account?{" "}
        <Link href="/register" style={{ color: "#4F8AFF", textDecoration: "none" }}>
          Register
        </Link>
      </p>
    </div>
  );
}
