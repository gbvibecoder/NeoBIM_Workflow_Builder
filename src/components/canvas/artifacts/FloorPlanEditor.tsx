"use client";

import { useState, useCallback, useRef, useMemo } from "react";
import type { FloorPlanGeometry, FloorPlanRoom, FloorPlanRoomType } from "@/types/floor-plan";

// ─── Constants ─────────────────────────────────────────────────────────────

const CYAN = "#00F5FF";
const BG = "#12121E";
const PANEL_BG = "#1A1A2E";
const BORDER = "rgba(255,255,255,0.08)";
const TEXT = "#F0F0F5";
const TEXT_DIM = "#8888A0";
const TEXT_MUTED = "#5C5C78";

const ROOM_COLORS: Record<FloorPlanRoomType, string> = {
  living: "rgba(176,128,80,0.35)",
  bedroom: "rgba(155,123,85,0.35)",
  kitchen: "rgba(204,204,204,0.35)",
  dining: "rgba(176,128,80,0.35)",
  bathroom: "rgba(187,187,204,0.35)",
  veranda: "rgba(153,153,153,0.35)",
  hallway: "rgba(170,154,128,0.35)",
  storage: "rgba(136,136,136,0.35)",
  office: "rgba(160,144,112,0.35)",
  balcony: "rgba(120,170,120,0.35)",
  patio: "rgba(120,170,120,0.35)",
  entrance: "rgba(170,160,140,0.35)",
  utility: "rgba(140,140,140,0.35)",
  closet: "rgba(130,130,130,0.35)",
  passage: "rgba(160,150,130,0.35)",
  studio: "rgba(176,128,80,0.35)",
  staircase: "rgba(160,140,100,0.35)",
  other: "rgba(187,187,187,0.35)",
};

const ROOM_TYPES: FloorPlanRoomType[] = [
  "living", "bedroom", "kitchen", "dining", "bathroom",
  "veranda", "hallway", "storage", "office", "balcony",
  "patio", "entrance", "studio", "staircase", "other",
];

// ─── Types ─────────────────────────────────────────────────────────────────

interface EditorRoom extends FloorPlanRoom {
  id: string;
}

interface FloorPlanEditorProps {
  geometry: FloorPlanGeometry;
  sourceImageUrl: string;
  onGenerate3D: (updatedGeometry: FloorPlanGeometry) => void;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function computeCentroid(polygon: [number, number][]): [number, number] {
  let sx = 0, sy = 0;
  for (const [x, y] of polygon) { sx += x; sy += y; }
  return [sx / polygon.length, sy / polygon.length];
}

function polyBounds(polygon: [number, number][]): { w: number; h: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of polygon) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { w: maxX - minX, h: maxY - minY };
}

/** Convert rect room (center+width+depth) to a polygon */
function rectToPolygon(room: FloorPlanRoom): [number, number][] {
  const hw = room.width / 2, hd = room.depth / 2;
  const [cx, cy] = room.center;
  return [
    [cx - hw, cy - hd],
    [cx + hw, cy - hd],
    [cx + hw, cy + hd],
    [cx - hw, cy + hd],
  ];
}

// ─── Component ─────────────────────────────────────────────────────────────

