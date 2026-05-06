import type { WorkflowCategoryMeta } from "@/features/workflows/lib/categorize";
import {
  pickFloorplanVariant,
  pickThreeDVariant,
  pickRenderVariant,
  pickPipelineNodeCount,
  hash,
} from "@/features/workflows/lib/synthetic-preview";
import s from "./page.module.css";

interface Props {
  workflowId: string;
  thumbnailUrl: string | null;
  category: WorkflowCategoryMeta;
  variant?: "small" | "large";
}

export function WorkflowPreview({ workflowId, thumbnailUrl, category, variant = "small" }: Props) {
  if (thumbnailUrl) {
    return (
      <div className={s.previewImg}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={thumbnailUrl} alt="" loading="lazy" />
      </div>
    );
  }

  switch (category.key) {
    case "floorplan":
      return <FloorplanPreview workflowId={workflowId} variant={variant} />;
    case "3d":
      return <ThreeDPreview workflowId={workflowId} />;
    case "render":
      return <RenderPreview workflowId={workflowId} />;
    case "pdf":
      return <PdfPreview />;
    case "pipeline":
      return <PipelinePreview workflowId={workflowId} />;
    default:
      return <CustomPreview workflowId={workflowId} />;
  }
}

function FloorplanPreview({ workflowId, variant }: { workflowId: string; variant: "small" | "large" }) {
  const v = pickFloorplanVariant(workflowId);
  return (
    <div className={s.synthFloorplan}>
      <svg viewBox="0 0 100 70" preserveAspectRatio="xMidYMid meet" className={s.synthSvg}>
        <rect x="2" y="2" width="96" height="66" fill="none" stroke="rgba(14,18,24,.5)" strokeWidth="1.4" />
        {v === "single" && (
          <>
            <line x1="40" y1="2" x2="40" y2="40" stroke="rgba(14,18,24,.4)" strokeWidth=".8" />
            <line x1="2" y1="40" x2="60" y2="40" stroke="rgba(14,18,24,.4)" strokeWidth=".8" />
            <line x1="60" y1="40" x2="60" y2="68" stroke="rgba(14,18,24,.4)" strokeWidth=".8" />
            <line x1="60" y1="20" x2="98" y2="20" stroke="rgba(14,18,24,.4)" strokeWidth=".8" />
          </>
        )}
        {v === "double" && (
          <>
            <line x1="50" y1="2" x2="50" y2="68" stroke="rgba(14,18,24,.4)" strokeWidth=".8" />
            <line x1="2" y1="35" x2="98" y2="35" stroke="rgba(14,18,24,.4)" strokeWidth=".8" />
            <line x1="25" y1="35" x2="25" y2="68" stroke="rgba(14,18,24,.4)" strokeWidth=".8" />
            <line x1="75" y1="35" x2="75" y2="68" stroke="rgba(14,18,24,.4)" strokeWidth=".8" />
          </>
        )}
        {v === "studio" && (
          <>
            <line x1="35" y1="40" x2="65" y2="40" stroke="rgba(14,18,24,.4)" strokeWidth=".8" />
            <line x1="65" y1="2" x2="65" y2="40" stroke="rgba(14,18,24,.4)" strokeWidth=".8" />
            <rect x="20" y="48" width="20" height="14" fill="rgba(74,107,77,.15)" stroke="rgba(14,18,24,.35)" strokeWidth=".5" />
          </>
        )}
        {v === "open" && (
          <>
            <line x1="2" y1="20" x2="60" y2="20" stroke="rgba(14,18,24,.4)" strokeWidth=".8" />
            <line x1="60" y1="20" x2="60" y2="68" stroke="rgba(14,18,24,.4)" strokeWidth=".8" />
          </>
        )}
        <rect x="20" y="0.5" width="6" height="3" fill="#F0EBE0" />
        {variant === "large" && (
          <>
            <text x="12" y="22" fontSize="3.5" fill="rgba(74,107,77,.6)" fontFamily="monospace">LIVING</text>
            <text x="68" y="32" fontSize="3.5" fill="rgba(74,107,77,.6)" fontFamily="monospace">KITCH</text>
          </>
        )}
      </svg>
    </div>
  );
}

