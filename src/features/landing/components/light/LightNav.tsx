"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import Image from "next/image";
import { Menu, X, Sun, Moon } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { LightLanguageSwitcher } from "./LightLanguageSwitcher";
import { trackCTAClick } from "./LightTrackingEvents";

export function LightNav() {
  const { t } = useLocale();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  const navLinks = [
    { label: t("landing.features"), href: "#four-surfaces" },
    { label: t("landing.pricing"), href: "#pricing" },
    { label: t("landing.faqSection"), href: "#faq" },
  ];

  return (
    <header>
      <nav
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          display: "flex",
          alignItems: "center",
          height: 64,
          padding: "0 max(16px, min(48px, 4vw))",
          background: scrolled ? "var(--light-bg)" : "transparent",
          borderBottom: scrolled
            ? "1px solid var(--light-border)"
            : "1px solid transparent",
          transition: "background 200ms ease-out, border-color 200ms ease-out",
        }}
        aria-label="Main navigation"
      >
        {/* Logo */}
        <Link
          href="/light"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            textDecoration: "none",
            flexShrink: 0,
          }}
        >
          <Image
            src="/buildflow_logo.png"
            alt="BuildFlow"
            width={32}
            height={32}
            style={{ borderRadius: 8 }}
          />
          <span
            style={{
              fontSize: 18,
              fontWeight: 600,
              color: "var(--light-ink)",
              fontFamily: "var(--font-dm-sans), sans-serif",
              letterSpacing: "-0.3px",
            }}
          >
            BuildFlow
          </span>
        </Link>

        {/* Desktop nav links */}
        <div
          className="light-nav-links"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flex: 1,
            justifyContent: "center",
          }}
        >
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="lnav-link"
              onClick={(e) => {
                e.preventDefault();
                document
                  .getElementById(link.href.slice(1))
                  ?.scrollIntoView({ behavior: "smooth" });
              }}
              style={{
                fontSize: 14,
                fontWeight: 400,
                color: "var(--light-soft)",
                textDecoration: "none",
                padding: "8px 14px",
                borderRadius: 6,
                fontFamily: "var(--font-dm-sans), sans-serif",
                transition: "color 200ms ease-out",
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
            </a>
          ))}
        </div>

        {/* Desktop right */}
        <div
          className="light-nav-right"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexShrink: 0,
            marginLeft: "auto",
          }}
        >
          <LightLanguageSwitcher />
          {/* Theme toggle pill */}
          <div className="ltheme-toggle">
            <span className="ltheme-toggle-active" aria-label="Light mode active">
              <Sun size={14} />
            </span>
            <Link href="/" className="ltheme-toggle-inactive" aria-label="Switch to dark mode">
              <Moon size={14} />
            </Link>
          </div>
          <Link
            href="/register"
            onClick={() => trackCTAClick("Get Started Free", "nav")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "10px 20px",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              color: "#fff",
              background: "var(--light-accent)",
              textDecoration: "none",
              whiteSpace: "nowrap",
              fontFamily: "var(--font-dm-sans), sans-serif",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "#3A5640";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background =
                "var(--light-accent)";
            }}
          >
            {t("light.heroPrimaryCTA")}
          </Link>
        </div>

        {/* Mobile hamburger */}
        <button
          className="light-nav-hamburger"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Toggle menu"
          aria-expanded={menuOpen}
          style={{
            display: "none",
            alignItems: "center",
            justifyContent: "center",
            width: 40,
            height: 40,
            borderRadius: 8,
            background: "transparent",
            border: "1px solid var(--light-border)",
            color: "var(--light-ink)",
            cursor: "pointer",
            flexShrink: 0,
            marginLeft: 8,
          }}
        >
          {menuOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </nav>

      {/* Mobile menu panel */}
      {menuOpen && (
        <div
          style={{
            position: "fixed",
            top: 64,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 49,
            background: "var(--light-bg)",
            borderTop: "1px solid var(--light-border)",
            padding: "16px 24px",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={(e) => {
                e.preventDefault();
                closeMenu();
                document
                  .getElementById(link.href.slice(1))
                  ?.scrollIntoView({ behavior: "smooth" });
              }}
              style={{
                display: "block",
                padding: "14px 16px",
                borderRadius: 8,
                fontSize: 16,
                fontWeight: 500,
                color: "var(--light-ink)",
                textDecoration: "none",
                fontFamily: "var(--font-dm-sans), sans-serif",
              }}
            >
              {link.label}
            </a>
          ))}
          <div
            style={{
              height: 1,
              background: "var(--light-border)",
              margin: "8px 0",
            }}
          />
          <Link
            href="/register"
            onClick={closeMenu}
            style={{
              display: "block",
              padding: "14px 16px",
              borderRadius: 8,
              fontSize: 15,
              fontWeight: 600,
              color: "#fff",
              background: "var(--light-accent)",
              textDecoration: "none",
              textAlign: "center",
              fontFamily: "var(--font-dm-sans), sans-serif",
            }}
          >
            {t("light.heroPrimaryCTA")}
          </Link>
        </div>
      )}

      <style>{`
        @media (max-width: 768px) {
          .light-nav-links { display: none !important; }
          .light-nav-right { display: none !important; }
          .light-nav-hamburger { display: flex !important; }
        }
      `}</style>
    </header>
  );
}
