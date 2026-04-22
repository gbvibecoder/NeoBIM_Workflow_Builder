"use client";

import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import {
  Sparkles,
  Sun,
  Sunset,
  Cloud,
  Moon,
  Aperture,
  ChevronDown,
  ChevronRight,
  Loader2,
  RotateCcw,
  AlertTriangle,
  CheckCircle2,
  Wand2,
  Trees,
  Lamp,
  Milestone,
  MapPin,
} from "lucide-react";
import { UI } from "@/features/ifc/components/constants";
import type { ViewportHandle } from "@/types/ifc-viewer";
import {
  DEFAULT_TIER2_TOGGLES,
  DEFAULT_TOGGLES,
  type EnhanceStatus,
  type EnhanceToggles,
  type GroundType,
  type HDRIPreset,
  type MaterialQuality,
  type RoadSide,
  type Tier2Toggles,
} from "@/features/ifc/enhance/types";
import {
  createTier1Engine,
  recommendedToggles,
  type Tier1Engine,
} from "@/features/ifc/enhance/tier1-engine";
import {
  createTier2Engine,
  type Tier2Engine,
} from "@/features/ifc/enhance/tier2/tier2-engine";

/* ─── Props + imperative handle ──────────────────────────────────────── */

interface IFCEnhancePanelProps {
  viewportRef: RefObject<ViewportHandle | null>;
  hasModel: boolean;
}

export interface IFCEnhancePanelHandle {
  /** Safe cleanup hook for IFCViewerPage to call before re-loading a model.
      No-op if nothing is applied. */
  resetIfApplied: () => Promise<void>;
}

/* ─── HDRI preset metadata ───────────────────────────────────────────── */

const HDRI_OPTIONS: Array<{
  id: HDRIPreset;
  label: string;
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  helper: string;
}> = [
  { id: "day", label: "Day", Icon: Sun, helper: "Partly cloudy, crisp shadows" },
  { id: "sunset", label: "Sunset", Icon: Sunset, helper: "Golden hour, warm light" },
  { id: "overcast", label: "Overcast", Icon: Cloud, helper: "Soft diffuse, no hard shadows" },
  { id: "night", label: "Night", Icon: Moon, helper: "Moonlit, low ambient" },
  { id: "studio", label: "Studio", Icon: Aperture, helper: "Neutral studio" },
];

const QUALITY_OPTIONS: Array<{ id: MaterialQuality; label: string; helper: string }> = [
  { id: "low",    label: "Low",    helper: "Faster — no AO, 4× aniso" },
  { id: "medium", label: "Medium", helper: "Default — AO + 8× aniso" },
  { id: "high",   label: "High",   helper: "Sharpest — AO + 16× aniso" },
];

/* ─── Shared style helpers ───────────────────────────────────────────── */

const sectionHeaderStyle: CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "8px 10px",
  background: "transparent",
  border: "none",
  color: UI.text.primary,
  fontSize: 12,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.4px",
  cursor: "pointer",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "8px 10px",
  fontSize: 12.5,
  color: UI.text.secondary,
};

const pickerBtnStyle = (active: boolean): CSSProperties => ({
  flex: 1,
  padding: "8px 6px",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 3,
  borderRadius: UI.radius.sm,
  border: `1px solid ${active ? UI.accent.cyan : UI.border.default}`,
  background: active ? "rgba(0,245,255,0.08)" : UI.bg.card,
  color: active ? UI.accent.cyan : UI.text.secondary,
  fontSize: 10.5,
  fontWeight: 600,
  cursor: "pointer",
  transition: UI.transition,
});

const switchStyle = (on: boolean): CSSProperties => ({
  position: "relative",
  width: 34,
  height: 18,
  borderRadius: 9,
  border: "none",
  background: on ? UI.accent.cyan : UI.border.default,
  cursor: "pointer",
  transition: UI.transition,
  padding: 0,
  flexShrink: 0,
});

const switchThumbStyle = (on: boolean): CSSProperties => ({
  position: "absolute",
  top: 2,
  left: on ? 18 : 2,
  width: 14,
  height: 14,
  borderRadius: 7,
  background: "#fff",
  transition: UI.transition,
});

/* ─── Panel ───────────────────────────────────────────────────────────── */

