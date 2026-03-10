"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  ChevronDown, ChevronUp, Box, Film, FileDown,
  Layers, Clock, Cpu, Sparkles, FileText, Image as ImageIcon,
  Video, BarChart3, Table2, Code2, File, Zap,
  Building2, Ruler, MapPin, Shield, CheckCircle,
} from "lucide-react";
import { useLocale } from "@/hooks/useLocale";
import { useExecutionStore } from "@/stores/execution-store";
import { COLORS } from "../constants";
import { HeroSection } from "../sections/HeroSection";
import { KpiStrip } from "../sections/KpiStrip";
import { PipelineViz } from "../sections/PipelineViz";
import { AnimatedNumber } from "../sections/AnimatedNumber";
import type { ShowcaseData } from "../useShowcaseData";
import type { TabId } from "../constants";
import type { TranslationKey } from "@/lib/i18n";

interface OverviewTabProps {
  data: ShowcaseData;
  onExpandVideo: () => void;
  onNavigateTab: (tab: TabId) => void;
  onRetryVideo?: () => void;
}

// ─── Artifact type icon map ──────────────────────────────────────────────────

const ARTIFACT_ICONS: Record<string, React.ReactNode> = {
  text: <FileText size={16} />,
  image: <ImageIcon size={16} />,
  video: <Video size={16} />,
  "3d": <Box size={16} />,
  kpi: <BarChart3 size={16} />,
  table: <Table2 size={16} />,
  json: <Code2 size={16} />,
  svg: <Layers size={16} />,
  file: <File size={16} />,
};

const ARTIFACT_COLORS: Record<string, string> = {
  text: "#8B5CF6",
  image: "#10B981",
  video: "#00F5FF",
  "3d": "#FFBF00",
  kpi: "#F59E0B",
  table: "#6366F1",
  json: "#EC4899",
  svg: "#14B8A6",
  file: "#64748B",
};

const ARTIFACT_LABEL_KEYS: Record<string, TranslationKey> = {
  text: "showcase.typeDocument",
  image: "showcase.typeRender",
  video: "showcase.typeWalkthrough",
  "3d": "showcase.type3dModel",
  kpi: "showcase.typeMetrics",
  table: "showcase.typeDataTable",
  json: "showcase.typeStructuredData",
  svg: "showcase.typeFloorPlan",
  file: "showcase.typeExportFile",
};

