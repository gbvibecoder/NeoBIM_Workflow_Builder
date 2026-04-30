"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, MessageSquare, FileText, X } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";

const BETA_BANNER_VERSION = "v1";
const STORAGE_KEY = `betaBanner.dismissed.${BETA_BANNER_VERSION}`;

export function BetaBanner() {
  const { t } = useLocale();
  const [mounted, setMounted] = useState(false);
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setMounted(true);
    try {
      setDismissed(window.localStorage.getItem(STORAGE_KEY) === "1");
    } catch {
      setDismissed(false);
    }
  }, []);

  const handleDismiss = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  if (!mounted || dismissed) return null;

  return (
    <>
      <style>{`
        .beta-banner {
          position: relative;
          display: flex;
          align-items: center;
          gap: 12px;
          /* Right padding reserves the floating UserMenu avatar zone
             (fixed at top:12 right:16, 32px plate + 16px buffer ≈ 64px)
             so the dismiss button is not occluded by the avatar. */
          padding: 8px 72px 8px clamp(12px, 3vw, 20px);
          background: linear-gradient(90deg, rgba(0,245,255,0.08) 0%, rgba(108,92,231,0.06) 100%);
          border-bottom: 1px solid rgba(0,245,255,0.18);
          color: var(--text-primary);
          font-size: 12.5px;
          line-height: 1.4;
          flex-shrink: 0;
        }
        .beta-banner__content {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 6px;
          min-width: 0;
          flex: 1;
        }
        .beta-banner__title { font-weight: 600; color: var(--text-primary); }
        .beta-banner__message { color: var(--text-secondary); }
        .beta-banner__actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
        }
        .beta-banner__pill {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 4px 10px;
          border-radius: 6px;
          font-weight: 600;
          font-size: 11.5px;
          text-decoration: none;
          white-space: nowrap;
          transition: background 120ms ease, border-color 120ms ease, color 120ms ease;
        }
        .beta-banner__pill--primary {
          background: rgba(0,245,255,0.1);
          border: 1px solid rgba(0,245,255,0.25);
          color: var(--interactive);
        }
        .beta-banner__pill--primary:hover {
          background: rgba(0,245,255,0.18);
          border-color: rgba(0,245,255,0.4);
        }
        .beta-banner__pill--ghost {
          background: transparent;
          border: 1px solid rgba(255,255,255,0.1);
          color: var(--text-secondary);
        }
        .beta-banner__pill--ghost:hover {
          border-color: rgba(255,255,255,0.25);
          color: var(--text-primary);
        }
        .beta-banner__dismiss {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          border-radius: 6px;
          background: transparent;
          border: 1px solid transparent;
          color: var(--text-tertiary);
          cursor: pointer;
          transition: background 120ms ease, color 120ms ease;
          flex-shrink: 0;
        }
        .beta-banner__dismiss:hover {
          background: rgba(255,255,255,0.06);
          color: var(--text-primary);
        }
        .beta-banner__dismiss:focus-visible {
          outline: 2px solid var(--border-focus);
          outline-offset: 2px;
        }
        .beta-banner__sparkles { color: var(--interactive); flex-shrink: 0; }

        @media (max-width: 640px) {
          .beta-banner {
            flex-direction: column;
            align-items: stretch;
            gap: 8px;
            /* Reserve ~60px on the left for the fixed mobile hamburger (44 + 12 + 4)
               and ~88px on the right to clear the floating UserMenu avatar
               (right:16 + 32px plate) plus the absolutely-positioned dismiss button. */
            padding: 10px 88px 10px 64px;
            font-size: 12px;
            line-height: 1.35;
          }
          .beta-banner__sparkles { display: none; }
          .beta-banner__content {
            flex-direction: column;
            align-items: flex-start;
            gap: 2px;
          }
          .beta-banner__title { font-size: 12.5px; }
          .beta-banner__message { font-size: 11.5px; }
          .beta-banner__actions {
            width: 100%;
            gap: 8px;
          }
          .beta-banner__actions .beta-banner__pill { flex: 1; justify-content: center; }
          .beta-banner__dismiss {
            position: absolute;
            top: 8px;
            /* Sit to the left of the floating UserMenu avatar
               (avatar covers viewport right 16-48). */
            right: 56px;
            width: 26px;
            height: 26px;
          }
        }
      `}</style>
      <div
        className="beta-banner"
        role="status"
        aria-live="polite"
      >
        <Sparkles size={14} className="beta-banner__sparkles" aria-hidden="true" />

        <div className="beta-banner__content">
          <strong className="beta-banner__title">{t("banner.betaTitle")}</strong>
          <span className="beta-banner__message">{t("banner.betaMessage")}</span>
        </div>

        <div className="beta-banner__actions">
          <Link href="/dashboard/feedback" className="beta-banner__pill beta-banner__pill--primary">
            <MessageSquare size={11} aria-hidden="true" />
            {t("banner.betaFeedback")}
          </Link>

          <Link href="/blog" className="beta-banner__pill beta-banner__pill--ghost">
            <FileText size={11} aria-hidden="true" />
            {t("banner.betaChangelog")}
          </Link>

          <button
            type="button"
            onClick={handleDismiss}
            aria-label={t("banner.betaDismiss")}
            className="beta-banner__dismiss"
          >
            <X size={12} aria-hidden="true" />
          </button>
        </div>
      </div>
    </>
  );
}
