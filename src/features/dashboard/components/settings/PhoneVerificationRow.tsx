"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Smartphone, CheckCircle2 } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { normalizePhone } from "@/lib/form-validation";
import s from "./settings.module.css";

interface PhoneVerificationRowProps {
  phoneNumber: string | null;
  phoneVerified: boolean;
  onPhoneChange: (phone: string | null) => void;
  onVerified: () => void;
}

export function PhoneVerificationRow({
  phoneNumber,
  phoneVerified,
  onPhoneChange,
}: PhoneVerificationRowProps) {
  const { t } = useLocale();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(phoneNumber ?? "");
  const [saving, setSaving] = useState(false);
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
      setIsEditing(false);
      toast.success("New phone, new you. Don't forget to verify it!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  }

  const editForm = (
    <div style={{ width: "100%", marginTop: 8 }}>
      <div className={s.verifInlineForm}>
        <input
          type="tel"
          value={editValue}
          onChange={e => { setEditValue(e.target.value); setError(""); }}
          placeholder="+919876543210"
          autoFocus
          onKeyDown={e => {
            if (e.key === "Enter") handleSavePhone();
            if (e.key === "Escape") { setIsEditing(false); setEditValue(phoneNumber ?? ""); setError(""); }
          }}
          className={s.verifInlineInput}
        />
        <button onClick={handleSavePhone} disabled={saving} className={s.verifInlineBtn}>
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          onClick={() => { setIsEditing(false); setEditValue(phoneNumber ?? ""); setError(""); }}
          className={s.verifInlineBtnCancel}
        >
          Cancel
        </button>
      </div>
      {error && <div className={s.verifError}>{error}</div>}
    </div>
  );

  // No phone number set
  if (!phoneNumber) {
    return (
      <div className={s.verifRow} data-status="none">
        <div className={s.verifRowLeft}>
          <div className={s.verifRowIcon}>
            <Smartphone size={14} />
          </div>
          <div className={s.verifRowInfo}>
            <div className={s.verifRowLabel}>{t("settings.phoneRowLabelNotAdded")}</div>
            {!isEditing && (
              <div className={s.verifHint}>{t("settings.phoneRowDescAdd")}</div>
            )}
          </div>
        </div>
        {!isEditing ? (
          <button className={s.verifRowAction} onClick={() => setIsEditing(true)}>
            {t("settings.addPhone")}
          </button>
        ) : null}
        {isEditing && editForm}
      </div>
    );
  }

  // Phone verified
  if (phoneVerified) {
    return (
      <div className={s.verifRow} data-status="verified">
        <div className={s.verifRowLeft}>
          <div className={s.verifRowIcon}>
            <CheckCircle2 size={14} />
          </div>
          <div className={s.verifRowInfo}>
            <div className={s.verifRowLabel}>{t("settings.phoneRowLabelVerified")}</div>
            <div className={s.verifRowValueMono}>{phoneNumber}</div>
          </div>
        </div>
        <button className={s.verifRowAction} onClick={() => setIsEditing(true)}>
          {t("settings.changeBtn")}
        </button>
        {isEditing && editForm}
      </div>
    );
  }

  // Phone added but unverified — show pending chip, NO mock verify button
  return (
    <div className={s.verifRow} data-status="unverified">
      <div className={s.verifRowLeft}>
        <div className={s.verifRowIcon}>
          <Smartphone size={14} />
        </div>
        <div className={s.verifRowInfo}>
          <div className={s.verifRowLabel}>{t("settings.phoneRowLabelAdded")}</div>
          <div className={s.verifRowValueMono}>{phoneNumber}</div>
          <div className={s.verifHint}>{t("settings.phoneRowDescPending")}</div>
        </div>
      </div>
      <button className={s.verifRowAction} onClick={() => setIsEditing(true)}>
        {t("settings.changeBtn")}
      </button>
      {isEditing && editForm}
    </div>
  );
}