export function OverviewTab({ data, onExpandVideo, onNavigateTab, onRetryVideo }: OverviewTabProps) {
  const { t } = useLocale();
  const [descExpanded, setDescExpanded] = useState(false);
  const descLines = data.textContent.split("\n");
  const shortDesc = descLines.slice(0, 4).join("\n");
  const hasLongDesc = descLines.length > 4;

  // Compute artifact type breakdown
  const artifactBreakdown = data.pipelineSteps
    .filter(s => s.artifactType)
    .map(s => ({
      type: s.artifactType!,
      label: s.label,
      nodeCategory: s.category,
    }));

  // Derive tech stack from pipeline
  const techStack = deriveTechStack(data);

  const hasKpis = data.kpiMetrics.length > 0;
  const hasHero = !!data.videoData || !!data.heroImageUrl;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* ── Top Row: Hero + Right Panel ──────────────────────────────────── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: hasHero ? "3fr 2fr" : "1fr",
        gap: 20,
        minHeight: 320,
      }}>
        {/* Left: Hero Media */}
        {hasHero && (
          <div style={{ minWidth: 0 }}>
            <HeroSection
              videoData={data.videoData}
              heroImageUrl={data.heroImageUrl}
              onExpandVideo={onExpandVideo}
              onRetryVideo={onRetryVideo}
            />
          </div>
        )}

        {/* Right: KPIs or Project Info */}
        <div style={{
          display: "flex",
          flexDirection: "column",
          gap: 12,
          minWidth: 0,
        }}>
          {hasKpis ? (
            <KpiStrip metrics={data.kpiMetrics} maxItems={6} compact />
          ) : (
            <ExecutionSummaryPanel data={data} />
          )}
          <PipelineViz steps={data.pipelineSteps} />
        </div>
      </div>

      {/* ── Execution Details Banner ──────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: "12px 18px",
          background: `linear-gradient(135deg, ${COLORS.CYAN}06, ${COLORS.EMERALD}04)`,
          border: `1px solid ${COLORS.CYAN}15`,
          borderRadius: 10,
        }}
      >
        <div style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          background: `${COLORS.EMERALD}15`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: COLORS.EMERALD,
          flexShrink: 0,
        }}>
          <CheckCircle size={16} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 12,
            fontWeight: 600,
            color: COLORS.TEXT_PRIMARY,
          }}>
            {t('showcase.executionComplete')}
          </div>
          <div style={{
            fontSize: 10,
            color: COLORS.TEXT_MUTED,
            marginTop: 1,
          }}>
            {new Date(data.executionMeta.executedAt).toLocaleDateString("en-US", {
              month: "short", day: "numeric", year: "numeric",
            })} at {new Date(data.executionMeta.executedAt).toLocaleTimeString("en-US", {
              hour: "2-digit", minute: "2-digit",
            })}
          </div>
        </div>
        {data.executionMeta.durationMs != null && (
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "4px 10px",
            borderRadius: 6,
            background: "rgba(255,255,255,0.04)",
          }}>
            <Clock size={10} style={{ color: COLORS.TEXT_MUTED }} />
            <span style={{ fontSize: 10, color: COLORS.TEXT_MUTED, fontWeight: 500 }}>
              {data.executionMeta.durationMs < 1000
                ? `${data.executionMeta.durationMs}ms`
                : `${(data.executionMeta.durationMs / 1000).toFixed(1)}s`}
            </span>
          </div>
        )}
        <div style={{
          display: "flex",
          gap: 12,
        }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.TEXT_PRIMARY, fontVariantNumeric: "tabular-nums" }}>
              {data.successNodes}/{data.totalNodes}
            </div>
            <div style={{ fontSize: 8, color: COLORS.TEXT_MUTED, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {t('showcase.nodesPassed')}
            </div>
          </div>
          <div style={{ width: 1, background: COLORS.GLASS_BORDER }} />
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.TEXT_PRIMARY, fontVariantNumeric: "tabular-nums" }}>
              {data.totalArtifacts}
            </div>
            <div style={{ fontSize: 8, color: COLORS.TEXT_MUTED, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              {t('showcase.artifactsGenerated')}
            </div>
          </div>
        </div>
      </motion.div>

      {/* ── Deliverables Grid ────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
      >
        <SectionHeader icon={<Layers size={13} />} title={t('showcase.deliverables')} />
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
          gap: 10,
        }}>
          {artifactBreakdown.map((item, i) => {
            const color = ARTIFACT_COLORS[item.type] ?? COLORS.TEXT_MUTED;
            const icon = ARTIFACT_ICONS[item.type] ?? <File size={16} />;
            const labelKey = ARTIFACT_LABEL_KEYS[item.type];
            const typeLabel = labelKey ? t(labelKey) : item.type;

            // Map artifact types to their corresponding tabs
            const tabMapping: Record<string, TabId> = {
              text: "data",
              image: "media",
              video: "media",
              svg: "media",
              kpi: "data",
              table: "data",
              json: "data",
              "3d": "model",
              file: "export",
            };
            const targetTab = tabMapping[item.type] ?? "export";

            return (
              <motion.button
                key={`${item.type}-${i}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + i * 0.04 }}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => onNavigateTab(targetTab)}
                style={{
                  background: COLORS.GLASS_BG,
                  border: `1px solid ${COLORS.GLASS_BORDER}`,
                  borderRadius: 10,
                  padding: "14px 16px",
                  position: "relative",
                  overflow: "hidden",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  textAlign: "left",
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = `${color}40`;
                  e.currentTarget.style.boxShadow = `0 0 20px ${color}10`;
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = COLORS.GLASS_BORDER;
                  e.currentTarget.style.boxShadow = "none";
                }}
              >
                {/* Top accent line */}
                <div style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  height: 2,
                  background: `linear-gradient(90deg, ${color}60, transparent)`,
                }} />
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                }}>
                  <div style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    background: `${color}12`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color,
                    flexShrink: 0,
                  }}>
                    {icon}
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: COLORS.TEXT_PRIMARY,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}>
                      {typeLabel}
                    </div>
                    <div style={{
                      fontSize: 9,
                      color: COLORS.TEXT_MUTED,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}>
                      {item.label}
                    </div>
                  </div>
                  <svg
                    width="12" height="12" viewBox="0 0 24 24" fill="none"
                    stroke={COLORS.TEXT_MUTED} strokeWidth="2"
                    style={{ flexShrink: 0, opacity: 0.4 }}
                  >
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </div>
              </motion.button>
            );
          })}
        </div>
      </motion.div>

      {/* ── Description ──────────────────────────────────────────────────── */}
      {data.textContent && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.25 }}
        >
          <SectionHeader icon={<FileText size={13} />} title={t('showcase.projectBrief')} />
          <div
            style={{
              background: COLORS.GLASS_BG,
              border: `1px solid ${COLORS.GLASS_BORDER}`,
              borderRadius: 10,
              padding: "18px 22px",
              position: "relative",
              overflow: "hidden",
            }}
          >
            {/* Blueprint corner marks */}
            <CornerMarks />
            <div style={{
              fontSize: 13,
              color: COLORS.TEXT_SECONDARY,
              lineHeight: 1.75,
              whiteSpace: "pre-wrap",
            }}>
              {descExpanded ? data.textContent : shortDesc}
              {hasLongDesc && (
                <button
                  onClick={() => setDescExpanded(e => !e)}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    background: "none",
                    border: "none",
                    color: COLORS.CYAN,
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: "pointer",
                    marginLeft: 8,
                  }}
                >
                  {descExpanded ? t('showcase.showLess') : `${t('showcase.showMoreLines')} (+${descLines.length - 4} ${t('showcase.lines')})`}
                  {descExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                </button>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {/* ── Bottom Row: Tech Stack + Quick Actions ───────────────────────── */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 16,
      }}>
        {/* Tech Stack */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <SectionHeader icon={<Cpu size={13} />} title={t('showcase.technologyStack')} />
          <div style={{
            background: COLORS.GLASS_BG,
            border: `1px solid ${COLORS.GLASS_BORDER}`,
            borderRadius: 10,
            padding: "16px 18px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}>
            {techStack.map((tech, i) => (
              <motion.div
                key={tech.name}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.35 + i * 0.04 }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: tech.color,
                    boxShadow: `0 0 8px ${tech.color}40`,
                  }} />
                  <span style={{ fontSize: 11, color: COLORS.TEXT_SECONDARY, fontWeight: 500 }}>
                    {tech.name}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {tech.statusBadge && (
                    <span
                      style={{
                        fontSize: 8, fontWeight: 700,
                        padding: "2px 6px", borderRadius: 4,
                        background: `${tech.statusBadge.badgeColor}15`,
                        color: tech.statusBadge.badgeColor,
                        textTransform: "uppercase", letterSpacing: "0.04em",
                        cursor: tech.statusBadge.link ? "pointer" : "default",
                      }}
                      onClick={() => { if (tech.statusBadge?.link) window.open(tech.statusBadge.link, "_blank"); }}
                    >
                      {tech.statusBadge.text}
                    </span>
                  )}
                  <span style={{
                    fontSize: 9,
                    color: COLORS.TEXT_MUTED,
                    padding: "2px 8px",
                    borderRadius: 4,
                    background: "rgba(255,255,255,0.03)",
                  }}>
                    {tech.role}
                  </span>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Quick Actions + AEC Info */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <SectionHeader icon={<Zap size={13} />} title={t('showcase.quickActions')} />
          <div style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}>
            {data.model3dData && (
              <QuickActionButton
                icon={<Box size={14} />}
                label={t('showcase.view3dModel')}
                description={t('showcase.interactiveMassing')}
                color={COLORS.CYAN}
                onClick={() => onNavigateTab("model")}
              />
            )}
            {data.videoData && (
              <QuickActionButton
                icon={<Film size={14} />}
                label={t('showcase.watchWalkthrough')}
                description={`${data.videoData.durationSeconds}s · ${data.videoData.shotCount} ${t('showcase.shots').toLowerCase()}`}
                color={COLORS.VIOLET}
                onClick={onExpandVideo}
              />
            )}
            {data.allImageUrls.length > 0 && (
              <QuickActionButton
                icon={<ImageIcon size={14} />}
                label={t('showcase.viewRenders')}
                description={`${data.allImageUrls.length} ${data.allImageUrls.length > 1 ? t('showcase.conceptRenders') : t('showcase.conceptRender')}`}
                color={COLORS.EMERALD}
                onClick={() => onNavigateTab("media")}
              />
            )}
            <QuickActionButton
              icon={<FileDown size={14} />}
              label={t('showcase.downloadCenter')}
              description={t('showcase.pdfVideoFiles')}
              color={COLORS.AMBER}
              onClick={() => onNavigateTab("export")}
            />
          </div>
        </motion.div>
      </div>

      {/* ── AEC Ambient Footer ───────────────────────────────────────────── */}
      <AECFooter />
    </div>
  );
}

