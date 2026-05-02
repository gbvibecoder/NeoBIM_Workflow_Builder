"use client";

import { useLocale } from "@/hooks/useLocale";
import s from "./settings.module.css";

interface ProfileData {
  email: string | null;
  phoneNumber: string | null;
  createdAt: string | null;
  role: string;
}

interface AccountDetailsCardProps {
  profileData: ProfileData;
  user: { name?: string | null; email?: string | null; image?: string | null; id?: string } | undefined;
}

export function AccountDetailsCard({ profileData, user }: AccountDetailsCardProps) {
  const { t } = useLocale();

  const planLabel =
    profileData.role === "FREE" ? "Free" :
    profileData.role === "MINI" ? "Mini" :
    profileData.role === "STARTER" ? "Starter" :
    profileData.role === "PRO" ? "Pro" :
    profileData.role === "TEAM_ADMIN" ? "Team" :
    profileData.role === "PLATFORM_ADMIN" ? "Admin" : profileData.role;

  const authMethod = user?.image?.startsWith("https://lh3.googleusercontent.com")
    ? "Google OAuth"
    : profileData.phoneNumber && profileData.email
      ? "Email / Phone & Password"
      : profileData.phoneNumber
        ? "Phone & Password"
        : "Email & Password";

  const userId = (user as { id?: string } | undefined)?.id ?? "\u2014";
  const truncatedId = userId.length > 12 ? `${userId.slice(0, 8)}...${userId.slice(-4)}` : userId;

  const memberSince = profileData.createdAt
    ? new Date(profileData.createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })
    : "\u2014";

  const rows = [
    { label: "AUTH METHOD", value: authMethod, mono: false, meta: t("settings.detailReadOnly") },
    { label: t("settings.detailUserId"), value: truncatedId, mono: true, meta: t("settings.detailReadOnly") },
    { label: t("settings.tabPlanLabel"), value: planLabel, mono: false, meta: "" },
    { label: "MEMBER SINCE", value: memberSince, mono: false, meta: "" },
    { label: t("settings.detailLastActive"), value: t("settings.detailLastActiveValue"), mono: false, meta: "" },
  ];

  return (
    <div className={s.section}>
      <div className={s.sectionStrip}>
        <span className={s.sectionStripNum}>FB-S01.B &middot; {t("settings.sectionAccountDetails")}</span>
        <span className={s.sectionStripRight}>5 fields</span>
      </div>
      <div className={s.sectionBody}>
        <div className={s.detailsGrid}>
          {rows.map((row) => (
            <div key={row.label} className={s.detailRow}>
              <span className={s.detailRowLabel}>{row.label}</span>
              <span className={row.mono ? s.detailRowValueMono : s.detailRowValue}>
                {row.value}
              </span>
              {row.meta && <span className={s.detailRowMeta}>{row.meta}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
