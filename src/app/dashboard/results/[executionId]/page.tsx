import { redirect } from "next/navigation";
import { ResultExperience } from "@/features/results-v2/components/ResultExperience";
import { LegacyResultPage } from "@/app/dashboard/results/[executionId]/LegacyResultPage";

/**
 * /dashboard/results/[executionId] — flag-gated entry point for the V2
 * cinematic result experience.
 *
 * - NEXT_PUBLIC_RESULTS_V2 === "true" → renders the V2 ResultExperience.
 * - Otherwise → the LegacyResultPage sibling, which just redirects users
 *   back to the canvas-hosted showcase (the production behavior today;
 *   this route did not exist at all before V2, so redirecting is the
 *   zero-regression default).
 *
 * Flag is a `NEXT_PUBLIC_*` so it's readable on both server and client
 * without an additional indirection. Default = false.
 */
export default async function DashboardResultPage({
  params,
}: {
  params: Promise<{ executionId: string }>;
}) {
  const { executionId } = await params;
  if (!executionId) {
    redirect("/dashboard");
  }
  const enabled = process.env.NEXT_PUBLIC_RESULTS_V2 === "true";
  if (enabled) {
    return <ResultExperience executionId={executionId} />;
  }
  return <LegacyResultPage executionId={executionId} />;
}
