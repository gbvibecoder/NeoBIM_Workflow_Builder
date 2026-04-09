"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import {
  User, Key, Shield, Save, Loader2, AlertCircle,
  CheckCircle2, Info, Crown, Star, Lock, Unlock,
  Fingerprint, ScanLine, Cpu, Activity, Camera, Trash2, Pencil,
  Gift, Users, Zap, Copy, Check, Phone, Smartphone, Mail,
} from "lucide-react";
import { PageBackground } from "@/features/dashboard/components/PageBackground";
import { useLocale } from "@/hooks/useLocale";
import { useAvatar } from "@/hooks/useAvatar";
import { normalizePhone } from "@/lib/form-validation";

type SettingsTab = "profile" | "api-keys" | "plan" | "security";

// ---- Hex ring scanner animation for profile ----
function HexRing({ size = 88, color = "#1B4FFF" }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ position: "absolute", inset: -12 }}>
      <circle
        cx="50" cy="50" r="46"
        fill="none"
        stroke={color}
        strokeWidth="0.5"
        strokeDasharray="4 6"
        opacity={0.3}
        style={{ animation: "dp-scanRotate 12s linear infinite" }}
      />
      <circle
        cx="50" cy="50" r="42"
        fill="none"
        stroke={color}
        strokeWidth="0.8"
        strokeDasharray="12 8"
        opacity={0.15}
        style={{ animation: "dp-scanRotate 8s linear infinite reverse" }}
      />
      {/* Scanner sweep */}
      <line
        x1="50" y1="4" x2="50" y2="20"
        stroke={color}
        strokeWidth="1.5"
        opacity={0.4}
        style={{
          transformOrigin: "50px 50px",
          animation: "dp-scanRotate 4s linear infinite",
        }}
      />
    </svg>
  );
}

// ---- Typing text effect ----
function TypeWriter({ text, delay = 0 }: { text: string; delay?: number }) {
  const [displayed, setDisplayed] = useState("");
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => setStarted(true), delay);
    return () => clearTimeout(t1);
  }, [delay]);

  useEffect(() => {
    if (!started) return;
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= text.length) clearInterval(interval);
    }, 30);
    return () => clearInterval(interval);
  }, [text, started]);

  return (
    <span>
      {displayed}
      {displayed.length < text.length && (
        <span style={{ animation: "dp-blink 1s infinite", color: "#4F8AFF" }}>|</span>
      )}
    </span>
  );
}

// ---- Security Status Bar ----
function SecurityBar() {
  const { t } = useLocale();
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 16,
      padding: "8px 16px", borderRadius: 8,
      background: "rgba(16,185,129,0.04)",
      border: "1px solid rgba(16,185,129,0.1)",
      marginBottom: 20,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{
          width: 6, height: 6, borderRadius: "50%",
          background: "#10B981",
          boxShadow: "0 0 8px rgba(16,185,129,0.5)",
          animation: "dp-statusPulse 2s ease-in-out infinite",
          color: "#10B981",
        }} />
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: "0.1em",
          textTransform: "uppercase",
          fontFamily: "var(--font-jetbrains), monospace",
          color: "#10B981",
        }}>
          {t('settings.secureSession')}
        </span>
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <Lock size={10} style={{ color: "rgba(255,255,255,0.2)" }} />
        <span style={{
          fontSize: 9, color: "rgba(255,255,255,0.2)",
          fontFamily: "var(--font-jetbrains), monospace",
        }}>
          {t('settings.encryption')}
        </span>
      </div>
    </div>
  );
}

// ---- Save Status Indicator ----
function SaveStatus({ status }: { status: "idle" | "saving" | "saved" }) {
  const { t } = useLocale();
  if (status === "idle") return null;
  return (
    <motion.div
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0 }}
      style={{
        display: "flex", alignItems: "center", gap: 5,
        fontSize: 11, fontWeight: 600,
        color: status === "saving" ? "#8888A0" : "#10B981",
      }}
    >
      {status === "saving" ? (
        <Loader2 size={12} className="animate-spin" />
      ) : (
        <CheckCircle2 size={12} />
      )}
      {status === "saving" ? t('settings.encrypting') : t('settings.vaultSealed')}
    </motion.div>
  );
}

