"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2, Loader2 } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import s from "./settings.module.css";

interface DangerZoneProps {
  userEmail: string;
}

export function DangerZone({ userEmail }: DangerZoneProps) {
  const { t } = useLocale();
  const router = useRouter();
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleting, setDeleting] = useState(false);

  const handleDeleteAccount = async () => {
    if (deleteConfirmation !== "DELETE") {
      toast.error(t("settings.typeDeleteToConfirm"));
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
        toast.error(data.error || t("settings.deleteFailed"));
      } else {
        toast.success(t("settings.accountDeleted"));
        router.push("/");
      }
    } catch {
      toast.error(t("settings.networkError"));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className={s.dangerZone}>
      <div className={s.dangerStrip}>
        <span className={s.dangerStripNum}>FB-S04.B &middot; {t("settings.dangerZoneLabel")}</span>
        <span className={s.dangerStripRight}>{t("settings.dangerZoneSuffix")}</span>
      </div>
      <div className={s.dangerBody}>
        <h3 className={s.dangerTitle}>{t("settings.deleteAccountTitle")}</h3>
        <p className={s.dangerDesc}>
          {t("settings.deleteAccountDesc")}
          {userEmail && (
            <> Account: <strong>{userEmail}</strong></>
          )}
        </p>

        <div className={s.deleteForm}>
          <div className={s.formField}>
            <label className={s.formLabel}>{t("settings.deleteTypeLabel")}</label>
            <input
              type="text"
              value={deleteConfirmation}
              onChange={e => setDeleteConfirmation(e.target.value)}
              placeholder="DELETE"
              className={s.formInput}
              style={deleteConfirmation === "DELETE" ? { borderColor: "var(--danger-mid)" } : undefined}
            />
          </div>
          <div className={s.formField}>
            <label className={s.formLabel}>{t("settings.deletePasswordLabel")}</label>
            <input
              type="password"
              value={deletePassword}
              onChange={e => setDeletePassword(e.target.value)}
              placeholder={t("settings.yourPassword")}
              className={s.formInput}
            />
          </div>
          <button
            onClick={handleDeleteAccount}
            disabled={deleting || deleteConfirmation !== "DELETE"}
            className={s.deleteAction}
          >
            {deleting ? <Loader2 size={14} className={s.spinner} /> : <Trash2 size={14} />}
            {deleting ? t("settings.deleting") : t("settings.deleteAccountBtn")}
          </button>
        </div>
      </div>
    </div>
  );
}