export function FloorPlanEditor({ geometry, sourceImageUrl, onGenerate3D }: FloorPlanEditorProps) {
  const [rooms, setRooms] = useState<EditorRoom[]>(() =>
    geometry.rooms.map((r, i) => ({
      ...r,
      id: `room-${i}`,
      polygon: r.polygon && r.polygon.length >= 3 ? r.polygon : rectToPolygon(r),
    })),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragVertex, setDragVertex] = useState<{ roomId: string; vertexIdx: number } | null>(null);
  const [dragRoom, setDragRoom] = useState<{ roomId: string; startPt: { x: number; y: number } } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const pad = 1;
  const vb = useMemo(() => ({
    x: -pad,
    y: -pad,
    w: geometry.footprint.width + pad * 2,
    h: geometry.footprint.depth + pad * 2,
  }), [geometry.footprint]);

  const selected = useMemo(() => rooms.find(r => r.id === selectedId) ?? null, [rooms, selectedId]);

  // ── SVG coordinate conversion ────────────────────────────────────────

  const toSVG = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM()?.inverse();
    if (!ctm) return { x: 0, y: 0 };
    const s = pt.matrixTransform(ctm);
    return { x: s.x, y: s.y };
  }, []);

  // ── Mouse handlers ─────────────────────────────────────────────────

  const onMouseMove = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const pos = toSVG(e.clientX, e.clientY);

    if (dragVertex) {
      // Drag a single polygon vertex
      setRooms(prev => prev.map(r => {
        if (r.id !== dragVertex.roomId || !r.polygon) return r;
        const newPoly = r.polygon.map((v, i) =>
          i === dragVertex.vertexIdx ? [pos.x, pos.y] as [number, number] : v
        );
        const c = computeCentroid(newPoly);
        const b = polyBounds(newPoly);
        return { ...r, polygon: newPoly, center: c, width: b.w, depth: b.h };
      }));
      return;
    }

    if (dragRoom) {
      // Move entire room
      const dx = pos.x - dragRoom.startPt.x;
      const dy = pos.y - dragRoom.startPt.y;
      setRooms(prev => prev.map(r => {
        if (r.id !== dragRoom.roomId) return r;
        const newPoly = (r.polygon ?? rectToPolygon(r)).map(([vx, vy]) =>
          [vx + dx, vy + dy] as [number, number]
        );
        const c = computeCentroid(newPoly);
        return { ...r, polygon: newPoly, center: c };
      }));
      setDragRoom({ ...dragRoom, startPt: pos });
    }
  }, [dragVertex, dragRoom, toSVG]);

  const onMouseUp = useCallback(() => {
    setDragVertex(null);
    setDragRoom(null);
  }, []);

  // ── Room CRUD ────────────────────────────────────────────────────────

  const updateRoom = useCallback((id: string, updates: Partial<FloorPlanRoom>) => {
    setRooms(prev => prev.map(r => {
      if (r.id !== id) return r;
      return { ...r, ...updates };
    }));
  }, []);

  const deleteRoom = useCallback((id: string) => {
    setRooms(prev => prev.filter(r => r.id !== id));
    if (selectedId === id) setSelectedId(null);
  }, [selectedId]);

  const addRoom = useCallback(() => {
    const newId = `room-${Date.now()}`;
    const cx = geometry.footprint.width / 2;
    const cy = geometry.footprint.depth / 2;
    const polygon: [number, number][] = [
      [cx - 1.5, cy - 1.5],
      [cx + 1.5, cy - 1.5],
      [cx + 1.5, cy + 1.5],
      [cx - 1.5, cy + 1.5],
    ];
    setRooms(prev => [...prev, {
      id: newId,
      name: `New Room`,
      center: [cx, cy] as [number, number],
      width: 3,
      depth: 3,
      type: "other" as FloorPlanRoomType,
      polygon,
    }]);
    setSelectedId(newId);
  }, [geometry.footprint]);

  const addVertex = useCallback((roomId: string) => {
    setRooms(prev => prev.map(r => {
      if (r.id !== roomId || !r.polygon || r.polygon.length < 3) return r;
      // Add a midpoint between the last two vertices
      const last = r.polygon[r.polygon.length - 1];
      const first = r.polygon[0];
      const mid: [number, number] = [(last[0] + first[0]) / 2, (last[1] + first[1]) / 2];
      return { ...r, polygon: [...r.polygon, mid] };
    }));
  }, []);

  // ── Build geometry for 3D ────────────────────────────────────────────

  const handleGenerate = useCallback(() => {
    const updatedGeometry: FloorPlanGeometry = {
      ...geometry,
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      rooms: rooms.map(({ id: _id, ...room }) => room),
    };
    onGenerate3D(updatedGeometry);
  }, [geometry, rooms, onGenerate3D]);

  const onBgClick = useCallback(() => {
    setSelectedId(null);
  }, []);

  // ── Render ───────────────────────────────────────────────────────────

  const vertexRadius = 0.12;

  return (
    <div style={{ display: "flex", height: "100%", background: BG }}>
      {/* ── SVG Canvas ─────────────────────────────────────────────── */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <svg
          ref={svgRef}
          viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
          style={{ width: "100%", height: "100%", cursor: (dragVertex || dragRoom) ? "grabbing" : "default" }}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onClick={onBgClick}
        >
          {/* Background image */}
          {sourceImageUrl && (
            <image
              href={sourceImageUrl}
              x={0} y={0}
              width={geometry.footprint.width}
              height={geometry.footprint.depth}
              preserveAspectRatio="xMidYMid meet"
              opacity={0.5}
            />
          )}

          {/* Grid */}
          {Array.from({ length: Math.ceil(geometry.footprint.width) + 1 }, (_, i) => (
            <line key={`gv-${i}`} x1={i} y1={0} x2={i} y2={geometry.footprint.depth}
              stroke="rgba(255,255,255,0.04)" strokeWidth={0.02} />
          ))}
          {Array.from({ length: Math.ceil(geometry.footprint.depth) + 1 }, (_, i) => (
            <line key={`gh-${i}`} x1={0} y1={i} x2={geometry.footprint.width} y2={i}
              stroke="rgba(255,255,255,0.04)" strokeWidth={0.02} />
          ))}

          {/* Walls */}
          {geometry.walls.map((wall, i) => (
            <line
              key={`wall-${i}`}
              x1={wall.start[0]} y1={wall.start[1]}
              x2={wall.end[0]} y2={wall.end[1]}
              stroke={wall.type === "exterior" ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.25)"}
              strokeWidth={wall.thickness}
              strokeLinecap="round"
            />
          ))}

          {/* Rooms — rendered as SVG polygons */}
          {rooms.map(room => {
            const poly = room.polygon && room.polygon.length >= 3
              ? room.polygon
              : rectToPolygon(room);
            const isSel = room.id === selectedId;
            const points = poly.map(([x, y]) => `${x},${y}`).join(" ");
            const centroid = computeCentroid(poly);
            const bounds = polyBounds(poly);

            return (
              <g key={room.id}>
                <polygon
                  points={points}
                  fill={ROOM_COLORS[room.type]}
                  stroke={isSel ? CYAN : "rgba(255,255,255,0.15)"}
                  strokeWidth={isSel ? 0.06 : 0.02}
                  strokeDasharray={isSel ? "0.15 0.08" : "none"}
                  style={{ cursor: "move" }}
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    setSelectedId(room.id);
                    setDragRoom({ roomId: room.id, startPt: toSVG(e.clientX, e.clientY) });
                  }}
                  onClick={(e) => { e.stopPropagation(); setSelectedId(room.id); }}
                />
                {/* Label */}
                <text
                  x={centroid[0]} y={centroid[1] - 0.15}
                  textAnchor="middle" dominantBaseline="central"
                  fill="white" fontSize={0.38} fontWeight={600}
                  style={{ pointerEvents: "none", userSelect: "none" }}
                >
                  {room.name}
                </text>
                <text
                  x={centroid[0]} y={centroid[1] + 0.35}
                  textAnchor="middle" dominantBaseline="central"
                  fill="rgba(255,255,255,0.45)" fontSize={0.28}
                  style={{ pointerEvents: "none", userSelect: "none" }}
                >
                  {bounds.w.toFixed(1)}m × {bounds.h.toFixed(1)}m
                </text>
                {/* Vertex handles (when selected) */}
                {isSel && poly.map(([vx, vy], vi) => (
                  <circle
                    key={`v-${room.id}-${vi}`}
                    cx={vx} cy={vy} r={vertexRadius}
                    fill={CYAN} stroke="white" strokeWidth={0.02}
                    style={{ cursor: "pointer" }}
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setDragVertex({ roomId: room.id, vertexIdx: vi });
                    }}
                  />
                ))}
              </g>
            );
          })}

          {/* Doors */}
          {geometry.doors.map((door, i) => (
            <circle
              key={`door-${i}`}
              cx={door.position[0]} cy={door.position[1]}
              r={door.width / 2}
              fill="none" stroke="rgba(255,200,80,0.4)" strokeWidth={0.04}
              style={{ pointerEvents: "none" }}
            />
          ))}
        </svg>

        <div style={{
          position: "absolute", bottom: 12, left: 12,
          fontSize: 11, color: TEXT_MUTED, lineHeight: 1.6,
        }}>
          Click room to select · Drag to move · Drag vertices to reshape
        </div>
      </div>

      {/* ── Right Panel ────────────────────────────────────────────── */}
      <div style={{
        width: 280, flexShrink: 0,
        background: PANEL_BG,
        borderLeft: `1px solid ${BORDER}`,
        padding: 20, overflowY: "auto",
        display: "flex", flexDirection: "column", gap: 14,
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: TEXT, letterSpacing: "0.02em" }}>
          Floor Plan Editor
        </div>
        <div style={{ fontSize: 11, color: TEXT_MUTED, lineHeight: 1.5, marginTop: -8 }}>
          {rooms.length} rooms · {geometry.walls.length} walls
        </div>

        {selected ? (
          <RoomPanel
            room={selected}
            onUpdate={(updates) => updateRoom(selected.id, updates)}
            onDelete={() => deleteRoom(selected.id)}
            onAddVertex={() => addVertex(selected.id)}
          />
        ) : (
          <div style={{ color: TEXT_DIM, fontSize: 12, padding: "16px 0" }}>
            Click a room to edit properties
          </div>
        )}

        <div style={{ flex: 1 }} />

        <button onClick={addRoom} style={{
          background: "rgba(255,255,255,0.05)",
          border: `1px solid ${BORDER}`,
          color: TEXT_DIM, fontSize: 12, fontWeight: 500,
          padding: "10px 0", borderRadius: 8, cursor: "pointer",
          transition: "all 0.15s",
        }}>
          + Add Room
        </button>

        <button onClick={handleGenerate} style={{
          background: "linear-gradient(135deg, #4F8AFF 0%, #00F5FF 100%)",
          border: "none", color: "#fff",
          fontSize: 14, fontWeight: 700,
          padding: "14px 0", borderRadius: 10, cursor: "pointer",
          letterSpacing: "0.03em",
          boxShadow: "0 4px 20px rgba(79,138,255,0.3)",
          transition: "all 0.2s",
        }}>
          Generate 3D →
        </button>
      </div>
    </div>
  );
}

