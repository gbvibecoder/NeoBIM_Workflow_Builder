"use client";

import { useState } from "react";
import { Lock, Loader2, AlertCircle, Eye, EyeOff, Shield } from "lucide-react";
import { motion } from "framer-motion";

export default function AdminLoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        window.location.href = "/admin/dashboard";
        return;
      } else {
        setError("Invalid admin credentials.");
      }
    } catch {
      setError("Connection failed. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#070809",
      position: "relative",
      overflow: "hidden",
    }}>
      {/* Subtle background effects */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <div style={{
          position: "absolute", top: "50%", left: "50%",
          transform: "translate(-50%, -50%)",
          width: 600, height: 600, borderRadius: "50%",
          background: "radial-gradient(circle, rgba(184,115,51,0.04) 0%, transparent 70%)",
          filter: "blur(40px)",
        }} />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        style={{
          width: "100%",
          maxWidth: 400,
          position: "relative",
          zIndex: 1,
          background: "rgba(15,16,25,0.95)",
          border: "1px solid rgba(184,115,51,0.12)",
          borderRadius: 16,
          boxShadow: "0 24px 64px rgba(0, 0, 0, 0.5), 0 0 40px rgba(184,115,51,0.03)",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "16px 24px",
          background: "linear-gradient(135deg, rgba(184,115,51,0.1), rgba(184,115,51,0.03))",
          borderBottom: "1px solid rgba(184,115,51,0.08)",
          borderRadius: "16px 16px 0 0",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}>
          <div style={{
            width: 8, height: 8, borderRadius: "50%",
            background: "#B87333",
            boxShadow: "0 0 8px #B87333",
          }} />
          <span style={{
            fontSize: 11, fontWeight: 700, letterSpacing: "1.5px",
            textTransform: "uppercase",
            color: "#B87333",
          }}>
            RESTRICTED ACCESS
          </span>
        </div>

        <div style={{ padding: "32px 36px 36px" }}>
          {/* Title */}
          <div style={{ marginBottom: 28, textAlign: "center" }}>
            <div style={{
              width: 48, height: 48, borderRadius: 14, margin: "0 auto 16px",
              background: "linear-gradient(135deg, rgba(184,115,51,0.15), rgba(184,115,51,0.05))",
              border: "1px solid rgba(184,115,51,0.2)",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              <Shield size={22} style={{ color: "#B87333" }} />
            </div>
            <h2 style={{
              fontSize: 22, fontWeight: 700, color: "#F0F0F5",
              marginBottom: 6, letterSpacing: "-0.02em",
            }}>
              Admin Access
            </h2>
            <p style={{ fontSize: 13.5, color: "#6C6C8A" }}>
              Platform administration panel
            </p>
          </div>

          <form onSubmit={handleSubmit}>
            {/* Username */}
            <motion.div
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.05, ease: [0.22, 1, 0.36, 1] }}
              style={{ marginBottom: 14 }}
            >
              <label style={{
                display: "block", fontSize: 12.5, fontWeight: 500,
                color: "#7C7C96", marginBottom: 6,
              }}>
                Username
              </label>
              <div style={{ position: "relative" }}>
                <Shield size={13} style={{
                  position: "absolute", left: 13, top: "50%",
                  transform: "translateY(-50%)", color: "#3A3A50",
                }} />
                <input
                  type="text"
                  value={username}
                  onChange={e => { setUsername(e.target.value); setError(""); }}
                  placeholder="Admin username"
                  autoComplete="username"
                  style={{
                    width: "100%", padding: "10px 14px 10px 36px", height: 44,
                    borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)",
                    background: "#08080f", color: "#F0F0F5",
                    fontSize: 14, outline: "none", boxSizing: "border-box",
                    transition: "border-color 0.2s, box-shadow 0.2s",
                  }}
                  onFocus={e => {
                    e.currentTarget.style.borderColor = "rgba(184,115,51,0.4)";
                    e.currentTarget.style.boxShadow = "0 0 0 3px rgba(184,115,51,0.08)";
                  }}
                  onBlur={e => {
                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                />
              </div>
            </motion.div>

            {/* Password */}
            <motion.div
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
              style={{ marginBottom: 20 }}
            >
              <label style={{
                display: "block", fontSize: 12.5, fontWeight: 500,
                color: "#7C7C96", marginBottom: 6,
              }}>
                Password
              </label>
              <div style={{ position: "relative" }}>
                <Lock size={13} style={{
                  position: "absolute", left: 13, top: "50%",
                  transform: "translateY(-50%)", color: "#3A3A50",
                }} />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={e => { setPassword(e.target.value); setError(""); }}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  style={{
                    width: "100%", padding: "10px 40px 10px 36px", height: 44,
                    borderRadius: 10, border: "1px solid rgba(255,255,255,0.06)",
                    background: "#08080f", color: "#F0F0F5",
                    fontSize: 14, outline: "none", boxSizing: "border-box",
                    transition: "border-color 0.2s, box-shadow 0.2s",
                  }}
                  onFocus={e => {
                    e.currentTarget.style.borderColor = "rgba(184,115,51,0.4)";
                    e.currentTarget.style.boxShadow = "0 0 0 3px rgba(184,115,51,0.08)";
                  }}
                  onBlur={e => {
                    e.currentTarget.style.borderColor = "rgba(255,255,255,0.06)";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  style={{
                    position: "absolute", right: 10, top: "50%",
                    transform: "translateY(-50%)",
                    background: "none", border: "none", padding: 4,
                    cursor: "pointer", color: "#3A3A50",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    opacity: 0.7,
                  }}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </motion.div>

            {/* Error */}
            {error && (
              <motion.div
                initial={{ opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                style={{
                  padding: "10px 14px", borderRadius: 10,
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.15)",
                  fontSize: 12.5, color: "#F87171", marginBottom: 16,
                  display: "flex", alignItems: "center", gap: 8,
                }}
              >
                <AlertCircle size={13} />
                {error}
              </motion.div>
            )}

            {/* Submit */}
            <motion.button
              whileHover={{ scale: 1.008 }}
              whileTap={{ scale: 0.995 }}
              type="submit"
              disabled={loading || !username || !password}
              style={{
                width: "100%", padding: "11px", height: 44, borderRadius: 10,
                border: "none",
                background: (loading || !username || !password)
                  ? "rgba(184,115,51,0.3)"
                  : "linear-gradient(135deg, #B87333 0%, #D4954A 100%)",
                color: "#fff", fontSize: 13.5, fontWeight: 600,
                cursor: (loading || !username || !password) ? "not-allowed" : "pointer",
                opacity: (loading || !username || !password) ? 0.5 : 1,
                boxShadow: (loading || !username || !password)
                  ? "none"
                  : "0 1px 3px rgba(184,115,51,0.3), 0 4px 12px rgba(184,115,51,0.15)",
                display: "flex", alignItems: "center", justifyContent: "center",
                gap: 8, transition: "all 0.2s ease",
              }}
            >
              {loading ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  Authenticating...
                </>
              ) : (
                <>
                  <Shield size={14} />
                  Access Admin Panel
                </>
              )}
            </motion.button>
          </form>

          {/* Footer */}
          <div style={{
            textAlign: "center", marginTop: 24, paddingTop: 20,
            borderTop: "1px solid rgba(255,255,255,0.04)",
          }}>
            <span style={{
              fontSize: 10, color: "#2A2A3A",
              fontFamily: "monospace", letterSpacing: "0.5px",
            }}>
              AUTHORIZED PERSONNEL ONLY
            </span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
