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
import { RefreshCw, TriangleAlert } from "lucide-react";
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

/* ACCENT_AMBER kept for the tier-2 conflict pill (only visible call site
   left after the compression pass). ACCENT_CYAN was used by the dropped
   "Detected" chip + thumbnail border (now uses RS tokens), so removed. */
const ACCENT_AMBER = "var(--rs-amber-mark)";

export function PanoramaSection({
  selectedAsset,
  onSelectionChange,
  parseResult,
  tier2GroundEnabled,
  keepTier2Override,
  onToggleKeepTier2,
  /* lastAppliedSlug — prop kept on the interface for backwards-compat
     with the parent's call site, but no longer rendered (the "Staged: …"
     status row was dropped in the compression pass). */
  lastAppliedSlug: _lastAppliedSlug,
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
    <div style={{ padding: "2px 8px 6px" }}>
      {/* Compressed redesign — Phase Z.IFC.2 follow-up 2026-05-19.
          Drops the duplicate detected chip (already shown in ApplyHero
          at the top of the panel). Drops the bulky "Type" label + dark
          dropdown — replaced with a tight RS-themed select sitting
          flush left. Drops the "Staged: X" status row (the highlighted
          thumbnail already conveys what's staged). Tier-2 warning
          becomes a tiny inline note instead of a full amber wall. */}

      {/* Type select + clear-staging — single tight row */}
      <div
        style={{
          display: "flex",
          gap: 6,
          alignItems: "center",
          padding: "2px 2px 8px",
        }}
      >
        <select
          value={activeBucket}
          onChange={(e) => handleBucketChange(e.target.value as PanoramaBucket)}
          disabled={disabled}
          style={{
            flex: 1,
            height: 28,
            background: UI.bg.cream,
            border: `1px solid ${UI.border.subtle}`,
            borderRadius: UI.radius.sm,
            color: UI.text.primary,
            padding: "0 8px",
            fontSize: 11,
            outline: "none",
            fontFamily: UI.font.body,
            cursor: disabled ? "not-allowed" : "pointer",
            appearance: "auto",
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
            title={`Reset to detected: ${PANORAMA_BUCKET_LABELS[detection.bucket]}`}
            disabled={disabled}
            style={{
              height: 28,
              width: 28,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              border: `1px solid ${UI.border.subtle}`,
              background: UI.bg.cream,
              color: UI.text.secondary,
              borderRadius: UI.radius.sm,
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            <RefreshCw size={11} />
          </button>
        )}
        {selectedAsset && (
          <button
            type="button"
            onClick={handleClear}
            disabled={disabled}
            title="Clear panorama selection — Apply will skip the 360° step."
            style={{
              height: 28,
              padding: "0 10px",
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: 0.4,
              textTransform: "uppercase",
              fontFamily: UI.font.mono,
              border: `1px solid ${UI.border.subtle}`,
              background: UI.bg.cream,
              color: UI.text.secondary,
              borderRadius: UI.radius.sm,
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Asset thumbnail strip — horizontal scroll, compact 80px tiles */}
      <div
        style={{
          display: "flex",
          gap: 6,
          overflowX: "auto",
          padding: "0 2px 4px",
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
                alignItems: "stretch",
                gap: 4,
                padding: 3,
                width: 80,
                flexShrink: 0,
                background: isSelected ? "var(--rs-blueprint-soft)" : UI.bg.paper,
                border: `1px solid ${isSelected ? "var(--rs-blueprint)" : UI.border.subtle}`,
                borderRadius: UI.radius.sm,
                cursor: disabled ? "not-allowed" : "pointer",
                opacity: disabled ? 0.55 : 1,
              }}
            >
              <div
                style={{
                  width: "100%",
                  height: 40,
                  borderRadius: 3,
                  backgroundImage: `url(${asset.thumbnail ?? panoramaUrlFor(asset)})`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                }}
              />
              <span
                style={{
                  fontSize: 9,
                  color: isSelected ? "var(--rs-blueprint)" : UI.text.secondary,
                  fontWeight: 600,
                  textAlign: "center",
                  lineHeight: 1.2,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {asset.displayName}
              </span>
            </button>
          );
        })}
      </div>

      {/* Tier-2 conflict — tiny inline note instead of full amber wall */}
      {conflictActive && (
        <button
          type="button"
          onClick={onToggleKeepTier2}
          disabled={disabled}
          title={
            keepTier2Override
              ? "Click to skip ground (recommended)."
              : "Click to keep the ground plane anyway."
          }
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            margin: "6px 0 0",
            padding: "3px 8px",
            fontSize: 10,
            color: keepTier2Override ? UI.accent.sage : ACCENT_AMBER,
            background: keepTier2Override ? "var(--rs-sage-soft)" : "var(--rs-amber-soft)",
            border: `1px solid ${keepTier2Override ? UI.accent.sage : ACCENT_AMBER}`,
            borderRadius: 999,
            cursor: disabled ? "not-allowed" : "pointer",
            fontFamily: UI.font.mono,
            fontWeight: 600,
            letterSpacing: 0.3,
            textTransform: "uppercase",
          }}
        >
          <TriangleAlert size={10} />
          {keepTier2Override ? "Ground kept" : "Ground skipped"}
        </button>
      )}
    </div>
  );
}
