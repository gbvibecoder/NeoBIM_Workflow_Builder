/**
 * Brief-to-Renders dashboard page.
 *
 * Server component. Auth + canary gate happen here so non-eligible
 * users get a 404 instead of a flash of UI followed by a 403 from the
 * API. The actual interactive UI lives in `BriefRenderShell`, which
 * is a client component imported here.
 */

import { notFound, redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { shouldUserSeeBriefRenders } from "@/features/brief-renders/services/brief-pipeline/canary";
import { BriefRenderShell } from "@/features/brief-renders/components/BriefRenderShell";

export const dynamic = "force-dynamic";

export default async function BriefRendersPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/dashboard/brief-renders");
  }
  if (!shouldUserSeeBriefRenders(session.user.email ?? null, session.user.id)) {
    notFound();
  }

  return (
    // The dashboard layout's children slot is `flex-1 min-h-0 overflow-hidden`
    // — i.e. it gives us a fixed-height box that clips by default. We need
    // `h-full` to claim that whole box and `overflow-y-auto` so content
    // longer than the viewport (the SpecReviewGate's apartment table + 12
    // shot rows + Approve button) becomes scrollable instead of clipped.
    // Without this, the Approve & Generate button at the bottom of
    // SpecReviewGate is unreachable except by zooming the browser out.
    <main className="h-full overflow-y-auto bg-[#070809] text-zinc-100">
      <BriefRenderShell />
    </main>
  );
}
