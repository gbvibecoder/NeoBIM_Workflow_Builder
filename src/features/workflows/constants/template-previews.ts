/**
 * Template preview side-map — the single source of bitmap/video previews
 * consumed by every template-card surface. Values are byte-identical to
 * the prior local definition in src/app/dashboard/templates/page.tsx;
 * extracted so the public /templates page, the hero deck, and the light
 * grid card can all read from the same registry.
 *
 * Render rules (consumed by TemplatePreviewMedia and DarkFeaturedTemplate):
 *   image → <img loading="lazy"> — bitmap thumbnail
 *   video → <video preload="none" muted playsInline> w/ hover-to-play
 *   svg   → handled by the caller's fallback (no live consumer today;
 *           kept in the union so existing dark-card render code compiles
 *           without modification)
 */

export type TemplatePreview =
  | { type: "image"; url: string }
  | { type: "video"; url: string; start: number }
  | { type: "svg"; output: string };

/** Cloudflare R2 base for legacy hosted demo clips. wf-06 still points
 *  here; the rest of the videos are now served locally from /templates/.
 */
const R2 = "https://pub-27d9a7371b6d47ff94fee1a3228f1720.r2.dev/workflow-demos";

export const TEMPLATE_PREVIEWS: Record<string, TemplatePreview> = {
  "wf-09": { type: "image", url: `/boq-cost-estimate-preview.png` },
  "wf-01": { type: "image", url: `/templates/text-to-floor-plan.png` },
  "wf-12": { type: "image", url: `/templates/ifc-clash-detection.png` },
  "wf-08": { type: "video", url: `/templates/pdf-to-video-walkthrough.mp4`, start: 0 },
  "wf-06": { type: "video", url: `${R2}/floor-plan-to-video-render.mp4`, start: 2 },
  "wf-05": { type: "video", url: `/templates/floor-plan-to-interactive-3d-model.mp4`, start: 0 },
  "wf-11": { type: "video", url: `/templates/building-photo-to-renovation-video.mp4`, start: 0 },
  "wf-ai-ifc-v3": { type: "image", url: `/templates/ai-powered-ifc-generation.png` },
};
