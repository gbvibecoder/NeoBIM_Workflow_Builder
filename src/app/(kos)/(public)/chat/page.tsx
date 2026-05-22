/**
 * Customer chat page — `/chat` (Phase 3B).
 *
 * Server component. Resolves the tenant from the request host and gates
 * the surface to Kalzen (the only tenant with a live document library
 * this phase); any other host 404s. The interactive surface itself is
 * the `ChatSurface` client component, which consumes the existing SSE
 * endpoint `POST /api/kos/customer/chat`.
 */

import { notFound } from "next/navigation";

import ChatSurface from "@/features/kos/components/ChatSurface";
import { getTenantFromRequestHeaders } from "@/features/kos/lib/tenant-from-headers";

export const metadata = {
  title: "Chat with Kalzen",
  description: "Get instant answers about Kalzen precast formwork.",
};

export default async function KosChatPage() {
  const tenant = await getTenantFromRequestHeaders();
  if (!tenant || tenant.slug !== "kalzen") {
    notFound();
  }

  return <ChatSurface tenantName={tenant.name} />;
}
