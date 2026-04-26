import { redirect } from "next/navigation";
import { ResultPageRoot } from "@/features/result-page";

/**
 * /dashboard/results/[executionId] — Phase 1 redesigned wrapper.
 *
 * Flag-free: this is the canonical result page for every workflow run.
 * Auth is handled by the dashboard middleware. The page is server-rendered
 * for the redirect guard, then hands off to a client component that fetches
 * the execution by id, hydrates state from useExecutionStore where available,
 * and renders the adaptive hero + 6 tabs.
 */
export default async function DashboardResultPage({
  params,
}: {
  params: Promise<{ executionId: string }>;
}) {
  const { executionId } = await params;
  if (!executionId) redirect("/dashboard");
  return <ResultPageRoot executionId={executionId} />;
}
