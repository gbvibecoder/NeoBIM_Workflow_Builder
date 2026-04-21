"use client";

import Link from "next/link";
import Image from "next/image";
import { Instagram, Linkedin, Mail } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { CONTACT_EMAIL } from "@/constants/contact";

const SOCIAL_LINKS = [
  {
    icon: Instagram,
    href: "https://www.instagram.com/buildflow_live/",
    label: "Instagram",
  },
  {
    icon: Linkedin,
    href: "https://www.linkedin.com/in/buildflow/",
    label: "LinkedIn",
  },
  {
    icon: Mail,
    href: `mailto:${CONTACT_EMAIL}`,
    label: "Email",
  },
];

export function LightFooter() {
  const { t } = useLocale();

  return (
    <footer
      style={{
        borderTop: "1px solid var(--light-border)",
        padding: "48px max(16px, min(48px, 4vw)) 32px",
        background: "var(--light-bg)",
      }}
    >
      <div
        className="light-footer-row"
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 16,
        }}
      >
        {/* Logo + name */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Image
            src="/buildflow_logo.png"
            alt="BuildFlow"
            width={24}
            height={24}
            style={{ borderRadius: 6 }}
          />
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--light-ink)",
              fontFamily: "var(--font-dm-sans), sans-serif",
            }}
          >
            BuildFlow
          </span>
        </div>

        {/* Legal links */}
        <div style={{ display: "flex", gap: 24 }}>
          {[
            { label: t("landing.privacy"), href: "/privacy" },
            { label: t("landing.terms"), href: "/terms" },
            { label: t("landing.contact"), href: "/contact" },
          ].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              style={{
                fontSize: 13,
                fontWeight: 400,
                color: "var(--light-soft)",
                textDecoration: "none",
                fontFamily: "var(--font-dm-sans), sans-serif",
                padding: "4px 0",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.color =
                  "var(--light-ink)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.color =
                  "var(--light-soft)";
              }}
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Social icons */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {SOCIAL_LINKS.map((social) => (
            <a
              key={social.label}
              href={social.href}
              target={social.href.startsWith("mailto:") ? undefined : "_blank"}
              rel={
                social.href.startsWith("mailto:")
                  ? undefined
                  : "noopener noreferrer"
              }
              aria-label={social.label}
              style={{
                width: 36,
                height: 36,
                borderRadius: 8,
                border: "1px solid var(--light-border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--light-soft)",
                textDecoration: "none",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.color =
                  "var(--light-accent)";
                (e.currentTarget as HTMLElement).style.borderColor =
                  "var(--light-border-strong)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.color =
                  "var(--light-soft)";
                (e.currentTarget as HTMLElement).style.borderColor =
                  "var(--light-border)";
              }}
            >
              <social.icon size={14} />
            </a>
          ))}
        </div>
      </div>

      {/* Copyright */}
      <p
        style={{
          maxWidth: 1200,
          margin: "16px auto 0",
          textAlign: "center",
          fontSize: 12,
          fontWeight: 400,
          color: "var(--light-soft)",
          fontFamily: "var(--font-dm-sans), sans-serif",
        }}
      >
        {t("landing.copyrightFull").replace(
          "{year}",
          String(new Date().getFullYear()),
        )}
      </p>

      <style>{`
        @media (max-width: 768px) {
          .light-footer-row {
            flex-direction: column !important;
            gap: 20px !important;
            text-align: center !important;
          }
        }
      `}</style>
    </footer>
  );
}
