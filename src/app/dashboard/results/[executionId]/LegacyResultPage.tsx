import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * Legacy "flag OFF" surface for /dashboard/results/[executionId].
 *
 * When `NEXT_PUBLIC_RESULTS_V2` is not `"true"`, we don't own a standalone
 * result page — the production surface is the canvas-hosted
 * `ResultShowcase` overlay. The graceful fallback is therefore: look up
 * the execution, find its workflow, and redirect the user to the canvas
 * pre-loaded with that workflow. The existing "View Results" FAB then
 * lets them open the overlay the same way they would from a fresh run.
 *
 * If the execution lookup fails (unauth, 404, or DB hiccup), we render a
 * small placeholder with a link back to the dashboard — no hard crash.
 */
export async function LegacyResultPage({ executionId }: { executionId: string }) {
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/login?next=/dashboard/results/${executionId}`);
  }

  // Safe narrowing — `redirect()` throws on the line above, so this is
  // unreachable when `session` is missing. The explicit check keeps TS happy.
  const userId = session.user.id;

  const execution = await prisma.execution
    .findFirst({
      where: { id: executionId, userId, workflow: { deletedAt: null } },
      select: { workflowId: true },
    })
    .catch(() => null);

  if (execution?.workflowId) {
    // Piggyback on the canvas's existing workflow-load semantics. The user
    // lands on the canvas with their workflow populated and can click the
    // "View Results" FAB to open the legacy ResultShowcase overlay.
    redirect(`/dashboard/canvas?id=${execution.workflowId}`);
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#070809",
        color: "#F5F5FA",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
          maxWidth: 440,
          textAlign: "center",
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "#9090A8",
          }}
        >
          Execution {executionId.slice(0, 10)}…
        </span>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em" }}>
          We couldn&apos;t find this result
        </h1>
        <p style={{ margin: 0, fontSize: 14, color: "#B8B8C8", lineHeight: 1.6 }}>
          The execution may have been deleted, or it belongs to a different account.
          Open your dashboard to pick up where you left off.
        </p>
        <Link
          href="/dashboard"
          style={{
            padding: "10px 18px",
            borderRadius: 10,
            background: "rgba(0,245,255,0.12)",
            border: "1px solid rgba(0,245,255,0.3)",
            color: "#00F5FF",
            fontSize: 13,
            fontWeight: 600,
            textDecoration: "none",
          }}
        >
          Go to dashboard
        </Link>
      </div>
    </main>
  );
}
