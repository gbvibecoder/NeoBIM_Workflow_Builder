import Link from "next/link";
import { Plus, ArrowRight, Box, Image as ImageIcon, Sparkles } from "lucide-react";
import s from "./page.module.css";

interface Props {
  onNewWorkflow: () => void;
  onBrowseTemplates: () => void;
}

const TEMPLATES = [
  { label: "Brief to 3D", desc: "Upload a brief, get a 3D model", emoji: "\u{1F9CA}", color: "#1A4D5C" },
  { label: "Brief to Render", desc: "Turn your brief into photoreal renders", emoji: "\u{1F3A8}", color: "#C26A3B" },
  { label: "Brief to Pipeline", desc: "Full pipeline: brief to renders + video", emoji: "\u26A1", color: "#7C5C8A" },
];

export function WorkflowsEmptyState({ onNewWorkflow, onBrowseTemplates }: Props) {
  return (
    <div className={s.page}>
      <div className={s.emptyState}>
        <div className={s.emptyEmoji}>{"\u{1F439}"}</div>
        <div className={s.emptyDecoRow}>
          {["\u{1F3D7}\uFE0F", "\u2728", "\u{1F4D0}", "\u2728", "\u{1F3D7}\uFE0F"].map((ch, i) => (
            <span key={i} className={s.emptyDecoItem}>{ch}</span>
          ))}
        </div>
        <h3 className={s.emptyTitle}>Your canvas is suspiciously clean</h3>
        <p className={s.emptyDesc}>
          No workflows yet? That&apos;s like an architect with an empty desk. Let&apos;s
          fix that &mdash; start from scratch or grab a template.
        </p>
        <div className={s.emptyCtas}>
          <button className={s.btnPrimary} onClick={onNewWorkflow}>
            <Plus size={14} strokeWidth={2.5} /> New Workflow
          </button>
          <button className={s.btnGhost} onClick={onBrowseTemplates}>
            Browse Templates <ArrowRight size={13} />
          </button>
        </div>
        <div className={s.emptyTemplatesLabel}>Popular starting points</div>
        <div className={s.emptyTemplatesGrid}>
          {TEMPLATES.map((tpl, i) => (
            <Link key={i} href="/dashboard/templates" className={s.emptyTemplateCard}>
              <div className={s.emptyTemplateEmoji}>{tpl.emoji}</div>
              <div className={s.emptyTemplateName}>{tpl.label}</div>
              <div className={s.emptyTemplateDesc}>{tpl.desc}</div>
            </Link>
          ))}
        </div>
        <p className={s.emptyFooter}>Every great building started with an empty canvas</p>
      </div>
    </div>
  );
}