// ─── Execution Summary Panel (shown when no KPIs) ───────────────────────────

function ExecutionSummaryPanel({ data }: { data: ShowcaseData }) {
  const { t } = useLocale();
  const stats = [
    {
      icon: <Layers size={16} />,
      label: t('showcase.statsArtifacts'),
      value: data.totalArtifacts,
      color: COLORS.CYAN,
    },
    {
      icon: <Sparkles size={16} />,
      label: t('showcase.statsNodesRun'),
      value: data.successNodes,
      suffix: `/ ${data.totalNodes}`,
      color: COLORS.EMERALD,
    },
    {
      icon: <Clock size={16} />,
      label: t('showcase.statsPipeline'),
      value: data.pipelineSteps.length,
      suffix: ` ${t('showcase.statsSteps')}`,
      color: COLORS.AMBER,
    },
  ];

  // Count artifact types
  const typeCounts: Record<string, number> = {};
  data.pipelineSteps.forEach(s => {
    if (s.artifactType) {
      typeCounts[s.artifactType] = (typeCounts[s.artifactType] ?? 0) + 1;
    }
  });

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      gap: 10,
      height: "100%",
    }}>
      {/* Stats cards */}
      {stats.map((stat, i) => (
        <motion.div
          key={stat.label}
          initial={{ opacity: 0, x: 15 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1 + i * 0.06 }}
          style={{
            background: COLORS.GLASS_BG,
            border: `1px solid ${COLORS.GLASS_BORDER}`,
            borderRadius: 10,
            padding: "14px 16px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            borderRadius: "0 2px 2px 0",
            background: stat.color,
          }} />
          <div style={{
            width: 36,
            height: 36,
            borderRadius: 8,
            background: `${stat.color}10`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: stat.color,
            flexShrink: 0,
          }}>
            {stat.icon}
          </div>
          <div>
            <div style={{
              fontSize: 22,
              fontWeight: 700,
              color: COLORS.TEXT_PRIMARY,
              lineHeight: 1.1,
              fontVariantNumeric: "tabular-nums",
            }}>
              <AnimatedNumber value={stat.value} duration={1000 + i * 300} />
              {stat.suffix && (
                <span style={{ fontSize: 11, color: COLORS.TEXT_MUTED, fontWeight: 400, marginLeft: 3 }}>
                  {stat.suffix}
                </span>
              )}
            </div>
            <div style={{
              fontSize: 10,
              color: COLORS.TEXT_MUTED,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              fontWeight: 500,
            }}>
              {stat.label}
            </div>
          </div>
        </motion.div>
      ))}

      {/* Artifact type mini-bar */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        style={{
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          marginTop: 2,
        }}
      >
        {Object.entries(typeCounts).map(([type, count]) => {
          const color = ARTIFACT_COLORS[type] ?? COLORS.TEXT_MUTED;
          return (
            <div
              key={type}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 4,
                padding: "3px 8px",
                borderRadius: 6,
                background: `${color}10`,
                border: `1px solid ${color}20`,
              }}
            >
              <div style={{ color, display: "flex" }}>
                {ARTIFACT_ICONS[type] ?? <File size={10} />}
              </div>
              <span style={{ fontSize: 9, color, fontWeight: 600 }}>
                {count} {ARTIFACT_LABEL_KEYS[type] ? t(ARTIFACT_LABEL_KEYS[type]) : type}
              </span>
            </div>
          );
        })}
      </motion.div>
    </div>
  );
}

