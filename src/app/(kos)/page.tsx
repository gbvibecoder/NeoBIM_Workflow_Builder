/**
 * KOS — landing placeholder (Week 1).
 *
 * Renders the tenant name (read from the layout via cascading CSS
 * vars + the `data-kos-tenant` data attribute) and a "coming soon"
 * headline. Week 3 replaces this with the real landing + embedded
 * chat widget.
 */

import { headers } from "next/headers";
import { KOS_TENANT_HEADER } from "@/features/kos/lib/tenant-host";

export default async function KosLanding() {
  const headerList = await headers();
  const slug = headerList.get(KOS_TENANT_HEADER) ?? "(unknown)";

  return (
    <section style={{ maxWidth: 720 }}>
      <h1 style={{ fontSize: 40, fontWeight: 800, marginBottom: 16, letterSpacing: "-0.02em" }}>
        KOS — Coming soon
      </h1>
      <p style={{ fontSize: 16, lineHeight: 1.6, opacity: 0.78, marginBottom: 24 }}>
        This is the Kalzen Operating System surface. The customer-facing
        bot, document library, and BD console land over the next 5 weeks.
      </p>
      <code
        style={{
          display: "inline-block",
          padding: "6px 10px",
          borderRadius: 6,
          background: "rgba(255,255,255,0.06)",
          fontSize: 12,
          fontFamily: "var(--font-jetbrains), monospace",
          color: "var(--kos-secondary)",
        }}
      >
        tenant: {slug}
      </code>
    </section>
  );
}
