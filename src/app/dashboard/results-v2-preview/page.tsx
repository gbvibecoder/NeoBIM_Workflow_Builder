import { notFound } from "next/navigation";
import { ResultsV2Preview } from "@/app/dashboard/results-v2-preview/PreviewClient";

/**
 * /dashboard/results-v2-preview
 *
 * Dev-only surface for visually auditing the six Phase D hero variants + the
 * full ResultExperience composition against fixture data. Gated by
 * NODE_ENV === "development" OR NEXT_PUBLIC_RESULTS_V2_PREVIEW === "true"
 * so production builds with both off return 404.
 */
export default function DashboardResultsV2Preview() {
  const enabled =
    process.env.NODE_ENV !== "production" ||
    process.env.NEXT_PUBLIC_RESULTS_V2_PREVIEW === "true";
  if (!enabled) {
    notFound();
  }
  return <ResultsV2Preview />;
}
