/**
 * KOS public (customer-facing) layout — server component.
 *
 * Nested inside `(kos)`, so the tenant-branded chrome (logo header,
 * dark gradient, `--kos-primary` / `--kos-secondary` CSS vars) is
 * already inherited from `(kos)/layout.tsx`. This layer adds only what
 * the customer surface needs on top of that chrome:
 *
 *   • <CustomerSessionProvider> — anonymous session bootstrap, scoped
 *     to public pages only (the BD console must NOT mint customer
 *     sessions), and
 *   • a centred max-width container.
 *
 * No BD sidebar, no auth wall. We deliberately do NOT add a second
 * branded header here — the `(kos)` layout already renders the Kalzen
 * logo + name, and the chat surface carries its own functional header
 * ("Talk to a human"); a third header would just stack duplicates.
 */

import type { ReactNode } from "react";

import { CustomerSessionProvider } from "@/features/kos/components/CustomerSessionProvider";

export default function KosPublicLayout({ children }: { children: ReactNode }) {
  return (
    <CustomerSessionProvider>
      <div style={{ width: "100%", maxWidth: 896, margin: "0 auto" }}>
        {children}
      </div>
    </CustomerSessionProvider>
  );
}
