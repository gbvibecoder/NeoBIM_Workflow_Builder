"use client";

/* ─── Panorama feature — Enhance-tab picker section ────────────────────────
   V2 model: this component is a *controlled picker*. It does NOT own state,
   does NOT call apply/reset, does NOT have its own enable toggle. Selection
   bubbles up to the parent panel via `onSelectionChange`; the parent's
   global Apply Enhancement / Reset buttons drive the actual lifecycle.

   What stays here: the auto-detected type chip (with reasoning tooltip),
   the building-type override dropdown, the asset thumbnail picker, the
   Tier 2 conflict warning + "Keep ground anyway" override, and a tiny
   status row. */

import React, { useCallback, useMemo } from "react";
import { Globe, RefreshCw, Sparkles, TriangleAlert } from "lucide-react";
import { UI } from "@/features/ifc/components/constants";
import {
  PANORAMA_BUCKETS,
  PANORAMA_BUCKET_LABELS,
  PANORAMA_MANIFEST,
  type PanoramaAsset,
  type PanoramaBucket,
  panoramaUrlFor,
} from "@/features/panorama/constants";
import { resolveBuildingType } from "@/features/panorama/lib/type-resolver";
import type { ParseResultLike } from "@/features/panorama/types";

interface Props {
  /** Currently staged (selected) asset. `null` = no panorama; Apply
   *  Enhancement will skip the panorama step. */
  selectedAsset: PanoramaAsset | null;
  /** Fires whenever the user picks a new asset, switches bucket, or clicks
   *  a thumbnail. The parent stages this; nothing applies until the parent's
   *  global Apply Enhancement runs. */
  onSelectionChange: (asset: PanoramaAsset | null) => void;
  /** Optional parse-result projection — feeds `resolveBuildingType` for the
   *  detected-type chip. */
  parseResult?: ParseResultLike | null;
  /** True when the parent's Tier 2 ground toggle is on. Used to show the
   *  preemptive conflict warning when an asset is staged AND Tier 2 ground
   *  is on. The actual conflict resolution happens in the parent's
   *  orchestration; this is the UI surface for it. */
  tier2GroundEnabled: boolean;
  /** True when the user clicked "Keep ground anyway" — flips the warning
   *  copy and changes orchestration behaviour at apply time. */
  keepTier2Override: boolean;
  /** Toggle for the keep-tier2 override. Flips the parent's flag. */
  onToggleKeepTier2: () => void;
  /** Last-applied slug from the most recent apply (status footer). May be
   *  null if panorama has never been applied this session. */
  lastAppliedSlug: string | null;
  /** Master enable for the section UI (mirrors `hasModel` from the panel
   *  + any global panel-disabled state). */
  disabled: boolean;
}

const ACCENT_CYAN = "#00F5FF";
const ACCENT_AMBER = "#FFBF00";

