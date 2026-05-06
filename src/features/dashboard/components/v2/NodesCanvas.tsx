import { FileText, Layers, Box, Palette, FileSpreadsheet } from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import s from "./dashboard.module.css";

const NODES = [
  { id: "brief", label: "dashboard.v2.nodeBrief" as const, icon: FileText, x: "6%", y: "38%", color: "#6B4566", bg: "rgba(107,69,102,0.08)", delay: 0 },
  { id: "floor", label: "dashboard.v2.nodeFloor" as const, icon: Layers, x: "28%", y: "22%", color: "#3D5C40", bg: "rgba(61,92,64,0.08)", delay: 0.1, active: true },
  { id: "ifc",   label: "dashboard.v2.nodeIfc" as const,   icon: Box, x: "52%", y: "14%", color: "#B8762D", bg: "rgba(184,118,45,0.08)", delay: 0.2 },
  { id: "render", label: "dashboard.v2.nodeRender" as const, icon: Palette, x: "52%", y: "58%", color: "#C26A3B", bg: "rgba(194,106,59,0.08)", delay: 0.3 },
  { id: "boq",   label: "dashboard.v2.nodeBoq" as const,   icon: FileSpreadsheet, x: "80%", y: "38%", color: "#1A4D5C", bg: "rgba(26,77,92,0.08)", delay: 0.4 },
];

// SVG connection paths between nodes
const PATHS = [
  { d: "M 80,65 C 120,65 140,48 165,48",  color: "rgba(107,69,102,0.2)" },   // brief → floor
  { d: "M 210,48 C 240,48 270,35 290,35",  color: "rgba(61,92,64,0.2)" },     // floor → ifc
  { d: "M 210,48 C 240,55 270,80 290,80",  color: "rgba(61,92,64,0.2)" },     // floor → render
  { d: "M 340,35 C 380,35 400,60 430,60",  color: "rgba(184,118,45,0.2)" },   // ifc → boq
  { d: "M 340,80 C 380,80 400,60 430,60",  color: "rgba(194,106,59,0.2)" },   // render → boq
];

export function NodesCanvas() {
  const { t } = useLocale();

  return (
    <div className={s.nodesCanvas}>
      {/* Strip header */}
      <div className={s.nodesCanvasStrip}>
        <div className={s.nodesCanvasStripLeft}>
          <span className={s.nodesCanvasStripPulse} />
          {t("dashboard.v2.sampleWorkflow")}
        </div>
        <div className={s.nodesCanvasStripRight}>5 {t("dashboard.v2.nodesLabel")}</div>
      </div>

      {/* SVG connection lines + animated dots */}
      <svg
        className={s.nodesSvg}
        viewBox="0 0 500 110"
        preserveAspectRatio="xMidYMid meet"
        style={{ position: "absolute", top: 30, left: 0, width: "100%", height: "calc(100% - 30px)", pointerEvents: "none" }}
      >
        {/* Connection paths */}
        {PATHS.map((p, i) => (
          <path
            key={i}
            d={p.d}
            fill="none"
            stroke={p.color}
            strokeWidth="1.5"
            strokeDasharray="4,4"
            style={{ animation: "dashFlow 1.5s linear infinite" }}
          />
        ))}

        {/* Traveling dots */}
        <circle r="3" fill="rgba(61,92,64,0.5)">
          <animateMotion dur="3s" repeatCount="indefinite" path="M 80,65 C 120,65 140,48 165,48" />
        </circle>
        <circle r="3" fill="rgba(184,118,45,0.5)">
          <animateMotion dur="3.5s" repeatCount="indefinite" path="M 210,48 C 240,48 270,35 290,35" />
        </circle>
        <circle r="2.5" fill="rgba(26,77,92,0.5)">
          <animateMotion dur="4s" repeatCount="indefinite" path="M 340,35 C 380,35 400,60 430,60" />
        </circle>

        {/* Annotations */}
        <text x="30" y="100" fontFamily="JetBrains Mono, monospace" fontSize="7" fill="rgba(154,161,176,0.6)" letterSpacing="1.5">INPUT</text>
        <text x="430" y="100" fontFamily="JetBrains Mono, monospace" fontSize="7" fill="rgba(154,161,176,0.6)" letterSpacing="1.5">OUTPUT</text>
      </svg>

      {/* HTML nodes positioned absolutely */}
      {NODES.map((node) => {
        const Icon = node.icon;
        return (
          <div
            key={node.id}
            className={`${s.wfNode} ${node.active ? s.wfNodeActive : ""}`}
            style={{
              left: node.x,
              top: `calc(30px + ${node.y})`,
              animationDelay: `${node.delay}s`,
            }}
          >
            <div className={s.wfNodeIcon} style={{ background: node.bg, color: node.color }}>
              <Icon size={14} />
            </div>
            <span className={s.wfNodeLabel}>{t(node.label)}</span>
          </div>
        );
      })}
    </div>
  );
}
