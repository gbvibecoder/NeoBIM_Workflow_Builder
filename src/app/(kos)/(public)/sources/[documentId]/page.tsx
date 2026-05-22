/**
 * Source PDF viewer — `/sources/[documentId]?page=N` (Phase 3B).
 *
 * Server component reached when a customer clicks a `[N]` citation. It
 * validates tenant ownership + document readiness, then hands off to
 * the same-origin streaming route which serves the PDF inline.
 *
 * Why a redirect to a streaming route instead of an embedded <iframe>
 * of a presigned S3 URL (the literal Phase 3B brief):
 *   The global security headers (`next.config.ts`, applied to every
 *   route) set `X-Frame-Options: DENY`, `frame-ancestors 'none'`, and a
 *   `frame-src` allow-list that excludes S3. Those block ALL PDF
 *   iframes — S3 OR same-origin. They do NOT, however, restrict
 *   top-level navigation. So the citation opens this page in a new tab,
 *   and on the happy path we top-level-redirect to a same-origin route
 *   that streams the PDF inline (forcing `Content-Type: application/pdf`
 *   + `Content-Disposition: inline`), where the browser's native viewer
 *   honours the `#page=N` fragment. This keeps the presigned URL fully
 *   server-side and requires zero changes to the global CSP/XFO posture.
 *
 * Error states render branded, in-chrome notices (the `(kos)` layout
 * supplies the surrounding Kalzen shell):
 *   • document not found / not READY → "not available" notice
 *   • tenant mismatch                → KOS_CHAT_004 access-denied notice
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/db";
import { getTenantFromRequestHeaders } from "@/features/kos/lib/tenant-from-headers";

export const metadata = {
  robots: { index: false, follow: false },
};

function parsePage(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const n = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

export default async function SourceViewerPage({
  params,
  searchParams,
}: {
  params: Promise<{ documentId: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const { documentId } = await params;
  const { page } = await searchParams;
  const pageNum = parsePage(page);

  const tenant = await getTenantFromRequestHeaders();
  if (!tenant) {
    return (
      <SourceNotice
        title="Source unavailable"
        body="We couldn't resolve which workspace this source belongs to."
      />
    );
  }

  const doc = await prisma.kosDocument.findUnique({
    where: { id: documentId },
    select: { id: true, tenantId: true, status: true, title: true },
  });

  if (!doc) {
    return (
      <SourceNotice
        title="Document not found"
        body="This source no longer exists, or the link is incorrect."
      />
    );
  }

  // Tenant isolation — never serve another tenant's document.
  if (doc.tenantId !== tenant.id) {
    return (
      <SourceNotice
        title="Access denied"
        body="You don't have access to this document."
        code="KOS_CHAT_004"
      />
    );
  }

  if (doc.status !== "READY") {
    return (
      <SourceNotice
        title="Source not ready"
        body={`"${doc.title}" is still being processed and isn't viewable yet.`}
      />
    );
  }

  // Happy path: top-level redirect (in this new tab) to the inline PDF
  // stream at the cited page. Not framing → unaffected by XFO/CSP.
  redirect(
    `/api/kos/customer/sources/${encodeURIComponent(doc.id)}#page=${pageNum}`,
  );
}

function SourceNotice({
  title,
  body,
  code,
}: {
  title: string;
  body: string;
  code?: string;
}) {
  return (
    <section
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        minHeight: "calc(100vh - 220px)",
        textAlign: "center",
        padding: "24px 16px",
      }}
    >
      <h1 style={{ fontSize: 24, fontWeight: 800, margin: 0 }}>{title}</h1>
      <p style={{ fontSize: 14.5, opacity: 0.7, maxWidth: 440, margin: 0 }}>
        {body}
      </p>
      {code && (
        <code
          style={{
            fontSize: 11,
            opacity: 0.5,
            fontFamily: "var(--font-jetbrains), monospace",
          }}
        >
          {code}
        </code>
      )}
      <BackToChat />
    </section>
  );
}

function BackToChat(): ReactNode {
  return (
    <Link
      href="/chat"
      style={{
        marginTop: 6,
        padding: "9px 16px",
        borderRadius: 10,
        background: "var(--kos-secondary, #c9a55a)",
        color: "var(--kos-primary, #0a3d2e)",
        fontSize: 13.5,
        fontWeight: 700,
        textDecoration: "none",
      }}
    >
      ← Back to chat
    </Link>
  );
}
