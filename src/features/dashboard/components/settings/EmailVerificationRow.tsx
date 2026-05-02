"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Mail, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import s from "./settings.module.css";

interface EmailVerificationRowProps {
  email: string | null;
  emailVerified: boolean;
  onEmailAdded: (newEmail: string) => void;
  onVerified: () => void;
}

export function EmailVerificationRow({
  email,
  emailVerified,
  onEmailAdded,
  onVerified,
}: EmailVerificationRowProps) {
  const { t } = useLocale();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  const hasRealEmail = !!email;

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

  // Email verified — sage green state
  if (hasRealEmail && emailVerified) {
    return (
      <div className={s.verifRow} data-status="verified">
        <div className={s.verifRowLeft}>
          <div className={s.verifRowIcon}>
            <CheckCircle2 size={14} />
          </div>
          <div className={s.verifRowInfo}>
            <div className={s.verifRowLabel}>{t("settings.emailRowLabel")} &middot; {t("settings.chipVerified")}</div>
            <div className={s.verifRowValueMono}>{email}</div>
          </div>
        </div>
      </div>
    );
  }

  // No email set — show add button
  if (!hasRealEmail) {
    return (
      <div className={s.verifRow} data-status="none">
        <div className={s.verifRowLeft}>
          <div className={s.verifRowIcon}>
            <Mail size={14} />
          </div>
          <div className={s.verifRowInfo}>
            <div className={s.verifRowLabel}>{t("settings.emailRowLabel")} &middot; Not added</div>
            {!isAdding && (
              <div className={s.verifHint}>Add an email for account recovery and notifications.</div>
            )}
          </div>
        </div>
        {!isAdding ? (
          <button className={s.verifRowAction} onClick={() => setIsAdding(true)}>
            {t("settings.addEmail")}
          </button>
        ) : null}
        {isAdding && (
          <div style={{ width: "100%", marginTop: 8 }}>
            <div className={s.verifInlineForm}>
              <input
                type="email"
                value={editValue}
                onChange={e => { setEditValue(e.target.value); setError(""); }}
                placeholder="you@example.com"
                autoFocus
                onKeyDown={e => {
                  if (e.key === "Enter") handleSaveEmail();
                  if (e.key === "Escape") { setIsAdding(false); setEditValue(""); setError(""); }
                }}
                className={s.verifInlineInput}
              />
              <button onClick={handleSaveEmail} disabled={saving} className={s.verifInlineBtn}>
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                onClick={() => { setIsAdding(false); setEditValue(""); setError(""); }}
                className={s.verifInlineBtnCancel}
              >
                Cancel
              </button>
            </div>
            {error && <div className={s.verifError}>{error}</div>}
          </div>
        )}
      </div>
    );
  }

  // Has real email but NOT verified
  return (
    <div className={s.verifRow} data-status="unverified">
      <div className={s.verifRowLeft}>
        <div className={s.verifRowIcon}>
          <AlertCircle size={14} />
        </div>
        <div className={s.verifRowInfo}>
          <div className={s.verifRowLabel}>{t("settings.emailRowLabel")} &middot; Unverified</div>
          <div className={s.verifRowValueMono}>{email}</div>
          <div className={s.verifHint}>Check your inbox for a verification email.</div>
        </div>
      </div>
      {sent ? (
        <span style={{ fontSize: 11, color: "var(--plan-sage)", fontWeight: 600 }}>Sent!</span>
      ) : (
        <button
          className={s.verifRowAction}
          data-variant="ember"
          disabled={sending}
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
        >
          {sending && <Loader2 size={12} className={s.spinner} />}
          {sending ? "Sending..." : "Resend"}
        </button>
      )}
      {error && <div className={s.verifError}>{error}</div>}
    </div>
  );
}
