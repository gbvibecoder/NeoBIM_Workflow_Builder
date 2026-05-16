/**
 * /dashboard/brief-to-ifc/v3/new — submit page for the v3 generator.
 *
 * Server component. Performs auth + canary check on the server so a
 * non-allowlisted user can't see the form (defence-in-depth on top of
 * the API route's own check). Renders the client `SubmitForm` once
 * gating passes.
 */

import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { shouldUseBriefToIfcV3 } from "@/features/brief-to-ifc/v3";

import { SubmitForm } from "@/features/brief-to-ifc/v3/components/submit-form";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "AI IFC v3 — New Run",
};

export default async function NewRunPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/login?callbackUrl=/dashboard/brief-to-ifc/v3/new");
  }
  const email = session.user.email ?? null;
  if (!shouldUseBriefToIfcV3(email)) {
    redirect("/dashboard");
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">
          AI IFC v3 <span className="ml-2 align-middle rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium uppercase tracking-wider text-amber-600">Beta</span>
        </h1>
        <p className="mt-1 text-sm text-zinc-600">
          Describe a building or paste a brief. AI generates an IFC2X3 model
          you can open in any BIM viewer. Typical run: 1–3 minutes,
          ~$0.20–$0.50 in compute.
        </p>
      </header>
      <SubmitForm />
    </div>
  );
}
