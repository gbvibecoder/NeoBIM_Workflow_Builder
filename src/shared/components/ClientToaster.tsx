"use client";

import { Toaster, type ToasterProps } from "sonner";

/**
 * Client-only wrapper around `sonner`'s Toaster.
 *
 * Why this exists: `sonner` runs `document.getElementsByTagName(...)` at
 * module-evaluation time (top-level side effect). If the root
 * `src/app/layout.tsx` — which is a React Server Component — imports
 * `Toaster` directly from `"sonner"`, webpack bundles the sonner module
 * into the server-rendered bundle, where `document` does not exist and
 * server evaluation crashes with `TypeError: document.* is not a
 * function`. Next.js 16 dev mode surfaces this via a confusing
 * `_document.js` (pages router) stack because its error-fallback chain
 * routes through pages internals.
 *
 * Wrapping `Toaster` behind `"use client"` keeps the sonner module off
 * the server graph entirely — it only loads in the browser. The root
 * layout imports THIS component instead of sonner directly.
 *
 * Note on comment placement: the block comment MUST live after the
 * import, not between `"use client"` and the import. Next.js 16.2.3's
 * next-flight-client-entry-loader mis-links the client-reference
 * manifest when substantial content separates the directive from the
 * first import — the chunk compiles, the harmony export is emitted,
 * but at hydration React sees `undefined` for the export and throws
 * "Element type is invalid. Received a promise that resolves to:
 * undefined."
 */
export function ClientToaster(props: ToasterProps) {
  return <Toaster {...props} />;
}
