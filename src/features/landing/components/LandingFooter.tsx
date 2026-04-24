"use client";

import Link from "next/link";
import { useLocale } from "@/hooks/useLocale";
import { Instagram, Linkedin, Mail } from "lucide-react";
import { CONTACT_EMAIL } from "@/constants/contact";

const SOCIAL_LINKS = [
  { icon: Instagram, href: "https://www.instagram.com/buildflow_live/", label: "Instagram", color: "#E1306C" },
  { icon: Linkedin, href: "https://www.linkedin.com/company/trybuildflow/", label: "LinkedIn", color: "#0A66C2" },
  { icon: Mail, href: `mailto:${CONTACT_EMAIL}`, label: "Email", color: "#4F8AFF" },
];

export function LandingFooter() {
  const { t } = useLocale();

  return (
    <>
      <footer className="landing-footer-wrapper landing-section" style={{
        borderTop: "1px solid rgba(255,255,255,0.04)",
        padding: "32px 48px",
        background: "rgba(7,7,13,0.9)",
      }}>
        <div className="landing-footer" style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
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
              <Link key={l.href} href={l.href} style={{ fontSize: 12, color: "#5C5C78", textDecoration: "none", transition: "color 0.15s", padding: "8px 4px" }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = "#9898B0"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#5C5C78"; }}
                onFocus={e => { (e.currentTarget as HTMLElement).style.color = "#9898B0"; }}
                onBlur={e => { (e.currentTarget as HTMLElement).style.color = "#5C5C78"; }}
              >{l.label}</Link>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {SOCIAL_LINKS.map(s => (
              <a
                key={s.label}
                href={s.href}
                target={s.href.startsWith("mailto:") ? undefined : "_blank"}
                rel={s.href.startsWith("mailto:") ? undefined : "noopener noreferrer"}
                aria-label={s.label}
                style={{
                  width: 44, height: 44, borderRadius: 8,
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.06)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  color: "#5C5C78", transition: "all 0.2s", textDecoration: "none",
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = s.color; (e.currentTarget as HTMLElement).style.borderColor = `${s.color}30`; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = "#5C5C78"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.06)"; }}
                onFocus={e => { (e.currentTarget as HTMLElement).style.color = s.color; (e.currentTarget as HTMLElement).style.borderColor = `${s.color}30`; }}
                onBlur={e => { (e.currentTarget as HTMLElement).style.color = "#5C5C78"; (e.currentTarget as HTMLElement).style.borderColor = "rgba(255,255,255,0.06)"; }}
              >
                <s.icon size={14} />
              </a>
            ))}
          </div>
        </div>
      </footer>

      {/* Trust Signals */}
      <div className="landing-section" style={{
        padding: "32px 48px 48px",
        textAlign: "center",
        borderTop: "1px solid rgba(255,255,255,0.04)",
      }}>
        <div style={{ display: "flex", justifyContent: "center", gap: 32, flexWrap: "wrap", marginBottom: 16 }}>
          {[t('landing.trustEncrypted'), t('landing.trustBuiltForAec'), t('landing.trustBeta')].map(signal => (
            <span key={signal} style={{ fontSize: 11, color: "#6B6B80", fontWeight: 500 }}>
              {signal}
            </span>
          ))}
        </div>
        <p style={{ fontSize: 11, color: "#5C5C78" }}>
          {t('landing.copyrightFull').replace('{year}', String(new Date().getFullYear()))}
        </p>
      </div>
    </>
  );
}