// ---- Email Verification Status inside Profile ----
function EmailVerificationStatus({
  email,
  emailVerified,
  onEmailAdded,
  onVerified,
}: {
  email: string | null;
  emailVerified: boolean;
  onEmailAdded: (newEmail: string) => void;
  onVerified: () => void;
}) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  const hasRealEmail = !!email;

  // Email verified — green checkmark
  if (hasRealEmail && emailVerified) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 16px", borderRadius: 10,
        background: "rgba(16,185,129,0.05)",
        border: "1px solid rgba(16,185,129,0.12)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <CheckCircle2 size={14} style={{ color: "#10B981", flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: "#10B981", fontFamily: "var(--font-jetbrains), monospace" }}>
            EMAIL VERIFIED
          </span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", fontFamily: "var(--font-jetbrains), monospace" }}>
            {email}
          </span>
        </div>
      </div>
    );
  }

  // Save a new email address
  async function handleSaveEmail() {
    setError("");
    const trimmed = editValue.trim().toLowerCase();
    if (!trimmed) { setError("Email is required"); return; }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmed)) { setError("Please enter a valid email address"); return; }

    setSaving(true);
    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error?.message || "Failed to update email.");
      }
      onEmailAdded(trimmed);
      setIsAdding(false);
      setEditValue("");
      setSent(true); // Verification email auto-sent by backend
      toast.success("Email saved! Check your inbox — a wild verification email appears.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save email.");
    } finally {
      setSaving(false);
    }
  }

  // No email set — show "Add Email" prompt
  if (!hasRealEmail) {
    return (
      <div style={{
        padding: "12px 16px", borderRadius: 10,
        background: "rgba(79,138,255,0.05)",
        border: "1px solid rgba(79,138,255,0.12)",
      }}>
        {isAdding ? (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Mail size={14} style={{ color: "#4F8AFF", flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: "#4F8AFF", fontFamily: "var(--font-jetbrains), monospace" }}>
                ADD EMAIL ADDRESS
              </span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="email"
                value={editValue}
                onChange={e => { setEditValue(e.target.value); setError(""); }}
                placeholder="your-real-email@not-fake.com"
                autoFocus
                onKeyDown={e => { if (e.key === "Enter") handleSaveEmail(); if (e.key === "Escape") { setIsAdding(false); setEditValue(""); setError(""); } }}
                style={{
                  flex: 1, padding: "8px 12px", borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "#08080f", color: "#F0F0F5",
                  fontSize: 13, outline: "none",
                }}
              />
              <button
                onClick={handleSaveEmail}
                disabled={saving}
                style={{
                  padding: "6px 14px", borderRadius: 6,
                  background: "rgba(79,138,255,0.15)",
                  border: "1px solid rgba(79,138,255,0.25)",
                  color: "#4F8AFF", fontSize: 11, fontWeight: 600,
                  cursor: saving ? "wait" : "pointer",
                  fontFamily: "var(--font-jetbrains), monospace",
                }}
              >
                {saving ? "SHIPPING..." : "LOCK IT IN"}
              </button>
              <button
                onClick={() => { setIsAdding(false); setEditValue(""); setError(""); }}
                style={{
                  padding: "6px 10px", borderRadius: 6,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "#5C5C78", fontSize: 11, fontWeight: 600, cursor: "pointer",
                  fontFamily: "var(--font-jetbrains), monospace",
                }}
              >
                CANCEL
              </button>
            </div>
            {error && <div style={{ fontSize: 11, color: "#EF4444", marginTop: 6 }}>{error}</div>}
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Mail size={14} style={{ color: "#4F8AFF", flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: "#4F8AFF", fontFamily: "var(--font-jetbrains), monospace" }}>
                NO EMAIL ADDRESS
              </span>
            </div>
            <button
              onClick={() => setIsAdding(true)}
              style={{
                background: "rgba(79,138,255,0.08)",
                border: "1px solid rgba(79,138,255,0.15)",
                borderRadius: 6, padding: "4px 12px",
                fontSize: 11, fontWeight: 600, color: "#4F8AFF",
                cursor: "pointer",
                fontFamily: "var(--font-jetbrains), monospace",
              }}
            >
              HOOK ME UP
            </button>
          </div>
        )}
        <div style={{ fontSize: 11, color: "#7C7C96", marginTop: 6, lineHeight: 1.5 }}>
          No email? Bold move. Add one so we can send you important stuff (and maybe a meme or two).
        </div>
      </div>
    );
  }

  // Has real email but NOT verified
  return (
    <div style={{
      padding: "12px 16px", borderRadius: 10,
      background: "rgba(245,158,11,0.05)",
      border: "1px solid rgba(245,158,11,0.12)",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" as const }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <AlertCircle size={14} style={{ color: "#F59E0B", flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: "#F59E0B", fontFamily: "var(--font-jetbrains), monospace" }}>
            EMAIL NOT VERIFIED
          </span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", fontFamily: "var(--font-jetbrains), monospace" }}>
            {email}
          </span>
        </div>
        {sent ? (
          <span style={{ fontSize: 11, color: "#10B981", fontWeight: 600 }}>&#10003; Verification email sent!</span>
        ) : (
          <button
            onClick={async () => {
              setSending(true);
              setError("");
              try {
                const res = await fetch("/api/auth/send-verification", { method: "POST" });
                if (res.ok) {
                  setSent(true);
                } else {
                  const data = await res.json().catch(() => ({}));
                  if (data.error?.includes("already verified")) {
                    onVerified();
                    return;
                  }
                  setError(data.error || "Failed to send.");
                }
              } catch {
                setError("Network error.");
              } finally {
                setSending(false);
              }
            }}
            disabled={sending}
            style={{
              background: "rgba(245,158,11,0.1)",
              border: "1px solid rgba(245,158,11,0.2)",
              borderRadius: 6, padding: "4px 12px",
              fontSize: 11, fontWeight: 600, color: "#F59E0B",
              cursor: sending ? "wait" : "pointer",
              opacity: sending ? 0.6 : 1,
              fontFamily: "var(--font-jetbrains), monospace",
            }}
          >
            {sending ? "SENDING..." : "RESEND EMAIL"}
          </button>
        )}
      </div>
      {error && (
        <div style={{ fontSize: 11, color: "#EF4444", marginTop: 6 }}>{error}</div>
      )}
      <div style={{ fontSize: 11, color: "#7C7C96", marginTop: 6, lineHeight: 1.5 }}>
        We sent you a verification email. Check your inbox (or spam, we won&apos;t judge).
      </div>
    </div>
  );
}

// ---- Phone Verification Status ----
function PhoneVerificationStatus({
  phoneNumber,
  phoneVerified,
  onPhoneChange,
  onVerified,
}: {
  phoneNumber: string | null;
  phoneVerified: boolean;
  onPhoneChange: (phone: string | null) => void;
  onVerified: () => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(phoneNumber ?? "");
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState("");

  // Sync editValue when phoneNumber changes externally
  useEffect(() => { setEditValue(phoneNumber ?? ""); }, [phoneNumber]);

  async function handleSavePhone() {
    setError("");
    const trimmed = editValue.trim();

    // Allow clearing
    if (!trimmed) {
      setSaving(true);
      try {
        const res = await fetch("/api/user/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phoneNumber: null }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.error?.message || "Failed to update.");
        }
        onPhoneChange(null);
        setVerified(false);
        setIsEditing(false);
        toast.success("Phone number removed. Gone. Poof. Like it never existed.");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save.");
      } finally {
        setSaving(false);
      }
      return;
    }

    // Validate
    const normalized = normalizePhone(trimmed);
    if (!normalized) {
      setError("Enter a valid phone number (e.g., +919876543210)");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error?.message || "Failed to update.");
      }
      onPhoneChange(normalized);
      setVerified(false); // Reset local verified state for new number
      setIsEditing(false);
      toast.success("New phone, new you. Don't forget to verify it!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  async function handleVerify() {
    setVerifying(true);
    setError("");
    try {
      // 2-second simulated delay for UX
      await new Promise(resolve => setTimeout(resolve, 2000));
      const res = await fetch("/api/user/verify-phone", { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error?.message || "Verification failed.");
      }
      setVerified(true);
      onVerified();
      toast.success("Phone verified! You're officially not a robot. Probably.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setVerifying(false);
    }
  }

  // No phone number set — show add button
  if (!phoneNumber) {
    return (
      <div style={{
        padding: "12px 16px", borderRadius: 10,
        background: "rgba(100,116,139,0.05)",
        border: "1px solid rgba(100,116,139,0.12)",
      }}>
        {isEditing ? (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <Smartphone size={14} style={{ color: "#94A3B8", flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: "#94A3B8", fontFamily: "var(--font-jetbrains), monospace" }}>
                ADD PHONE NUMBER
              </span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="tel"
                value={editValue}
                onChange={e => { setEditValue(e.target.value); setError(""); }}
                placeholder="+91 your digits here"
                autoFocus
                onKeyDown={e => { if (e.key === "Enter") handleSavePhone(); if (e.key === "Escape") { setIsEditing(false); setEditValue(""); setError(""); } }}
                style={{
                  flex: 1, padding: "8px 12px", borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "#08080f", color: "#F0F0F5",
                  fontSize: 13, outline: "none",
                }}
              />
              <button
                onClick={handleSavePhone}
                disabled={saving}
                style={{
                  padding: "6px 14px", borderRadius: 6,
                  background: "rgba(79,138,255,0.15)",
                  border: "1px solid rgba(79,138,255,0.25)",
                  color: "#4F8AFF", fontSize: 11, fontWeight: 600,
                  cursor: saving ? "wait" : "pointer",
                  fontFamily: "var(--font-jetbrains), monospace",
                }}
              >
                {saving ? "SAVING..." : "SAVE"}
              </button>
              <button
                onClick={() => { setIsEditing(false); setEditValue(""); setError(""); }}
                style={{
                  padding: "6px 10px", borderRadius: 6,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "#5C5C78", fontSize: 11, fontWeight: 600, cursor: "pointer",
                  fontFamily: "var(--font-jetbrains), monospace",
                }}
              >
                CANCEL
              </button>
            </div>
            {error && <div style={{ fontSize: 11, color: "#EF4444", marginTop: 6 }}>{error}</div>}
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Smartphone size={14} style={{ color: "#94A3B8", flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: "#94A3B8", fontFamily: "var(--font-jetbrains), monospace" }}>
                NO PHONE NUMBER
              </span>
            </div>
            <button
              onClick={() => setIsEditing(true)}
              style={{
                background: "rgba(79,138,255,0.08)",
                border: "1px solid rgba(79,138,255,0.15)",
                borderRadius: 6, padding: "4px 12px",
                fontSize: 11, fontWeight: 600, color: "#4F8AFF",
                cursor: "pointer",
                fontFamily: "var(--font-jetbrains), monospace",
              }}
            >
              RING ME UP
            </button>
          </div>
        )}
        <div style={{ fontSize: 11, color: "#7C7C96", marginTop: 6, lineHeight: 1.5 }}>
          No phone number? Are you a ghost? Add one for phone login and so we know you&apos;re real.
        </div>
      </div>
    );
  }

  // Phone verified
  if (phoneVerified || verified) {
    return (
      <div style={{
        padding: "12px 16px", borderRadius: 10,
        background: "rgba(16,185,129,0.05)",
        border: "1px solid rgba(16,185,129,0.12)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <CheckCircle2 size={14} style={{ color: "#10B981", flexShrink: 0 }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: "#10B981", fontFamily: "var(--font-jetbrains), monospace" }}>
              PHONE VERIFIED
            </span>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", fontFamily: "var(--font-jetbrains), monospace" }}>
              {phoneNumber}
            </span>
          </div>
          <button
            onClick={() => setIsEditing(true)}
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 6, padding: "4px 10px",
              fontSize: 10, fontWeight: 600, color: "#5C5C78",
              cursor: "pointer",
              fontFamily: "var(--font-jetbrains), monospace",
            }}
          >
            CHANGE
          </button>
        </div>
        {isEditing && (
          <div style={{ marginTop: 10 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="tel"
                value={editValue}
                onChange={e => { setEditValue(e.target.value); setError(""); }}
                placeholder="+91 your digits here"
                autoFocus
                onKeyDown={e => { if (e.key === "Enter") handleSavePhone(); if (e.key === "Escape") { setIsEditing(false); setEditValue(phoneNumber ?? ""); setError(""); } }}
                style={{
                  flex: 1, padding: "8px 12px", borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.08)",
                  background: "#08080f", color: "#F0F0F5",
                  fontSize: 13, outline: "none",
                }}
              />
              <button
                onClick={handleSavePhone}
                disabled={saving}
                style={{
                  padding: "6px 14px", borderRadius: 6,
                  background: "rgba(79,138,255,0.15)",
                  border: "1px solid rgba(79,138,255,0.25)",
                  color: "#4F8AFF", fontSize: 11, fontWeight: 600,
                  cursor: saving ? "wait" : "pointer",
                  fontFamily: "var(--font-jetbrains), monospace",
                }}
              >
                {saving ? "SAVING..." : "SAVE"}
              </button>
              <button
                onClick={() => { setIsEditing(false); setEditValue(phoneNumber ?? ""); setError(""); }}
                style={{
                  padding: "6px 10px", borderRadius: 6,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "#5C5C78", fontSize: 11, fontWeight: 600, cursor: "pointer",
                  fontFamily: "var(--font-jetbrains), monospace",
                }}
              >
                CANCEL
              </button>
            </div>
            {error && <div style={{ fontSize: 11, color: "#EF4444", marginTop: 6 }}>{error}</div>}
            <div style={{ fontSize: 10, color: "#F59E0B", marginTop: 4 }}>
              New number, who dis? You&apos;ll need to re-verify after changing.
            </div>
          </div>
        )}
      </div>
    );
  }

  // Phone set but NOT verified
  return (
    <div style={{
      padding: "12px 16px", borderRadius: 10,
      background: "rgba(245,158,11,0.05)",
      border: "1px solid rgba(245,158,11,0.12)",
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" as const }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <AlertCircle size={14} style={{ color: "#F59E0B", flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: "#F59E0B", fontFamily: "var(--font-jetbrains), monospace" }}>
            PHONE NOT VERIFIED
          </span>
          <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)", fontFamily: "var(--font-jetbrains), monospace" }}>
            {phoneNumber}
          </span>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            onClick={handleVerify}
            disabled={verifying}
            style={{
              background: "rgba(245,158,11,0.1)",
              border: "1px solid rgba(245,158,11,0.2)",
              borderRadius: 6, padding: "4px 12px",
              fontSize: 11, fontWeight: 600, color: "#F59E0B",
              cursor: verifying ? "wait" : "pointer",
              opacity: verifying ? 0.6 : 1,
              fontFamily: "var(--font-jetbrains), monospace",
            }}
          >
            {verifying ? "PROVING YOU EXIST..." : "VERIFY NOW"}
          </button>
          <button
            onClick={() => setIsEditing(true)}
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 6, padding: "4px 10px",
              fontSize: 10, fontWeight: 600, color: "#5C5C78",
              cursor: "pointer",
              fontFamily: "var(--font-jetbrains), monospace",
            }}
          >
            CHANGE
          </button>
        </div>
      </div>
      {isEditing && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="tel"
              value={editValue}
              onChange={e => { setEditValue(e.target.value); setError(""); }}
              placeholder="+919876543210"
              autoFocus
              onKeyDown={e => { if (e.key === "Enter") handleSavePhone(); if (e.key === "Escape") { setIsEditing(false); setEditValue(phoneNumber ?? ""); setError(""); } }}
              style={{
                flex: 1, padding: "8px 12px", borderRadius: 8,
                border: "1px solid rgba(255,255,255,0.08)",
                background: "#08080f", color: "#F0F0F5",
                fontSize: 13, outline: "none",
              }}
            />
            <button
              onClick={handleSavePhone}
              disabled={saving}
              style={{
                padding: "6px 14px", borderRadius: 6,
                background: "rgba(79,138,255,0.15)",
                border: "1px solid rgba(79,138,255,0.25)",
                color: "#4F8AFF", fontSize: 11, fontWeight: 600,
                cursor: saving ? "wait" : "pointer",
                fontFamily: "var(--font-jetbrains), monospace",
              }}
            >
              {saving ? "SAVING..." : "SAVE"}
            </button>
            <button
              onClick={() => { setIsEditing(false); setEditValue(phoneNumber ?? ""); setError(""); }}
              style={{
                padding: "6px 10px", borderRadius: 6,
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
                color: "#5C5C78", fontSize: 11, fontWeight: 600, cursor: "pointer",
                fontFamily: "var(--font-jetbrains), monospace",
              }}
            >
              CANCEL
            </button>
          </div>
          {error && <div style={{ fontSize: 11, color: "#EF4444", marginTop: 6 }}>{error}</div>}
        </div>
      )}
      {!isEditing && error && <div style={{ fontSize: 11, color: "#EF4444", marginTop: 6 }}>{error}</div>}
      <div style={{ fontSize: 11, color: "#7C7C96", marginTop: 6, lineHeight: 1.5 }}>
        Your phone is feeling unverified and insecure. Hit that verify button, be a hero.
      </div>
    </div>
  );
}

// ---- Profile Section — Identity Card (Editable) ----
function ProfileSection({
  user, initials, saveStatus, onSaveStatusChange, onSessionUpdate,
}: {
  user: { name?: string | null; email?: string | null; image?: string | null } | undefined;
  initials: string;
  saveStatus: "idle" | "saving" | "saved";
  onSaveStatusChange: (s: "idle" | "saving" | "saved") => void;
  onSessionUpdate: () => Promise<unknown>;
}) {
  const { t } = useLocale();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const processingRef = useRef(0); // generation counter to prevent race conditions
  const [editName, setEditName] = useState(user?.name ?? "");
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isHoveringAvatar, setIsHoveringAvatar] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [profileData, setProfileData] = useState<{
    email: string | null; emailVerified: boolean; phoneNumber: string | null; phoneVerified: boolean; createdAt: string | null; role: string;
  }>({ email: null, emailVerified: false, phoneNumber: null, phoneVerified: false, createdAt: null, role: "FREE" });

  // Fetch profile data (emailVerified, createdAt, role)
  useEffect(() => {
    fetch("/api/user/profile")
      .then(res => res.json())
      .then(data => {
        if (data.emailVerified !== undefined) {
          setProfileData({
            email: data.email ?? null,
            emailVerified: data.emailVerified,
            phoneNumber: data.phoneNumber ?? null,
            phoneVerified: !!data.phoneVerified,
            createdAt: data.createdAt,
            role: data.role,
          });
        }
      })
      .catch(() => {});
  }, []);

  // Fetch actual avatar (handles "uploaded" sentinel)
  const loadedImage = useAvatar(user?.image);

  // Sync name from session
  useEffect(() => {
    if (user?.name && !isEditingName) setEditName(user.name);
  }, [user?.name, isEditingName]);

  // The displayed image: preview (pending upload) > loaded (from API/session)
  const displayImage = previewImage ?? loadedImage;
  const hasImageToRemove = !!(previewImage || loadedImage);

  const nameChanged = editName.trim() !== (user?.name ?? "");
  const hasChanges = nameChanged || previewImage !== null;

  function processImage(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      toast.error(t('settings.imageTooLarge'));
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast.error(t('settings.invalidImageType'));
      return;
    }
    // Increment generation counter — only the latest selection wins
    const generation = ++processingRef.current;
    setIsProcessing(true);
    const reader = new FileReader();
    reader.onload = (e) => {
      if (processingRef.current !== generation) return; // stale
      const img = new Image();
      img.onload = () => {
        if (processingRef.current !== generation) return; // stale
        const canvas = document.createElement("canvas");
        const TARGET = 200;
        const size = Math.min(img.width, img.height);
        const sx = (img.width - size) / 2;
        const sy = (img.height - size) / 2;
        canvas.width = TARGET;
        canvas.height = TARGET;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(img, sx, sy, size, size, 0, 0, TARGET, TARGET);
        setPreviewImage(canvas.toDataURL("image/jpeg", 0.8));
        setIsProcessing(false);
      };
      img.onerror = () => {
        if (processingRef.current !== generation) return;
        setIsProcessing(false);
        toast.error(t('settings.invalidImageType'));
      };
      img.src = e.target?.result as string;
    };
    reader.onerror = () => {
      if (processingRef.current !== generation) return;
      setIsProcessing(false);
      toast.error(t('settings.profileSaveFailed'));
    };
    reader.readAsDataURL(file);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    processImage(file);
    e.target.value = "";
  }

  async function handleRemoveAvatar() {
    onSaveStatusChange("saving");
    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: null }),
      });
      if (!res.ok) {
        let msg = t('settings.profileSaveFailed');
        try { const d = await res.json(); msg = d?.error?.message ?? msg; } catch { /* non-JSON response */ }
        throw new Error(msg);
      }
      setPreviewImage(null);
      await onSessionUpdate();
      onSaveStatusChange("saved");
      toast.success(t('settings.profileSaved'));
      setTimeout(() => onSaveStatusChange("idle"), 2000);
    } catch (err) {
      onSaveStatusChange("idle");
      toast.error(err instanceof Error ? err.message : t('settings.profileSaveFailed'));
    }
  }

  async function handleSave() {
    onSaveStatusChange("saving");
    try {
      const payload: { name?: string; image?: string | null } = {};
      if (nameChanged) payload.name = editName.trim();
      if (previewImage) payload.image = previewImage;
      if (Object.keys(payload).length === 0) {
        onSaveStatusChange("idle");
        return;
      }

      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let msg = t('settings.profileSaveFailed');
        try { const d = await res.json(); msg = d?.error?.message ?? msg; } catch { /* non-JSON response */ }
        throw new Error(msg);
      }

      setPreviewImage(null);
      setIsEditingName(false);
      await onSessionUpdate();
      onSaveStatusChange("saved");
      toast.success(t('settings.profileSaved'));
      setTimeout(() => onSaveStatusChange("idle"), 2000);
    } catch (err) {
      onSaveStatusChange("idle");
      toast.error(err instanceof Error ? err.message : t('settings.profileSaveFailed'));
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      style={{ display: "flex", flexDirection: "column", gap: 20 }}
    >
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleFileSelect}
        style={{ display: "none" }}
      />

      {/* Identity Card */}
      <div
        className="dp-glass-card"
        data-accent="blue"
        style={{ padding: 0, overflow: "hidden" }}
      >
        {/* Card header stripe */}
        <div style={{
          padding: "14px 24px",
          background: profileData.emailVerified ? "rgba(27,79,255,0.04)" : "rgba(245,158,11,0.04)",
          borderBottom: `1px solid ${profileData.emailVerified ? "rgba(27,79,255,0.08)" : "rgba(245,158,11,0.08)"}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Fingerprint size={14} style={{ color: profileData.emailVerified ? "#4F8AFF" : "#F59E0B" }} />
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: profileData.emailVerified ? "#4F8AFF" : "#F59E0B",
              fontFamily: "var(--font-jetbrains), monospace",
            }}>
              {profileData.emailVerified ? "IDENTITY VERIFIED" : "VERIFICATION PENDING"}
            </span>
          </div>
          <div style={{
            padding: "2px 8px", borderRadius: 4,
            background: profileData.emailVerified ? "rgba(16,185,129,0.1)" : "rgba(245,158,11,0.1)",
            border: `1px solid ${profileData.emailVerified ? "rgba(16,185,129,0.2)" : "rgba(245,158,11,0.2)"}`,
          }}>
            <span style={{
              fontSize: 9, fontWeight: 700,
              color: profileData.emailVerified ? "#10B981" : "#F59E0B",
              fontFamily: "var(--font-jetbrains), monospace",
            }}>
              {profileData.emailVerified ? "ACTIVE" : "PENDING"}
            </span>
          </div>
        </div>

        <div className="settings-identity-layout" style={{ padding: "28px 24px", display: "flex", alignItems: "center", gap: 24 }}>
          {/* Avatar with scan ring — clickable */}
          <div
            style={{ position: "relative", flexShrink: 0, cursor: "pointer" }}
            onMouseEnter={() => setIsHoveringAvatar(true)}
            onMouseLeave={() => setIsHoveringAvatar(false)}
            onClick={() => fileInputRef.current?.click()}
            title={t('settings.changeAvatar')}
          >
            <HexRing />
            <div style={{
              width: 64, height: 64, borderRadius: "50%",
              background: "linear-gradient(135deg, #1B4FFF, #8B5CF6)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 24, fontWeight: 700, color: "#fff",
              overflow: "hidden", position: "relative",
              boxShadow: "0 0 32px rgba(27,79,255,0.2)",
              transition: "box-shadow 0.2s",
              ...(isHoveringAvatar ? { boxShadow: "0 0 48px rgba(27,79,255,0.4)" } : {}),
            }}>
              {displayImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={displayImage} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                initials
              )}
              {/* Hover overlay */}
              <div style={{
                position: "absolute", inset: 0,
                background: "rgba(0,0,0,0.5)",
                display: "flex", alignItems: "center", justifyContent: "center",
                opacity: isHoveringAvatar ? 1 : 0,
                transition: "opacity 0.2s",
                borderRadius: "50%",
              }}>
                <Camera size={20} style={{ color: "#fff" }} />
              </div>
            </div>
          </div>

          {/* Identity info */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Editable name */}
            {isEditingName ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Escape") { setIsEditingName(false); setEditName(user?.name ?? ""); } }}
                  maxLength={100}
                  autoFocus
                  style={{
                    fontSize: 20, fontWeight: 700, color: "#F0F0F5",
                    letterSpacing: "-0.02em", lineHeight: 1.2,
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(79,138,255,0.3)",
                    borderRadius: 8, padding: "6px 12px",
                    outline: "none", width: "100%",
                  }}
                />
              </div>
            ) : (
              <div
                style={{
                  display: "flex", alignItems: "center", gap: 8, cursor: "pointer",
                  fontSize: 22, fontWeight: 700, color: "#F0F0F5",
                  letterSpacing: "-0.02em", lineHeight: 1.2,
                  overflowWrap: "break-word", wordBreak: "break-word",
                }}
                onClick={() => setIsEditingName(true)}
                title="Click to edit name"
              >
                {editName || user?.name || t('settings.user')}
                <Pencil size={14} style={{ color: "rgba(255,255,255,0.25)", flexShrink: 0 }} />
              </div>
            )}
            <div style={{
              fontSize: 13, color: "rgba(255,255,255,0.35)", marginTop: 4,
              fontFamily: "var(--font-jetbrains), monospace",
              overflowWrap: "break-word", wordBreak: "break-all",
            }}>
              {profileData.email ?? profileData.phoneNumber ?? (user?.email?.endsWith("@phone.buildflow.app") ? null : user?.email) ?? "\u2014"}
            </div>

            {/* Action buttons row */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              {/* Clearance badge */}
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "4px 12px", borderRadius: 6,
                background: "rgba(139,92,246,0.08)",
                border: "1px solid rgba(139,92,246,0.15)",
              }}>
                <Shield size={11} style={{ color: "#A78BFA" }} />
                <span style={{
                  fontSize: 10, fontWeight: 700, color: "#A78BFA",
                  letterSpacing: "0.08em",
                  fontFamily: "var(--font-jetbrains), monospace",
                }}>
                  {t('settings.authorizedOperator')}
                </span>
              </div>

              {/* Remove avatar button */}
              {hasImageToRemove && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleRemoveAvatar(); }}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 4,
                    padding: "4px 10px", borderRadius: 6,
                    background: "rgba(239,68,68,0.06)",
                    border: "1px solid rgba(239,68,68,0.15)",
                    color: "rgba(239,68,68,0.6)", fontSize: 10, fontWeight: 600,
                    cursor: "pointer", transition: "all 0.2s",
                    fontFamily: "var(--font-jetbrains), monospace",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(239,68,68,0.12)";
                    e.currentTarget.style.color = "#EF4444";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(239,68,68,0.06)";
                    e.currentTarget.style.color = "rgba(239,68,68,0.6)";
                  }}
                >
                  <Trash2 size={10} />
                  {t('settings.removeAvatar')}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Card footer — session info + save */}
        <div style={{
          padding: "10px 24px",
          borderTop: "1px solid rgba(255,255,255,0.04)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", gap: 24 }}>
            {[
              { label: t('settings.session'), value: t('settings.encrypted') },
              { label: t('settings.protocol'), value: "OAuth 2.0" },
              { label: t('settings.statusLabel'), value: t('settings.online'), color: "#10B981" },
            ].map((item) => (
              <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{
                  fontSize: 9, color: "rgba(255,255,255,0.2)",
                  fontFamily: "var(--font-jetbrains), monospace",
                  letterSpacing: "0.05em",
                }}>
                  {item.label}:
                </span>
                <span style={{
                  fontSize: 9, color: item.color ?? "rgba(255,255,255,0.4)",
                  fontFamily: "var(--font-jetbrains), monospace",
                  fontWeight: 600,
                }}>
                  {item.value}
                </span>
              </div>
            ))}
          </div>

          {/* Save button */}
          {hasChanges && (
            <motion.button
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              onClick={handleSave}
              disabled={saveStatus === "saving" || isProcessing}
              style={{
                display: "inline-flex", alignItems: "center", gap: 6,
                padding: "6px 16px", borderRadius: 8,
                background: "linear-gradient(135deg, #1B4FFF, #4F8AFF)",
                border: "1px solid rgba(79,138,255,0.3)",
                color: "#fff", fontSize: 11, fontWeight: 700,
                cursor: (saveStatus === "saving" || isProcessing) ? "wait" : "pointer",
                fontFamily: "var(--font-jetbrains), monospace",
                letterSpacing: "0.05em",
                opacity: (saveStatus === "saving" || isProcessing) ? 0.7 : 1,
                transition: "opacity 0.2s",
              }}
            >
              {saveStatus === "saving" ? (
                <Loader2 size={12} style={{ animation: "spin 1s linear infinite" }} />
              ) : (
                <Save size={12} />
              )}
              {t('settings.saveProfile')}
            </motion.button>
          )}
        </div>
      </div>

      {/* Email Verification Status */}
      <EmailVerificationStatus
        email={profileData.email}
        emailVerified={profileData.emailVerified}
        onEmailAdded={(newEmail) => {
          setProfileData(prev => ({ ...prev, email: newEmail, emailVerified: false }));
          onSessionUpdate();
        }}
        onVerified={() => {
          setProfileData(prev => ({ ...prev, emailVerified: true }));
          onSessionUpdate();
        }}
      />

      {/* Phone Verification Status */}
      <PhoneVerificationStatus
        phoneNumber={profileData.phoneNumber}
        phoneVerified={profileData.phoneVerified}
        onPhoneChange={(phone) => {
          setProfileData(prev => ({
            ...prev,
            phoneNumber: phone,
            phoneVerified: false,
          }));
          onSessionUpdate();
        }}
        onVerified={() => {
          setProfileData(prev => ({ ...prev, phoneVerified: true }));
          onSessionUpdate();
        }}
      />

      {/* Account Details Card */}
      <div
        className="dp-glass-card"
        data-accent="blue"
        style={{ padding: 0, overflow: "hidden" }}
      >
        <div style={{
          padding: "14px 24px",
          background: "rgba(27,79,255,0.04)",
          borderBottom: "1px solid rgba(27,79,255,0.08)",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <ScanLine size={14} style={{ color: "#4F8AFF" }} />
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: "0.12em",
            textTransform: "uppercase", color: "#4F8AFF",
            fontFamily: "var(--font-jetbrains), monospace",
          }}>
            ACCOUNT DETAILS
          </span>
        </div>
        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
          {[
            { label: "Email", value: profileData.email ?? "Not set" },
            { label: "Phone", value: profileData.phoneNumber ?? "Not set" },
            { label: "Plan", value: profileData.role === "FREE" ? "Free" : profileData.role === "MINI" ? "Mini" : profileData.role === "STARTER" ? "Starter" : profileData.role === "PRO" ? "Pro" : profileData.role === "TEAM_ADMIN" ? "Team" : profileData.role === "PLATFORM_ADMIN" ? "Admin" : profileData.role },
            { label: "Member since", value: profileData.createdAt ? new Date(profileData.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" }) : "—" },
            { label: "Auth method", value: user?.image?.startsWith("https://lh3.googleusercontent.com") ? "Google OAuth" : profileData.phoneNumber && profileData.email ? "Email / Phone & Password" : profileData.phoneNumber ? "Phone & Password" : "Email & Password" },
          ].map((item) => (
            <div key={item.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{
                fontSize: 12, color: "rgba(255,255,255,0.35)",
                fontFamily: "var(--font-jetbrains), monospace",
                letterSpacing: "0.03em",
              }}>
                {item.label}
              </span>
              <span style={{
                fontSize: 12, color: "#C0C0D0", fontWeight: 500,
                fontFamily: "var(--font-jetbrains), monospace",
                textAlign: "right",
                overflowWrap: "break-word", wordBreak: "break-all", maxWidth: "60%",
              }}>
                {item.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}

// ---- Referral Details Section ----
function ReferralDetailsSection() {
  const { t } = useLocale();
  const [stats, setStats] = useState<{
    code: string | null;
    stats: { totalReferred: number; converted: number; bonusEarned: number; bonusRemaining: number };
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    fetch("/api/referral")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setStats(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const referralLink = stats?.code
    ? `https://trybuildflow.in/register?ref=${stats.code}`
    : null;

  const copyLink = async () => {
    if (!referralLink) return;
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* */ }
  };

  const generateCode = async () => {
    setGenerating(true);
    try {
      const res = await fetch("/api/referral", { method: "POST" });
      if (res.ok) {
        const d = await res.json();
        setStats(prev => prev ? { ...prev, code: d.code } : { code: d.code, stats: { totalReferred: 0, converted: 0, bonusEarned: 0, bonusRemaining: 0 } });
      }
    } catch { /* */ }
    setGenerating(false);
  };

  const s = stats?.stats ?? { totalReferred: 0, converted: 0, bonusEarned: 0, bonusRemaining: 0 };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.15 }}
    >
      <div
        className="dp-glass-card"
        data-accent="green"
        style={{ padding: 0, overflow: "hidden", marginTop: 20 }}
      >
        {/* Header */}
        <div style={{
          padding: "14px 24px",
          background: "rgba(16,185,129,0.04)",
          borderBottom: "1px solid rgba(16,185,129,0.08)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Gift size={14} style={{ color: "#10B981" }} />
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: "0.12em",
              textTransform: "uppercase", color: "#10B981",
              fontFamily: "var(--font-jetbrains), monospace",
            }}>
              {t('referral.inviteTitle')}
            </span>
          </div>
          {s.bonusRemaining > 0 && (
            <div style={{
              display: "flex", alignItems: "center", gap: 4,
              padding: "3px 10px", borderRadius: 20,
              background: "rgba(16,185,129,0.1)",
              border: "1px solid rgba(16,185,129,0.2)",
            }}>
              <Zap size={10} style={{ color: "#10B981" }} />
              <span style={{
                fontSize: 10, fontWeight: 700, color: "#10B981",
                fontFamily: "var(--font-jetbrains), monospace",
              }}>
                {s.bonusRemaining} BONUS
              </span>
            </div>
          )}
        </div>

        <div style={{ padding: "24px" }}>
          {loading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 20 }}>
              <Loader2 size={16} style={{ color: "#10B981", animation: "spin 1s linear infinite" }} />
            </div>
          ) : (
            <>
              {/* Stats grid */}
              <div style={{
                display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12,
                marginBottom: 20,
              }}>
                {[
                  { label: "Referred", value: s.totalReferred, icon: <Users size={14} />, color: "#4F8AFF" },
                  { label: "Earned", value: s.bonusEarned, icon: <Gift size={14} />, color: "#8B5CF6" },
                  { label: "Remaining", value: s.bonusRemaining, icon: <Zap size={14} />, color: "#10B981" },
                ].map((stat) => (
                  <div key={stat.label} style={{
                    padding: "14px 16px", borderRadius: 12,
                    background: "rgba(255,255,255,0.02)",
                    border: "1px solid rgba(255,255,255,0.05)",
                    textAlign: "center",
                  }}>
                    <div style={{ display: "flex", justifyContent: "center", marginBottom: 6, color: stat.color, opacity: 0.7 }}>
                      {stat.icon}
                    </div>
                    <div style={{
                      fontSize: 22, fontWeight: 800, color: "#F0F0F5",
                      fontFamily: "var(--font-jetbrains), monospace",
                      lineHeight: 1,
                    }}>
                      {stat.value}
                    </div>
                    <div style={{
                      fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,0.3)",
                      letterSpacing: "0.1em", textTransform: "uppercase",
                      fontFamily: "var(--font-jetbrains), monospace",
                      marginTop: 4,
                    }}>
                      {stat.label}
                    </div>
                  </div>
                ))}
              </div>

              {/* How it works */}
              <div style={{
                padding: "12px 16px", borderRadius: 10,
                background: "rgba(16,185,129,0.04)",
                border: "1px solid rgba(16,185,129,0.08)",
                marginBottom: 16,
              }}>
                <div style={{
                  fontSize: 10, fontWeight: 700, color: "#10B981",
                  letterSpacing: "0.08em", textTransform: "uppercase",
                  fontFamily: "var(--font-jetbrains), monospace",
                  marginBottom: 8,
                }}>
                  How it works
                </div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.5)", lineHeight: 1.6 }}>
                  Share your link. When someone signs up, you both get <span style={{ color: "#10B981", fontWeight: 600 }}>+1 bonus execution</span>. Bonuses stack on top of your plan limit.
                </div>
              </div>

              {/* Referral link */}
              {referralLink ? (
                <div style={{
                  display: "flex", alignItems: "center", gap: 8,
                  padding: "10px 14px", borderRadius: 10,
                  border: `1px solid ${copied ? "rgba(16,185,129,0.25)" : "rgba(255,255,255,0.06)"}`,
                  background: copied ? "rgba(16,185,129,0.05)" : "rgba(255,255,255,0.02)",
                  transition: "all 0.2s",
                }}>
                  <span style={{
                    flex: 1, fontSize: 12, color: "rgba(255,255,255,0.5)",
                    fontFamily: "var(--font-jetbrains), monospace",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {referralLink}
                  </span>
                  <button
                    onClick={copyLink}
                    style={{
                      display: "flex", alignItems: "center", gap: 5,
                      padding: "6px 14px", borderRadius: 8,
                      background: copied ? "rgba(16,185,129,0.15)" : "rgba(16,185,129,0.1)",
                      border: "1px solid rgba(16,185,129,0.15)",
                      color: "#10B981", fontSize: 11, fontWeight: 600,
                      cursor: "pointer", transition: "all 0.2s",
                      fontFamily: "var(--font-jetbrains), monospace",
                    }}
                  >
                    {copied ? <Check size={12} /> : <Copy size={12} />}
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
              ) : (
                <button
                  onClick={generateCode}
                  disabled={generating}
                  style={{
                    width: "100%", padding: "10px 16px", borderRadius: 10,
                    background: "rgba(16,185,129,0.08)",
                    border: "1px solid rgba(16,185,129,0.15)",
                    color: "#10B981", fontSize: 12, fontWeight: 600,
                    cursor: "pointer", transition: "all 0.2s",
                    fontFamily: "var(--font-jetbrains), monospace",
                    opacity: generating ? 0.5 : 1,
                  }}
                >
                  {generating ? "Generating..." : "Generate Referral Link"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}

// ---- API Keys Section — Access Vault ----
function ApiKeysSection({ saveStatus, onSaveStatusChange }: {
  saveStatus: "idle" | "saving" | "saved";
  onSaveStatusChange: (s: "idle" | "saving" | "saved") => void;
}) {
  const { t } = useLocale();
  const [openAiKey, setOpenAiKey] = useState("");
  const [stabilityKey, setStabilityKey] = useState("");
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    fetch("/api/user/api-keys", { signal: controller.signal })
      .then(r => {
        clearTimeout(timeoutId);
        if (!r.ok) throw new Error(`API returned ${r.status}`);
        return r.json();
      })
      .then(({ apiKeys }) => {
        if (apiKeys?.openai) setOpenAiKey(apiKeys.openai);
        if (apiKeys?.stability) setStabilityKey(apiKeys.stability);
        setLoadError(null);
      })
      .catch((err) => {
        const errorMsg = err instanceof Error && err.name === 'AbortError'
          ? t('toast.requestTimeout')
          : t('toast.loadKeysFailed');
        setLoadError(errorMsg);
        toast.error(errorMsg);
      })
      .finally(() => setLoadingKeys(false));

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSaveKeys() {
    if (!openAiKey.trim() && !stabilityKey.trim()) {
      toast.error(t('settings.enterAtLeastOne'));
      return;
    }
    onSaveStatusChange("saving");
    try {
      const apiKeys: Record<string, string> = {};
      if (openAiKey.trim()) apiKeys.openai = openAiKey.trim();
      if (stabilityKey.trim()) apiKeys.stability = stabilityKey.trim();

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const res = await fetch("/api/user/api-keys", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKeys }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        onSaveStatusChange("saved");
        toast.success(t('settings.saveSuccess'));
        setTimeout(() => onSaveStatusChange("idle"), 2000);
      } else {
        throw new Error(`API returned ${res.status}`);
      }
    } catch (err) {
      onSaveStatusChange("idle");
      const errorMsg = err instanceof Error && err.name === 'AbortError'
        ? t('toast.requestTimeout')
        : t('settings.saveFailed');
      toast.error(errorMsg);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      {/* Vault Header */}
      <div
        className="dp-glass-card"
        data-accent="purple"
        style={{ padding: 0, overflow: "hidden" }}
      >
        <div style={{
          padding: "14px 24px",
          background: "rgba(139,92,246,0.04)",
          borderBottom: "1px solid rgba(139,92,246,0.08)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Lock size={14} style={{ color: "#A78BFA" }} />
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: "0.12em",
              textTransform: "uppercase", color: "#A78BFA",
              fontFamily: "var(--font-jetbrains), monospace",
            }}>
              ACCESS VAULT
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <ScanLine size={12} style={{ color: "rgba(255,255,255,0.15)" }} />
            <span style={{
              fontSize: 9, color: "rgba(255,255,255,0.2)",
              fontFamily: "var(--font-jetbrains), monospace",
            }}>
              ENCRYPTED STORAGE
            </span>
          </div>
        </div>

        <div style={{ padding: 24 }}>
          {/* Security notice */}
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "10px 14px", borderRadius: 8,
            background: "rgba(27,79,255,0.04)",
            border: "1px solid rgba(27,79,255,0.1)",
            marginBottom: 24,
          }}>
            <Shield size={13} style={{ color: "#4F8AFF", flexShrink: 0 }} />
            <span style={{
              fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.5,
              fontFamily: "var(--font-jetbrains), monospace",
            }}>
              <TypeWriter text="Keys encrypted at rest with AES-256-GCM. Zero-knowledge architecture." delay={300} />
            </span>
          </div>

          {loadingKeys ? (
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              color: "#55556A", fontSize: 12, padding: "20px 0",
            }}>
              <Loader2 size={14} className="animate-spin" />
              <span style={{ fontFamily: "var(--font-jetbrains), monospace" }}>
                {t('settings.loadingKeys')}
              </span>
            </div>
          ) : loadError ? (
            <div style={{
              padding: 16, borderRadius: 10,
              border: "1px solid rgba(239,68,68,0.2)",
              background: "rgba(239,68,68,0.05)",
              marginBottom: 20,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                <AlertCircle size={14} style={{ color: "#F87171" }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: "#F87171" }}>{loadError}</span>
              </div>
              <p style={{ fontSize: 11, color: "#8888A0", margin: "0 0 8px" }}>
                {t('settings.loadError')}
              </p>
              <button
                onClick={() => window.location.reload()}
                style={{
                  fontSize: 11, color: "#4F8AFF", background: "none",
                  border: "none", cursor: "pointer", padding: 0,
                }}
              >
                {t('settings.tryAgain')}
              </button>
            </div>
          ) : null}

          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {/* Access Code: OpenAI */}
            <AccessCodeField
              label={t('settings.openaiKey')}
              value={openAiKey}
              onChange={setOpenAiKey}
              placeholder="sk-..."
              disabled={loadingKeys}
              hint={t('settings.openaiUsage')}
              icon={<Cpu size={13} style={{ color: "#4F8AFF" }} />}
              slotLabel="SLOT A"
            />

            {/* Access Code: Stability */}
            <AccessCodeField
              label={t('settings.stabilityKey')}
              value={stabilityKey}
              onChange={setStabilityKey}
              placeholder="sk-..."
              disabled={loadingKeys}
              hint={t('settings.stabilityUsage')}
              icon={<Activity size={13} style={{ color: "#8B5CF6" }} />}
              slotLabel="SLOT B"
            />

            {/* Seal Vault button */}
            <motion.button
              onClick={handleSaveKeys}
              disabled={saveStatus === "saving" || loadingKeys || (!openAiKey.trim() && !stabilityKey.trim())}
              whileHover={(!openAiKey.trim() && !stabilityKey.trim()) ? {} : { scale: 1.02 }}
              whileTap={(!openAiKey.trim() && !stabilityKey.trim()) ? {} : { scale: 0.98 }}
              style={{
                display: "inline-flex", alignItems: "center", gap: 10, alignSelf: "flex-start",
                padding: "12px 28px", borderRadius: 10, border: "none",
                background: saveStatus === "saved"
                  ? "linear-gradient(135deg, #10B981, #059669)"
                  : (!openAiKey.trim() && !stabilityKey.trim())
                    ? "linear-gradient(135deg, #374151, #4B5563)"
                    : "linear-gradient(135deg, #1B4FFF, #8B5CF6)",
                color: "#fff", fontSize: 13, fontWeight: 700,
                cursor: (!openAiKey.trim() && !stabilityKey.trim()) ? "not-allowed" : "pointer",
                letterSpacing: "0.03em",
                boxShadow: saveStatus === "saved"
                  ? "0 4px 20px rgba(16,185,129,0.3)"
                  : (!openAiKey.trim() && !stabilityKey.trim())
                    ? "none"
                    : "0 4px 20px rgba(27,79,255,0.3)",
                transition: "all 200ms ease",
                opacity: (saveStatus === "saving" || loadingKeys || (!openAiKey.trim() && !stabilityKey.trim())) ? 0.5 : 1,
                fontFamily: "var(--font-jetbrains), monospace",
              }}
            >
              {saveStatus === "saving" ? (
                <><Loader2 size={14} className="animate-spin" /> {t('settings.encrypting')}</>
              ) : saveStatus === "saved" ? (
                <><Lock size={14} /> {t('settings.vaultSealed')}</>
              ) : (
                <><Unlock size={14} /> {t('settings.saveApiKeys').toUpperCase()}</>
              )}
            </motion.button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ---- Access Code Field ----
function AccessCodeField({ label, value, onChange, placeholder, disabled, hint, icon, slotLabel }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  disabled: boolean;
  hint: string;
  icon: React.ReactNode;
  slotLabel: string;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <div>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        marginBottom: 8,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {icon}
          <label style={{
            fontSize: 11, fontWeight: 700, color: "#8888A0",
            textTransform: "uppercase", letterSpacing: "0.06em",
            fontFamily: "var(--font-jetbrains), monospace",
          }}>
            {label}
          </label>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            fontSize: 9, color: "rgba(255,255,255,0.15)",
            fontFamily: "var(--font-jetbrains), monospace",
          }}>
            {slotLabel}
          </span>
          {value ? (
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              style={{
                width: 16, height: 16, borderRadius: 4,
                background: "rgba(16,185,129,0.15)",
                border: "1px solid rgba(16,185,129,0.3)",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              <CheckCircle2 size={10} style={{ color: "#10B981" }} />
            </motion.div>
          ) : (
            <div style={{
              width: 16, height: 16, borderRadius: 4,
              border: "1px dashed rgba(255,255,255,0.1)",
            }} />
          )}
        </div>
      </div>

      <div style={{ position: "relative" }}>
        <input
          type="password"
          value={value}
          onChange={e => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          disabled={disabled}
          className="dp-settings-input"
          style={{
            paddingLeft: 40,
            borderColor: focused ? "rgba(139,92,246,0.4)" : undefined,
            boxShadow: focused ? "0 0 0 3px rgba(139,92,246,0.08)" : undefined,
          }}
        />
        <Key size={13} style={{
          position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)",
          color: focused ? "#A78BFA" : "rgba(255,255,255,0.15)",
          transition: "color 200ms ease",
        }} />
      </div>
      <p style={{
        fontSize: 10, color: "#3A3A50", marginTop: 6,
        fontFamily: "var(--font-jetbrains), monospace",
      }}>
        {hint}
      </p>
    </div>
  );
}

// ---- Plan Section — Clearance Level ----
function PlanSection({ userRole }: { userRole: string }) {
  const { t } = useLocale();

  const clearanceLevel = userRole === "FREE" ? "LEVEL 1" : userRole === "PRO" ? "LEVEL 2" : "LEVEL 3";
  const clearanceColor = userRole === "FREE" ? "#F59E0B" : userRole === "PRO" ? "#4F8AFF" : "#A78BFA";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      {/* Clearance Card */}
      <div
        className="dp-glass-card"
        style={{
          padding: 0, overflow: "hidden",
          borderColor: `${clearanceColor}22`,
        }}
      >
        {/* Clearance header */}
        <div style={{
          padding: "14px 24px",
          background: `${clearanceColor}08`,
          borderBottom: `1px solid ${clearanceColor}15`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Crown size={14} style={{
              color: "#FFB800",
              filter: "drop-shadow(0 0 6px rgba(255,184,0,0.3))",
            }} />
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: "0.12em",
              textTransform: "uppercase", color: clearanceColor,
              fontFamily: "var(--font-jetbrains), monospace",
            }}>
              CLEARANCE {clearanceLevel}
            </span>
          </div>
          <div style={{
            padding: "2px 8px", borderRadius: 4,
            background: userRole !== "FREE" ? "rgba(16,185,129,0.1)" : "rgba(245,158,11,0.1)",
            border: `1px solid ${userRole !== "FREE" ? "rgba(16,185,129,0.2)" : "rgba(245,158,11,0.2)"}`,
          }}>
            <span style={{
              fontSize: 9, fontWeight: 700,
              color: userRole !== "FREE" ? "#10B981" : "#F59E0B",
              fontFamily: "var(--font-jetbrains), monospace",
            }}>
              {userRole !== "FREE" ? "GRANTED" : "RESTRICTED"}
            </span>
          </div>
        </div>

        <div style={{ padding: 24 }}>
          {/* Plan info */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{
                fontSize: 24, fontWeight: 700, color: "#F0F0F5",
                letterSpacing: "-0.02em",
              }}>
                {userRole === "FREE" ? t('settings.freePlan') : userRole === "MINI" ? t('settings.miniPlan') : userRole === "STARTER" ? t('settings.starterPlan') : userRole === "PRO" ? t('settings.proPlan') : t('settings.teamPlan')}
              </div>
              <p style={{
                fontSize: 13, color: "rgba(255,255,255,0.35)", marginTop: 4, marginBottom: 0,
              }}>
                {userRole === "FREE" ? t('settings.freeRunsPerMonth') : userRole === "MINI" ? t('settings.miniRunsPerMonth') : userRole === "STARTER" ? t('settings.starterRunsPerMonth') : userRole === "PRO" ? t('settings.proRunsPerMonth') : t('settings.unlimitedRuns')}
              </p>
            </div>

            {/* Decorative star */}
            <div style={{ opacity: 0.12 }}>
              <Star size={44} style={{ color: "#FFB800" }} />
            </div>
          </div>

          {/* Usage metrics */}
          {userRole !== "FREE" && (
            <div style={{ marginTop: 24 }}>
              <div style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                marginBottom: 8,
              }}>
                <span style={{
                  fontSize: 10, color: "rgba(255,255,255,0.3)",
                  fontFamily: "var(--font-jetbrains), monospace",
                  letterSpacing: "0.05em",
                }}>
                  API CAPACITY THIS CYCLE (SAMPLE)
                </span>
                <span style={{
                  fontSize: 10, color: clearanceColor,
                  fontFamily: "var(--font-jetbrains), monospace",
                  fontWeight: 700,
                }}>
                  --
                </span>
              </div>
              <div style={{
                width: "100%", height: 6, borderRadius: 3,
                background: "rgba(255,255,255,0.04)",
                overflow: "hidden",
                position: "relative",
              }}>
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: "0%" }}
                  transition={{ delay: 0.5, duration: 1.2, ease: "easeOut" }}
                  style={{
                    height: "100%", borderRadius: 3,
                    background: `linear-gradient(90deg, ${clearanceColor}, ${clearanceColor}88)`,
                    boxShadow: `0 0 12px ${clearanceColor}40`,
                  }}
                />
              </div>

              {/* Sub-metrics */}
              <div style={{
                display: "flex", gap: 24, marginTop: 16,
              }}>
                {[
                  { label: "CALLS", value: "--", max: "10,000" },
                  { label: "TOKENS", value: "--", max: "2M" },
                  { label: "UPTIME", value: "99.9%", max: null },
                ].map((m) => (
                  <div key={m.label}>
                    <div style={{
                      fontSize: 9, color: "rgba(255,255,255,0.2)",
                      fontFamily: "var(--font-jetbrains), monospace",
                      letterSpacing: "0.05em", marginBottom: 4,
                    }}>
                      {m.label}
                    </div>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 3 }}>
                      <span style={{
                        fontSize: 16, fontWeight: 700, color: "#F0F0F5",
                        fontFamily: "var(--font-jetbrains), monospace",
                      }}>
                        {m.value}
                      </span>
                      {m.max && (
                        <span style={{
                          fontSize: 10, color: "rgba(255,255,255,0.15)",
                          fontFamily: "var(--font-jetbrains), monospace",
                        }}>
                          / {m.max}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Upgrade / Status */}
          <div style={{ marginTop: 24, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            {userRole === "FREE" ? (
              <Link
                href="/dashboard/billing"
                style={{
                  display: "inline-flex", alignItems: "center", gap: 8,
                  padding: "11px 24px", borderRadius: 10,
                  background: "linear-gradient(135deg, #4F8AFF, #8B5CF6)",
                  color: "#fff", fontSize: 12, fontWeight: 700,
                  textDecoration: "none",
                  boxShadow: "0 4px 20px rgba(79,138,255,0.3)",
                  transition: "all 200ms ease",
                  letterSpacing: "0.05em",
                  fontFamily: "var(--font-jetbrains), monospace",
                }}
              >
                {t('settings.requestClearance')}
              </Link>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <CheckCircle2 size={13} style={{ color: "#10B981" }} />
                <span style={{
                  fontSize: 11, color: "rgba(255,255,255,0.3)",
                  fontFamily: "var(--font-jetbrains), monospace",
                }}>
                  {t('settings.maxClearance')}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ---- Security Section ----
function SecuritySection({ userEmail }: { userEmail: string }) {
  const { t } = useLocale();
  const router = useRouter();
  const [isOAuthUser, setIsOAuthUser] = useState(false);

  // Detect if user signed in via OAuth (no password set)
  useEffect(() => {
    fetch("/api/user/profile").then(r => r.json()).then(data => {
      // If profile API exposes hasPassword, use it; otherwise we'll detect on first password change attempt
      if (data?.isOAuthOnly) setIsOAuthUser(true);
    }).catch(() => {});
  }, []);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  // Account deletion state
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleting, setDeleting] = useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error(t('settings.passwordsDoNotMatch'));
      return;
    }
    setChangingPassword(true);
    try {
      const res = await fetch("/api/user/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('settings.passwordChangeFailed'));
      } else {
        toast.success(t('settings.passwordChanged'));
        setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      }
    } catch {
      toast.error(t('settings.networkError'));
    } finally {
      setChangingPassword(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmation !== "DELETE") {
      toast.error(t('settings.typeDeleteToConfirm'));
      return;
    }
    setDeleting(true);
    try {
      const res = await fetch("/api/user/delete-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: "DELETE", password: deletePassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t('settings.deleteFailed'));
      } else {
        toast.success(t('settings.accountDeleted'));
        router.push("/");
      }
    } catch {
      toast.error(t('settings.networkError'));
    } finally {
      setDeleting(false);
    }
  };

  const inputStyle = {
    width: "100%", padding: "10px 14px", borderRadius: 10,
    background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
    color: "#F0F0F5", fontSize: 13, outline: "none", boxSizing: "border-box" as const,
  };

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {/* Password Change */}
        <div className="dp-glass-card" style={{ padding: 24, borderRadius: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: isOAuthUser ? 0 : 20 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(79,138,255,0.08)", border: "1px solid rgba(79,138,255,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Lock size={16} style={{ color: "#4F8AFF" }} />
            </div>
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 600, color: "#F0F0F5" }}>{t('settings.changePassword')}</h3>
              <p style={{ fontSize: 11, color: "#5C5C78" }}>{isOAuthUser ? t('settings.oauthPasswordNote') : t('settings.changePasswordDesc')}</p>
            </div>
          </div>
          {!isOAuthUser && <>

          <form onSubmit={handleChangePassword} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#5C5C78", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.5px" }}>{t('settings.currentPassword')}</label>
              <input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} required style={inputStyle} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#5C5C78", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.5px" }}>{t('settings.newPassword')}</label>
              <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required minLength={8} style={inputStyle} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#5C5C78", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.5px" }}>{t('settings.confirmNewPassword')}</label>
              <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required style={inputStyle} />
            </div>
            <button type="submit" disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword} style={{
              padding: "10px 20px", borderRadius: 10, border: "none", cursor: changingPassword ? "wait" : "pointer",
              background: "linear-gradient(135deg, #4F8AFF 0%, #6366F1 100%)", color: "#fff", fontSize: 13, fontWeight: 600,
              opacity: (!currentPassword || !newPassword || !confirmPassword) ? 0.5 : 1,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6, alignSelf: "flex-start",
            }}>
              {changingPassword ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Lock size={14} />}
              {changingPassword ? t('settings.saving') : t('settings.changePassword')}
            </button>
          </form>
          </>}
        </div>

        {/* Danger Zone */}
        <div className="dp-glass-card" style={{ padding: 24, borderRadius: 16, border: "1px solid rgba(239,68,68,0.15)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <AlertCircle size={16} style={{ color: "#EF4444" }} />
            </div>
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 600, color: "#EF4444" }}>{t('settings.dangerZone')}</h3>
              <p style={{ fontSize: 11, color: "#5C5C78" }}>{t('settings.dangerZoneDesc')}</p>
            </div>
          </div>

          <div style={{ padding: 16, borderRadius: 10, background: "rgba(239,68,68,0.04)", border: "1px solid rgba(239,68,68,0.08)", marginBottom: 16 }}>
            <p style={{ fontSize: 12, color: "#9898B0", lineHeight: 1.6, marginBottom: 8 }}>
              {t('settings.deleteWarning')}
            </p>
            <p style={{ fontSize: 11, color: "#5C5C78" }}>
              {t('settings.deleteAccountEmail')}: <strong style={{ color: "#9898B0" }}>{userEmail}</strong>
            </p>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#5C5C78", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.5px" }}>{t('settings.typeDelete')}</label>
              <input type="text" value={deleteConfirmation} onChange={e => setDeleteConfirmation(e.target.value)} placeholder="DELETE" style={{ ...inputStyle, borderColor: deleteConfirmation === "DELETE" ? "rgba(239,68,68,0.4)" : undefined }} />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#5C5C78", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.5px" }}>{t('settings.confirmWithPassword')}</label>
              <input type="password" value={deletePassword} onChange={e => setDeletePassword(e.target.value)} placeholder={t('settings.yourPassword')} style={inputStyle} />
            </div>
            <button onClick={handleDeleteAccount} disabled={deleting || deleteConfirmation !== "DELETE"} style={{
              padding: "10px 20px", borderRadius: 10, border: "none", cursor: deleting ? "wait" : "pointer",
              background: deleteConfirmation === "DELETE" ? "#EF4444" : "rgba(239,68,68,0.2)", color: "#fff", fontSize: 13, fontWeight: 600,
              opacity: deleteConfirmation !== "DELETE" ? 0.5 : 1,
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6, alignSelf: "flex-start",
            }}>
              {deleting ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <Trash2 size={14} />}
              {deleting ? t('settings.deleting') : t('settings.deleteAccount')}
            </button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ---- Page ----
export default function SettingsPage() {
  const { t } = useLocale();
  const { data: session, update: updateSession } = useSession();
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  const user = session?.user;
  const userRole = (user as { role?: string } | undefined)?.role || "FREE";
  const initials = user?.name
    ? user.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)
    : (user?.email?.[0] ?? "U").toUpperCase();

  const tabs: Array<{ key: SettingsTab; label: string; icon: React.ReactNode; desc: string }> = [
    { key: "profile",  label: t('settings.profile'),   icon: <Fingerprint size={16} />, desc: t('settings.tabIdentity') },
    { key: "api-keys", label: t('settings.apiKeys'),   icon: <Key size={16} />, desc: t('settings.tabVault') },
    { key: "plan",     label: t('settings.planUsage'),  icon: <Shield size={16} />, desc: t('settings.tabClearance') },
    { key: "security", label: t('settings.security'),  icon: <Lock size={16} />, desc: t('settings.tabSecurity') },
  ];

  return (
    <div className="dp-page-bg" style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <PageBackground />

      {/* Header */}
      <header
        className="flex items-center justify-between px-6 dashboard-header"
        style={{
          minHeight: 56,
          background: "rgba(7,7,13,0.85)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          borderBottom: "1px solid rgba(79,138,255,0.06)",
          position: "relative", zIndex: 2,
        }}
      >
        <div>
          <div className="flex items-center gap-3">
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "#F0F0F5", letterSpacing: "-0.02em" }}>
              {t('settings.title')}
            </h1>
            <span style={{
              padding: "2px 8px", borderRadius: 20, fontSize: 9, fontWeight: 700,
              letterSpacing: "0.08em", textTransform: "uppercase" as const,
              color: "#F59E0B", border: "1px solid rgba(245,158,11,0.25)",
              background: "rgba(245,158,11,0.06)",
              fontFamily: "var(--font-jetbrains), monospace",
            }}>
              {t('dashboard.beta')}
            </span>
          </div>
          <p style={{ fontSize: 11, color: "#5C5C78", marginTop: 2, letterSpacing: "0.02em" }}>
            {t('settings.subtitle')}
          </p>
        </div>
        <AnimatePresence>
          <SaveStatus status={saveStatus} />
        </AnimatePresence>
      </header>

      <main className="settings-main-padding" style={{ flex: 1, overflowY: "auto", padding: "28px 32px", position: "relative", zIndex: 1 }}>
        <div style={{ maxWidth: 960, margin: "0 auto" }}>
          <SecurityBar />

          <div className="settings-layout" style={{ display: "flex", gap: 24 }}>
            {/* Tab Navigation — Control Panel Selector */}
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.4 }}
              className="dp-glass-card settings-sidebar"
              style={{
                width: 220, flexShrink: 0, padding: 8,
                display: "flex", flexDirection: "column", gap: 2,
                alignSelf: "flex-start", position: "sticky", top: 0,
              }}
            >
              {/* Panel label */}
              <div style={{
                padding: "8px 14px 12px",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
                marginBottom: 4,
              }}>
                <span style={{
                  fontSize: 9, fontWeight: 700, letterSpacing: "0.12em",
                  color: "rgba(255,255,255,0.2)",
                  fontFamily: "var(--font-jetbrains), monospace",
                }}>
                  {t('settings.controlPanel')}
                </span>
              </div>

              {tabs.map((tab, i) => (
                <motion.button
                  key={tab.key}
                  className="dp-settings-tab"
                  data-active={activeTab === tab.key ? "true" : "false"}
                  onClick={() => setActiveTab(tab.key)}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.1 }}
                  style={{ flexDirection: "column", alignItems: "flex-start", gap: 2, padding: "12px 14px" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
                    {tab.icon}
                    <span>{tab.label}</span>
                  </div>
                  <span style={{
                    fontSize: 9, color: "rgba(255,255,255,0.15)",
                    fontFamily: "var(--font-jetbrains), monospace",
                    paddingLeft: 24,
                  }}>
                    {tab.desc}
                  </span>
                </motion.button>
              ))}
            </motion.div>

            {/* Content Panel */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <AnimatePresence mode="wait">
                {activeTab === "profile" && (
                  <motion.div key="profile" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }}>
                    <ProfileSection user={user} initials={initials} saveStatus={saveStatus} onSaveStatusChange={setSaveStatus} onSessionUpdate={updateSession} />
                    <ReferralDetailsSection />
                  </motion.div>
                )}
                {activeTab === "api-keys" && (
                  <motion.div key="api-keys" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }}>
                    <ApiKeysSection saveStatus={saveStatus} onSaveStatusChange={setSaveStatus} />
                  </motion.div>
                )}
                {activeTab === "plan" && (
                  <motion.div key="plan" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }}>
                    <PlanSection userRole={userRole} />
                  </motion.div>
                )}
                {activeTab === "security" && (
                  <motion.div key="security" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3 }}>
                    <SecuritySection userEmail={user?.email || ""} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