// ─── Tech Stack Derivation ──────────────────────────────────────────────────

interface TechItem {
  name: string;
  role: string;
  color: string;
  statusBadge?: { text: string; badgeColor: string; link?: string };
}

function deriveTechStack(data: ShowcaseData): TechItem[] {
  const techs: TechItem[] = [];
  const seen = new Set<string>();

  const add = (name: string, role: string, color: string, statusBadge?: TechItem["statusBadge"]) => {
    if (!seen.has(name)) {
      seen.add(name);
      techs.push({ name, role, color, statusBadge });
    }
  };

  // Derive Kling status from video artifact
  let klingBadge: TechItem["statusBadge"] | undefined;
  if (data.videoData?.nodeId) {
    const videoArtifact = useExecutionStore.getState().artifacts.get(data.videoData.nodeId);
    if (videoArtifact) {
      const meta = (videoArtifact.metadata ?? {}) as Record<string, unknown>;
      const artData = (videoArtifact.data ?? {}) as Record<string, unknown>;
      if (meta.engine === "kling-official" && artData.videoGenerationStatus === "complete") {
        klingBadge = { text: "Active", badgeColor: COLORS.EMERALD };
      } else if (meta.engine === "kling-official" && artData.videoGenerationStatus === "processing") {
        klingBadge = { text: "Generating", badgeColor: COLORS.AMBER };
      } else if (meta.engine === "threejs-client") {
        klingBadge = { text: "Fallback", badgeColor: COLORS.TEXT_MUTED };
      }
    }
    // Check videoGenProgress for balance errors
    const progressStates = useExecutionStore.getState().videoGenProgress;
    for (const [, state] of progressStates) {
      if (state.status === "failed" && state.failureMessage?.toLowerCase().includes("balance")) {
        klingBadge = { text: "No Credits", badgeColor: "#ff5050", link: "https://klingai.com" };
      }
    }
  }

  data.pipelineSteps.forEach(step => {
    const cat = step.category;
    if (cat === "input") add("User Input", "Data source", "#64748B");
    if (step.label.includes("Brief") || step.label.includes("Analyzer") || step.label.includes("Understanding") || step.label.includes("Parser") || step.label.includes("Extractor")) {
      add("GPT-4o mini", "AI analysis", "#8B5CF6");
    }
    if (step.label.includes("Massing")) add("Procedural Engine", "3D geometry", COLORS.AMBER);
    if (step.label.includes("Style") || step.label.includes("Composer")) add("GPT-4o mini", "Prompt engineering", "#8B5CF6");
    if (step.label.includes("Concept Render")) add("DALL-E 3", "Image generation", COLORS.EMERALD);
    if (step.label.includes("Video") || step.label.includes("Walkthrough")) add("Kling 3.0", "Video synthesis", COLORS.CYAN, klingBadge);
    if (step.label.includes("3D Recon")) add("Meshy v4", "3D reconstruction", COLORS.AMBER);
    if (step.label.includes("Floor Plan Gen")) add("GPT-4o + SVG", "Plan generation", "#14B8A6");
    if (step.label.includes("Quantity") || step.label.includes("BOQ")) add("web-ifc Parser", "BIM extraction", "#F59E0B");
  });

  if (techs.length === 0) {
    add("NeoBIM Engine", "Workflow orchestration", COLORS.CYAN);
  }

  return techs;
}

