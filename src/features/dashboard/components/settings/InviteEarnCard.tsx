"use client";

import { useEffect, useState } from "react";
import { Gift, Users, Zap, Copy, Check, Loader2, Info } from "lucide-react";
import { toast } from "sonner";
import { useLocale } from "@/hooks/useLocale";
import s from "./settings.module.css";

interface ReferralStats {
  code: string | null;
  stats: {
    totalReferred: number;
    converted: number;
    bonusEarned: number;
    bonusRemaining: number;
  };
}

export function InviteEarnCard() {
  const { t } = useLocale();
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);

  const fetchStats = () => {
    fetch("/api/referral")
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setStats(d); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchStats();
    const onFocus = () => fetchStats();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const referralLink = stats?.code
    ? `https://trybuildflow.in/register?ref=${stats.code}`
    : null;

  const copyLink = async () => {
    if (!referralLink) return;
    try {
      await navigator.clipboard.writeText(referralLink);
      setCopied(true);
      toast.success("Referral link copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy link");
    }
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

  const r = stats?.stats ?? { totalReferred: 0, converted: 0, bonusEarned: 0, bonusRemaining: 0 };

  return (
    <div className={s.invite}>
      {/* Drafting strip */}
      <div className={s.inviteStrip}>
        <span className={s.inviteStripNum}>FB-S01.E &middot; {t("referral.inviteEyebrow")}</span>
        {r.bonusRemaining > 0 && (
          <span className={s.inviteStripBonus}>
            <Zap size={10} />
            {r.bonusRemaining} {t("referral.bonusAvailable")}
          </span>
        )}
      </div>

      <div className={s.inviteBody}>
        {loading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: 24 }}>
            <Loader2 size={18} className={s.spinner} style={{ color: "var(--plan-sage)" }} />
          </div>
        ) : (
          <>
            {/* Head */}
            <div className={s.inviteHead}>
              <div className={s.inviteEyebrow}>
                <Gift size={10} />
                {t("referral.inviteEyebrow")}
              </div>
              <h3 className={s.inviteTitle}>
                {t("referral.inviteTitlePart1")} <em>{t("referral.inviteTitleHighlight")}</em>{t("referral.inviteTitleSuffix")}
              </h3>
              <p className={s.inviteSub}>{t("referral.inviteSub")}</p>
            </div>

            {/* Stats */}
            <div className={s.inviteStats}>
              <div className={s.inviteStat}>
                <div className={s.inviteStatValue}>{r.totalReferred}</div>
                <div className={s.inviteStatLabel}>{t("referral.statFriendsInvited")}</div>
                <div className={s.inviteStatMeta}>{t("referral.statSignupsCompleted")}</div>
              </div>
              <div className={s.inviteStat}>
                <div className={s.inviteStatValue}>{r.bonusEarned}</div>
                <div className={s.inviteStatLabel}>{t("referral.statBonusEarned")}</div>
                <div className={s.inviteStatMeta}>{t("referral.statBonusEarnedMeta")}</div>
              </div>
              <div className={s.inviteStat}>
                <div className={s.inviteStatValue}>{r.bonusRemaining}</div>
                <div className={s.inviteStatLabel}>{t("referral.statAvailableNow")}</div>
                <div className={s.inviteStatMeta}>{t("referral.statAvailableMeta")}</div>
              </div>
            </div>

            {/* How it works */}
            <div className={s.inviteHowitworks}>
              <div className={s.inviteHowitworksIcon}>
                <Info size={12} />
              </div>
              <div className={s.inviteHowitworksBody}>
                <div className={s.inviteHowitworksLabel}>{t("referral.howItWorksLabel")}</div>
                <div className={s.inviteHowitworksText}>{t("referral.howItWorksText")}</div>
              </div>
            </div>

            {/* Referral link or generate button */}
            {referralLink ? (
              <div className={s.inviteLink}>
                <div className={s.inviteLinkInput}>{referralLink}</div>
                <button
                  className={s.inviteLinkBtn}
                  data-copied={copied ? "true" : "false"}
                  onClick={copyLink}
                >
                  {copied ? <Check size={12} /> : <Copy size={12} />}
                  {copied ? t("referral.copied") : t("referral.copyLink")}
                </button>
              </div>
            ) : (
              <button
                className={s.inviteLinkBtn}
                onClick={generateCode}
                disabled={generating}
                style={{ width: "100%", justifyContent: "center", padding: "10px 16px" }}
              >
                {generating ? <Loader2 size={12} className={s.spinner} /> : <Gift size={12} />}
                {generating ? "Generating..." : t("referral.generateLink")}
              </button>
            )}

            {/* Recent invites — empty state for Z.8.1 (Option 2) */}
            <div className={s.recentInvites}>
              <div className={s.recentInvitesHead}>
                <span className={s.recentInvitesTitle}>{t("referral.recentInvitesTitle")}</span>
                <span className={s.recentInvitesCount}>{r.totalReferred} total</span>
              </div>
              {r.totalReferred === 0 ? (
                <div className={s.recentInvitesEmpty}>{t("referral.recentInvitesEmpty")}</div>
              ) : (
                <div className={s.recentInvitesEmpty}>
                  {t("referral.recentInvitesActive").replace(/\{count\}/g, String(r.totalReferred))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
