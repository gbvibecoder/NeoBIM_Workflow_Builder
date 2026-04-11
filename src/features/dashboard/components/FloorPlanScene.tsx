"use client";

import { useRef, useMemo, useState, useEffect, Suspense } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import { BoxGeometry, EdgesGeometry, Vector3, DoubleSide, Mesh, LineSegments, MeshBasicMaterial, MeshStandardMaterial, LineBasicMaterial } from "three";

/* ═══════════════════════════════════════════════════════════════════
   FLOOR PLAN SCENE — Real apartment layout that draws & rises

   12m x 10m apartment:
   ┌───────────────────────┐
   │                       │
   │   Living Room   ┌─────┤
   │   (7 x 5)      │Kit- │
   │                 │chen │
   ├────────┬────────┤(3x5)│
   │        │        ├─────┤
   │ Bed 1  │ Bed 2  │Bath │
   │ (4x5)  │ (5x5)  │(3x3)│
   │        │        │     │
   └────────┴────────┴─────┘

   All coordinates in meters, origin at bottom-left corner.
   ═══════════════════════════════════════════════════════════════════ */

const W = 0.15; // wall thickness
const H = 2.8;  // wall height

// Each wall: [startX, startZ, endX, endZ, isInterior, riseOrder]
// riseOrder: 0=exterior first, 1=interior second
const WALL_SEGMENTS: [number, number, number, number, boolean, number][] = [
  // ── Exterior walls ──
  [0, 0, 12, 0, false, 0],       // bottom
  [12, 0, 12, 10, false, 0],     // right
  [12, 10, 0, 10, false, 0],     // top
  [0, 10, 0, 0, false, 0],       // left

  // ── Interior walls ──
  // Horizontal divider (Living/Beds boundary) — with door gap
  [0, 5, 3.6, 5, true, 1],       // left part
  [4.5, 5, 9, 5, true, 1],       // right part (gap for door at ~4m)
  // Vertical divider between Bed1 and Bed2
  [4, 0, 4, 4.6, true, 1],       // with gap at top for door
  // Kitchen wall (vertical at x=9)
  [9, 5, 9, 10, true, 1],        // full height
  // Bath wall (horizontal at z=3, from x=9 to x=12)
  [9, 3, 12, 3, true, 1],
  // Bath divider from Bed2 (vertical at x=9, z=0 to z=3)
  [9, 0, 9, 2.6, true, 1],       // gap for door
];

// Window positions: [centerX, centerZ, wallSide, width]
// wallSide: 'top'|'bottom'|'left'|'right' for which exterior wall
const WINDOWS: { x: number; z: number; rot: number; w: number }[] = [
  { x: 3, z: 0, rot: 0, w: 1.5 },        // bottom wall — Bed1
  { x: 7, z: 0, rot: 0, w: 1.5 },        // bottom wall — Bed2
  { x: 0, z: 7.5, rot: Math.PI / 2, w: 1.5 }, // left wall — Living
  { x: 6, z: 10, rot: 0, w: 2 },         // top wall — Living
  { x: 12, z: 7, rot: Math.PI / 2, w: 1.2 },  // right wall — Kitchen
  { x: 12, z: 1.5, rot: Math.PI / 2, w: 1 },  // right wall — Bath
];

// Room labels: [centerX, centerZ, name]
const ROOMS: [number, number, string][] = [
  [4.5, 7.5, "Living Room"],
  [10.5, 7.5, "Kitchen"],
  [2, 2.5, "Bedroom 1"],
  [6.5, 2.5, "Bedroom 2"],
  [10.5, 1.5, "Bath"],
];

