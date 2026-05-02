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
import s from "./page.module.css";

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
    <main className={s.page} data-theme="light">
      <BriefRenderShell />
    </main>
  );
}