export function PanoramaSection({
  selectedAsset,
  onSelectionChange,
  parseResult,
  tier2GroundEnabled,
  keepTier2Override,
  onToggleKeepTier2,
  lastAppliedSlug,
  disabled,
}: Props) {
  const detection = useMemo(
    () => resolveBuildingType(parseResult ?? null),
    [parseResult],
  );

  /* The active bucket is whichever bucket the staged asset belongs to. If
     no asset is staged, fall through to detection. The dropdown override
     is implemented by changing `selectedAsset` (parent picks a new asset
     in that bucket and fires `onSelectionChange`). */
  const activeBucket: PanoramaBucket = selectedAsset?.bucket ?? detection.bucket;
  const assetsInBucket = PANORAMA_MANIFEST[activeBucket];

  const handleBucketChange = useCallback(
    (bucket: PanoramaBucket) => {
      const first = PANORAMA_MANIFEST[bucket][0] ?? null;
      onSelectionChange(first);
    },
    [onSelectionChange],
  );

  const handleClear = useCallback(() => {
    onSelectionChange(null);
  }, [onSelectionChange]);

  const conflictActive = selectedAsset !== null && tier2GroundEnabled;

  return (
    <div style={{ padding: "0 0 6px" }}>
      {/* Detected type chip + clear-staging affordance */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 10px 8px",
        }}
      >
        <div
          title={detection.reasoning}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "3px 8px",
            fontSize: 10.5,
            fontWeight: 600,
            color: UI.text.secondary,
            background: "rgba(79,138,255,0.06)",
            border: "1px solid rgba(79,138,255,0.18)",
            borderRadius: 999,
          }}
        >
          <Sparkles size={11} color={ACCENT_CYAN} />
          <span>
            Detected: {PANORAMA_BUCKET_LABELS[detection.bucket]}
            <span style={{ color: UI.text.tertiary, marginLeft: 4 }}>
              ({detection.source})
            </span>
          </span>
        </div>
        {selectedAsset && (
          <button
            type="button"
            onClick={handleClear}
            disabled={disabled}
            title="Clear panorama selection — Apply will skip the 360° step."
            style={{
              padding: "3px 7px",
              fontSize: 10,
              fontWeight: 600,
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.04)",
              color: UI.text.tertiary,
              borderRadius: 5,
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Building type dropdown */}
      <div
        style={{
          display: "flex",
          gap: 6,
          alignItems: "center",
          padding: "0 10px 8px",
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: UI.text.tertiary,
            textTransform: "uppercase",
            letterSpacing: 0.6,
          }}
        >
          Type
        </span>
        <select
          value={activeBucket}
          onChange={(e) => handleBucketChange(e.target.value as PanoramaBucket)}
          disabled={disabled}
          style={{
            flex: 1,
            background: "rgba(7,7,13,0.6)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: UI.radius.sm,
            color: UI.text.primary,
            padding: "5px 7px",
            fontSize: 11,
            outline: "none",
            fontFamily: "inherit",
          }}
        >
          {PANORAMA_BUCKETS.map((b) => (
            <option key={b} value={b}>
              {PANORAMA_BUCKET_LABELS[b]}
            </option>
          ))}
        </select>
        {selectedAsset && selectedAsset.bucket !== detection.bucket && (
          <button
            type="button"
            onClick={() => handleBucketChange(detection.bucket)}
            title="Reset to detected type"
            disabled={disabled}
            style={{
              padding: "4px 6px",
              fontSize: 10,
              border: "1px solid rgba(255,255,255,0.1)",
              background: "rgba(255,255,255,0.04)",
              color: UI.text.secondary,
              borderRadius: 5,
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            <RefreshCw size={10} />
          </button>
        )}
      </div>

      {/* Asset thumbnail picker — horizontal scroll */}
      <div
        style={{
          display: "flex",
          gap: 6,
          overflowX: "auto",
          padding: "0 10px 8px",
        }}
      >
        {assetsInBucket.length === 0 && (
          <div style={{ fontSize: 10, color: UI.text.tertiary, padding: "4px 0" }}>
            No panoramas in this bucket yet — drop a JPG into <code>public/panoramas/{activeBucket}/</code> and add it to the manifest.
          </div>
        )}
        {assetsInBucket.map((asset) => {
          const isSelected = selectedAsset?.slug === asset.slug;
          return (
            <button
              key={asset.slug}
              type="button"
              disabled={disabled}
              onClick={() => onSelectionChange(asset)}
              title={`${asset.displayName} — ${asset.attribution ?? asset.source}`}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
                padding: 4,
                width: 96,
                flexShrink: 0,
                background: isSelected ? "rgba(0,245,255,0.06)" : "rgba(255,255,255,0.02)",
                border: `1px solid ${isSelected ? ACCENT_CYAN : "rgba(255,255,255,0.08)"}`,
                borderRadius: UI.radius.sm,
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.55 : 1,
              }}
            >
              <div
                style={{
                  width: 88,
                  height: 44,
                  borderRadius: 4,
                  backgroundImage: `url(${asset.thumbnail ?? panoramaUrlFor(asset)})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                  border: "1px solid rgba(255,255,255,0.04)",
                }}
              />
              <span
                style={{
                  fontSize: 9.5,
                  color: isSelected ? ACCENT_CYAN : UI.text.secondary,
                  fontWeight: 600,
                  textAlign: "center",
                  lineHeight: 1.2,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  width: "100%",
                }}
              >
                {asset.displayName}
              </span>
            </button>
          );
        })}
      </div>

      {/* Tier 2 conflict warning — preemptive (shown before Apply runs).
          The parent's orchestration uses `keepTier2Override` to decide
          whether to skip Tier 2 in the apply pipeline. */}
      {conflictActive && (
        <div
          style={{
            margin: "0 10px 6px",
            display: "flex",
            alignItems: "flex-start",
            gap: 6,
            padding: "6px 8px",
            background: keepTier2Override
              ? "rgba(52,211,153,0.06)"
              : "rgba(255,191,0,0.08)",
            border: `1px solid ${keepTier2Override ? "rgba(52,211,153,0.25)" : "rgba(255,191,0,0.25)"}`,
            borderRadius: UI.radius.sm,
            fontSize: 10.5,
            color: UI.text.secondary,
            lineHeight: 1.4,
          }}
        >
          <TriangleAlert
            size={12}
            color={keepTier2Override ? UI.accent.green : ACCENT_AMBER}
            style={{ flexShrink: 0, marginTop: 2 }}
          />
          <div style={{ flex: 1 }}>
            {keepTier2Override
              ? "Ground plane will mount on top of the panorama. May visually clash."
              : "Ground plane will be skipped on Apply — a real-world panorama already includes ground."}
            <button
              type="button"
              onClick={onToggleKeepTier2}
              disabled={disabled}
              style={{
                marginLeft: 6,
                background: "transparent",
                border: "none",
                color: ACCENT_CYAN,
                cursor: disabled ? "not-allowed" : "pointer",
                fontSize: 10.5,
                textDecoration: "underline",
                padding: 0,
              }}
            >
              {keepTier2Override ? "Skip ground" : "Keep ground anyway"}
            </button>
          </div>
        </div>
      )}

      {/* Status row */}
      <div
        style={{
          padding: "0 10px 4px",
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 9.5,
          color: UI.text.tertiary,
        }}
      >
        <Globe size={10} color={UI.text.tertiary} />
        <span>
          {selectedAsset
            ? `Staged: ${selectedAsset.displayName}`
            : "No panorama selected — Apply will leave the blueprint background."}
        </span>
        {lastAppliedSlug && lastAppliedSlug !== selectedAsset?.slug && (
          <span style={{ marginLeft: "auto", color: UI.text.tertiary }}>
            Last applied: {lastAppliedSlug}
          </span>
        )}
      </div>
    </div>
  );
}
