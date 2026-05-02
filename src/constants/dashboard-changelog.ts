export type ChangelogEntry = {
  id: string;
  type: "feature" | "template" | "improvement";
  date: string;
  title: string;
  description: string;
  cta: { label: string; href: string };
};

export const DASHBOARD_CHANGELOG: ChangelogEntry[] = [
  {
    id: "ifc-enhance-ai",
    type: "feature",
    date: "2026-04-29",
    title: "IFC Enhance with AI is now in beta.",
    description:
      "Upload any basic IFC and apply photoreal materials, HDRI lighting, and rooftop details — all without modifying the source file.",
    cta: { label: "Try Enhance", href: "/dashboard/ifc-viewer" },
  },
  {
    id: "photo-renovation-template",
    type: "template",
    date: "2026-04-26",
    title: "Building photo \u2192 renovation video.",
    description:
      "Drop a fa\u00e7ade photo. GPT-4o Vision analyzes architecture, materials, and style \u2014 Kling produces a 15\u2009s cinematic reveal.",
    cta: { label: "Use template", href: "/dashboard/templates" },
  },
  {
    id: "floor-plan-faster",
    type: "improvement",
    date: "2026-04-23",
    title: "Floor plan generation is 2.4\u00d7 faster.",
    description:
      "Phase 2.12 ships. Average end-to-end pipeline went from 2:18 to 0:54. Quality scores held at 84/100 on benchmark prompts.",
    cta: { label: "Read changelog", href: "#" },
  },
];
