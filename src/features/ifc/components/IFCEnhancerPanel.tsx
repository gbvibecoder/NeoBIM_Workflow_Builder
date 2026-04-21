"use client";

import React, { useCallback, useRef, useState } from "react";
import {
  Sparkles,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Plus,
  Minus,
  Layers,
  Home,
  Square,
  Columns3,
  DoorOpen,
  Fence,
  Download,
  RotateCcw,
  Wand2,
  Armchair,
  Sofa,
  UtensilsCrossed,
  Trees,
  Compass,
  Palette,
  Ruler,
  Info,
} from "lucide-react";
import { UI } from "@/features/ifc/components/constants";

/* ─── Types (mirror modal's shape so the viewer-apply flow is identical) ── */

export interface EnhanceStats {
  originalBytes: number;
  modifiedBytes: number;
}

export interface OperationSummary {
  op: string;
  ok: boolean;
  message: string;
  entitiesAdded?: number;
  entitiesRewritten?: number;
}

export interface EnhanceSuccess {
  filename: string;
  summary: string;
  understood: string;
  notes: string;
  plannerSource: "ai" | "heuristic";
  results: OperationSummary[];
  stats: EnhanceStats;
  modifiedBuffer: ArrayBuffer;
}

interface IFCEnhancerPanelProps {
  sourceFile: { name: string; buffer: ArrayBuffer } | null;
  onApplyToViewer: (result: EnhanceSuccess) => void;
}

type Status = "idle" | "working" | "success" | "error";

interface LastResult {
  status: "success" | "error";
  prompt: string;
  result: EnhanceSuccess | null;
  errorMessage: string;
}

/* ─── Section metadata ─── */

type SectionId =
  | "floors"
  | "rooms"
  | "walls"
  | "wall_builder"
  | "windows"
  | "doors"
  | "stairs"
  | "balcony"
  | "parapet"
  | "tables"
  | "chairs"
  | "sofas"
  | "landscape"
  | "custom";

type Tone = "primary" | "danger" | "neutral";

interface ActionDef {
  label: string;
  prompt: string;
  icon: React.ReactNode;
  tone: Tone;
}

interface SectionDef {
  id: SectionId;
  title: string;
  icon: React.ReactNode;
  supported: boolean; // fully supported by backend engine?
  group: "structure" | "openings" | "circulation" | "exterior" | "furniture" | "advanced" | "free";
  actions: ActionDef[];
}

const ACCENT_CYAN = "#00F5FF";
const ACCENT_BLUE = "#4F8AFF";
const ACCENT_RED = "#F87171";
const ACCENT_AMBER = "#FFBF00";

const PRIMARY_GRADIENT = "linear-gradient(90deg, #00F5FF 0%, #4F8AFF 100%)";

const ico = (Node: React.ComponentType<{ size?: number; strokeWidth?: number }>) => (
  <Node size={13} strokeWidth={2.2} />
);

/* Preset wall colors — lightweight swatches that map to named colors in
   natural-language prompts. IFC doesn't have a first-class "color" concept
   at the element level (it's via material/style), so these feed the AI as
   hints rather than precise values. */
const COLOR_SWATCHES: { name: string; hex: string }[] = [
  { name: "white", hex: "#F5F5F5" },
  { name: "gray", hex: "#9A9A9A" },
  { name: "beige", hex: "#D6C7A8" },
  { name: "brick red", hex: "#B85450" },
  { name: "blue", hex: "#4F8AFF" },
  { name: "green", hex: "#6FAF74" },
  { name: "wood", hex: "#A0754B" },
  { name: "black", hex: "#1A1A1A" },
];