function ss(x: number, lo: number, hi: number) {
  const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/* ── Floor surface with grid ── */
function Floor({ progress }: { progress: number }) {
  const vis = ss(progress, 0, 0.1);
  return (
    <group position={[6, 0, 5]}>
      {/* Solid floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
        <planeGeometry args={[12.3, 10.3]} />
        <meshStandardMaterial color="#0f1520" transparent opacity={vis * 0.9} roughness={0.95} />
      </mesh>
      {/* Grid overlay */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}>
        <planeGeometry args={[12.3, 10.3, 24, 20]} />
        <meshBasicMaterial color="#06b6d4" wireframe transparent opacity={vis * 0.07} />
      </mesh>
    </group>
  );
}

/* ── Blueprint 2D line that draws on ground ── */
function BlueprintLine({ x1, z1, x2, z2, isInterior, drawStart, drawEnd, progress }: {
  x1: number; z1: number; x2: number; z2: number; isInterior: boolean;
  drawStart: number; drawEnd: number; progress: number;
}) {
  const ref = useRef<Mesh>(null);
  const dx = x2 - x1;
  const dz = z2 - z1;
  const fullLen = Math.sqrt(dx * dx + dz * dz);
  const angle = Math.atan2(dz, dx);

  useFrame(() => {
    if (!ref.current) return;
    const drawProgress = ss(progress, drawStart, drawEnd);
    const currentLen = fullLen * drawProgress;
    ref.current.scale.x = Math.max(0.001, drawProgress);
    (ref.current.material as MeshBasicMaterial).opacity = drawProgress > 0.01 ? 0.9 : 0;
  });

  const cx = (x1 + x2) / 2;
  const cz = (z1 + z2) / 2;

  return (
    <mesh ref={ref} position={[cx, 0.02, cz]} rotation={[0, -angle, 0]}>
      <planeGeometry args={[fullLen, 0.04]} />
      <meshBasicMaterial
        color={isInterior ? "#a78bfa" : "#06b6d4"}
        transparent opacity={0}
        side={DoubleSide}
      />
    </mesh>
  );
}

/* ── Wall that rises from its blueprint line ── */
function RisingWall({ x1, z1, x2, z2, isInterior, riseOrder, progress }: {
  x1: number; z1: number; x2: number; z2: number;
  isInterior: boolean; riseOrder: number; progress: number;
}) {
  const meshRef = useRef<Mesh>(null);
  const edgesRef = useRef<LineSegments>(null);

  const dx = x2 - x1;
  const dz = z2 - z1;
  const length = Math.sqrt(dx * dx + dz * dz);
  const cx = (x1 + x2) / 2;
  const cz = (z1 + z2) / 2;
  const angle = Math.atan2(dz, dx);

  const geo = useMemo(() => new BoxGeometry(length, H, W), [length]);
  const edgesGeo = useMemo(() => new EdgesGeometry(geo), [geo]);

  const color = isInterior ? "#2d1f5e" : "#1a2940";
  const edgeColor = isInterior ? "#a78bfa" : "#06b6d4";

  // Exterior walls rise at progress 0.3-0.5, interior at 0.4-0.6
  const riseStart = riseOrder === 0 ? 0.28 : 0.38;
  const riseEnd = riseOrder === 0 ? 0.52 : 0.62;

  useFrame(() => {
    if (!meshRef.current || !edgesRef.current) return;
    const rise = ss(progress, riseStart, riseEnd);

    meshRef.current.scale.y = Math.max(0.001, rise);
    meshRef.current.position.y = (H * rise) / 2;
    edgesRef.current.scale.y = Math.max(0.001, rise);
    edgesRef.current.position.y = (H * rise) / 2;

    (meshRef.current.material as MeshStandardMaterial).opacity = rise * 0.85;
    (edgesRef.current.material as LineBasicMaterial).opacity = rise * 0.8;
  });

  return (
    <group position={[cx, 0, cz]} rotation={[0, -angle, 0]}>
      <mesh ref={meshRef} geometry={geo}>
        <meshStandardMaterial color={color} transparent opacity={0} metalness={0.3} roughness={0.7} />
      </mesh>
      <lineSegments ref={edgesRef} geometry={edgesGeo}>
        <lineBasicMaterial color={edgeColor} transparent opacity={0} />
      </lineSegments>
    </group>
  );
}

/* ── Window frames on exterior walls ── */
function WindowFrame({ x, z, rot, w, progress }: { x: number; z: number; rot: number; w: number; progress: number }) {
  const vis = ss(progress, 0.6, 0.78);
  if (vis < 0.01) return null;

  return (
    <group position={[x, H * 0.5, z]} rotation={[0, rot, 0]}>
      <mesh>
        <boxGeometry args={[w, H * 0.4, 0.06]} />
        <meshStandardMaterial color="#38bdf8" transparent opacity={vis * 0.2} metalness={0.9} roughness={0.1} />
      </mesh>
      <lineSegments geometry={new EdgesGeometry(new BoxGeometry(w, H * 0.4, 0.06))}>
        <lineBasicMaterial color="#38bdf8" transparent opacity={vis * 0.7} />
      </lineSegments>
    </group>
  );
}

/* ── Room label sprites ── */
function RoomLabel({ x, z, progress }: { x: number; z: number; name: string; progress: number }) {
  const vis = ss(progress, 0.65, 0.82);
  if (vis < 0.01) return null;

  return (
    <mesh position={[x, 0.04, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[2, 0.6]} />
      <meshBasicMaterial color="#06b6d4" transparent opacity={vis * 0.05} side={DoubleSide} />
    </mesh>
  );
}

/* ── Camera: bird-eye → isometric ── */
function FPCamera({ progress }: { progress: number }) {
  const { camera } = useThree();

  useFrame(() => {
    const t = ss(progress, 0.05, 0.7);
    // Bird-eye looking straight down → isometric angle
    const x = 6 + t * 8;
    const y = 14 - t * 4;    // 14 (high overhead) → 10 (angled)
    const z = 5 + t * 8;

    camera.position.lerp(new Vector3(x, y, z), 0.04);
    camera.lookAt(6, 0, 5);
  });

  return null;
}

/* ── Scene composition ── */
function Scene({ progress }: { progress: number }) {
  return (
    <>
      <color attach="background" args={["#07070D"]} />
      <ambientLight color="#c0d0e0" intensity={0.25} />
      <directionalLight color="#e0eaff" intensity={0.9} position={[10, 12, 8]} />
      <pointLight color="#06b6d4" intensity={1.5} distance={25} position={[0, 3, 10]} />
      <pointLight color="#a78bfa" intensity={1} distance={20} position={[12, 3, 0]} />
      <fog attach="fog" args={["#07070D", 18, 35]} />

      <FPCamera progress={progress} />
      <Floor progress={progress} />

      {/* Blueprint lines (draw during 0.08-0.28) */}
      {WALL_SEGMENTS.map(([x1, z1, x2, z2, interior], i) => (
        <BlueprintLine
          key={`bp-${i}`}
          x1={x1} z1={z1} x2={x2} z2={z2}
          isInterior={interior}
          drawStart={0.08 + (i / WALL_SEGMENTS.length) * 0.18}
          drawEnd={0.12 + (i / WALL_SEGMENTS.length) * 0.18}
          progress={progress}
        />
      ))}

      {/* Rising walls */}
      {WALL_SEGMENTS.map(([x1, z1, x2, z2, interior, order], i) => (
        <RisingWall
          key={`wall-${i}`}
          x1={x1} z1={z1} x2={x2} z2={z2}
          isInterior={interior} riseOrder={order}
          progress={progress}
        />
      ))}

      {/* Windows */}
      {WINDOWS.map((w, i) => (
        <WindowFrame key={i} {...w} progress={progress} />
      ))}

      {/* Room labels */}
      {ROOMS.map(([x, z, name], i) => (
        <RoomLabel key={i} x={x} z={z} name={name} progress={progress} />
      ))}

      <EffectComposer>
        <Bloom intensity={0.5} luminanceThreshold={0.25} luminanceSmoothing={0.9} mipmapBlur />
      </EffectComposer>
    </>
  );
}

/* ── Export ── */
export function FloorPlanScene({ progress }: { progress: number }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const c = document.createElement("canvas");
      if (!c.getContext("webgl2") && !c.getContext("webgl")) return;
    } catch { return; }
    setReady(true);
  }, []);

  if (!ready) return <div style={{ width: "100%", height: "100%", background: "#07070D" }} />;

  return (
    <Canvas
      camera={{ position: [6, 14, 5], fov: 45, near: 0.1, far: 60 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false }}
      style={{ width: "100%", height: "100%" }}
    >
      <Suspense fallback={null}>
        <Scene progress={progress} />
      </Suspense>
    </Canvas>
  );
}
