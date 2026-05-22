/**
 * BD console (authenticated) layout — server component.
 *
 * Guards every nested BD page (`/bd`, `/bd/documents`, `/bd/...`)
 * behind a valid KosBdSession cookie. Unauthenticated requests get
 * redirected to `/bd/login`.
 *
 * Sibling `(unauthenticated)` group hosts `/bd/login` and bypasses
 * this layout entirely — that's the canonical Next.js App Router
 * pattern for "public route inside a private feature".
 *
 * Sidebar (Inbox / Documents / Logout) lives here so every
 * authenticated page inherits the chrome without restating it.
 */

import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";

import { prisma } from "@/lib/db";
import {
  KOS_BD_SESSION_COOKIE_NAME,
  validateKosBdSessionToken,
} from "@/features/kos/lib/kos-bd-auth";
import {
  KOS_TENANT_HEADER,
  KOS_TENANT_OVERRIDE_HEADER,
  resolveTenantSlugFromHost,
} from "@/features/kos/lib/tenant-host";
import { getTenantBySlug } from "@/features/kos/lib/tenant-resolver";
import LogoutButton from "./LogoutButton";
import BdSidebarLink from "./BdSidebarLink";

async function resolveTenantSlug(): Promise<string | null> {
  const h = await headers();
  let slug: string | null = h.get(KOS_TENANT_HEADER);
  if (!slug && process.env.NODE_ENV !== "production") {
    slug = h.get(KOS_TENANT_OVERRIDE_HEADER);
  }
  if (!slug) {
    slug = resolveTenantSlugFromHost(h.get("host"));
  }
  return slug;
}

export default async function BdAuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const slug = await resolveTenantSlug();
  if (!slug) redirect("/bd/login");

  const tenant = await getTenantBySlug(slug);
  if (!tenant) redirect("/bd/login");

  const cookieStore = await cookies();
  const token = cookieStore.get(KOS_BD_SESSION_COOKIE_NAME)?.value;
  if (!token) redirect("/bd/login");

  const bdUser = await validateKosBdSessionToken(token);
  if (!bdUser || bdUser.tenantId !== tenant.id || !bdUser.active) {
    redirect("/bd/login");
  }

  // Eagerly verify the user row still exists with the same active flag
  // (validateKosBdSessionToken already checked .active, but the row
  // may have changed between the join and the redirect; one more
  // findUnique keeps the post-login state honest).
  const fresh = await prisma.kosBdUser.findUnique({
    where: { id: bdUser.id },
    select: { id: true, active: true },
  });
  if (!fresh || !fresh.active) redirect("/bd/login");

  return (
    <div style={{ display: "flex", minHeight: "calc(100vh - 80px)" }}>
      <aside
        style={{
          width: 220,
          flexShrink: 0,
          padding: "24px 16px",
          borderRight: "1px solid rgba(255,255,255,0.08)",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "var(--kos-secondary, #c9a55a)",
            marginBottom: 14,
            opacity: 0.8,
          }}
        >
          BD console
        </div>
        <BdSidebarLink href="/bd" label="Inbox" />
        <BdSidebarLink href="/bd/documents" label="Documents" />

        <div style={{ flex: 1 }} />

        <div
          style={{
            padding: "10px 12px",
            borderTop: "1px solid rgba(255,255,255,0.08)",
            marginTop: 12,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: "#fafafa" }}>
            {bdUser.name}
          </div>
          <div style={{ fontSize: 10, opacity: 0.55 }}>
            {bdUser.email} · {bdUser.role}
          </div>
          <div style={{ marginTop: 6 }}>
            <LogoutButton />
          </div>
        </div>
      </aside>
      <section style={{ flex: 1, padding: "32px 36px", minWidth: 0 }}>
        {children}
      </section>
    </div>
  );
}