function ThreeDPreview({ workflowId }: { workflowId: string }) {
  const v = pickThreeDVariant(workflowId);
  return (
    <div className={s.synth3d}>
      <svg viewBox="0 0 100 80" preserveAspectRatio="xMidYMid meet" className={s.synthSvg}>
        <polygon points="10,60 50,75 90,60 50,42" fill="rgba(229,168,120,.15)" stroke="rgba(229,168,120,.5)" strokeWidth=".6" />
        {v === "stack" && (
          <>
            <polygon points="38,45 52,38 66,45 52,52" fill="rgba(244,192,137,.35)" stroke="rgba(229,168,120,.6)" strokeWidth=".5" />
            <polygon points="38,45 38,30 52,23 52,38" fill="rgba(229,168,120,.3)" stroke="rgba(229,168,120,.6)" strokeWidth=".5" />
            <polygon points="52,38 52,23 66,30 66,45" fill="rgba(194,106,59,.35)" stroke="rgba(229,168,120,.6)" strokeWidth=".5" />
            <polygon points="60,52 70,47 80,52 70,57" fill="rgba(244,192,137,.3)" stroke="rgba(229,168,120,.5)" strokeWidth=".4" />
            <polygon points="60,52 60,42 70,37 70,47" fill="rgba(229,168,120,.25)" stroke="rgba(229,168,120,.5)" strokeWidth=".4" />
            <polygon points="70,47 70,37 80,42 80,52" fill="rgba(194,106,59,.3)" stroke="rgba(229,168,120,.5)" strokeWidth=".4" />
          </>
        )}
        {v === "tower" && (
          <>
            <polygon points="40,50 50,44 60,50 50,56" fill="rgba(244,192,137,.35)" stroke="rgba(229,168,120,.6)" strokeWidth=".5" />
            <polygon points="40,50 40,22 50,16 50,44" fill="rgba(229,168,120,.3)" stroke="rgba(229,168,120,.6)" strokeWidth=".5" />
            <polygon points="50,44 50,16 60,22 60,50" fill="rgba(194,106,59,.35)" stroke="rgba(229,168,120,.6)" strokeWidth=".5" />
          </>
        )}
        {v === "wide" && (
          <>
            <polygon points="25,55 50,43 75,55 50,67" fill="rgba(244,192,137,.3)" stroke="rgba(229,168,120,.5)" strokeWidth=".5" />
            <polygon points="25,55 25,42 50,30 50,43" fill="rgba(229,168,120,.25)" stroke="rgba(229,168,120,.5)" strokeWidth=".5" />
            <polygon points="50,43 50,30 75,42 75,55" fill="rgba(194,106,59,.3)" stroke="rgba(229,168,120,.5)" strokeWidth=".5" />
          </>
        )}
      </svg>
    </div>
  );
}

function RenderPreview({ workflowId }: { workflowId: string }) {
  const v = pickRenderVariant(workflowId);
  return <div className={s.synthRender} data-variant={v} />;
}

function PdfPreview() {
  return (
    <div className={s.synthPdf}>
      <div className={s.synthPdfShadow} />
      <div className={s.synthPdfDoc} />
    </div>
  );
}

function PipelinePreview({ workflowId }: { workflowId: string }) {
  const count = pickPipelineNodeCount(workflowId);
  return (
    <div className={s.synthPipeline}>
      <div className={s.synthPipelineFlow}>
        {Array.from({ length: count }).map((_, i) => (
          <span key={i} className={s.synthPipelineNode}>
            {i < count - 1 && <span className={s.synthPipelineLine} />}
          </span>
        ))}
      </div>
    </div>
  );
}

function CustomPreview({ workflowId }: { workflowId: string }) {
  const n = 4 + (hash(workflowId) % 4); // 4..7 nodes
  return (
    <div className={s.synthCustom}>
      <svg viewBox="0 0 100 70" preserveAspectRatio="xMidYMid meet" className={s.synthSvg}>
        {Array.from({ length: n }).map((_, i) => {
          const angle = (i / n) * Math.PI * 2;
          const cx = 50 + Math.cos(angle) * 22;
          const cy = 35 + Math.sin(angle) * 18;
          return (
            <g key={i}>
              <line x1={50} y1={35} x2={cx} y2={cy} stroke="rgba(63,74,82,.3)" strokeWidth=".8" />
              <circle cx={cx} cy={cy} r="4" fill="rgba(63,74,82,.12)" stroke="rgba(63,74,82,.4)" strokeWidth=".8" />
            </g>
          );
        })}
        <circle cx="50" cy="35" r="5" fill="rgba(63,74,82,.22)" stroke="rgba(63,74,82,.6)" strokeWidth="1" />
      </svg>
    </div>
  );
}