// ─── AEC Ambient Footer ─────────────────────────────────────────────────────

function AECFooter() {
  const { t } = useLocale();
  const aecFacts = [
    { icon: <Building2 size={13} />, text: t('showcase.aecGrade') },
    { icon: <Shield size={13} />, text: t('showcase.enterpriseReady') },
    { icon: <Ruler size={13} />, text: t('showcase.dimensionallyAccurate') },
    { icon: <MapPin size={13} />, text: t('showcase.contextAware') },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.5 }}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 0",
        borderTop: `1px solid ${COLORS.GLASS_BORDER}`,
      }}
    >
      <div style={{ display: "flex", gap: 20 }}>
        {aecFacts.map((fact, i) => (
          <motion.div
            key={fact.text}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.55 + i * 0.05 }}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              color: COLORS.TEXT_MUTED,
              fontSize: 10,
            }}
          >
            <span style={{ opacity: 0.5, display: "flex" }}>{fact.icon}</span>
            {fact.text}
          </motion.div>
        ))}
      </div>
      <div style={{ fontSize: 9, color: COLORS.TEXT_MUTED, opacity: 0.5 }}>
        NeoBIM Workflow Engine v2.0
      </div>
    </motion.div>
  );
}

// ─── Section Header ─────────────────────────────────────────────────────────

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 6,
      marginBottom: 10,
    }}>
      <span style={{ color: COLORS.TEXT_MUTED, display: "flex" }}>{icon}</span>
      <span style={{
        fontSize: 11,
        fontWeight: 600,
        color: COLORS.TEXT_SECONDARY,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
      }}>
        {title}
      </span>
      <div style={{
        flex: 1,
        height: 1,
        marginLeft: 8,
        background: `linear-gradient(90deg, ${COLORS.GLASS_BORDER}, transparent)`,
      }} />
    </div>
  );
}

