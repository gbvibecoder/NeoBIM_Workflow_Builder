"use client";

import { useRef, useMemo, Suspense } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

/* ═══════════════════════════════════════════════════════════════════
   SHARED HELPERS
   ═══════════════════════════════════════════════════════════════════ */

function EdgedBox({ args, color, edgeColor, position, opacity = 0.6, edgeOpacity = 0.5 }: {
  args: [number, number, number];
  color: string; edgeColor: string;
  position: [number, number, number];
  opacity?: number; edgeOpacity?: number;
}) {
  const geo = useMemo(() => new THREE.BoxGeometry(...args), [args]);
  const edges = useMemo(() => new THREE.EdgesGeometry(geo), [geo]);
  return (
    <group position={position}>
      <mesh geometry={geo}>
        <meshStandardMaterial color={color} transparent opacity={opacity} roughness={0.7} />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={edgeColor} transparent opacity={edgeOpacity} />
      </lineSegments>
    </group>
  );
}

function SceneLights({ accent = "#06b6d4" }: { accent?: string }) {
  return (
    <>
      <ambientLight color="#b0c0d0" intensity={0.25} />
      <directionalLight color="#e0e8ff" intensity={0.8} position={[3, 5, 3]} />
      <pointLight color={accent} intensity={0.6} distance={15} position={[-3, 2, -3]} />
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   1. FLOOR PLAN MINI — A simple 4-room apartment, BIM style
   ═══════════════════════════════════════════════════════════════════ */

function FloorPlanMiniInner() {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = clock.getElapsedTime() * 0.15;
    }
  });

  const W = 0.08; // wall thickness
  const H = 1.2;  // wall height (short for preview)

  // Room definitions: [x, z, width, depth, label]
  const rooms = [
    { x: 0, z: 0, w: 3.5, d: 2.5, label: "Living" },
    { x: 3.5, z: 0, w: 2, d: 2.5, label: "Kitchen" },
    { x: 0, z: 2.5, w: 2.5, d: 2, label: "Bedroom" },
    { x: 2.5, z: 2.5, w: 3, d: 2, label: "Bath" },
  ];

  const totalW = 5.5;
  const totalD = 4.5;
  const cx = totalW / 2;
  const cz = totalD / 2;

  // Wall segments: [startX, startZ, endX, endZ]
  const exteriorWalls: [number, number, number, number][] = [
    [0, 0, totalW, 0], [totalW, 0, totalW, totalD],
    [totalW, totalD, 0, totalD], [0, totalD, 0, 0],
  ];
  const interiorWalls: [number, number, number, number][] = [
    [0, 2.5, 2.2, 2.5], [2.8, 2.5, totalW, 2.5], // horizontal divider with door gap
    [3.5, 0, 3.5, 2.2], // kitchen divider with gap
    [2.5, 2.5, 2.5, 4.2], // bed/bath divider with gap
  ];

  function WallMesh({ x1, z1, x2, z2, isInterior }: { x1: number; z1: number; x2: number; z2: number; isInterior: boolean }) {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.sqrt(dx * dx + dz * dz);
    const angle = Math.atan2(dz, dx);
    const midX = (x1 + x2) / 2 - cx;
    const midZ = (z1 + z2) / 2 - cz;
    const wallColor = isInterior ? "#2d1f5e" : "#1a2940";
    const edgeC = isInterior ? "#a78bfa" : "#06b6d4";
    const geo = useMemo(() => new THREE.BoxGeometry(len, H, W), [len]);
    const edges = useMemo(() => new THREE.EdgesGeometry(geo), [geo]);

    return (
      <group position={[midX, H / 2, midZ]} rotation={[0, -angle, 0]}>
        <mesh geometry={geo}>
          <meshStandardMaterial color={wallColor} transparent opacity={0.7} />
        </mesh>
        <lineSegments geometry={edges}>
          <lineBasicMaterial color={edgeC} transparent opacity={0.6} />
        </lineSegments>
      </group>
    );
  }

  return (
    <group ref={groupRef}>
      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
        <planeGeometry args={[totalW + 0.4, totalD + 0.4]} />
        <meshStandardMaterial color="#0c1018" transparent opacity={0.9} roughness={0.95} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.015, 0]}>
        <planeGeometry args={[totalW + 0.4, totalD + 0.4, 11, 9]} />
        <meshBasicMaterial color="#06b6d4" wireframe transparent opacity={0.08} />
      </mesh>

      {/* Exterior walls */}
      {exteriorWalls.map(([x1, z1, x2, z2], i) => (
        <WallMesh key={`ext-${i}`} x1={x1} z1={z1} x2={x2} z2={z2} isInterior={false} />
      ))}

      {/* Interior walls */}
      {interiorWalls.map(([x1, z1, x2, z2], i) => (
        <WallMesh key={`int-${i}`} x1={x1} z1={z1} x2={x2} z2={z2} isInterior={true} />
      ))}

      {/* Room labels — subtle floating text planes */}
      {rooms.map((r, i) => {
        const lx = r.x + r.w / 2 - cx;
        const lz = r.z + r.d / 2 - cz;
        const colors = ["#06b6d4", "#3b82f6", "#a78bfa", "#10b981"];
        return (
          <mesh key={i} position={[lx, 0.02, lz]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[r.w * 0.7, r.d * 0.5]} />
            <meshBasicMaterial color={colors[i]} transparent opacity={0.04} />
          </mesh>
        );
      })}
    </group>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   2. BUILDING MINI — 2-story building with columns, floors, glass
   ═══════════════════════════════════════════════════════════════════ */

