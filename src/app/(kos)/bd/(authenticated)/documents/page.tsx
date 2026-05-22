/**
 * /bd/documents — KOS document library (server component).
 *
 * Lists the current tenant's KosDocument rows via a direct Prisma
 * read (tenant is already resolved by the (kos) layout shell). Pure
 * server render — the only interactive piece is the Upload button,
 * which is a client island.
 */

import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import { prisma } from "@/lib/db";
import {
  KOS_TENANT_HEADER,
  KOS_TENANT_OVERRIDE_HEADER,
  resolveTenantSlugFromHost,
} from "@/features/kos/lib/tenant-host";
import { getTenantBySlug } from "@/features/kos/lib/tenant-resolver";
import UploadModal from "./UploadModal";
import DocumentStatusBadge from "./DocumentStatusBadge";

export const dynamic = "force-dynamic";

async function resolveTenantSlug(): Promise<string | null> {
  const h = await headers();
  let slug: string | null = h.get(KOS_TENANT_HEADER);
  if (!slug && process.env.NODE_ENV !== "production") {
    slug = h.get(KOS_TENANT_OVERRIDE_HEADER);
  }
  if (!slug) slug = resolveTenantSlugFromHost(h.get("host"));
  return slug;
}

export default async function DocumentsPage() {
  const slug = await resolveTenantSlug();
  if (!slug) redirect("/bd/login");
  const tenant = await getTenantBySlug(slug);
  if (!tenant) notFound();

  const docs = await prisma.kosDocument.findMany({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const uploaderIds = Array.from(
    new Set(docs.map((d) => d.uploadedBy).filter((u) => u && u !== "system")),
  );
  const uploaders = uploaderIds.length
    ? await prisma.kosBdUser.findMany({
        where: { id: { in: uploaderIds }, tenantId: tenant.id },
        select: { id: true, name: true, email: true },
      })
    : [];
  const uploaderMap = new Map(
    uploaders.map((u) => [u.id, { name: u.name, email: u.email }]),
  );

  return (
    <div>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 24,
        }}
      >
        <div>
          <h1
            style={{
              fontSize: 24,
              fontWeight: 800,
              marginBottom: 6,
              letterSpacing: "-0.02em",
            }}
          >
            Documents
          </h1>
          <p style={{ fontSize: 13, opacity: 0.65, lineHeight: 1.5 }}>
            Source PDFs the bot retrieves from. Upload a PDF; the system parses,
            chunks, and embeds it for semantic search.
          </p>
        </div>
        <UploadModal />
      </header>

      {docs.length === 0 ? (
        <div
          style={{
            padding: "40px 24px",
            border: "1px dashed rgba(255,255,255,0.18)",
            borderRadius: 12,
            textAlign: "center",
            opacity: 0.7,
          }}
        >
          <p style={{ fontSize: 14, marginBottom: 6 }}>No documents yet.</p>
          <p style={{ fontSize: 12, opacity: 0.7 }}>
            Click <strong>Upload document</strong> above to add the first one.
          </p>
        </div>
      ) : (
        <table
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 13,
            background: "rgba(0,0,0,0.2)",
            borderRadius: 12,
            overflow: "hidden",
          }}
        >
          <thead>
            <tr
              style={{
                textAlign: "left",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                opacity: 0.6,
              }}
            >
              <th style={th}>Title</th>
              <th style={th}>Type</th>
              <th style={th}>Status</th>
              <th style={th}>Pages</th>
              <th style={th}>Version</th>
              <th style={th}>Uploaded by</th>
              <th style={th}>Indexed</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => {
              const u = uploaderMap.get(d.uploadedBy);
              return (
                <tr key={d.id} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                  <td style={td}>{d.title}</td>
                  <td style={{ ...td, opacity: 0.85 }}>{d.docType}</td>
                  <td style={td}>
                    <DocumentStatusBadge status={d.status} />
                  </td>
                  <td style={td}>{d.pageCount ?? "—"}</td>
                  <td style={td}>v{d.version}</td>
                  <td style={td}>{u?.name ?? d.uploadedBy}</td>
                  <td style={{ ...td, fontSize: 11, opacity: 0.65 }}>
                    {d.indexedAt
                      ? new Date(d.indexedAt).toLocaleString()
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

const th: React.CSSProperties = {
  padding: "10px 14px",
  borderBottom: "1px solid rgba(255,255,255,0.08)",
};
const td: React.CSSProperties = {
  padding: "12px 14px",
  verticalAlign: "middle",
};
