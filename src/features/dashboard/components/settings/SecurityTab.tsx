"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Shield } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { PasswordChangeForm } from "./PasswordChangeForm";
import { DangerZone } from "./DangerZone";
import s from "./settings.module.css";

export function SecurityTab() {
  const { t } = useLocale();
  const { data: session } = useSession();
  const [isOAuthUser, setIsOAuthUser] = useState(false);

  // Detect if user signed in via OAuth (no password set)
  useEffect(() => {
    fetch("/api/user/profile").then(r => r.json()).then(data => {
      if (data?.isOAuthOnly) setIsOAuthUser(true);
    }).catch(() => {});
  }, []);

  const userEmail = session?.user?.email || "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {isOAuthUser ? (
        <div className={s.section}>
          <div className={s.sectionStrip}>
            <span className={s.sectionStripNum}>FB-S04.A &middot; {t("settings.passwordSection")}</span>
          </div>
          <div className={s.sectionBody}>
            <div className={s.oauthNote}>
              <div className={s.oauthNoteIcon}>
                <Shield size={18} />
              </div>
              <div className={s.oauthNoteBody}>
                <div className={s.oauthNoteTitle}>{t("settings.oauthSignedInWith")}</div>
                <div className={s.oauthNoteText}>{t("settings.oauthDesc")}</div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <PasswordChangeForm />
      )}

      <DangerZone userEmail={userEmail} />
    </div>
  );
}