function BuildingMiniInner() {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = clock.getElapsedTime() * 0.12;
    }
  });

  // Column positions
  const cols: [number, number][] = [
    [-2.5, -1.5], [2.5, -1.5], [-2.5, 1.5], [2.5, 1.5],
    [0, -1.5], [0, 1.5],
  ];

  return (
    <group ref={groupRef}>
      {/* Foundation */}
      <EdgedBox args={[6, 0.15, 4]} color="#475569" edgeColor="#94a3b8" position={[0, 0.075, 0]} opacity={0.7} edgeOpacity={0.4} />

      {/* Columns */}
      {cols.map(([x, z], i) => (
        <EdgedBox key={i} args={[0.2, 4, 0.2]} color="#475569" edgeColor="#94a3b8" position={[x, 2, z]} opacity={0.5} edgeOpacity={0.5} />
      ))}

      {/* Floor slabs */}
      <EdgedBox args={[5.8, 0.12, 3.8]} color="#334155" edgeColor="#64748b" position={[0, 2, 0]} opacity={0.35} edgeOpacity={0.4} />

      {/* Roof */}
      <EdgedBox args={[6.4, 0.12, 4.4]} color="#1e293b" edgeColor="#475569" position={[0, 4, 0]} opacity={0.5} edgeOpacity={0.5} />

      {/* Glass front wall — ground floor */}
      <EdgedBox args={[5.6, 1.8, 0.04]} color="#38bdf8" edgeColor="#38bdf8" position={[0, 1.05, -1.9]} opacity={0.12} edgeOpacity={0.5} />
      {/* Glass front wall — upper floor */}
      <EdgedBox args={[5.6, 1.8, 0.04]} color="#38bdf8" edgeColor="#38bdf8" position={[0, 3.05, -1.9]} opacity={0.1} edgeOpacity={0.4} />

      {/* Side walls */}
      <EdgedBox args={[0.06, 3.8, 3.6]} color="#334155" edgeColor="#475569" position={[-3, 2, 0]} opacity={0.25} edgeOpacity={0.35} />
      <EdgedBox args={[0.06, 3.8, 3.6]} color="#334155" edgeColor="#475569" position={[3, 2, 0]} opacity={0.25} edgeOpacity={0.35} />

      {/* Ground grid */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <planeGeometry args={[10, 8, 20, 16]} />
        <meshBasicMaterial color="#06b6d4" wireframe transparent opacity={0.04} />
      </mesh>
    </group>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   3. MASSING MINI — Parametric volumes that breathe/morph
   ═══════════════════════════════════════════════════════════════════ */

function MassingMiniInner() {
  const groupRef = useRef<THREE.Group>(null);
  const vol0 = useRef<THREE.Group>(null);
  const vol1 = useRef<THREE.Group>(null);
  const vol2 = useRef<THREE.Group>(null);
  const vol3 = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (groupRef.current) groupRef.current.rotation.y = t * 0.1;

    // Breathing animation — each volume gently scales
    if (vol0.current) {
      vol0.current.scale.y = 1 + Math.sin(t * 0.8) * 0.06;
      vol0.current.scale.x = 1 + Math.sin(t * 0.6 + 1) * 0.03;
    }
    if (vol1.current) {
      vol1.current.scale.y = 1 + Math.sin(t * 0.7 + 2) * 0.08;
      vol1.current.scale.z = 1 + Math.sin(t * 0.5 + 1.5) * 0.04;
    }
    if (vol2.current) {
      vol2.current.scale.y = 1 + Math.sin(t * 0.9 + 1) * 0.07;
      vol2.current.scale.x = 1 + Math.sin(t * 0.4 + 3) * 0.05;
    }
    if (vol3.current) {
      vol3.current.scale.x = 1 + Math.sin(t * 0.6 + 0.5) * 0.06;
      vol3.current.scale.z = 1 + Math.sin(t * 0.8 + 2) * 0.04;
    }
  });

  const volumes = [
    { ref: vol0, w: 1.6, h: 3.5, d: 1.6, x: -1.2, z: -0.5, color: "#7c3aed", edge: "#a78bfa" },
    { ref: vol1, w: 2.5, h: 1.4, d: 1.8, x: 1.5, z: -0.3, color: "#06b6d4", edge: "#22d3ee" },
    { ref: vol2, w: 1.2, h: 2.6, d: 1.3, x: -0.2, z: 1.8, color: "#8b5cf6", edge: "#c4b5fd" },
    { ref: vol3, w: 2.8, h: 0.7, d: 2.5, x: 0.5, z: 0.2, color: "#10b981", edge: "#34d399" },
  ];

  return (
    <group ref={groupRef}>
      {volumes.map((v, i) => {
        const geo = new THREE.BoxGeometry(v.w, v.h, v.d);
        const edges = new THREE.EdgesGeometry(geo);
        return (
          <group key={i} ref={v.ref} position={[v.x, v.h / 2, v.z]}>
            <mesh geometry={geo}>
              <meshStandardMaterial color={v.color} transparent opacity={0.2} roughness={0.6} />
            </mesh>
            <lineSegments geometry={edges}>
              <lineBasicMaterial color={v.edge} transparent opacity={0.7} />
            </lineSegments>
          </group>
        );
      })}

      {/* Ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0.5]}>
        <planeGeometry args={[8, 7, 16, 14]} />
        <meshBasicMaterial color="#8b5cf6" wireframe transparent opacity={0.04} />
      </mesh>
    </group>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   EXPORTED CANVAS WRAPPERS — Each scene in its own Canvas
   ═══════════════════════════════════════════════════════════════════ */

function MiniCanvas({ children, camera }: { children: React.ReactNode; camera?: { position: [number, number, number]; fov?: number } }) {
  const pos = camera?.position ?? [4, 3, 4];
  const fov = camera?.fov ?? 40;
  return (
    <Canvas
      camera={{ position: pos, fov, near: 0.1, far: 50 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      dpr={[1, 2]}
      style={{ background: "transparent", width: "100%", height: "100%" }}
    >
      {children}
    </Canvas>
  );
}

export function FloorPlanMiniScene() {
  return (
    <MiniCanvas camera={{ position: [3.5, 3.5, 3.5], fov: 38 }}>
      <SceneLights accent="#06b6d4" />
      <fog attach="fog" args={["#07070D", 8, 20]} />
      <FloorPlanMiniInner />
    </MiniCanvas>
  );
}

export function BuildingMiniScene() {
  return (
    <MiniCanvas camera={{ position: [5, 4, 5], fov: 35 }}>
      <SceneLights accent="#3b82f6" />
      <fog attach="fog" args={["#07070D", 10, 25]} />
      <BuildingMiniInner />
    </MiniCanvas>
  );
}

export function MassingMiniScene() {
  return (
    <MiniCanvas camera={{ position: [4, 3.5, 4], fov: 38 }}>
      <SceneLights accent="#8b5cf6" />
      <fog attach="fog" args={["#07070D", 8, 20]} />
      <MassingMiniInner />
    </MiniCanvas>
  );
}
