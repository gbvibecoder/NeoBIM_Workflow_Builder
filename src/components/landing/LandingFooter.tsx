"use client";

import Link from "next/link";
import { useLocale } from "@/hooks/useLocale";

export function LandingFooter() {
  const { t } = useLocale();

  return (
    <>
      <footer className="landing-footer-wrapper" style={{
        borderTop: "1px solid rgba(255,255,255,0.04)",
        padding: "32px 48px",
        background: "rgba(7,7,13,0.9)",
      }}>
        <div className="landing-footer" style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, overflow: "hidden", flexShrink: 0 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/buildflow_logo.png" alt="BuildFlow" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            </div>
            <span style={{ fontSize: 13, color: "#5C5C78", fontWeight: 600 }}>
              {t('landing.copyright')}
            </span>
          </div>
          <div style={{ display: "flex", gap: 24 }}>
            {[
              { label: t('landing.privacy'), href: '/privacy' },
              { label: t('landing.terms'), href: '/terms' },
              { label: t('landing.contact'), href: '/contact' },
            ].map(l => (
              <Link key={l.href} href={l.href} style={{ fontSize: 12, color: "#5C5C78", textDecoration: "none", transition: "color 0.15s" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#9898B0"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#5C5C78"; }}
              >{l.label}</Link>
            ))}
          </div>
          <span style={{ fontSize: 11, color: "#3A3A50" }}>
            {t('landing.betaProduct')}
          </span>
        </div>
      </footer>

      {/* Trust Signals */}
      <div style={{
        padding: "32px 48px 48px",
        textAlign: "center",
        borderTop: "1px solid rgba(255,255,255,0.04)",
      }}>
        <div style={{ display: "flex", justifyContent: "center", gap: 32, flexWrap: "wrap", marginBottom: 16 }}>
          {[t('landing.trustEncrypted'), t('landing.trustBuiltForAec'), t('landing.trustBeta')].map(signal => (
            <span key={signal} style={{ fontSize: 11, color: "#3A3A50", fontWeight: 500 }}>
              {signal}
            </span>
          ))}
        </div>
        <p style={{ fontSize: 11, color: "#2A2A3E" }}>
          {t('landing.copyrightFull').replace('{year}', String(new Date().getFullYear()))}
        </p>
      </div>
    </>
  );
}
