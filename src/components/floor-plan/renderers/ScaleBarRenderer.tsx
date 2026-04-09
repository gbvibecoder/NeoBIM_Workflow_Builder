"use client";

import React, { useMemo } from "react";
import { Group, Rect, Line as KLine, Text } from "react-konva";
import type { Viewport } from "@/features/floor-plan/lib/geometry";
import type { DisplayUnit } from "@/lib/floor-plan/unit-conversion";
import { formatDimension } from "@/lib/floor-plan/unit-conversion";

interface ScaleBarRendererProps {
  viewport: Viewport;
  displayUnit: DisplayUnit;
}

/**
 * Screen-fixed scale bar — bottom-left of canvas.
 * Adapts segment count and labels to current zoom level.
 * Standard bar-and-gap architectural style.
 */
function ScaleBarRendererBase({ viewport, displayUnit }: ScaleBarRendererProps) {
  const bar = useMemo(() => {
    // Determine a "nice" scale bar length in world units (mm)
    // Target: scale bar should be ~200px on screen
    const targetScreenWidth = 180;
    const zoom = viewport.zoom || 1;
    const worldWidth = targetScreenWidth / zoom; // mm

    // Pick the nearest "nice" interval in mm
    const niceIntervals = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
    let interval = niceIntervals[0];
    for (const n of niceIntervals) {
      if (n <= worldWidth) interval = n;
      else break;
    }

    // How many segments fit nicely
    const numSegments = Math.min(5, Math.max(2, Math.floor(worldWidth / interval)));
    const totalWorld = interval * numSegments;
    const totalScreen = totalWorld * viewport.zoom;
    const segmentScreen = interval * viewport.zoom;

    // Position: bottom-left corner, 24px from edges
    const x0 = 24;
    const y0 = viewport.canvasHeight - 36;
    const barHeight = 6;

    // Build segments
    const segments: Array<{
      x: number;
      y: number;
      w: number;
      h: number;
      filled: boolean;
      label: string;
      labelX: number;
    }> = [];

    for (let i = 0; i < numSegments; i++) {
      segments.push({
        x: x0 + i * segmentScreen,
        y: y0,
        w: segmentScreen,
        h: barHeight,
        filled: i % 2 === 0, // alternating black and white
        label: formatDimension(interval * (i + 1), displayUnit),
        labelX: x0 + (i + 1) * segmentScreen,
      });
    }

    return { segments, x0, y0, barHeight, totalScreen, totalWorld };
  }, [viewport.zoom, viewport.canvasWidth, viewport.canvasHeight, displayUnit]);

  return (
    <Group listening={false}>
      {/* Background for readability */}
      <Rect
        x={bar.x0 - 4}
        y={bar.y0 - 16}
        width={bar.totalScreen + 8}
        height={bar.barHeight + 28}
        fill="rgba(255,255,255,0.85)"
        cornerRadius={3}
      />

      {/* "0" label at start */}
      <Text
        x={bar.x0}
        y={bar.y0 - 14}
        text="0"
        fontSize={9}
        fontFamily="Inter, system-ui, sans-serif"
        fill="#333333"
        align="center"
        width={20}
        offsetX={10}
      />

      {/* Segments */}
      {bar.segments.map((seg, i) => (
        <React.Fragment key={`scalebar-${i}`}>
          {/* Filled or outline segment */}
          <Rect
            x={seg.x}
            y={seg.y}
            width={seg.w}
            height={seg.h}
            fill={seg.filled ? "#1A1A1A" : "#FFFFFF"}
            stroke="#1A1A1A"
            strokeWidth={1}
          />
          {/* Segment end label */}
          <Text
            x={seg.labelX}
            y={seg.y - 14}
            text={seg.label}
            fontSize={9}
            fontFamily="Inter, system-ui, sans-serif"
            fill="#333333"
            align="center"
            width={60}
            offsetX={30}
          />
        </React.Fragment>
      ))}

      {/* Bottom border line (thick) */}
      <KLine
        points={[bar.x0, bar.y0 + bar.barHeight + 1, bar.x0 + bar.totalScreen, bar.y0 + bar.barHeight + 1]}
        stroke="#1A1A1A"
        strokeWidth={1.5}
      />
    </Group>
  );
}

export const ScaleBarRenderer = React.memo(ScaleBarRendererBase);