const SECTIONS: SectionDef[] = [
  // STRUCTURE
  {
    id: "floors",
    title: "Floors",
    icon: <Layers size={14} strokeWidth={2.2} />,
    supported: true,
    group: "structure",
    actions: [
      { label: "Add Floor", prompt: "Add one more floor", icon: ico(Plus), tone: "primary" },
      { label: "Remove Floor", prompt: "Remove the top floor", icon: ico(Minus), tone: "danger" },
    ],
  },
  {
    id: "rooms",
    title: "Rooms",
    icon: <Home size={14} strokeWidth={2.2} />,
    supported: true,
    group: "structure",
    actions: [
      { label: "+ Room on Terrace", prompt: "Add a room on the terrace", icon: ico(Plus), tone: "primary" },
      { label: "+ Room on Top Floor", prompt: "Add a room on the top floor", icon: ico(Plus), tone: "primary" },
    ],
  },
  {
    id: "walls",
    title: "Walls",
    icon: <Square size={14} strokeWidth={2.2} />,
    supported: false,
    group: "structure",
    actions: [
      { label: "Add Wall", prompt: "Add an interior wall on the top floor", icon: ico(Plus), tone: "neutral" },
      { label: "Remove Wall", prompt: "Remove the last added wall", icon: ico(Minus), tone: "neutral" },
    ],
  },
  {
    id: "wall_builder",
    title: "Wall Builder (advanced)",
    icon: <Ruler size={14} strokeWidth={2.2} />,
    supported: false,
    group: "advanced",
    actions: [], // rendered specially
  },

  // OPENINGS
  {
    id: "windows",
    title: "Windows",
    icon: <Columns3 size={14} strokeWidth={2.2} />,
    supported: false,
    group: "openings",
    actions: [
      { label: "Add Window", prompt: "Add a window on each exterior wall of the top floor", icon: ico(Plus), tone: "neutral" },
      { label: "Remove Window", prompt: "Remove a window", icon: ico(Minus), tone: "neutral" },
    ],
  },
  {
    id: "doors",
    title: "Doors",
    icon: <DoorOpen size={14} strokeWidth={2.2} />,
    supported: false,
    group: "openings",
    actions: [
      { label: "Add Door", prompt: "Add a door to the top floor room", icon: ico(Plus), tone: "neutral" },
      { label: "Remove Door", prompt: "Remove a door", icon: ico(Minus), tone: "neutral" },
    ],
  },

  // CIRCULATION
  {
    id: "stairs",
    title: "Stairs",
    icon: <Layers size={14} strokeWidth={2.2} />,
    supported: false,
    group: "circulation",
    actions: [
      { label: "Add Stairs", prompt: "Add stairs from ground floor to the top floor", icon: ico(Plus), tone: "neutral" },
      { label: "Remove Stairs", prompt: "Remove the stairs", icon: ico(Minus), tone: "neutral" },
    ],
  },

  // EXTERIOR
  {
    id: "balcony",
    title: "Balcony",
    icon: <Trees size={14} strokeWidth={2.2} />,
    supported: false,
    group: "exterior",
    actions: [
      { label: "Add Balcony", prompt: "Add a balcony to the top floor", icon: ico(Plus), tone: "neutral" },
      { label: "Remove Balcony", prompt: "Remove the balcony", icon: ico(Minus), tone: "neutral" },
    ],
  },
  {
    id: "parapet",
    title: "Parapet Walls",
    icon: <Fence size={14} strokeWidth={2.2} />,
    supported: false,
    group: "exterior",
    actions: [
      { label: "+ Parapet", prompt: "Add parapet walls on the terrace", icon: ico(Plus), tone: "neutral" },
      { label: "- Parapet", prompt: "Remove the parapet walls", icon: ico(Minus), tone: "neutral" },
    ],
  },

  // FURNITURE
  {
    id: "tables",
    title: "Tables",
    icon: <UtensilsCrossed size={14} strokeWidth={2.2} />,
    supported: false,
    group: "furniture",
    actions: [
      { label: "Add Table", prompt: "Add a table in the top floor room", icon: ico(Plus), tone: "neutral" },
      { label: "Remove Table", prompt: "Remove a table", icon: ico(Minus), tone: "neutral" },
    ],
  },
  {
    id: "chairs",
    title: "Chairs",
    icon: <Armchair size={14} strokeWidth={2.2} />,
    supported: false,
    group: "furniture",
    actions: [
      { label: "Add 4 Chairs", prompt: "Add 4 chairs around the table", icon: ico(Plus), tone: "neutral" },
      { label: "Remove Chairs", prompt: "Remove the chairs", icon: ico(Minus), tone: "neutral" },
    ],
  },
  {
    id: "sofas",
    title: "Sofas",
    icon: <Sofa size={14} strokeWidth={2.2} />,
    supported: false,
    group: "furniture",
    actions: [
      { label: "Add Sofa", prompt: "Add a sofa in the living room", icon: ico(Plus), tone: "neutral" },
      { label: "Remove Sofa", prompt: "Remove the sofa", icon: ico(Minus), tone: "neutral" },
    ],
  },

  // LANDSCAPE (bonus — things commonly asked)
  {
    id: "landscape",
    title: "Landscape",
    icon: <Trees size={14} strokeWidth={2.2} />,
    supported: false,
    group: "exterior",
    actions: [
      { label: "Add Tree", prompt: "Add a tree next to the building", icon: ico(Plus), tone: "neutral" },
      { label: "Add Garden", prompt: "Add a garden area around the building", icon: ico(Plus), tone: "neutral" },
    ],
  },

  // CUSTOM
  {
    id: "custom",
    title: "Custom Prompt",
    icon: <Wand2 size={14} strokeWidth={2.2} />,
    supported: true,
    group: "free",
    actions: [],
  },
];

const GROUP_ORDER: { id: SectionDef["group"]; label: string }[] = [
  { id: "structure", label: "Structure" },
  { id: "openings", label: "Openings" },
  { id: "circulation", label: "Circulation" },
  { id: "exterior", label: "Exterior" },
  { id: "furniture", label: "Furniture" },
  { id: "advanced", label: "Advanced Builders" },
  { id: "free", label: "Custom" },
];

