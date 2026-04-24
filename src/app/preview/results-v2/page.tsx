import { notFound } from "next/navigation";
import { ResultsV2Preview } from "@/app/dashboard/results-v2-preview/PreviewClient";

/**
 * /preview/results-v2 — mirror of the /dashboard/results-v2-preview route.
 *
 * Why a second route: the dashboard version sits behind auth middleware
 * (protects `/dashboard/*`), so headless screenshot capture cannot reach
 * it without mocking a session. This non-dashboard mirror shares the same
 * dev/env gate and renders the same `ResultsV2Preview` client component,
 * so the screenshot tool and logged-out humans can reach it directly.
 *
 * Production-safe: same gate — the route 404s unless NODE_ENV is not
 * "production" or `NEXT_PUBLIC_RESULTS_V2_PREVIEW === "true"`.
 */
export default function PreviewResultsV2() {
  const enabled =
    process.env.NODE_ENV !== "production" ||
    process.env.NEXT_PUBLIC_RESULTS_V2_PREVIEW === "true";
  if (!enabled) {
    notFound();
  }
  return <ResultsV2Preview />;
}