// ─── Blueprint Corner Marks ─────────────────────────────────────────────────

function CornerMarks() {
  const markStyle = (top: boolean, left: boolean): React.CSSProperties => ({
    position: "absolute",
    [top ? "top" : "bottom"]: 6,
    [left ? "left" : "right"]: 6,
    width: 12,
    height: 12,
    borderColor: `${COLORS.CYAN}20`,
    borderStyle: "solid",
    borderWidth: 0,
    ...(top && left ? { borderTopWidth: 1, borderLeftWidth: 1 } : {}),
    ...(top && !left ? { borderTopWidth: 1, borderRightWidth: 1 } : {}),
    ...(!top && left ? { borderBottomWidth: 1, borderLeftWidth: 1 } : {}),
    ...(!top && !left ? { borderBottomWidth: 1, borderRightWidth: 1 } : {}),
  });

  return (
    <>
      <div style={markStyle(true, true)} />
      <div style={markStyle(true, false)} />
      <div style={markStyle(false, true)} />
      <div style={markStyle(false, false)} />
    </>
  );
}

// ─── Quick Action Button ────────────────────────────────────────────────────

function QuickActionButton({
  icon,
  label,
  description,
  color,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  description?: string;
  color: string;
  onClick: () => void;
}) {
  return (
    <motion.button
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 16px",
        borderRadius: 10,
        background: COLORS.GLASS_BG,
        border: `1px solid ${COLORS.GLASS_BORDER}`,
        color: COLORS.TEXT_PRIMARY,
        fontSize: 12,
        fontWeight: 500,
        cursor: "pointer",
        transition: "all 0.15s ease",
        textAlign: "left",
        width: "100%",
      }}
      onMouseEnter={e => {
        e.currentTarget.style.borderColor = `${color}40`;
        e.currentTarget.style.boxShadow = `0 0 20px ${color}08`;
      }}
      onMouseLeave={e => {
        e.currentTarget.style.borderColor = COLORS.GLASS_BORDER;
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      <div style={{
        width: 34,
        height: 34,
        borderRadius: 8,
        background: `${color}10`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color,
        flexShrink: 0,
      }}>
        {icon}
      </div>
      <div>
        <div style={{ fontWeight: 600, fontSize: 12 }}>{label}</div>
        {description && (
          <div style={{ fontSize: 10, color: COLORS.TEXT_MUTED, marginTop: 1 }}>
            {description}
          </div>
        )}
      </div>
      <svg
        width="14" height="14" viewBox="0 0 24 24" fill="none"
        stroke={COLORS.TEXT_MUTED} strokeWidth="2"
        style={{ marginLeft: "auto", flexShrink: 0, opacity: 0.5 }}
      >
        <path d="M9 18l6-6-6-6" />
      </svg>
    </motion.button>
  );
}