export function IFCEnhancerPanel({ sourceFile, onApplyToViewer }: IFCEnhancerPanelProps) {
  const [open, setOpen] = useState<Record<SectionId, boolean>>({
    floors: true,
    rooms: true,
    walls: false,
    wall_builder: false,
    windows: false,
    doors: false,
    stairs: false,
    balcony: false,
    parapet: false,
    tables: false,
    chairs: false,
    sofas: false,
    landscape: false,
    custom: true,
  });
  const [status, setStatus] = useState<Status>("idle");
  const [working, setWorking] = useState<string | null>(null);
  const [last, setLast] = useState<LastResult | null>(null);

  // Sub-form state
  const [customPrompt, setCustomPrompt] = useState("");
  const [floorTarget, setFloorTarget] = useState("");
  const [roomName, setRoomName] = useState("");
  const [wallLength, setWallLength] = useState("4");
  const [wallHeight, setWallHeight] = useState("3");
  const [wallAngle, setWallAngle] = useState<"0" | "45" | "90" | "custom">("90");
  const [wallAngleCustom, setWallAngleCustom] = useState("30");
  const [wallColor, setWallColor] = useState("white");
  const [wallFloor, setWallFloor] = useState<"top" | "ground" | "all">("top");

  const abortRef = useRef<AbortController | null>(null);

  const toggle = (id: SectionId) => setOpen((s) => ({ ...s, [id]: !s[id] }));

  const runPrompt = useCallback(
    async (prompt: string, opts?: { autoApply?: boolean }) => {
      const autoApply = opts?.autoApply ?? true;
      if (!sourceFile) {
        setLast({ status: "error", prompt, result: null, errorMessage: "No IFC file loaded in the viewer." });
        setStatus("error");
        return;
      }
      if (!prompt.trim()) return;

      // Abort any in-flight request so rapid clicks don't stack.
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      setStatus("working");
      setWorking(prompt);

      try {
        const fd = new FormData();
        fd.append(
          "file",
          new Blob([sourceFile.buffer], { type: "application/octet-stream" }),
          sourceFile.name,
        );
        fd.append("prompt", prompt.trim());

        const res = await fetch("/api/enhance-ifc", {
          method: "POST",
          body: fd,
          signal: ctrl.signal,
        });
        const data = await res.json();

        const modifiedText: string | undefined =
          typeof data?.modifiedText === "string" ? data.modifiedText : undefined;
        const modifiedBuffer = modifiedText
          ? new TextEncoder().encode(modifiedText).buffer
          : sourceFile.buffer.slice(0);

        const built: EnhanceSuccess = {
          filename: data?.filename ?? "model_enhanced.ifc",
          summary: data?.summary ?? data?.message ?? data?.error?.message ?? "",
          understood: data?.understood ?? "",
          notes: data?.notes ?? "",
          plannerSource: data?.plannerSource ?? "heuristic",
          results: Array.isArray(data?.results) ? data.results : [],
          stats: data?.stats ?? {
            originalBytes: sourceFile.buffer.byteLength,
            modifiedBytes: modifiedBuffer.byteLength,
          },
          modifiedBuffer,
        };

        if (!res.ok || !data?.ok) {
          setLast({
            status: "error",
            prompt,
            result: built,
            errorMessage:
              data?.error?.message ?? built.summary ?? built.understood ?? `Request failed (HTTP ${res.status}).`,
          });
          setStatus("error");
          return;
        }

        setLast({ status: "success", prompt, result: built, errorMessage: "" });
        setStatus("success");

        if (autoApply) onApplyToViewer(built);
      } catch (err) {
        if ((err as { name?: string } | undefined)?.name === "AbortError") return;
        setLast({
          status: "error",
          prompt,
          result: null,
          errorMessage: err instanceof Error ? err.message : "Unexpected error",
        });
        setStatus("error");
      } finally {
        setWorking(null);
      }
    },
    [sourceFile, onApplyToViewer],
  );

  const handleSetFloorCount = useCallback(() => {
    const n = parseInt(floorTarget, 10);
    if (!Number.isFinite(n) || n < 1 || n > 50) {
      setLast({
        status: "error",
        prompt: `set floors to ${floorTarget}`,
        result: null,
        errorMessage: "Enter a number between 1 and 50.",
      });
      setStatus("error");
      return;
    }
    runPrompt(`I want exactly ${n} floors`);
  }, [floorTarget, runPrompt]);

  const handleAddNamedRoom = useCallback(() => {
    const name = roomName.trim();
    if (!name) {
      runPrompt("Add a room on the terrace");
      return;
    }
    runPrompt(`Add a room named "${name}" on the terrace`);
  }, [roomName, runPrompt]);

  const handleBuildWall = useCallback(() => {
    const len = parseFloat(wallLength);
    const h = parseFloat(wallHeight);
    const angle = wallAngle === "custom" ? parseFloat(wallAngleCustom) : parseFloat(wallAngle);
    const floor = wallFloor === "all" ? "each floor" : `the ${wallFloor} floor`;
    const parts: string[] = [];
    parts.push("Add a wall");
    if (Number.isFinite(len) && len > 0) parts.push(`${len}m long`);
    if (Number.isFinite(h) && h > 0) parts.push(`${h}m high`);
    if (Number.isFinite(angle)) parts.push(`oriented at ${angle}°`);
    if (wallColor) parts.push(`colored ${wallColor}`);
    parts.push(`on ${floor}`);
    runPrompt(parts.join(", ").replace(", on", " on"));
  }, [wallLength, wallHeight, wallAngle, wallAngleCustom, wallColor, wallFloor, runPrompt]);

  const handleCustom = useCallback(() => {
    if (!customPrompt.trim()) return;
    runPrompt(customPrompt);
  }, [customPrompt, runPrompt]);

  const handleDownloadLast = useCallback(() => {
    if (!last?.result) return;
    const blob = new Blob([last.result.modifiedBuffer], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = last.result.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [last]);

  const isBusy = status === "working";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: UI.bg.base,
        color: UI.text.primary,
      }}
    >
      {/* Header banner */}
      <div
        style={{
          padding: "10px 12px",
          borderBottom: "1px solid rgba(255,255,255,0.04)",
          background: "linear-gradient(90deg, rgba(0,245,255,0.05), rgba(79,138,255,0.05))",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <Sparkles size={14} color={ACCENT_CYAN} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, letterSpacing: 0.2 }}>IFC Enhancer</div>
          <div
            style={{
              fontSize: 10.5,
              color: UI.text.tertiary,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={sourceFile?.name ?? ""}
          >
            {sourceFile?.name || "No model loaded"}
          </div>
        </div>
      </div>

      {/* Info strip explaining the supported / experimental split */}
      <div
        style={{
          padding: "8px 12px",
          borderBottom: "1px solid rgba(255,255,255,0.04)",
          background: "rgba(255,191,0,0.04)",
          display: "flex",
          alignItems: "flex-start",
          gap: 8,
          fontSize: 10.5,
          color: UI.text.secondary,
          lineHeight: 1.4,
          flexShrink: 0,
        }}
      >
        <Info size={12} color={ACCENT_AMBER} style={{ flexShrink: 0, marginTop: 2 }} />
        <div>
          <strong style={{ color: UI.text.primary }}>Floors</strong> &amp;{" "}
          <strong style={{ color: UI.text.primary }}>Rooms</strong> apply directly. Other sections
          run through an AI attempt — results vary.
        </div>
      </div>

      {/* Scrollable body — sections grouped by category */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "8px 10px 12px" }}>
        {GROUP_ORDER.map((group) => {
          const groupSections = SECTIONS.filter((s) => s.group === group.id);
          if (groupSections.length === 0) return null;

          return (
            <div key={group.id} style={{ marginBottom: 14 }}>
              <div
                style={{
                  fontSize: 9.5,
                  fontWeight: 700,
                  color: UI.text.tertiary,
                  textTransform: "uppercase",
                  letterSpacing: 1.2,
                  padding: "4px 4px 6px",
                }}
              >
                {group.label}
              </div>

              {groupSections.map((section) => (
                <Section
                  key={section.id}
                  section={section}
                  expanded={open[section.id]}
                  onToggle={() => toggle(section.id)}
                  working={working}
                  disabled={isBusy || !sourceFile}
                  onRunPrompt={(p) => runPrompt(p)}
                >
                  {section.id === "floors" && (
                    <InlineRow>
                      <span style={{ fontSize: 11, color: UI.text.secondary, flexShrink: 0 }}>Total:</span>
                      <NumberInput
                        min={1}
                        max={50}
                        value={floorTarget}
                        disabled={isBusy || !sourceFile}
                        onChange={setFloorTarget}
                        onSubmit={handleSetFloorCount}
                        placeholder="e.g. 3"
                      />
                      <MiniButton
                        onClick={handleSetFloorCount}
                        disabled={isBusy || !sourceFile || !floorTarget}
                        variant="accent"
                      >
                        Set
                      </MiniButton>
                    </InlineRow>
                  )}

                  {section.id === "rooms" && (
                    <InlineRow>
                      <TextInput
                        value={roomName}
                        disabled={isBusy || !sourceFile}
                        onChange={setRoomName}
                        onSubmit={handleAddNamedRoom}
                        placeholder="Room name (optional)"
                      />
                      <MiniButton
                        onClick={handleAddNamedRoom}
                        disabled={isBusy || !sourceFile}
                        variant="accent"
                      >
                        <Plus size={11} strokeWidth={2.5} /> Add
                      </MiniButton>
                    </InlineRow>
                  )}

                  {section.id === "wall_builder" && (
                    <WallBuilderForm
                      length={wallLength}
                      height={wallHeight}
                      angle={wallAngle}
                      angleCustom={wallAngleCustom}
                      color={wallColor}
                      floor={wallFloor}
                      disabled={isBusy || !sourceFile}
                      onLength={setWallLength}
                      onHeight={setWallHeight}
                      onAngle={setWallAngle}
                      onAngleCustom={setWallAngleCustom}
                      onColor={setWallColor}
                      onFloor={setWallFloor}
                      onSubmit={handleBuildWall}
                    />
                  )}

                  {section.id === "custom" && (
                    <div>
                      <textarea
                        value={customPrompt}
                        disabled={isBusy || !sourceFile}
                        onChange={(e) => setCustomPrompt(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault();
                            handleCustom();
                          }
                        }}
                        placeholder="Describe any change in plain language…"
                        rows={3}
                        style={{
                          width: "100%",
                          boxSizing: "border-box",
                          background: "rgba(7,7,13,0.6)",
                          border: "1px solid rgba(255,255,255,0.08)",
                          borderRadius: UI.radius.sm,
                          color: UI.text.primary,
                          padding: "8px 10px",
                          fontSize: 11.5,
                          lineHeight: 1.45,
                          resize: "vertical",
                          outline: "none",
                          fontFamily: "inherit",
                        }}
                      />
                      <button
                        type="button"
                        onClick={handleCustom}
                        disabled={isBusy || !sourceFile || !customPrompt.trim()}
                        style={{
                          marginTop: 6,
                          width: "100%",
                          padding: "7px 10px",
                          fontSize: 11,
                          fontWeight: 600,
                          border: "1px solid rgba(0,245,255,0.5)",
                          background: PRIMARY_GRADIENT,
                          color: "#07070D",
                          borderRadius: UI.radius.sm,
                          cursor:
                            isBusy || !sourceFile || !customPrompt.trim() ? "not-allowed" : "pointer",
                          opacity: isBusy || !sourceFile || !customPrompt.trim() ? 0.55 : 1,
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 6,
                        }}
                      >
                        {isBusy && working === customPrompt ? (
                          <>
                            <Loader2 size={12} style={{ animation: "ifc-enh-spin 0.8s linear infinite" }} /> Applying…
                          </>
                        ) : (
                          <>
                            <Sparkles size={12} /> Apply custom change
                          </>
                        )}
                      </button>
                      <div style={{ fontSize: 10, color: UI.text.tertiary, marginTop: 4 }}>
                        ⌘/Ctrl+Enter to apply
                      </div>
                    </div>
                  )}
                </Section>
              ))}
            </div>
          );
        })}
      </div>

      {/* Status footer */}
      <StatusFooter
        status={status}
        working={working}
        last={last}
        onRetry={() => last && runPrompt(last.prompt)}
        onDownload={handleDownloadLast}
        onApply={() => last?.result && onApplyToViewer(last.result)}
        onDismiss={() => {
          setStatus("idle");
          setLast(null);
        }}
      />

      <style>{`@keyframes ifc-enh-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

/* ─── Collapsible section with action grid ─── */

interface SectionProps {
  section: SectionDef;
  expanded: boolean;
  onToggle: () => void;
  working: string | null;
  disabled: boolean;
  onRunPrompt: (prompt: string) => void;
  children?: React.ReactNode;
}

function Section({ section, expanded, onToggle, working, disabled, onRunPrompt, children }: SectionProps) {
  return (
    <div
      style={{
        marginBottom: 5,
        border: "1px solid rgba(255,255,255,0.04)",
        borderRadius: UI.radius.sm,
        background: UI.bg.card,
        overflow: "hidden",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 10px",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          color: UI.text.primary,
          textAlign: "left",
        }}
      >
        <span style={{ color: section.supported ? UI.accent.cyan : UI.text.tertiary, display: "inline-flex" }}>
          {section.icon}
        </span>
        <span style={{ flex: 1, fontSize: 11.5, fontWeight: 600, letterSpacing: 0.3 }}>
          {section.title}
        </span>
        {!section.supported && (
          <span
            style={{
              fontSize: 9,
              padding: "2px 5px",
              borderRadius: 999,
              background: "rgba(255,191,0,0.1)",
              border: "1px solid rgba(255,191,0,0.25)",
              color: ACCENT_AMBER,
              letterSpacing: 0.4,
              fontWeight: 600,
            }}
          >
            AI Beta
          </span>
        )}
        <span style={{ color: UI.text.tertiary, display: "inline-flex" }}>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>

      {expanded && (
        <div style={{ padding: "0 10px 10px" }}>
          {section.actions.length > 0 && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 6,
                marginBottom: children ? 8 : 0,
              }}
            >
              {section.actions.map((action) => (
                <ActionButton
                  key={action.label}
                  action={action}
                  loading={working === action.prompt}
                  disabled={disabled}
                  supported={section.supported}
                  onClick={() => onRunPrompt(action.prompt)}
                />
              ))}
            </div>
          )}
          {children}
        </div>
      )}
    </div>
  );
}

/* ─── Individual action button ─── */

interface ActionButtonProps {
  action: ActionDef;
  loading: boolean;
  disabled: boolean;
  supported: boolean;
  onClick: () => void;
}

function ActionButton({ action, loading, disabled, supported, onClick }: ActionButtonProps) {
  const isDanger = action.tone === "danger";
  const isPrimary = action.tone === "primary";

  let borderColor: string;
  let bg: string;
  let color: string;

  if (!supported) {
    borderColor = "rgba(255,255,255,0.08)";
    bg = "rgba(255,255,255,0.02)";
    color = UI.text.secondary;
  } else if (isDanger) {
    borderColor = "rgba(248,113,113,0.3)";
    bg = "rgba(248,113,113,0.08)";
    color = ACCENT_RED;
  } else if (isPrimary) {
    borderColor = "rgba(0,245,255,0.35)";
    bg = "rgba(0,245,255,0.08)";
    color = ACCENT_CYAN;
  } else {
    borderColor = "rgba(255,255,255,0.1)";
    bg = "rgba(255,255,255,0.03)";
    color = UI.text.primary;
  }

  const isDisabled = disabled || loading;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      title={action.prompt}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        padding: "7px 6px",
        fontSize: 10.5,
        fontWeight: 600,
        border: `1px solid ${borderColor}`,
        background: bg,
        color,
        borderRadius: UI.radius.sm,
        cursor: isDisabled ? "not-allowed" : "pointer",
        opacity: isDisabled && !loading ? 0.5 : 1,
        transition: "transform 0.12s ease, background 0.12s ease, border-color 0.12s ease",
        textAlign: "center",
        lineHeight: 1.2,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
      onMouseEnter={(e) => {
        if (isDisabled) return;
        e.currentTarget.style.transform = "translateY(-1px)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
      }}
    >
      {loading ? (
        <Loader2 size={12} style={{ animation: "ifc-enh-spin 0.8s linear infinite", flexShrink: 0 }} />
      ) : (
        <span style={{ display: "inline-flex", flexShrink: 0 }}>{action.icon}</span>
      )}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{action.label}</span>
    </button>
  );
}

/* ─── Wall Builder sub-form ─── */

interface WallBuilderFormProps {
  length: string;
  height: string;
  angle: "0" | "45" | "90" | "custom";
  angleCustom: string;
  color: string;
  floor: "top" | "ground" | "all";
  disabled: boolean;
  onLength: (v: string) => void;
  onHeight: (v: string) => void;
  onAngle: (v: "0" | "45" | "90" | "custom") => void;
  onAngleCustom: (v: string) => void;
  onColor: (v: string) => void;
  onFloor: (v: "top" | "ground" | "all") => void;
  onSubmit: () => void;
}

function WallBuilderForm(p: WallBuilderFormProps) {
  return (
    <div
      style={{
        padding: 8,
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.05)",
        borderRadius: UI.radius.sm,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {/* Size row */}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <Ruler size={11} color={UI.text.tertiary} />
        <Label>Size</Label>
        <NumberInput
          value={p.length}
          onChange={p.onLength}
          onSubmit={p.onSubmit}
          disabled={p.disabled}
          placeholder="len"
          step="0.5"
          suffix="m"
        />
        <span style={{ fontSize: 11, color: UI.text.tertiary }}>×</span>
        <NumberInput
          value={p.height}
          onChange={p.onHeight}
          onSubmit={p.onSubmit}
          disabled={p.disabled}
          placeholder="ht"
          step="0.5"
          suffix="m"
        />
      </div>

      {/* Angle row */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <Compass size={11} color={UI.text.tertiary} />
        <Label>Angle</Label>
        <div style={{ display: "flex", gap: 3 }}>
          {(["0", "45", "90", "custom"] as const).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => p.onAngle(a)}
              disabled={p.disabled}
              style={{
                padding: "3px 7px",
                fontSize: 10,
                fontWeight: 600,
                border: `1px solid ${p.angle === a ? "rgba(0,245,255,0.5)" : "rgba(255,255,255,0.08)"}`,
                background: p.angle === a ? "rgba(0,245,255,0.1)" : "rgba(255,255,255,0.03)",
                color: p.angle === a ? ACCENT_CYAN : UI.text.secondary,
                borderRadius: 5,
                cursor: p.disabled ? "not-allowed" : "pointer",
              }}
            >
              {a === "custom" ? "…" : `${a}°`}
            </button>
          ))}
        </div>
        {p.angle === "custom" && (
          <NumberInput
            value={p.angleCustom}
            onChange={p.onAngleCustom}
            onSubmit={p.onSubmit}
            disabled={p.disabled}
            placeholder="deg"
            suffix="°"
          />
        )}
      </div>

      {/* Color row */}
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <Palette size={11} color={UI.text.tertiary} />
        <Label>Color</Label>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {COLOR_SWATCHES.map((c) => (
            <button
              key={c.name}
              type="button"
              onClick={() => p.onColor(c.name)}
              disabled={p.disabled}
              title={c.name}
              aria-label={c.name}
              style={{
                width: 18,
                height: 18,
                borderRadius: 4,
                border: p.color === c.name
                  ? `2px solid ${ACCENT_CYAN}`
                  : "1px solid rgba(255,255,255,0.2)",
                background: c.hex,
                cursor: p.disabled ? "not-allowed" : "pointer",
                padding: 0,
              }}
            />
          ))}
        </div>
      </div>

      {/* Floor row */}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <Layers size={11} color={UI.text.tertiary} />
        <Label>On</Label>
        <div style={{ display: "flex", gap: 3 }}>
          {(["top", "ground", "all"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => p.onFloor(f)}
              disabled={p.disabled}
              style={{
                padding: "3px 8px",
                fontSize: 10,
                fontWeight: 600,
                textTransform: "capitalize",
                border: `1px solid ${p.floor === f ? "rgba(0,245,255,0.5)" : "rgba(255,255,255,0.08)"}`,
                background: p.floor === f ? "rgba(0,245,255,0.1)" : "rgba(255,255,255,0.03)",
                color: p.floor === f ? ACCENT_CYAN : UI.text.secondary,
                borderRadius: 5,
                cursor: p.disabled ? "not-allowed" : "pointer",
              }}
            >
              {f === "all" ? "each" : f} {f !== "all" && "floor"}
            </button>
          ))}
        </div>
      </div>

      {/* Submit */}
      <button
        type="button"
        onClick={p.onSubmit}
        disabled={p.disabled}
        style={{
          marginTop: 2,
          padding: "7px 10px",
          fontSize: 11,
          fontWeight: 600,
          border: "1px solid rgba(0,245,255,0.5)",
          background: PRIMARY_GRADIENT,
          color: "#07070D",
          borderRadius: UI.radius.sm,
          cursor: p.disabled ? "not-allowed" : "pointer",
          opacity: p.disabled ? 0.55 : 1,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
        }}
      >
        <Sparkles size={12} /> Build Wall
      </button>
    </div>
  );
}

/* ─── Small form primitives ─── */

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        color: UI.text.tertiary,
        textTransform: "uppercase",
        letterSpacing: 0.6,
        minWidth: 36,
      }}
    >
      {children}
    </span>
  );
}

function InlineRow({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        alignItems: "center",
        padding: 8,
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.05)",
        borderRadius: UI.radius.sm,
      }}
    >
      {children}
    </div>
  );
}

interface NumberInputProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  disabled?: boolean;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: string;
  suffix?: string;
}

function NumberInput({ value, onChange, onSubmit, disabled, placeholder, min, max, step, suffix }: NumberInputProps) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        position: "relative",
        display: "flex",
        alignItems: "center",
      }}
    >
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && onSubmit) {
            e.preventDefault();
            onSubmit();
          }
        }}
        placeholder={placeholder}
        style={{
          width: "100%",
          boxSizing: "border-box",
          background: "rgba(7,7,13,0.6)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 5,
          color: UI.text.primary,
          padding: suffix ? "4px 20px 4px 7px" : "4px 7px",
          fontSize: 11,
          outline: "none",
          fontFamily: "inherit",
        }}
      />
      {suffix && (
        <span
          style={{
            position: "absolute",
            right: 6,
            fontSize: 10,
            color: UI.text.tertiary,
            pointerEvents: "none",
          }}
        >
          {suffix}
        </span>
      )}
    </div>
  );
}

interface TextInputProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit?: () => void;
  disabled?: boolean;
  placeholder?: string;
}

function TextInput({ value, onChange, onSubmit, disabled, placeholder }: TextInputProps) {
  return (
    <input
      type="text"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && onSubmit) {
          e.preventDefault();
          onSubmit();
        }
      }}
      placeholder={placeholder}
      style={{
        flex: 1,
        minWidth: 0,
        background: "rgba(7,7,13,0.6)",
        border: "1px solid rgba(255,255,255,0.08)",
        borderRadius: 5,
        color: UI.text.primary,
        padding: "5px 8px",
        fontSize: 11.5,
        outline: "none",
        fontFamily: "inherit",
      }}
    />
  );
}

interface MiniButtonProps {
  onClick: () => void;
  disabled?: boolean;
  variant?: "accent" | "neutral";
  children: React.ReactNode;
}

function MiniButton({ onClick, disabled, variant = "accent", children }: MiniButtonProps) {
  const isAccent = variant === "accent";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "5px 10px",
        fontSize: 10.5,
        fontWeight: 600,
        border: `1px solid ${isAccent ? "rgba(79,138,255,0.35)" : "rgba(255,255,255,0.1)"}`,
        background: isAccent ? "rgba(79,138,255,0.12)" : "rgba(255,255,255,0.04)",
        color: isAccent ? ACCENT_BLUE : UI.text.primary,
        borderRadius: 6,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

/* ─── Status footer (sticky bottom strip) ─── */

interface StatusFooterProps {
  status: Status;
  working: string | null;
  last: LastResult | null;
  onRetry: () => void;
  onDownload: () => void;
  onApply: () => void;
  onDismiss: () => void;
}

function StatusFooter({ status, working, last, onRetry, onDownload, onApply, onDismiss }: StatusFooterProps) {
  if (status === "idle" && !last) {
    return (
      <div
        style={{
          padding: "8px 12px",
          borderTop: "1px solid rgba(255,255,255,0.04)",
          background: UI.bg.base,
          fontSize: 10.5,
          color: UI.text.tertiary,
          flexShrink: 0,
        }}
      >
        Pick an action above. Supported changes apply to the 3D viewer instantly.
      </div>
    );
  }

  if (status === "working") {
    return (
      <div
        style={{
          padding: "10px 12px",
          borderTop: "1px solid rgba(255,255,255,0.04)",
          background: "rgba(79,138,255,0.05)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexShrink: 0,
        }}
      >
        <Loader2 size={13} color={ACCENT_BLUE} style={{ animation: "ifc-enh-spin 0.8s linear infinite" }} />
        <div
          style={{
            fontSize: 11,
            color: UI.text.primary,
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          Applying: {working}
        </div>
      </div>
    );
  }

  if (status === "success" && last?.result) {
    const changed = last.result.stats.modifiedBytes !== last.result.stats.originalBytes;
    return (
      <div
        style={{
          padding: "10px 12px",
          borderTop: "1px solid rgba(52,211,153,0.2)",
          background: "rgba(52,211,153,0.06)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <CheckCircle2 size={14} color={UI.accent.green} style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: UI.text.primary }}>
              Applied · {last.prompt}
            </div>
            {last.result.understood && (
              <div style={{ fontSize: 10.5, color: UI.text.secondary, marginTop: 2, lineHeight: 1.4 }}>
                {last.result.understood}
              </div>
            )}
            <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              {changed && (
                <button
                  type="button"
                  onClick={onDownload}
                  style={{
                    padding: "4px 8px",
                    fontSize: 10,
                    fontWeight: 500,
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: "rgba(255,255,255,0.04)",
                    color: UI.text.primary,
                    borderRadius: 6,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <Download size={10} /> Download
                </button>
              )}
              <button
                type="button"
                onClick={onDismiss}
                style={{
                  padding: "4px 8px",
                  fontSize: 10,
                  fontWeight: 500,
                  border: "1px solid rgba(255,255,255,0.1)",
                  background: "transparent",
                  color: UI.text.tertiary,
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (status === "error" && last) {
    const canRecover = last.result?.results.some((r) => r.ok);
    const isUnsupported =
      last.result?.results.length === 0 &&
      (last.errorMessage.toLowerCase().includes("couldn't interpret") ||
        last.errorMessage.toLowerCase().includes("could not interpret"));
    return (
      <div
        style={{
          padding: "10px 12px",
          borderTop: "1px solid rgba(248,113,113,0.2)",
          background: "rgba(248,113,113,0.06)",
          flexShrink: 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <AlertTriangle size={14} color={ACCENT_RED} style={{ flexShrink: 0, marginTop: 1 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: UI.text.primary }}>
              {last.prompt}
            </div>
            <div style={{ fontSize: 10.5, color: "#FCA5A5", marginTop: 2, lineHeight: 1.4, whiteSpace: "pre-wrap" }}>
              {isUnsupported
                ? "This operation isn't supported by the IFC engine yet. Only floor and room operations are currently implemented."
                : last.errorMessage}
            </div>
            {last.result?.notes && (
              <div style={{ fontSize: 10, color: UI.text.tertiary, marginTop: 3, lineHeight: 1.4 }}>
                Note: {last.result.notes}
              </div>
            )}
            <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
              {!isUnsupported && (
                <button
                  type="button"
                  onClick={onRetry}
                  style={{
                    padding: "4px 8px",
                    fontSize: 10,
                    fontWeight: 500,
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: "rgba(255,255,255,0.04)",
                    color: UI.text.primary,
                    borderRadius: 6,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <RotateCcw size={10} /> Retry
                </button>
              )}
              {canRecover && last.result && (
                <button
                  type="button"
                  onClick={onApply}
                  style={{
                    padding: "4px 8px",
                    fontSize: 10,
                    fontWeight: 500,
                    border: "1px solid rgba(0,245,255,0.3)",
                    background: "rgba(0,245,255,0.08)",
                    color: ACCENT_CYAN,
                    borderRadius: 6,
                    cursor: "pointer",
                  }}
                >
                  Apply partial
                </button>
              )}
              <button
                type="button"
                onClick={onDismiss}
                style={{
                  padding: "4px 8px",
                  fontSize: 10,
                  fontWeight: 500,
                  border: "1px solid rgba(255,255,255,0.1)",
                  background: "transparent",
                  color: UI.text.tertiary,
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
