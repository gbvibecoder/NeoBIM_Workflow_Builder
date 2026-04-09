"use client";

import React from "react";
import { Group, Text, Line as KLine, Circle } from "react-konva";
import type { Annotation, Point } from "@/types/floor-plan-cad";
import type { Viewport } from "@/features/floor-plan/lib/geometry";
import { worldToScreen } from "@/features/floor-plan/lib/geometry";
import { lw } from "@/features/floor-plan/lib/line-weights";

interface AnnotationRendererProps {
  annotations: Annotation[];
  viewport: Viewport;
  selectedIds: string[];
}

function AnnotationRendererBase({ annotations, viewport, selectedIds }: AnnotationRendererProps) {
  return (
    <>
      {annotations.map((ann) => (
        <AnnotationItem
          key={ann.id}
          annotation={ann}
          viewport={viewport}
          isSelected={selectedIds.includes(ann.id)}
        />
      ))}
    </>
  );
}

function AnnotationItem({
  annotation,
  viewport,
  isSelected,
}: {
  annotation: Annotation;
  viewport: Viewport;
  isSelected: boolean;
}) {
  const screen = worldToScreen(annotation.position, viewport);
  const fontSize = Math.max(9, annotation.font_size_mm * viewport.zoom);
  const color = isSelected ? "#3B82F6" : "#333333";

  return (
    <Group>
      {/* Leader line if present */}
      {annotation.leader_line && annotation.leader_line.length >= 1 && (() => {
        const leaderPoints: number[] = [screen.x, screen.y];
        for (const pt of annotation.leader_line) {
          const s = worldToScreen(pt, viewport);
          leaderPoints.push(s.x, s.y);
        }
        const lastPt = annotation.leader_line[annotation.leader_line.length - 1];
        const lastScreen = worldToScreen(lastPt, viewport);
        return (
          <>
            <KLine
              points={leaderPoints}
              stroke={color}
              strokeWidth={lw("dim-line", viewport.zoom)}
              listening={false}
            />
            {/* Arrow dot at leader target */}
            <Circle
              x={lastScreen.x}
              y={lastScreen.y}
              radius={2.5}
              fill={color}
              listening={false}
            />
          </>
        );
      })()}

      {/* Selection highlight */}
      {isSelected && (
        <KLine
          points={[screen.x - 2, screen.y + 2, screen.x + fontSize * 4, screen.y + 2]}
          stroke="#3B82F6"
          strokeWidth={1.5}
          opacity={0.5}
          listening={false}
        />
      )}

      {/* Text */}
      <Text
        x={screen.x}
        y={screen.y - fontSize}
        text={annotation.text}
        fontSize={fontSize}
        fontFamily="Inter, system-ui, sans-serif"
        fill={color}
        fontStyle={annotation.type === "callout" ? "bold" : "normal"}
        rotation={-annotation.rotation_deg}
        listening={false}
      />
    </Group>
  );
}

export const AnnotationRenderer = React.memo(AnnotationRendererBase);