// ─── Room Properties Panel ─────────────────────────────────────────────────

function RoomPanel({ room, onUpdate, onDelete, onAddVertex }: {
  room: EditorRoom;
  onUpdate: (u: Partial<FloorPlanRoom>) => void;
  onDelete: () => void;
  onAddVertex: () => void;
}) {
  const inputStyle: React.CSSProperties = {
    width: "100%", padding: "8px 10px",
    background: "rgba(255,255,255,0.05)",
    border: `1px solid ${BORDER}`,
    borderRadius: 6, color: TEXT, fontSize: 12,
    outline: "none",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 10, fontWeight: 500, color: TEXT_DIM,
    textTransform: "uppercase", letterSpacing: "0.06em",
    marginBottom: 3, marginTop: 6,
  };

  const vertexCount = room.polygon?.length ?? 4;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: CYAN, marginBottom: 4 }}>
        Room Properties
      </div>

      <div style={labelStyle}>Name</div>
      <input
        value={room.name}
        onChange={e => onUpdate({ name: e.target.value })}
        style={inputStyle}
      />

      <div style={labelStyle}>Type</div>
      <select
        value={room.type}
        onChange={e => onUpdate({ type: e.target.value as FloorPlanRoomType })}
        style={{ ...inputStyle, appearance: "none" }}
      >
        {ROOM_TYPES.map(t => (
          <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>
        ))}
      </select>

      <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
        <div style={{ flex: 1 }}>
          <div style={labelStyle}>Width (m)</div>
          <input
            type="number" step={0.1} min={0.5} max={30}
            value={room.width.toFixed(1)}
            onChange={e => onUpdate({ width: parseFloat(e.target.value) || room.width })}
            style={inputStyle}
          />
        </div>
        <div style={{ flex: 1 }}>
          <div style={labelStyle}>Depth (m)</div>
          <input
            type="number" step={0.1} min={0.5} max={30}
            value={room.depth.toFixed(1)}
            onChange={e => onUpdate({ depth: parseFloat(e.target.value) || room.depth })}
            style={inputStyle}
          />
        </div>
      </div>

      <div style={{ fontSize: 11, color: TEXT_MUTED, marginTop: 6 }}>
        {vertexCount} vertices · Drag cyan dots to reshape
      </div>

      <button onClick={onAddVertex} style={{
        marginTop: 6, padding: "6px 0",
        background: "rgba(0,245,255,0.08)",
        border: "1px solid rgba(0,245,255,0.2)",
        borderRadius: 6, color: CYAN,
        fontSize: 11, fontWeight: 500, cursor: "pointer",
      }}>
        + Add Vertex
      </button>

      <button onClick={onDelete} style={{
        marginTop: 6, padding: "8px 0",
        background: "rgba(239,68,68,0.1)",
        border: "1px solid rgba(239,68,68,0.25)",
        borderRadius: 6, color: "#EF4444",
        fontSize: 11, fontWeight: 500, cursor: "pointer",
      }}>
        Delete Room
      </button>
    </div>
  );
}
