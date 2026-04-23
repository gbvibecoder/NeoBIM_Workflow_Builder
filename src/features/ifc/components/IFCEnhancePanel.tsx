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
  MapPin,
  Home,
  Building2,
} from "lucide-react";
import { UI } from "@/features/ifc/components/constants";
import type { ViewportHandle } from "@/types/ifc-viewer";
import {
  DEFAULT_TIER2_TOGGLES,
  DEFAULT_TIER3_TOGGLES,
  DEFAULT_TIER4_TOGGLES,
  DEFAULT_TOGGLES,
  type DeckMaterial,
  type EnhanceStatus,
  type EnhanceToggles,
  type GroundType,
  type HDRIPreset,
  type MaterialQuality,
  type RidgeDirection,
  type RoofStyle,
  type Tier2Toggles,
  type Tier3ApplyResult,
  type Tier3Toggles,
  type Tier4ApplyResult,
  type Tier4Toggles,
  type WindowFrameColor,
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
import {
  createTier3Engine,
  type Tier3Engine,
} from "@/features/ifc/enhance/tier3/tier3-engine";
import {
  createTier4Engine,
  type Tier4Engine,
} from "@/features/ifc/enhance/tier4/tier4-engine";

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
    const [tier3Toggles, setTier3Toggles] = useState<Tier3Toggles>(DEFAULT_TIER3_TOGGLES);
    const [tier4Toggles, setTier4Toggles] = useState<Tier4Toggles>(DEFAULT_TIER4_TOGGLES);
    const [status, setStatus] = useState<EnhanceStatus>({ kind: "idle" });
    const [expanded, setExpanded] = useState({
      materials: true,
      environment: true,
      lighting: true,
      context: true,
      roof: true,
      "building-details": true,
    });
    const [tier2Counts, setTier2Counts] = useState<{
      ground: number;
    } | null>(null);
    const [tier3Result, setTier3Result] = useState<Tier3ApplyResult | null>(null);
    const [tier4Result, setTier4Result] = useState<Tier4ApplyResult | null>(null);

    /* Engines live in refs so tab switches don't recreate them and lose state. */
    const engineRef = useRef<Tier1Engine | null>(null);
    const tier2EngineRef = useRef<Tier2Engine | null>(null);
    const tier3EngineRef = useRef<Tier3Engine | null>(null);
    const tier4EngineRef = useRef<Tier4Engine | null>(null);

    const isLoading = status.kind === "loading";
    const isApplied = status.kind === "applied";

    /* ── Reset-before-reload safety hook ── */
    useImperativeHandle(
      panelRef,
      () => ({
        resetIfApplied: async () => {
          /* Order: tier4 → tier3 → tier2 → tier1. Stack-unwind: building
             details come off first (they hang off wall / window / slab
             meshes that tier3 would otherwise unhide), then roof (it
             depends on the IFC slab being hidden), then site context,
             finally building materials + env. This keeps the scene
             coherent at every frame. */
          const tier4 = tier4EngineRef.current;
          if (tier4 && tier4.isApplied()) {
            await tier4.reset();
          }
          const tier3 = tier3EngineRef.current;
          if (tier3 && tier3.isApplied()) {
            await tier3.reset();
          }
          const tier2 = tier2EngineRef.current;
          if (tier2 && tier2.isApplied()) {
            await tier2.reset();
          }
          const tier1 = engineRef.current;
          if (tier1 && tier1.isApplied()) {
            await tier1.reset();
          }
          setTier2Counts(null);
          setTier3Result(null);
          setTier4Result(null);
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
        overrideTier3?: Tier3Toggles,
        overrideTier4?: Tier4Toggles,
      ) => {
        if (!viewportRef.current) {
          setStatus({ kind: "error", message: "Viewer not ready." });
          return;
        }
        const nextToggles = overrideToggles ?? toggles;
        const nextTier2 = overrideTier2 ?? tier2Toggles;
        const nextTier3 = overrideTier3 ?? tier3Toggles;
        const nextTier4 = overrideTier4 ?? tier4Toggles;
        if (overrideToggles) setToggles(overrideToggles);
        if (overrideTier2) setTier2Toggles(overrideTier2);
        if (overrideTier3) setTier3Toggles(overrideTier3);
        if (overrideTier4) setTier4Toggles(overrideTier4);

        if (!engineRef.current) engineRef.current = createTier1Engine(viewportRef.current);
        if (!tier2EngineRef.current) tier2EngineRef.current = createTier2Engine(viewportRef.current);
        if (!tier3EngineRef.current) tier3EngineRef.current = createTier3Engine(viewportRef.current);
        if (!tier4EngineRef.current) tier4EngineRef.current = createTier4Engine(viewportRef.current);

        setStatus({ kind: "loading", step: "Starting", progress: 0 });
        try {
          /* Tier 1 (materials + HDRI + lighting) — 0.0 → 0.3 of combined. */
          const tier1Result = await engineRef.current.apply(nextToggles, (step, progress) => {
            setStatus({ kind: "loading", step, progress: progress * 0.3 });
          });
          if (!tier1Result.success) {
            setStatus({ kind: "error", message: tier1Result.message ?? "Tier 1 apply failed." });
            return;
          }

          /* Tier 2 (site context — ground only post-strip) — 0.3 → 0.55.
             Skip quietly if master toggle off. */
          let tier2Result: Awaited<ReturnType<Tier2Engine["apply"]>> = {
            success: true,
            groundAreaM2: 0,
            durationMs: 0,
          };
          if (nextTier2.context) {
            tier2Result = await tier2EngineRef.current.apply(
              nextTier2,
              nextToggles.hdriPreset,
              nextToggles.quality,
              (step, progress) => setStatus({ kind: "loading", step, progress: 0.3 + progress * 0.25 }),
            );
            if (!tier2Result.success) {
              setStatus({ kind: "error", message: tier2Result.message ?? "Tier 2 apply failed." });
              return;
            }
          } else if (tier2EngineRef.current?.isApplied()) {
            /* Context was toggled off after a prior apply — drop the site. */
            await tier2EngineRef.current.reset();
          }

          /* Tier 3 (roof treatment) — 0.55 → 0.8. Skip quietly if master
             enabled toggle off, but reset any prior roof so the scene
             reflects the new state. */
          let tier3Out: Tier3ApplyResult = {
            success: true,
            resolvedStyle: "skipped",
            durationMs: 0,
          };
          if (nextTier3.enabled) {
            tier3Out = await tier3EngineRef.current.apply(
              nextTier3,
              nextToggles.hdriPreset,
              nextToggles.quality,
              (step, progress) => setStatus({ kind: "loading", step, progress: 0.55 + progress * 0.25 }),
            );
            if (!tier3Out.success) {
              setStatus({ kind: "error", message: tier3Out.message ?? "Tier 3 apply failed." });
              return;
            }
          } else if (tier3EngineRef.current?.isApplied()) {
            await tier3EngineRef.current.reset();
          }

          /* Tier 4 (building details — railings / frames / sills) —
             0.8 → 1.0. Skip quietly if master enabled toggle off, but
             reset any prior details so the scene reflects the new
             state. */
          let tier4Out: Tier4ApplyResult = {
            success: true,
            balconyEdgesDetected: 0,
            railingsBuilt: 0,
            windowsFramed: 0,
            sillsBuilt: 0,
            balconyCount: 0,
            durationMs: 0,
          };
          if (nextTier4.enabled) {
            tier4Out = await tier4EngineRef.current.apply(
              nextTier4,
              (step, progress) => setStatus({ kind: "loading", step, progress: 0.8 + progress * 0.2 }),
            );
            if (!tier4Out.success) {
              setStatus({ kind: "error", message: tier4Out.message ?? "Tier 4 apply failed." });
              return;
            }
          } else if (tier4EngineRef.current?.isApplied()) {
            await tier4EngineRef.current.reset();
          }

          setTier2Counts({ ground: tier2Result.groundAreaM2 });
          setTier3Result(tier3Out);
          setTier4Result(tier4Out);
          setStatus({ kind: "applied", toggles: nextToggles, counts: tier1Result.counts });
        } catch (err) {
          setStatus({
            kind: "error",
            message: err instanceof Error ? err.message : "Unexpected error during enhance.",
          });
        }
      },
      [toggles, tier2Toggles, tier3Toggles, tier4Toggles, viewportRef],
    );

    /* ── Reset button handler ── */
    const handleReset = useCallback(async () => {
      try {
        /* Stack unwind: tier4 → tier3 → tier2 → tier1. Building details
           come off first (they hang off wall / window / slab meshes);
           roof next (it depends on the IFC slab being hidden); site
           context next so the ground doesn't float under the building
           mid-reset; Tier 1 last. */
        const tier4 = tier4EngineRef.current;
        if (tier4 && tier4.isApplied()) await tier4.reset();
        const tier3 = tier3EngineRef.current;
        if (tier3 && tier3.isApplied()) await tier3.reset();
        const tier2 = tier2EngineRef.current;
        if (tier2 && tier2.isApplied()) await tier2.reset();
        const tier1 = engineRef.current;
        if (tier1 && tier1.isApplied()) await tier1.reset();
        setTier2Counts(null);
        setTier3Result(null);
        setTier4Result(null);
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
      const autoTier1 = recommendedToggles(vp.getMeshMap().size);
      /* Reset every tier to its documented defaults — "Auto" means Auto
         end-to-end, not a merge of prior user tweaks. Phase 3.5a: the
         Tier 3 "auto" style defers the gable-vs-flat choice to the
         engine's storey-count heuristic at apply time. Phase 4a adds
         tier 4 defaults (railings on, window frames aluminum, sills
         on). */
      setTier3Toggles(DEFAULT_TIER3_TOGGLES);
      setTier4Toggles(DEFAULT_TIER4_TOGGLES);
      await handleApply(
        autoTier1,
        DEFAULT_TIER2_TOGGLES,
        DEFAULT_TIER3_TOGGLES,
        DEFAULT_TIER4_TOGGLES,
      );
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
      if (tier2Counts && tier2Counts.ground > 0) {
        rows.push(`${tier2Counts.ground.toLocaleString()} m² site`);
      }
      /* Phase 3.5a — roof treatment summary. Three flavours:
           - Flat terrace: "Flat terrace roof (wood deck, N bulkheads)"
           - Gable:        "Gable roof (30°, E-W ridge)"
           - Skipped:      "Roof: skipped (already authored)" */
      if (tier3Result) {
        if (tier3Result.resolvedStyle === "flat-terrace") {
          const bulkCount =
            (tier3Result.hvacCount ?? 0) + (tier3Result.stairBulkhead ? 1 : 0);
          rows.push(
            `Flat terrace roof (wood deck, ${bulkCount} bulkhead${bulkCount === 1 ? "" : "s"})`,
          );
        } else if (tier3Result.resolvedStyle === "gable") {
          const dir = tier3Result.ridgeDirection === "ew" ? "E-W" : "N-S";
          rows.push(`Gable roof (${tier3Result.pitchDeg ?? "?"}°, ${dir} ridge)`);
        } else {
          /* skipped — only show if user explicitly enabled it, to avoid
             noise when the roof master toggle is off. */
          if (tier3Toggles.enabled) {
            rows.push("Roof: skipped (already authored)");
          }
        }
      }
      /* Phase 4a — building details summary. Only render the items the
         user actually enabled, so an "all off" tier 4 stays silent. The
         counters below now report DISTINCT window ELEMENTS and DISTINCT
         BALCONIES (hotfix) — not sub-mesh counts. */
      if (tier4Result && tier4Toggles.enabled) {
        if (tier4Toggles.windowFrames && tier4Result.windowsFramed > 0) {
          rows.push(`${tier4Result.windowsFramed} windows framed`);
        }
        if (tier4Toggles.windowSills && tier4Result.sillsBuilt > 0) {
          rows.push(`${tier4Result.sillsBuilt} sills`);
        }
        /* Prefer the explicit `balconyCount` field; `railingsBuilt` is a
           legacy compatibility alias that now holds the same value. */
        const balconyCount = tier4Result.balconyCount ?? tier4Result.railingsBuilt;
        if (tier4Toggles.railings && balconyCount > 0) {
          rows.push(`${balconyCount} balcon${balconyCount === 1 ? "y" : "ies"}`);
        }
      }
      return rows.join(" · ");
    }, [status, tier2Counts, tier3Result, tier3Toggles.enabled, tier4Result, tier4Toggles.enabled, tier4Toggles.windowFrames, tier4Toggles.windowSills, tier4Toggles.railings]);

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
                <div style={{ padding: "4px 10px 10px" }}>
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
              </Section>

              {/* ── ROOF (Phase 3.5a) ── */}
              <Section
                expanded={expanded.roof}
                onToggle={() => setExpanded((p) => ({ ...p, roof: !p.roof }))}
                title="Roof"
              >
                <div style={rowStyle}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Home size={13} color={UI.accent.cyan} aria-hidden />
                    <span>Enable roof synthesis</span>
                  </div>
                  <button
                    type="button"
                    aria-label="Toggle roof synthesis"
                    disabled={anyDisabled}
                    onClick={() =>
                      setTier3Toggles((p) => ({ ...p, enabled: !p.enabled }))
                    }
                    style={switchStyle(tier3Toggles.enabled)}
                  >
                    <span style={switchThumbStyle(tier3Toggles.enabled)} />
                  </button>
                </div>

                {/* Style picker — always visible when master enabled */}
                <div style={{ padding: "4px 10px 10px" }}>
                  <div
                    style={{
                      fontSize: 10.5,
                      color: UI.text.tertiary,
                      marginBottom: 6,
                      letterSpacing: "0.4px",
                      textTransform: "uppercase",
                    }}
                  >
                    Style
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {(
                      [
                        { id: "auto", label: "Auto" },
                        { id: "gable", label: "Gable" },
                        { id: "flat-terrace", label: "Flat" },
                      ] as Array<{ id: RoofStyle; label: string }>
                    ).map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        disabled={anyDisabled || !tier3Toggles.enabled}
                        onClick={() =>
                          setTier3Toggles((p) => ({ ...p, style: s.id }))
                        }
                        style={pickerBtnStyle(tier3Toggles.style === s.id)}
                      >
                        <span>{s.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Flat-terrace sub-controls — shown for "auto" (unknown yet)
                    and "flat-terrace". */}
                {(tier3Toggles.style === "auto" ||
                  tier3Toggles.style === "flat-terrace") && (
                  <>
                    <div style={{ padding: "4px 10px 10px" }}>
                      <div
                        style={{
                          fontSize: 10.5,
                          color: UI.text.tertiary,
                          marginBottom: 6,
                          letterSpacing: "0.4px",
                          textTransform: "uppercase",
                        }}
                      >
                        Deck material
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        {(
                          [
                            { id: "wood", label: "Wood", enabled: true },
                            { id: "ceramic", label: "Ceramic", enabled: false },
                            { id: "concrete", label: "Concrete", enabled: false },
                          ] as Array<{ id: DeckMaterial; label: string; enabled: boolean }>
                        ).map((d) => (
                          <button
                            key={d.id}
                            type="button"
                            title={d.enabled ? undefined : "Coming soon"}
                            disabled={
                              anyDisabled || !tier3Toggles.enabled || !d.enabled
                            }
                            onClick={() =>
                              setTier3Toggles((p) => ({
                                ...p,
                                deckMaterial: d.id,
                              }))
                            }
                            style={{
                              ...pickerBtnStyle(
                                tier3Toggles.deckMaterial === d.id && d.enabled,
                              ),
                              opacity: d.enabled ? 1 : 0.45,
                            }}
                          >
                            <span>{d.label}</span>
                            {!d.enabled && (
                              <span
                                style={{
                                  fontSize: 9,
                                  color: UI.text.tertiary,
                                  marginTop: 2,
                                }}
                              >
                                soon
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div style={rowStyle}>
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <span>Bulkheads + HVAC</span>
                        <span style={{ fontSize: 10.5, color: UI.text.tertiary }}>
                          Stair access box + condenser units
                        </span>
                      </div>
                      <button
                        type="button"
                        aria-label="Toggle bulkheads"
                        disabled={anyDisabled || !tier3Toggles.enabled}
                        onClick={() =>
                          setTier3Toggles((p) => ({ ...p, bulkheads: !p.bulkheads }))
                        }
                        style={switchStyle(tier3Toggles.bulkheads)}
                      >
                        <span style={switchThumbStyle(tier3Toggles.bulkheads)} />
                      </button>
                    </div>
                  </>
                )}

                {/* Gable sub-controls — only for explicit gable */}
                {tier3Toggles.style === "gable" && (
                  <>
                    <div style={{ padding: "4px 10px 10px" }}>
                      <div
                        style={{
                          fontSize: 10.5,
                          color: UI.text.tertiary,
                          marginBottom: 6,
                          letterSpacing: "0.4px",
                          textTransform: "uppercase",
                        }}
                      >
                        Pitch: {tier3Toggles.pitchDeg}°
                      </div>
                      <input
                        type="range"
                        min={15}
                        max={45}
                        step={1}
                        value={tier3Toggles.pitchDeg}
                        disabled={anyDisabled || !tier3Toggles.enabled}
                        onChange={(e) =>
                          setTier3Toggles((p) => ({
                            ...p,
                            pitchDeg: Number(e.target.value),
                          }))
                        }
                        style={{ width: "100%", accentColor: UI.accent.cyan }}
                      />
                    </div>
                    <div style={{ padding: "4px 10px 10px" }}>
                      <div
                        style={{
                          fontSize: 10.5,
                          color: UI.text.tertiary,
                          marginBottom: 6,
                          letterSpacing: "0.4px",
                          textTransform: "uppercase",
                        }}
                      >
                        Ridge direction
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        {(
                          [
                            { id: "auto", label: "Auto" },
                            { id: "ns", label: "N-S" },
                            { id: "ew", label: "E-W" },
                          ] as Array<{ id: RidgeDirection; label: string }>
                        ).map((r) => (
                          <button
                            key={r.id}
                            type="button"
                            disabled={anyDisabled || !tier3Toggles.enabled}
                            onClick={() =>
                              setTier3Toggles((p) => ({
                                ...p,
                                ridgeDirection: r.id,
                              }))
                            }
                            style={pickerBtnStyle(
                              tier3Toggles.ridgeDirection === r.id,
                            )}
                          >
                            <span>{r.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </Section>

              {/* ── BUILDING DETAILS (Phase 4a) ── */}
              <Section
                expanded={expanded["building-details"]}
                onToggle={() =>
                  setExpanded((p) => ({ ...p, "building-details": !p["building-details"] }))
                }
                title="Building details"
              >
                <div style={rowStyle}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Building2 size={13} color={UI.accent.cyan} aria-hidden />
                    <span>Enable building details</span>
                  </div>
                  <button
                    type="button"
                    aria-label="Toggle building details master"
                    disabled={anyDisabled}
                    onClick={() =>
                      setTier4Toggles((p) => ({ ...p, enabled: !p.enabled }))
                    }
                    style={switchStyle(tier4Toggles.enabled)}
                  >
                    <span style={switchThumbStyle(tier4Toggles.enabled)} />
                  </button>
                </div>

                {/* Balcony railings */}
                <div style={rowStyle}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span>Balcony railings</span>
                    <span style={{ fontSize: 10.5, color: UI.text.tertiary }}>
                      Metal top + base rail with balusters along cantilever edges
                    </span>
                  </div>
                  <button
                    type="button"
                    aria-label="Toggle balcony railings"
                    disabled={anyDisabled || !tier4Toggles.enabled}
                    onClick={() =>
                      setTier4Toggles((p) => ({ ...p, railings: !p.railings }))
                    }
                    style={switchStyle(tier4Toggles.railings)}
                  >
                    <span style={switchThumbStyle(tier4Toggles.railings)} />
                  </button>
                </div>

                {/* Window frames */}
                <div style={rowStyle}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span>Window frames</span>
                    <span style={{ fontSize: 10.5, color: UI.text.tertiary }}>
                      4-sided frame · mullion ≥ 1.2 m · transom ≥ 1.5 m
                    </span>
                  </div>
                  <button
                    type="button"
                    aria-label="Toggle window frames"
                    disabled={anyDisabled || !tier4Toggles.enabled}
                    onClick={() =>
                      setTier4Toggles((p) => ({ ...p, windowFrames: !p.windowFrames }))
                    }
                    style={switchStyle(tier4Toggles.windowFrames)}
                  >
                    <span style={switchThumbStyle(tier4Toggles.windowFrames)} />
                  </button>
                </div>

                {/* Frame color picker */}
                <div style={{ padding: "4px 10px 10px" }}>
                  <div
                    style={{
                      fontSize: 10.5,
                      color: UI.text.tertiary,
                      marginBottom: 6,
                      letterSpacing: "0.4px",
                      textTransform: "uppercase",
                    }}
                  >
                    Frame color
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    {(
                      [
                        { id: "aluminum", label: "Aluminum" },
                        { id: "white-pvc", label: "White PVC" },
                        { id: "wood", label: "Wood" },
                      ] as Array<{ id: WindowFrameColor; label: string }>
                    ).map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        disabled={
                          anyDisabled || !tier4Toggles.enabled || !tier4Toggles.windowFrames
                        }
                        onClick={() =>
                          setTier4Toggles((p) => ({ ...p, frameColor: c.id }))
                        }
                        style={pickerBtnStyle(tier4Toggles.frameColor === c.id)}
                      >
                        <span>{c.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Window sills */}
                <div style={rowStyle}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span>Window sills</span>
                    <span style={{ fontSize: 10.5, color: UI.text.tertiary }}>
                      Concrete ledge below each frame
                    </span>
                  </div>
                  <button
                    type="button"
                    aria-label="Toggle window sills"
                    disabled={anyDisabled || !tier4Toggles.enabled}
                    onClick={() =>
                      setTier4Toggles((p) => ({ ...p, windowSills: !p.windowSills }))
                    }
                    style={switchStyle(tier4Toggles.windowSills)}
                  >
                    <span style={switchThumbStyle(tier4Toggles.windowSills)} />
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
