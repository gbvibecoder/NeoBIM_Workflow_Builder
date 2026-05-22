/**
 * KOS route-group layout (server component).
 *
 * Wraps every KOS surface (landing, chat, customer app, BD console)
 * with a tenant-branded shell:
 *   1. Read the `x-kos-tenant-slug` header that `middleware.ts`
 *      injected for the matched host.
 *   2. Look up the Tenant row (cache hits return in <1ms).
 *   3. Apply `tenant.branding` as CSS custom properties on a wrapper
 *      div — nested components consume them via `var(--kos-primary)`
 *      etc., so child pages stay branding-agnostic.
 *   4. Call `notFound()` if the tenant doesn't resolve. This shows
 *      Next's 404 page and prevents an "unknown subdomain" from
 *      being treated as a usable surface.
 *
 * No <html>/<body> here — the root `src/app/layout.tsx` owns those.
 * No client interactivity, no `"use client"` — KOS Week 1 is read-only
 * placeholder content.
 *
 * Sidebar / auth checks intentionally absent: the BuildFlow dashboard
 * sidebar is BuildFlow-specific, and KOS auth (KosCustomer cookie,
 * KosBdUser cookie) lands in Week 5. This layout is the shell; the
 * BD console will get its own nested `(kos)/bd/layout.tsx` when that
 * auth ships.
 */

import type { ReactNode } from "react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import {
  KOS_TENANT_HEADER,
  KOS_TENANT_OVERRIDE_HEADER,
  resolveTenantSlugFromHost,
} from "@/features/kos/lib/tenant-host";
import { getTenantBySlug } from "@/features/kos/lib/tenant-resolver";

interface KosBranding {
  displayName?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  logoUrl?: string | null;
  supportPhone?: string | null;
}

function brandingFromTenant(branding: unknown): KosBranding {
  if (!branding || typeof branding !== "object") return {};
  return branding as KosBranding;
}

// KOS surfaces are tenant-specific customer/BD tools — never public SEO
// targets — and must not leak BuildFlow brand metadata. This overrides the
// BuildFlow root metadata for every (kos) route: noindex robots, a
// Kalzen-flavoured title, and explicit null OG/Twitter so the inherited
// BuildFlow social cards (og-image.png, @buildflow) are stripped. Title is
// static "Kalzen" for the pilot tenant; revisit if KOS goes multi-brand.
export const metadata: Metadata = {
  title: { default: "Kalzen", template: "%s — Kalzen" },
  description:
    "Kalzen Realty — precast formwork system. Get answers about products, certifications, and specifications.",
  robots: { index: false, follow: false },
  keywords: [],
  // Strip the BuildFlow brand strings the root metadata would otherwise
  // inherit into KOS <meta> / social cards.
  applicationName: "Kalzen",
  authors: [{ name: "Kalzen" }],
  creator: "Kalzen",
  publisher: "Kalzen",
  openGraph: null,
  twitter: null,
};

export default async function KosLayout({ children }: { children: ReactNode }) {
  const headerList = await headers();

  // Header-injection from middleware is the primary path; the override
  // header and direct Host parse are fallbacks for paths that bypass
  // middleware (e.g. direct curl tests). Mirrors the resolution order
  // of `requireTenantOrThrow`.
  let slug = headerList.get(KOS_TENANT_HEADER);
  if (!slug && process.env.NODE_ENV !== "production") {
    slug = headerList.get(KOS_TENANT_OVERRIDE_HEADER);
  }
  if (!slug) {
    slug = resolveTenantSlugFromHost(headerList.get("host"));
  }

  if (!slug) {
    // Reached `/kos/...` directly with no tenant context — treat as 404
    // rather than rendering an un-branded shell. This is the right call
    // both for typos and for casual scanning of internal paths.
    notFound();
  }

  const tenant = await getTenantBySlug(slug);
  if (!tenant) {
    notFound();
  }

  const branding = brandingFromTenant(tenant.branding);
  const primary = branding.primaryColor ?? "#0a3d2e";
  const secondary = branding.secondaryColor ?? "#c9a55a";
  const displayName = branding.displayName ?? tenant.name;

  // Inline-style CSS variable injection so the children can theme via
  // `var(--kos-primary)` / `var(--kos-secondary)` without needing a
  // client provider or a Tailwind plugin. The wrapper also sets a base
  // background + foreground so a bare placeholder page already looks
  // tenant-branded.
  const cssVars: React.CSSProperties = {
    ["--kos-primary" as string]: primary,
    ["--kos-secondary" as string]: secondary,
  };

  return (
    <div
      data-kos-tenant={tenant.slug}
      style={{
        ...cssVars,
        minHeight: "100vh",
        background: `linear-gradient(180deg, ${primary} 0%, #0a0a0a 100%)`,
        color: "#fafafa",
        fontFamily: "var(--font-ui), system-ui, sans-serif",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "20px 32px",
          borderBottom: `1px solid ${secondary}33`,
        }}
      >
        <div
          aria-hidden
          style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            background: secondary,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 800,
            color: primary,
            fontFamily: "var(--font-jetbrains), monospace",
          }}
        >
          {displayName.slice(0, 1).toUpperCase()}
        </div>
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
          <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em" }}>
            {displayName}
          </span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: secondary,
              fontFamily: "var(--font-jetbrains), monospace",
            }}
          >
            KOS · Kalzen Operating System
          </span>
        </div>
      </header>
      <main style={{ flex: 1, padding: "40px 32px" }}>{children}</main>
    </div>
  );
}