export const IFCEnhancePanel = forwardRef<IFCEnhancePanelHandle, IFCEnhancePanelProps>(
  function IFCEnhancePanel({ viewportRef, hasModel }, panelRef) {
    const [toggles, setToggles] = useState<EnhanceToggles>(DEFAULT_TOGGLES);
    const [tier2Toggles, setTier2Toggles] = useState<Tier2Toggles>(DEFAULT_TIER2_TOGGLES);
    const [status, setStatus] = useState<EnhanceStatus>({ kind: "idle" });
    const [expanded, setExpanded] = useState({
      materials: true,
      environment: true,
      lighting: true,
      context: true,
    });
    const [tier2Counts, setTier2Counts] = useState<{
      ground: number;
      trees: number;
      shrubs: number;
      lamps: number;
    } | null>(null);

    /* Engines live in refs so tab switches don't recreate them and lose state. */
    const engineRef = useRef<Tier1Engine | null>(null);
    const tier2EngineRef = useRef<Tier2Engine | null>(null);

    const isLoading = status.kind === "loading";
    const isApplied = status.kind === "applied";

    /* ── Reset-before-reload safety hook ── */
    useImperativeHandle(
      panelRef,
      () => ({
        resetIfApplied: async () => {
          /* Order: tier2 first (removes site context from scene), then
             tier1 (restores mesh materials + env). Keeps scene coherent
             while resetting — never shows "textured building with mixed
             site" state. */
          const tier2 = tier2EngineRef.current;
          if (tier2 && tier2.isApplied()) {
            await tier2.reset();
          }
          const tier1 = engineRef.current;
          if (tier1 && tier1.isApplied()) {
            await tier1.reset();
          }
          setTier2Counts(null);
          setStatus({ kind: "idle" });
        },
      }),
      [],
    );

    /* ── Apply button handler ── */
    const handleApply = useCallback(
      async (
        overrideToggles?: EnhanceToggles,
        overrideTier2?: Tier2Toggles,
      ) => {
        if (!viewportRef.current) {
          setStatus({ kind: "error", message: "Viewer not ready." });
          return;
        }
        const nextToggles = overrideToggles ?? toggles;
        const nextTier2 = overrideTier2 ?? tier2Toggles;
        if (overrideToggles) setToggles(overrideToggles);
        if (overrideTier2) setTier2Toggles(overrideTier2);

        if (!engineRef.current) engineRef.current = createTier1Engine(viewportRef.current);
        if (!tier2EngineRef.current) tier2EngineRef.current = createTier2Engine(viewportRef.current);

        setStatus({ kind: "loading", step: "Starting", progress: 0 });
        try {
          /* Tier 1 (materials + HDRI + lighting) — 0.0 → 0.5 of combined. */
          const tier1Result = await engineRef.current.apply(nextToggles, (step, progress) => {
            setStatus({ kind: "loading", step, progress: progress * 0.5 });
          });
          if (!tier1Result.success) {
            setStatus({ kind: "error", message: tier1Result.message ?? "Tier 1 apply failed." });
            return;
          }

          /* Tier 2 (site context) — 0.5 → 1.0. Skip quietly if master toggle off. */
          let tier2Result: Awaited<ReturnType<Tier2Engine["apply"]>> = {
            success: true,
            groundAreaM2: 0,
            treesPlaced: 0,
            shrubsPlaced: 0,
            lampsPlaced: 0,
            durationMs: 0,
          };
          if (nextTier2.context) {
            tier2Result = await tier2EngineRef.current.apply(
              nextTier2,
              nextToggles.hdriPreset,
              nextToggles.quality,
              (step, progress) => setStatus({ kind: "loading", step, progress: 0.5 + progress * 0.5 }),
            );
            if (!tier2Result.success) {
              setStatus({ kind: "error", message: tier2Result.message ?? "Tier 2 apply failed." });
              return;
            }
          } else if (tier2EngineRef.current?.isApplied()) {
            /* Context was toggled off after a prior apply — drop the site. */
            await tier2EngineRef.current.reset();
          }

          setTier2Counts({
            ground: tier2Result.groundAreaM2,
            trees: tier2Result.treesPlaced,
            shrubs: tier2Result.shrubsPlaced,
            lamps: tier2Result.lampsPlaced,
          });
          setStatus({ kind: "applied", toggles: nextToggles, counts: tier1Result.counts });
        } catch (err) {
          setStatus({
            kind: "error",
            message: err instanceof Error ? err.message : "Unexpected error during enhance.",
          });
        }
      },
      [toggles, tier2Toggles, viewportRef],
    );

    /* ── Reset button handler ── */
    const handleReset = useCallback(async () => {
      try {
        /* Tier 2 first — pull the site context out of the scene. Then tier
           1 so mesh materials + env restore cleanly without a visible
           "site but gray building" intermediate frame. */
        const tier2 = tier2EngineRef.current;
        if (tier2 && tier2.isApplied()) await tier2.reset();
        const tier1 = engineRef.current;
        if (tier1 && tier1.isApplied()) await tier1.reset();
        setTier2Counts(null);
        setStatus({ kind: "idle" });
      } catch (err) {
        setStatus({
          kind: "error",
          message: err instanceof Error ? err.message : "Reset failed.",
        });
      }
    }, []);

    /* ── Auto button — pick defaults based on model size, then apply ── */
    const handleAuto = useCallback(async () => {
      const vp = viewportRef.current;
      if (!vp) {
        setStatus({ kind: "error", message: "Viewer not ready." });
        return;
      }
      const meshMap = vp.getMeshMap();
      const autoTier1 = recommendedToggles(meshMap.size);
      /* Auto picks the defaults for Phase 3 context — they're already tuned
         (20 trees, 15 shrubs, east road, lamps on). For truly massive
         models (>5000 elements) we halve tree/shrub counts to stay snappy. */
      const autoTier2: Tier2Toggles = meshMap.size > 5000
        ? { ...DEFAULT_TIER2_TOGGLES, treeCount: 10, shrubCount: 8 }
        : DEFAULT_TIER2_TOGGLES;
      await handleApply(autoTier1, autoTier2);
    }, [handleApply, viewportRef]);

    const classifiedSummary = useMemo(() => {
      if (status.kind !== "applied") return null;
      const rows: string[] = [];
      const c = status.counts;
      if (c["wall-exterior"]) rows.push(`${c["wall-exterior"]} exterior walls`);
      if (c["wall-interior"]) rows.push(`${c["wall-interior"]} interior walls`);
      if (c["window-glass"]) rows.push(`${c["window-glass"]} windows`);
      if (c["door"]) rows.push(`${c["door"]} doors`);
      if (c["floor-slab"]) rows.push(`${c["floor-slab"]} floor slabs`);
      if (c["roof-slab"]) rows.push(`${c["roof-slab"]} roof slabs`);
      if (tier2Counts) {
        if (tier2Counts.ground > 0) rows.push(`${tier2Counts.ground.toLocaleString()} m² site`);
        if (tier2Counts.trees > 0) rows.push(`${tier2Counts.trees} trees`);
        if (tier2Counts.shrubs > 0) rows.push(`${tier2Counts.shrubs} shrubs`);
        if (tier2Counts.lamps > 0) rows.push(`${tier2Counts.lamps} lamps`);
      }
      return rows.join(" · ");
    }, [status, tier2Counts]);

    const anyDisabled = !hasModel || isLoading;

    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          color: UI.text.primary,
          background: UI.bg.base,
        }}
      >
        {/* Header */}
        <header style={{ padding: "12px 14px 8px", borderBottom: `1px solid ${UI.border.subtle}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <Sparkles size={16} color={UI.accent.cyan} strokeWidth={2.2} aria-hidden />
            <h2 style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>Enhance with AI</h2>
          </div>
          <p style={{ fontSize: 11, color: UI.text.tertiary, margin: "4px 0 0 0", lineHeight: 1.4 }}>
            Turn your basic IFC into a photoreal visualisation. Your .ifc file is never modified.
          </p>
        </header>

        {/* Status banner */}
        <StatusBanner status={status} summary={classifiedSummary} />

        {/* Scrollable toggles */}
        <div style={{ flex: 1, overflowY: "auto", padding: "4px 0 100px 0" }}>
          {!hasModel ? (
            <div style={{ padding: "24px 16px", color: UI.text.secondary, fontSize: 12.5, lineHeight: 1.5 }}>
              Upload an IFC file to start enhancing.
            </div>
          ) : (
            <>
              {/* ── MATERIALS ── */}
              <Section
                expanded={expanded.materials}
                onToggle={() => setExpanded((p) => ({ ...p, materials: !p.materials }))}
                title="Materials"
              >
                <div style={rowStyle}>
                  <span>Apply PBR materials</span>
                  <button
                    type="button"
                    aria-label="Toggle materials"
                    disabled={anyDisabled}
                    onClick={() => setToggles((p) => ({ ...p, materials: !p.materials }))}
                    style={switchStyle(toggles.materials)}
                  >
                    <span style={switchThumbStyle(toggles.materials)} />
                  </button>
                </div>
                <div style={{ padding: "4px 10px 10px" }}>
                  <div style={{ fontSize: 10.5, color: UI.text.tertiary, marginBottom: 6, letterSpacing: "0.4px", textTransform: "uppercase" }}>
                    Quality
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {QUALITY_OPTIONS.map((q) => (
                      <button
                        key={q.id}
                        type="button"
                        title={q.helper}
                        disabled={anyDisabled || !toggles.materials}
                        onClick={() => setToggles((p) => ({ ...p, quality: q.id }))}
                        style={pickerBtnStyle(toggles.quality === q.id)}
                      >
                        <span>{q.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </Section>

              {/* ── ENVIRONMENT ── */}
              <Section
                expanded={expanded.environment}
                onToggle={() => setExpanded((p) => ({ ...p, environment: !p.environment }))}
                title="Environment"
              >
                <div style={rowStyle}>
                  <span>HDRI lighting</span>
                  <button
                    type="button"
                    aria-label="Toggle HDRI"
                    disabled={anyDisabled}
                    onClick={() => setToggles((p) => ({ ...p, hdri: !p.hdri }))}
                    style={switchStyle(toggles.hdri)}
                  >
                    <span style={switchThumbStyle(toggles.hdri)} />
                  </button>
                </div>
                <div style={{ padding: "4px 10px 10px" }}>
                  <div style={{ fontSize: 10.5, color: UI.text.tertiary, marginBottom: 6, letterSpacing: "0.4px", textTransform: "uppercase" }}>
                    Preset
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 6 }}>
                    {HDRI_OPTIONS.map(({ id, label, Icon, helper }) => {
                      const active = toggles.hdriPreset === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          title={helper}
                          disabled={anyDisabled || !toggles.hdri}
                          onClick={() => setToggles((p) => ({ ...p, hdriPreset: id }))}
                          style={pickerBtnStyle(active)}
                        >
                          <Icon size={14} strokeWidth={2} color={active ? UI.accent.cyan : UI.text.secondary} />
                          <span>{label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </Section>

              {/* ── LIGHTING DETAILS ── */}
              <Section
                expanded={expanded.lighting}
                onToggle={() => setExpanded((p) => ({ ...p, lighting: !p.lighting }))}
                title="Lighting details"
              >
                <div style={rowStyle}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span>Lit interior windows</span>
                    <span style={{ fontSize: 10.5, color: UI.text.tertiary }}>
                      Warm emissive glow behind glass — strongest at night
                    </span>
                  </div>
                  <button
                    type="button"
                    aria-label="Toggle lit interior windows"
                    disabled={anyDisabled}
                    onClick={() => setToggles((p) => ({ ...p, litInteriorWindows: !p.litInteriorWindows }))}
                    style={switchStyle(toggles.litInteriorWindows)}
                  >
                    <span style={switchThumbStyle(toggles.litInteriorWindows)} />
                  </button>
                </div>
              </Section>

              {/* ── SITE CONTEXT (Phase 3) ── */}
              <Section
                expanded={expanded.context}
                onToggle={() => setExpanded((p) => ({ ...p, context: !p.context }))}
                title="Site context"
              >
                <div style={rowStyle}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <MapPin size={13} color={UI.accent.cyan} aria-hidden />
                    <span>Enable site context</span>
                  </div>
                  <button
                    type="button"
                    aria-label="Toggle site context master"
                    disabled={anyDisabled}
                    onClick={() => setTier2Toggles((p) => ({ ...p, context: !p.context }))}
                    style={switchStyle(tier2Toggles.context)}
                  >
                    <span style={switchThumbStyle(tier2Toggles.context)} />
                  </button>
                </div>

                {/* Ground */}
                <div style={rowStyle}>
                  <span>Ground plane</span>
                  <button
                    type="button"
                    aria-label="Toggle ground plane"
                    disabled={anyDisabled || !tier2Toggles.context}
                    onClick={() => setTier2Toggles((p) => ({ ...p, ground: !p.ground }))}
                    style={switchStyle(tier2Toggles.ground)}
                  >
                    <span style={switchThumbStyle(tier2Toggles.ground)} />
                  </button>
                </div>
                <div style={{ padding: "4px 10px 8px" }}>
                  <div style={{ fontSize: 10.5, color: UI.text.tertiary, marginBottom: 6, letterSpacing: "0.4px", textTransform: "uppercase" }}>
                    Ground type
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {(["auto", "grass", "concrete", "asphalt"] as GroundType[]).map((g) => (
                      <button
                        key={g}
                        type="button"
                        disabled={anyDisabled || !tier2Toggles.context || !tier2Toggles.ground}
                        onClick={() => setTier2Toggles((p) => ({ ...p, groundType: g }))}
                        style={pickerBtnStyle(tier2Toggles.groundType === g)}
                      >
                        <span style={{ textTransform: "capitalize" }}>{g}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Sidewalk */}
                <div style={rowStyle}>
                  <span>Sidewalk ring</span>
                  <button
                    type="button"
                    aria-label="Toggle sidewalk"
                    disabled={anyDisabled || !tier2Toggles.context}
                    onClick={() => setTier2Toggles((p) => ({ ...p, sidewalk: !p.sidewalk }))}
                    style={switchStyle(tier2Toggles.sidewalk)}
                  >
                    <span style={switchThumbStyle(tier2Toggles.sidewalk)} />
                  </button>
                </div>

                {/* Road */}
                <div style={rowStyle}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Milestone size={13} color={UI.text.secondary} aria-hidden />
                    <span>Road</span>
                  </div>
                  <button
                    type="button"
                    aria-label="Toggle road"
                    disabled={anyDisabled || !tier2Toggles.context}
                    onClick={() => setTier2Toggles((p) => ({ ...p, road: !p.road }))}
                    style={switchStyle(tier2Toggles.road)}
                  >
                    <span style={switchThumbStyle(tier2Toggles.road)} />
                  </button>
                </div>
                <div style={{ padding: "4px 10px 8px" }}>
                  <div style={{ fontSize: 10.5, color: UI.text.tertiary, marginBottom: 6, letterSpacing: "0.4px", textTransform: "uppercase" }}>
                    Road side
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0,1fr))", gap: 6 }}>
                    {(["north", "east", "south", "west", "none"] as RoadSide[]).map((s) => (
                      <button
                        key={s}
                        type="button"
                        disabled={anyDisabled || !tier2Toggles.context || !tier2Toggles.road}
                        onClick={() => setTier2Toggles((p) => ({ ...p, roadSide: s }))}
                        style={pickerBtnStyle(tier2Toggles.roadSide === s)}
                      >
                        <span style={{ textTransform: "capitalize" }}>{s}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Trees slider */}
                <div style={{ ...rowStyle, flexDirection: "column", alignItems: "stretch", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Trees size={13} color={UI.accent.green} aria-hidden />
                      <span>Trees</span>
                    </div>
                    <span style={{ fontVariantNumeric: "tabular-nums", color: UI.text.primary, fontWeight: 600 }}>
                      {tier2Toggles.treeCount}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={40}
                    value={tier2Toggles.treeCount}
                    disabled={anyDisabled || !tier2Toggles.context}
                    onChange={(e) => setTier2Toggles((p) => ({ ...p, treeCount: Number(e.target.value) }))}
                    style={{ width: "100%", accentColor: UI.accent.cyan }}
                  />
                </div>

                {/* Shrubs slider */}
                <div style={{ ...rowStyle, flexDirection: "column", alignItems: "stretch", gap: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span>Shrubs</span>
                    <span style={{ fontVariantNumeric: "tabular-nums", color: UI.text.primary, fontWeight: 600 }}>
                      {tier2Toggles.shrubCount}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={30}
                    value={tier2Toggles.shrubCount}
                    disabled={anyDisabled || !tier2Toggles.context}
                    onChange={(e) => setTier2Toggles((p) => ({ ...p, shrubCount: Number(e.target.value) }))}
                    style={{ width: "100%", accentColor: UI.accent.cyan }}
                  />
                </div>

                {/* Lamps */}
                <div style={rowStyle}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <Lamp size={13} color={UI.text.secondary} aria-hidden />
                      <span>Street lamps</span>
                    </div>
                    <span style={{ fontSize: 10.5, color: UI.text.tertiary }}>
                      PointLights glow at Night preset
                    </span>
                  </div>
                  <button
                    type="button"
                    aria-label="Toggle street lamps"
                    disabled={anyDisabled || !tier2Toggles.context}
                    onClick={() => setTier2Toggles((p) => ({ ...p, lamps: !p.lamps }))}
                    style={switchStyle(tier2Toggles.lamps)}
                  >
                    <span style={switchThumbStyle(tier2Toggles.lamps)} />
                  </button>
                </div>
              </Section>
            </>
          )}
        </div>

        {/* ── Sticky action row ── */}
        <ActionRow
          status={status}
          hasModel={hasModel}
          onApply={() => handleApply()}
          onReset={handleReset}
          onAuto={handleAuto}
        />
      </div>
    );
  },
);

IFCEnhancePanel.displayName = "IFCEnhancePanel";

/* ─── Sub-components ─────────────────────────────────────────────────── */

function Section({
  expanded,
  onToggle,
  title,
  children,
}: {
  expanded: boolean;
  onToggle: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ borderBottom: `1px solid ${UI.border.subtle}` }}>
      <button type="button" onClick={onToggle} style={sectionHeaderStyle}>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>{title}</span>
      </button>
      {expanded && <div>{children}</div>}
    </div>
  );
}

function StatusBanner({ status, summary }: { status: EnhanceStatus; summary: string | null }) {
  if (status.kind === "idle") return null;

  const base: CSSProperties = {
    padding: "8px 14px",
    fontSize: 11.5,
    display: "flex",
    alignItems: "center",
    gap: 8,
    borderBottom: `1px solid ${UI.border.subtle}`,
    lineHeight: 1.35,
  };

  if (status.kind === "loading") {
    return (
      <div style={{ ...base, background: "rgba(79,138,255,0.08)", color: UI.accent.blue }}>
        <Loader2 size={13} aria-hidden />
        <span style={{ flex: 1 }}>{status.step}</span>
        <span style={{ fontVariantNumeric: "tabular-nums", color: UI.text.secondary }}>
          {Math.round(status.progress * 100)}%
        </span>
      </div>
    );
  }

  if (status.kind === "error") {
    return (
      <div style={{ ...base, background: "rgba(248,113,113,0.08)", color: UI.accent.red }}>
        <AlertTriangle size={13} aria-hidden />
        <span>{status.message}</span>
      </div>
    );
  }

  return (
    <div style={{ ...base, background: "rgba(52,211,153,0.08)", color: UI.accent.green }}>
      <CheckCircle2 size={13} aria-hidden />
      <span style={{ flex: 1, color: UI.text.primary }}>
        Applied · {summary ?? "no classified elements"}
      </span>
    </div>
  );
}

function ActionRow({
  status,
  hasModel,
  onApply,
  onReset,
  onAuto,
}: {
  status: EnhanceStatus;
  hasModel: boolean;
  onApply: () => void;
  onReset: () => void;
  onAuto: () => void;
}) {
  const isLoading = status.kind === "loading";
  const isApplied = status.kind === "applied";

  const primaryStyle: CSSProperties = {
    flex: 1,
    padding: "10px 14px",
    borderRadius: UI.radius.md,
    border: isApplied ? `1px solid ${UI.accent.red}` : "none",
    fontSize: 12,
    fontWeight: 600,
    cursor: hasModel && !isLoading ? "pointer" : "not-allowed",
    opacity: hasModel ? 1 : 0.5,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    transition: UI.transition,
    background: isApplied ? UI.bg.elevated : `linear-gradient(135deg, ${UI.accent.cyan}, ${UI.accent.blue})`,
    color: isApplied ? UI.accent.red : "#07070D",
  };

  const autoStyle: CSSProperties = {
    padding: "10px 12px",
    borderRadius: UI.radius.md,
    border: `1px solid ${UI.border.default}`,
    background: UI.bg.card,
    color: UI.text.primary,
    fontSize: 11.5,
    fontWeight: 600,
    cursor: hasModel && !isLoading ? "pointer" : "not-allowed",
    opacity: hasModel && !isLoading ? 1 : 0.5,
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    transition: UI.transition,
  };

  return (
    <div
      style={{
        position: "sticky",
        bottom: 0,
        display: "flex",
        gap: 8,
        padding: "10px 12px",
        background: `linear-gradient(to top, ${UI.bg.base} 70%, rgba(7,7,13,0))`,
        borderTop: `1px solid ${UI.border.subtle}`,
      }}
    >
      {isApplied ? (
        <button type="button" onClick={onReset} disabled={isLoading} style={primaryStyle}>
          <RotateCcw size={13} />
          Reset
        </button>
      ) : (
        <button type="button" onClick={onApply} disabled={!hasModel || isLoading} style={primaryStyle}>
          {isLoading ? <Loader2 size={13} /> : <Sparkles size={13} />}
          {isLoading ? "Applying…" : "Apply Enhancement"}
        </button>
      )}
      <button type="button" onClick={onAuto} disabled={!hasModel || isLoading} style={autoStyle} title="Pick sensible defaults based on model size">
        <Wand2 size={13} />
        Auto
      </button>
    </div>
  );
}
