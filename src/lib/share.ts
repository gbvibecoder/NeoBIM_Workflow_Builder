import { toast } from "sonner";

const SITE_URL = "https://trybuildflow.in";
const HANDLE = "@BuildFlowAI";

function openPopup(url: string) {
  window.open(url, "_blank", "width=550,height=420,noopener,noreferrer");
}

// ── Post-execution share ─────────────────────────────────────────────────────

export function shareExecutionToTwitter(workflowName: string, nodeCount: number) {
  const text = encodeURIComponent(
    `I just turned "${workflowName}" into a full building concept using ${HANDLE}\n\n` +
    `${nodeCount} AI steps — from text to 3D massing, renders, and cost estimates.\n\n` +
    `Try it free: ${SITE_URL}`
  );
  openPopup(`https://twitter.com/intent/tweet?text=${text}`);
}

export function shareExecutionToLinkedIn() {
  const url = encodeURIComponent(SITE_URL);
  openPopup(`https://www.linkedin.com/sharing/share-offsite/?url=${url}`);
}

// ── Workflow share (before execution) ────────────────────────────────────────

export function shareWorkflowToTwitter(workflowName: string) {
  const text = encodeURIComponent(
    `Check out this AI-powered design workflow on ${HANDLE}:\n\n` +
    `"${workflowName}"\n\n` +
    `Build → Add Data → Run → Get 3D concepts in minutes\n\n` +
    `Try it free: ${SITE_URL}`
  );
  openPopup(`https://twitter.com/intent/tweet?text=${text}`);
}

export function shareWorkflowToLinkedIn() {
  const url = encodeURIComponent(SITE_URL);
  openPopup(`https://www.linkedin.com/sharing/share-offsite/?url=${url}`);
}

// ── Template share ───────────────────────────────────────────────────────────

export function shareTemplateToTwitter(templateName: string) {
  const text = encodeURIComponent(
    `Found this amazing AEC workflow template on ${HANDLE}:\n\n` +
    `"${templateName}"\n\n` +
    `AI-powered concept design for architects — try it free: ${SITE_URL}/dashboard/templates`
  );
  openPopup(`https://twitter.com/intent/tweet?text=${text}`);
}

// ── History share ────────────────────────────────────────────────────────────

export function shareHistoryToTwitter(workflowName: string, nodeCount: number, duration: string) {
  const text = encodeURIComponent(
    `Built "${workflowName}" on ${HANDLE} — ${nodeCount} AI steps completed in ${duration}.\n\n` +
    `From brief to 3D concept in minutes\n\n` +
    `${SITE_URL}`
  );
  openPopup(`https://twitter.com/intent/tweet?text=${text}`);
}

// ── Copy link ────────────────────────────────────────────────────────────────

export async function copyShareLink(path: string = "") {
  try {
    await navigator.clipboard.writeText(`${SITE_URL}${path}`);
    toast.success("Link copied to clipboard!");
  } catch {
    toast.error("Could not copy link");
  }
}
