/**
 * Z.CANVAS.2B Phase 6 — Smart alignment guides hook.
 * Computes guide lines when a node is being dragged near aligned positions.
 * Returns guides array + an onNodeDrag handler for ReactFlow.
 */

import React, { useState, useCallback, useRef } from "react";
import type { Node } from "@xyflow/react";
import type { GuideLine } from "@/features/canvas/components/chrome/AlignmentGuides";

const TOLERANCE = 4; // alignment tolerance in px
const SNAP_ZONE = 8; // snap-to-alignment zone

interface NodeBox {
  id: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  cx: number;
  cy: number;
}

function nodeBox(n: Node): NodeBox {
  const w = (n.measured?.width ?? n.width ?? 200);
  const h = (n.measured?.height ?? n.height ?? 80);
  return {
    id: n.id,
    left: n.position.x,
    top: n.position.y,
    right: n.position.x + w,
    bottom: n.position.y + h,
    cx: n.position.x + w / 2,
    cy: n.position.y + h / 2,
  };
}

export function useSmartGuides() {
  const [guides, setGuides] = useState<GuideLine[]>([]);
  const rafRef = useRef<number>(0);

  const onNodeDrag = useCallback(
    (_event: React.MouseEvent, dragNode: Node, allNodes: Node[]) => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const drag = nodeBox(dragNode);
        const others = allNodes
          .filter((n) => n.id !== dragNode.id)
          .map(nodeBox);

        if (others.length === 0) {
          setGuides([]);
          return;
        }

        const newGuides: GuideLine[] = [];
        const minY = Math.min(drag.top, ...others.map((o) => o.top)) - 40;
        const maxY = Math.max(drag.bottom, ...others.map((o) => o.bottom)) + 40;
        const minX = Math.min(drag.left, ...others.map((o) => o.left)) - 40;
        const maxX = Math.max(drag.right, ...others.map((o) => o.right)) + 40;

        for (const other of others) {
          // Vertical alignments (x-axis)
          const vChecks = [
            { a: drag.left, b: other.left },
            { a: drag.right, b: other.right },
            { a: drag.cx, b: other.cx },
            { a: drag.left, b: other.right },
            { a: drag.right, b: other.left },
          ];
          for (const { a, b } of vChecks) {
            if (Math.abs(a - b) <= TOLERANCE) {
              newGuides.push({ type: "vertical", position: b, from: minY, to: maxY });
            }
          }

          // Horizontal alignments (y-axis)
          const hChecks = [
            { a: drag.top, b: other.top },
            { a: drag.bottom, b: other.bottom },
            { a: drag.cy, b: other.cy },
            { a: drag.top, b: other.bottom },
            { a: drag.bottom, b: other.top },
          ];
          for (const { a, b } of hChecks) {
            if (Math.abs(a - b) <= TOLERANCE) {
              newGuides.push({ type: "horizontal", position: b, from: minX, to: maxX });
            }
          }
        }

        // Deduplicate guides by type+position
        const seen = new Set<string>();
        const deduped = newGuides.filter((g) => {
          const key = `${g.type}-${Math.round(g.position)}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        setGuides(deduped);
      });
    },
    []
  );

  const onNodeDragStop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    setGuides([]);
  }, []);

  return { guides, onNodeDrag, onNodeDragStop };
}
