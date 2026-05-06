"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Lock, Loader2 } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import s from "./settings.module.css";

export function PasswordChangeForm() {
  const { t } = useLocale();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error(t("settings.passwordsDoNotMatch"));
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
        toast.error(data.error || t("settings.passwordChangeFailed"));
      } else {
        toast.success(t("settings.passwordChanged"));
        setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      }
    } catch {
      toast.error(t("settings.networkError"));
    } finally {
      setChangingPassword(false);
    }
  };

  return (
    <div className={s.section}>
      <div className={s.sectionStrip}>
        <span className={s.sectionStripNum}>FB-S04.A &middot; {t("settings.passwordSection")}</span>
        <span className={s.sectionStripRight}>{t("settings.passwordRule")}</span>
      </div>
      <div className={s.sectionBody}>
        <p className={s.formHint} style={{ marginBottom: 16, marginTop: 0 }}>
          {t("settings.passwordIntro")}
        </p>
        <form onSubmit={handleChangePassword} className={s.passwordForm}>
          <div className={s.formField}>
            <label className={s.formLabel}>{t("settings.currentPassword")}</label>
            <input
              type="password"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              required
              className={s.formInput}
            />
          </div>
          <div className={s.formField}>
            <label className={s.formLabel}>{t("settings.newPassword")}</label>
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              required
              minLength={8}
              className={s.formInput}
            />
          </div>
          <div className={s.formField}>
            <label className={s.formLabel}>{t("settings.confirmNewPassword")}</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              required
              className={s.formInput}
            />
          </div>
          <p className={s.formHint}>{t("settings.passwordHint")}</p>
          <div className={s.formActions}>
            <button
              type="submit"
              disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword}
              className={s.btnPrimary}
            >
              {changingPassword ? <Loader2 size={14} className={s.spinner} /> : <Lock size={14} />}
              {changingPassword ? t("settings.saving") : t("settings.passwordUpdate")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
