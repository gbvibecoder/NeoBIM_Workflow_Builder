import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { Play } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { PREBUILT_WORKFLOWS } from "@/features/workflows/constants/prebuilt-workflows";
import { useWorkflowStore } from "@/features/workflows/stores/workflow-store";
import { WorkflowPreviewBoq } from "./WorkflowPreviewBoq";
import { WorkflowPreviewRenovation } from "./WorkflowPreviewRenovation";
import { WorkflowPreviewPdfWalkthrough } from "./WorkflowPreviewPdfWalkthrough";
import s from "./dashboard.module.css";
import type { TranslationKey } from "@/lib/i18n";
import type { WorkflowTemplate } from "@/types/workflow";

type WorkflowId = "boq" | "renovation" | "pdf-walkthrough";

const CONFIG: Record<WorkflowId, {
  num: string;
  templateId: string;
  tagKey: TranslationKey;
  nameKey: TranslationKey;
  nameEmKey: TranslationKey;
  descKey: TranslationKey;
  meta: string[];
  badgeKey: TranslationKey;
  badgeType: "top" | "hot" | "pro";
  preview: () => React.JSX.Element;
}> = {
  boq: {
    num: "FB-W01", templateId: "wf-09",
    tagKey: "dashboard.v2.workflowBoqTag", nameKey: "dashboard.v2.workflowBoqName",
    nameEmKey: "dashboard.v2.workflowBoqNameEm", descKey: "dashboard.v2.workflowBoqDesc",
    meta: ["4 nodes", "~45s", "XLSX"],
    badgeKey: "dashboard.v2.workflowTopPick", badgeType: "top",
    preview: WorkflowPreviewBoq,
  },
  renovation: {
    num: "FB-W02", templateId: "wf-11",
    tagKey: "dashboard.v2.workflowRenovationTag", nameKey: "dashboard.v2.workflowRenovationName",
    nameEmKey: "dashboard.v2.workflowRenovationNameEm", descKey: "dashboard.v2.workflowRenovationDesc",
    meta: ["3 nodes", "~60s", "MP4"],
    badgeKey: "dashboard.v2.workflowHot", badgeType: "hot",
    preview: WorkflowPreviewRenovation,
  },
  "pdf-walkthrough": {
    num: "FB-W03", templateId: "wf-08",
    tagKey: "dashboard.v2.workflowPdfTag", nameKey: "dashboard.v2.workflowPdfName",
    nameEmKey: "dashboard.v2.workflowPdfNameEm", descKey: "dashboard.v2.workflowPdfDesc",
    meta: ["5 nodes", "~3m", "MP4 + IFC"],
    badgeKey: "dashboard.v2.workflowPro", badgeType: "pro",
    preview: WorkflowPreviewPdfWalkthrough,
  },
};

interface WorkflowCardProps {
  workflowId: WorkflowId;
}

export function WorkflowCard({ workflowId }: WorkflowCardProps) {
  const { t } = useLocale();
  const router = useRouter();
  const loadFromTemplate = useWorkflowStore((s) => s.loadFromTemplate);
  const cfg = CONFIG[workflowId];
  const Preview = cfg.preview;

  const handleClick = useCallback(() => {
    const template = PREBUILT_WORKFLOWS.find((w) => w.id === cfg.templateId);
    if (template) {
      loadFromTemplate(template as WorkflowTemplate);
      router.push("/dashboard/canvas");
    } else {
      router.push("/dashboard/templates");
    }
  }, [cfg.templateId, loadFromTemplate, router]);

  return (
    <div className={s.workflow} onClick={handleClick} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") handleClick(); }}>
      <div className={s.workflowStrip}>
        <span className={s.workflowStripNum}>{cfg.num}</span>
        <span className={s.workflowStripBadge} data-badge={cfg.badgeType}>
          {t(cfg.badgeKey)}
        </span>
      </div>
      <div className={s.workflowPreview}>
        <Preview />
      </div>
      <div className={s.workflowBody}>
        <div className={s.workflowTag}>{t(cfg.tagKey)}</div>
        <div className={s.workflowName}>
          {t(cfg.nameKey)} <em className={s.workflowNameEm}>{t(cfg.nameEmKey)}</em>
        </div>
        <div className={s.workflowDesc}>{t(cfg.descKey)}</div>
        <div className={s.workflowMeta}>
          <div className={s.workflowMetaPills}>
            {cfg.meta.map((m) => (
              <span key={m} className={s.workflowMetaPill}>{m}</span>
            ))}
          </div>
        </div>
        <button type="button" className={s.workflowCta} onClick={(e) => { e.stopPropagation(); handleClick(); }}>
          <Play size={12} /> {t("dashboard.v2.workflowRunCta")}
        </button>
      </div>
    </div>
  );
}
