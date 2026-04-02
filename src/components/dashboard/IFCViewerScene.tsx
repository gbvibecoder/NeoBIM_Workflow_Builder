"use client";

import { useRef, useMemo, useState, useEffect, Suspense } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";

/* ═══════════════════════════════════════════════════════════════════
   IFC VIEWER SCENE — 2-story building assembles itself

   10m x 8m footprint, 2 stories (3m each), flat roof
   Assembly: foundation → columns → slabs → walls/glass → roof → x-ray MEP
   ═══════════════════════════════════════════════════════════════════ */

function ss(x: number, lo: number, hi: number) {
  const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

// Column grid positions [x, z]
const COL_POS: [number, number][] = [
  [0, 0], [5, 0], [10, 0],
  [0, 8], [5, 8], [10, 8],
  [0, 4], [10, 4],
];

// Wall panels: [cx, cz, w, d, story, isGlass]
const WALL_PANELS: [number, number, number, number, number, boolean][] = [
  // Ground floor — front (z=0)
  [2.5, 0, 5, 0.15, 0, false],
  [7.5, 0, 5, 0.15, 0, true],    // glass shopfront
  // Ground floor — back (z=8)
  [2.5, 8, 5, 0.15, 0, false],
  [7.5, 8, 5, 0.15, 0, false],
  // Ground floor — sides
  [0, 2, 0.15, 4, 0, false],
  [0, 6, 0.15, 4, 0, false],
  [10, 2, 0.15, 4, 0, true],     // glass
  [10, 6, 0.15, 4, 0, false],
  // Upper floor — front
  [2.5, 0, 5, 0.15, 1, true],    // more glass upstairs
  [7.5, 0, 5, 0.15, 1, true],
  // Upper floor — back
  [2.5, 8, 5, 0.15, 1, false],
  [7.5, 8, 5, 0.15, 1, true],
  // Upper floor — sides
  [0, 2, 0.15, 4, 1, false],
  [0, 6, 0.15, 4, 1, true],
  [10, 2, 0.15, 4, 1, true],
  [10, 6, 0.15, 4, 1, false],
];

// MEP pipes: [x1,y1,z1, x2,y2,z2, color]
const MEP_PIPES: { p1: [number, number, number]; p2: [number, number, number]; c: string }[] = [
  // Hot water — red, runs along ceiling of ground floor
  { p1: [1, 2.7, 2], p2: [9, 2.7, 2], c: "#ef4444" },
  { p1: [1, 2.7, 6], p2: [9, 2.7, 6], c: "#ef4444" },
  // Cold water — blue
  { p1: [1, 2.5, 3], p2: [9, 2.5, 3], c: "#3b82f6" },
  // Ventilation — green, larger duct
  { p1: [2, 5.7, 4], p2: [8, 5.7, 4], c: "#22c55e" },
  // Vertical risers
  { p1: [2, 0.5, 2], p2: [2, 5.5, 2], c: "#ef4444" },
  { p1: [8, 0.5, 6], p2: [8, 5.5, 6], c: "#3b82f6" },
  { p1: [5, 3, 4], p2: [5, 5.7, 4], c: "#22c55e" },
];

/* ── EdgeBox: mesh + edges together ── */
function EdgeBox({ args, position, color, opacity, edgeOpacity, edgeColor, metalness = 0.4, roughness = 0.6 }: {
  args: [number, number, number];
  position: [number, number, number];
  color: string;
  opacity: number;
  edgeOpacity: number;
  edgeColor?: string;
  metalness?: number;
  roughness?: number;
}) {
  const geo = useMemo(() => new THREE.BoxGeometry(...args), [args]);
  const edgesGeo = useMemo(() => new THREE.EdgesGeometry(geo), [geo]);

  return (
    <group position={position}>
      <mesh geometry={geo}>
        <meshStandardMaterial color={color} transparent opacity={opacity} metalness={metalness} roughness={roughness} />
      </mesh>
      <lineSegments geometry={edgesGeo}>
        <lineBasicMaterial color={edgeColor || "#ffffff"} transparent opacity={edgeOpacity} />
      </lineSegments>
    </group>
  );
}

/* ── Foundation ── */
function Foundation({ progress }: { progress: number }) {
  const vis = ss(progress, 0, 0.1);
  return (
    <EdgeBox
      args={[10.8, 0.35, 8.8]}
      position={[5, 0.175 * vis, 4]}
      color="#64748b"
      opacity={vis * 0.7}
      edgeOpacity={vis * 0.4}
      edgeColor="#94a3b8"
      roughness={0.9}
    />
  );
}

/* ── Columns ── */
function Columns({ progress }: { progress: number }) {
  const rise = ss(progress, 0.1, 0.28);
  const colH = 6; // full 2-story height

  return (
    <group>
      {COL_POS.map(([x, z], i) => {
        const stagger = (i / COL_POS.length) * 0.15;
        const r = ss(rise, stagger, stagger + 0.5);
        return (
          <EdgeBox
            key={i}
            args={[0.3, colH, 0.3]}
            position={[x, 0.35 + (colH * r) / 2, z]}
            color="#475569"
            opacity={r * 0.75}
            edgeOpacity={r * 0.4}
            edgeColor="#94a3b8"
            metalness={0.7}
            roughness={0.3}
          />
        );
      })}
    </group>
  );
}

/* ── Floor slabs ── */
function Slabs({ progress }: { progress: number }) {
  const vis = ss(progress, 0.25, 0.4);
  // Ground floor slab (y=0.35), 1st floor (y=3.35), roof placeholder position
  const slabs: [number, number][] = [[0.35, 0], [3.35, 0.3]];

  return (
    <group>
      {slabs.map(([y, delay], i) => {
        const v = ss(vis, delay, delay + 0.5);
        return (
          <EdgeBox
            key={i}
            args={[10.2, 0.2, 8.2]}
            position={[5, y, 4]}
            color="#475569"
            opacity={v * 0.5}
            edgeOpacity={v * 0.3}
            edgeColor="#64748b"
            roughness={0.8}
          />
        );
      })}
    </group>
  );
}

/* ── Wall panels (solid + glass) ── */
function Walls({ progress }: { progress: number }) {
  const vis = ss(progress, 0.4, 0.6);
  const xray = ss(progress, 0.8, 1.0);
  const storyH = 2.8;

  return (
    <group>
      {WALL_PANELS.map(([cx, cz, w, d, story, isGlass], i) => {
        const stagger = (i / WALL_PANELS.length) * 0.4;
        const v = ss(vis, stagger, stagger + 0.35);
        const baseY = 0.35 + story * 3;

        const opacity = isGlass
          ? v * (0.18 - xray * 0.08)
          : v * (0.75 - xray * 0.55);
        const edgeOp = v * (0.35 - xray * 0.15);

        return (
          <EdgeBox
            key={i}
            args={[w, storyH * v, d]}
            position={[cx, baseY + (storyH * v) / 2, cz]}
            color={isGlass ? "#38bdf8" : "#334155"}
            opacity={opacity}
            edgeOpacity={edgeOp}
            edgeColor={isGlass ? "#38bdf8" : "#64748b"}
            metalness={isGlass ? 0.9 : 0.3}
            roughness={isGlass ? 0.1 : 0.7}
          />
        );
      })}
    </group>
  );
}

/* ── Roof ── */
function Roof({ progress }: { progress: number }) {
  const vis = ss(progress, 0.6, 0.72);
  const xray = ss(progress, 0.8, 1.0);
  // Descends from above
  const y = 6.35 + (1 - vis) * 4;

  return (
    <group>
      <EdgeBox
        args={[10.5, 0.25, 8.5]}
        position={[5, y, 4]}
        color="#1e293b"
        opacity={vis * (0.6 - xray * 0.4)}
        edgeOpacity={vis * 0.35}
        edgeColor="#475569"
        roughness={0.8}
      />
      {/* Rooftop equipment box */}
      <EdgeBox
        args={[1.5, 0.8 * vis, 1.2]}
        position={[7.5, y + 0.15 + (0.8 * vis) / 2, 5.5]}
        color="#334155"
        opacity={vis * (0.5 - xray * 0.3)}
        edgeOpacity={vis * 0.3}
        edgeColor="#475569"
      />
    </group>
  );
}

/* ── Staircase ── */
function Staircase({ progress }: { progress: number }) {
  const vis = ss(progress, 0.65, 0.78);
  if (vis < 0.01) return null;

  const steps: THREE.Vector3[] = [];
  for (let i = 0; i < 12; i++) {
    steps.push(new THREE.Vector3(4.5, 0.35 + i * 0.25, 3.5 + i * 0.15));
  }

  return (
    <group>
      {steps.map((pos, i) => (
        <EdgeBox
          key={i}
          args={[1.2, 0.12, 0.28]}
          position={[pos.x, pos.y, pos.z]}
          color="#475569"
          opacity={vis * 0.6}
          edgeOpacity={vis * 0.3}
          edgeColor="#64748b"
        />
      ))}
    </group>
  );
}

/* ── Balcony ── */
function Balcony({ progress }: { progress: number }) {
  const vis = ss(progress, 0.68, 0.78);
  if (vis < 0.01) return null;

  return (
    <group>
      {/* Balcony slab */}
      <EdgeBox
        args={[3.5, 0.15, 1.5]}
        position={[2.5, 3.35, -0.75]}
        color="#475569"
        opacity={vis * 0.6}
        edgeOpacity={vis * 0.4}
        edgeColor="#64748b"
      />
      {/* Glass railing */}
      <EdgeBox
        args={[3.5, 1, 0.06]}
        position={[2.5, 3.85, -1.45]}
        color="#38bdf8"
        opacity={vis * 0.12}
        edgeOpacity={vis * 0.4}
        edgeColor="#38bdf8"
        metalness={0.9}
        roughness={0.1}
      />
    </group>
  );
}

/* ── MEP Pipes (x-ray mode) ── */
function MEP({ progress }: { progress: number }) {
  const vis = ss(progress, 0.82, 1.0);
  if (vis < 0.01) return null;

  return (
    <group>
      {MEP_PIPES.map(({ p1, p2, c }, i) => {
        const dx = p2[0] - p1[0];
        const dy = p2[1] - p1[1];
        const dz = p2[2] - p1[2];
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const cx = (p1[0] + p2[0]) / 2;
        const cy = (p1[1] + p2[1]) / 2;
        const cz = (p1[2] + p2[2]) / 2;
        const dir = new THREE.Vector3(dx, dy, dz).normalize();
        const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
        const radius = c === "#22c55e" ? 0.08 : 0.04;

        return (
          <group key={i} position={[cx, cy, cz]} quaternion={quat}>
            <mesh>
              <cylinderGeometry args={[radius, radius, len, 8]} />
              <meshBasicMaterial color={c} transparent opacity={vis * 0.8} />
            </mesh>
            {/* Glow shell */}
            <mesh>
              <cylinderGeometry args={[radius * 2.5, radius * 2.5, len, 8]} />
              <meshBasicMaterial color={c} transparent opacity={vis * 0.08} blending={THREE.AdditiveBlending} depthWrite={false} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/* ── Ground plane ── */
function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[5, -0.01, 4]}>
      <planeGeometry args={[20, 18, 40, 36]} />
      <meshBasicMaterial color="#1a2a45" wireframe transparent opacity={0.04} />
    </mesh>
  );
}

/* ── Camera: orbits the building ── */
function IFCCamera({ progress }: { progress: number }) {
  const { camera } = useThree();

  useFrame(({ clock }) => {
    const orbitAngle = clock.elapsedTime * 0.12 + progress * Math.PI * 0.6;
    const r = 14 - progress * 2;
    const y = 6 + progress * 3;

    const x = 5 + Math.cos(orbitAngle) * r;
    const z = 4 + Math.sin(orbitAngle) * r;

    camera.position.lerp(new THREE.Vector3(x, y, z), 0.03);
    camera.lookAt(5, 2.5, 4);
  });

  return null;
}

/* ── Scene ── */
function Scene({ progress }: { progress: number }) {
  return (
    <>
      <color attach="background" args={["#07070D"]} />
      <ambientLight color="#b0c0d0" intensity={0.15} />
      <directionalLight color="#e0eaff" intensity={0.8} position={[8, 12, 6]} />
      <pointLight color="#8B5CF6" intensity={1.5} distance={25} position={[-5, 4, -3]} />
      <pointLight color="#06b6d4" intensity={1} distance={20} position={[15, 3, 10]} />
      <fog attach="fog" args={["#07070D", 20, 40]} />

      <IFCCamera progress={progress} />
      <Ground />

      <Foundation progress={progress} />
      <Columns progress={progress} />
      <Slabs progress={progress} />
      <Walls progress={progress} />
      <Roof progress={progress} />
      <Staircase progress={progress} />
      <Balcony progress={progress} />
      <MEP progress={progress} />

      <EffectComposer>
        <Bloom intensity={0.45} luminanceThreshold={0.25} luminanceSmoothing={0.9} mipmapBlur />
      </EffectComposer>
    </>
  );
}

/* ── Export ── */
export function IFCViewerScene({ progress }: { progress: number }) {
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
      camera={{ position: [16, 8, 16], fov: 40, near: 0.1, far: 60 }}
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
