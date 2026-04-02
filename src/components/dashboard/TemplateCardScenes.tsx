"use client";

import { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

/* ═══════════════════════════════════════════════════════════════════
   TEMPLATE CARD BACKGROUND 3D SCENES
   Each scene renders behind text content at ~40% opacity.
   Lightweight: simple geometry, no post-processing, auto-rotate.
   ═══════════════════════════════════════════════════════════════════ */

/* ── Shared: edged box ── */
function EBox({ args, color, edgeColor, position, opacity = 0.35, eo = 0.5 }: {
  args: [number, number, number]; color: string; edgeColor: string;
  position: [number, number, number]; opacity?: number; eo?: number;
}) {
  const geo = useMemo(() => new THREE.BoxGeometry(...args), [args]);
  const edges = useMemo(() => new THREE.EdgesGeometry(geo), [geo]);
  return (
    <group position={position}>
      <mesh geometry={geo}>
        <meshStandardMaterial color={color} transparent opacity={opacity} roughness={0.8} />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color={edgeColor} transparent opacity={eo} />
      </lineSegments>
    </group>
  );
}

/* ═══════ wf-01: Floor Plan — glowing room outlines ═══════ */
function FloorPlanBG() {
  const ref = useRef<THREE.Group>(null);
  const dotRef = useRef<THREE.Mesh>(null);

  // Room outline points (2D on XZ plane)
  const lines = useMemo(() => {
    const pts: [number, number, number, number][] = [
      // Outer walls
      [0, 0, 5, 0], [5, 0, 5, 4], [5, 4, 0, 4], [0, 4, 0, 0],
      // Interior
      [0, 2.2, 3, 2.2], [3.2, 2.2, 5, 2.2], // horizontal with door gap
      [3, 0, 3, 2], // vertical
      [3, 2.4, 3, 4],
    ];
    const geos = pts.map(([x1, z1, x2, z2]) => {
      const g = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(x1 - 2.5, 0, z1 - 2),
        new THREE.Vector3(x2 - 2.5, 0, z2 - 2),
      ]);
      return g;
    });
    return geos;
  }, []);

  // Path for traveling dot
  const path = useMemo(() => {
    const pts = [
      [0, 0], [5, 0], [5, 4], [0, 4], [0, 0],
    ].map(([x, z]) => new THREE.Vector3(x - 2.5, 0.05, z - 2));
    return new THREE.CatmullRomCurve3(pts, true);
  }, []);

  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.y = clock.getElapsedTime() * 0.08;
    if (dotRef.current) {
      const t = (clock.getElapsedTime() * 0.1) % 1;
      const p = path.getPoint(t);
      dotRef.current.position.copy(p);
    }
  });

  return (
    <group ref={ref} position={[0, -0.5, 0]}>
      {lines.map((geo, i) => (
        <lineSegments key={i} geometry={geo}>
          <lineBasicMaterial color="#06b6d4" transparent opacity={0.5} />
        </lineSegments>
      ))}
      {/* Room fills */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-1, -0.01, 0]}>
        <planeGeometry args={[2.8, 2]} />
        <meshBasicMaterial color="#06b6d4" transparent opacity={0.04} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[1.2, -0.01, -1]}>
        <planeGeometry args={[1.8, 2]} />
        <meshBasicMaterial color="#a78bfa" transparent opacity={0.04} />
      </mesh>
      {/* Traveling dot */}
      <mesh ref={dotRef}>
        <sphereGeometry args={[0.08, 8, 8]} />
        <meshBasicMaterial color="#06b6d4" transparent opacity={0.9} />
      </mesh>
      {/* Grid floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <planeGeometry args={[6, 5, 12, 10]} />
        <meshBasicMaterial color="#06b6d4" wireframe transparent opacity={0.05} />
      </mesh>
    </group>
  );
}

/* ═══════ wf-03: Wireframe Building ═══════ */
function BuildingBG() {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.y = clock.getElapsedTime() * 0.1;
  });
  return (
    <group ref={ref}>
      {/* Main volume */}
      <EBox args={[2, 3, 1.5]} color="#1e1e3a" edgeColor="#a855f7" position={[0, 1.5, 0]} opacity={0.15} eo={0.55} />
      {/* Floor slabs */}
      <EBox args={[2.1, 0.06, 1.6]} color="#a855f7" edgeColor="#a855f7" position={[0, 1, 0]} opacity={0.08} eo={0.3} />
      <EBox args={[2.1, 0.06, 1.6]} color="#a855f7" edgeColor="#a855f7" position={[0, 2, 0]} opacity={0.08} eo={0.3} />
      {/* Columns */}
      {[[-0.8, -0.6], [0.8, -0.6], [-0.8, 0.6], [0.8, 0.6]].map(([x, z], i) => (
        <EBox key={i} args={[0.12, 3, 0.12]} color="#475569" edgeColor="#94a3b8" position={[x, 1.5, z]} opacity={0.25} eo={0.4} />
      ))}
      {/* Roof */}
      <EBox args={[2.3, 0.08, 1.8]} color="#1e293b" edgeColor="#a855f7" position={[0, 3.04, 0]} opacity={0.2} eo={0.45} />
      {/* Grid */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <planeGeometry args={[5, 4, 10, 8]} />
        <meshBasicMaterial color="#a855f7" wireframe transparent opacity={0.04} />
      </mesh>
    </group>
  );
}

/* ═══════ wf-04: Parametric Massing — breathing volumes ═══════ */
function MassingBG() {
  const ref = useRef<THREE.Group>(null);
  const v0 = useRef<THREE.Group>(null);
  const v1 = useRef<THREE.Group>(null);
  const v2 = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (ref.current) ref.current.rotation.y = t * 0.07;
    if (v0.current) { v0.current.scale.y = 1 + Math.sin(t * 0.8) * 0.1; v0.current.position.y = 1.25 * v0.current.scale.y; }
    if (v1.current) { v1.current.scale.y = 1 + Math.sin(t * 0.6 + 2) * 0.12; v1.current.position.y = 0.5 * v1.current.scale.y; }
    if (v2.current) { v2.current.scale.y = 1 + Math.sin(t * 0.9 + 1) * 0.08; v2.current.position.y = 1.5 * v2.current.scale.y; }
  });

  return (
    <group ref={ref}>
      <group ref={v0}><EBox args={[1.3, 2.5, 1.3]} color="#0e1e30" edgeColor="#06b6d4" position={[-1, 0, -0.3]} opacity={0.15} eo={0.5} /></group>
      <group ref={v1}><EBox args={[2, 1, 1.5]} color="#1a0e30" edgeColor="#a855f7" position={[0.8, 0, 0.5]} opacity={0.12} eo={0.45} /></group>
      <group ref={v2}><EBox args={[1, 3, 1]} color="#0e2a20" edgeColor="#10b981" position={[0.2, 0, -0.8]} opacity={0.12} eo={0.5} /></group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <planeGeometry args={[6, 5, 12, 10]} />
        <meshBasicMaterial color="#8b5cf6" wireframe transparent opacity={0.04} />
      </mesh>
    </group>
  );
}

/* ═══════ wf-06: Render + Video — orbiting camera around screen ═══════ */
function RenderBG() {
  const ref = useRef<THREE.Group>(null);
  const camRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (ref.current) ref.current.rotation.y = t * 0.05;
    if (camRef.current) {
      camRef.current.position.x = Math.cos(t * 0.4) * 2.2;
      camRef.current.position.z = Math.sin(t * 0.4) * 2.2;
      camRef.current.position.y = 0.5 + Math.sin(t * 0.2) * 0.3;
    }
  });

  return (
    <group ref={ref}>
      {/* Screen plane */}
      <mesh position={[0, 0.5, 0]}>
        <boxGeometry args={[2.5, 1.5, 0.05]} />
        <meshStandardMaterial color="#10b981" transparent opacity={0.08} emissive="#10b981" emissiveIntensity={0.3} />
      </mesh>
      {/* Screen edges */}
      {(() => {
        const g = new THREE.BoxGeometry(2.5, 1.5, 0.05);
        const e = new THREE.EdgesGeometry(g);
        return <lineSegments geometry={e} position={[0, 0.5, 0]}><lineBasicMaterial color="#10b981" transparent opacity={0.45} /></lineSegments>;
      })()}
      {/* Orbiting camera */}
      <mesh ref={camRef}>
        <octahedronGeometry args={[0.12, 0]} />
        <meshBasicMaterial color="#8b5cf6" transparent opacity={0.8} />
      </mesh>
      {/* Orbit ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.5, 0]}>
        <ringGeometry args={[2.1, 2.2, 48]} />
        <meshBasicMaterial color="#8b5cf6" transparent opacity={0.08} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

/* ═══════ wf-08: PDF to IFC — document flow ═══════ */
function PdfToIfcBG() {
  const ref = useRef<THREE.Group>(null);
  const particles = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (ref.current) ref.current.rotation.y = t * 0.04;
    if (particles.current) {
      for (let i = 0; i < 8; i++) {
        const p = ((t * 0.3 + i / 8) % 1);
        dummy.position.set(-1.5 + p * 3, 0.8 + Math.sin(p * Math.PI) * 0.3, 0);
        dummy.scale.setScalar(0.04 + Math.sin(p * Math.PI) * 0.02);
        dummy.updateMatrix();
        particles.current.setMatrixAt(i, dummy.matrix);
      }
      particles.current.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group ref={ref}>
      {/* PDF document */}
      <EBox args={[1, 1.4, 0.05]} color="#1e293b" edgeColor="#3b82f6" position={[-1.5, 0.8, 0]} opacity={0.15} eo={0.45} />
      {/* Arrow direction particles */}
      <instancedMesh ref={particles} args={[undefined, undefined, 8]}>
        <sphereGeometry args={[1, 6, 6]} />
        <meshBasicMaterial color="#06b6d4" transparent opacity={0.7} />
      </instancedMesh>
      {/* Building output */}
      <EBox args={[1.2, 1.8, 0.8]} color="#0e1e30" edgeColor="#06b6d4" position={[1.5, 0.9, 0]} opacity={0.12} eo={0.45} />
      <EBox args={[1.3, 0.05, 0.9]} color="#06b6d4" edgeColor="#06b6d4" position={[1.5, 1.8, 0]} opacity={0.1} eo={0.3} />
    </group>
  );
}

/* ═══════ wf-09: BOQ Cost — animated bar chart ═══════ */
function BarChartBG() {
  const ref = useRef<THREE.Group>(null);
  const bars = useRef<THREE.Mesh[]>([]);

  const heights = [1.5, 2.4, 1.0, 2.8, 1.8];
  const colors = ["#06b6d4", "#a855f7", "#10b981", "#f59e0b", "#3b82f6"];

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (ref.current) ref.current.rotation.y = t * 0.06;
    bars.current.forEach((bar, i) => {
      if (!bar) return;
      const h = heights[i] * (1 + Math.sin(t * 0.7 + i * 1.2) * 0.12);
      bar.scale.y = h / heights[i];
      bar.position.y = h / 2;
    });
  });

  return (
    <group ref={ref}>
      {heights.map((h, i) => {
        const geo = new THREE.BoxGeometry(0.35, h, 0.35);
        const edges = new THREE.EdgesGeometry(geo);
        return (
          <group key={i}>
            <mesh
              ref={el => { if (el) bars.current[i] = el; }}
              position={[-1.2 + i * 0.6, h / 2, 0]}
            >
              <boxGeometry args={[0.35, h, 0.35]} />
              <meshStandardMaterial color={colors[i]} transparent opacity={0.2} />
            </mesh>
            <lineSegments geometry={edges} position={[-1.2 + i * 0.6, h / 2, 0]}>
              <lineBasicMaterial color={colors[i]} transparent opacity={0.5} />
            </lineSegments>
          </group>
        );
      })}
      {/* Base line */}
      <mesh position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[4, 3, 8, 6]} />
        <meshBasicMaterial color="#f59e0b" wireframe transparent opacity={0.04} />
      </mesh>
    </group>
  );
}

/* ═══════ wf-05: Interactive 3D Model — mini floor plan with extruded walls ═══════ */
function Interactive3dBG() {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.y = clock.getElapsedTime() * 0.12;
  });
  return (
    <group ref={ref} position={[0, -0.3, 0]}>
      {/* 3 rooms */}
      <EBox args={[2, 0.5, 1.5]} color="#0e1e30" edgeColor="#3b82f6" position={[-0.5, 0.25, -0.5]} opacity={0.1} eo={0.4} />
      <EBox args={[1.2, 0.5, 1.5]} color="#1a0e30" edgeColor="#a78bfa" position={[1.1, 0.25, -0.5]} opacity={0.1} eo={0.4} />
      <EBox args={[3.2, 0.5, 1.2]} color="#0e2a20" edgeColor="#06b6d4" position={[0.1, 0.25, 0.85]} opacity={0.1} eo={0.4} />
      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.1, -0.01, 0.2]}>
        <planeGeometry args={[4, 3.5, 8, 7]} />
        <meshBasicMaterial color="#3b82f6" wireframe transparent opacity={0.05} />
      </mesh>
    </group>
  );
}

/* ═══════ wf-11: Renovation — before/after planes ═══════ */
function RenovationBG() {
  const ref = useRef<THREE.Group>(null);
  const divRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (ref.current) ref.current.rotation.y = t * 0.04;
    if (divRef.current) divRef.current.position.x = Math.sin(t * 0.5) * 0.3;
  });

  return (
    <group ref={ref}>
      {/* Before plane */}
      <mesh position={[-0.8, 0.8, 0]}>
        <planeGeometry args={[1.4, 1.8]} />
        <meshStandardMaterial color="#7f1d1d" transparent opacity={0.12} />
      </mesh>
      {(() => {
        const g = new THREE.PlaneGeometry(1.4, 1.8);
        const e = new THREE.EdgesGeometry(g);
        return <lineSegments geometry={e} position={[-0.8, 0.8, 0.01]}><lineBasicMaterial color="#ef4444" transparent opacity={0.3} /></lineSegments>;
      })()}
      {/* After plane */}
      <mesh position={[0.8, 0.8, 0]}>
        <planeGeometry args={[1.4, 1.8]} />
        <meshStandardMaterial color="#0e2a20" transparent opacity={0.12} />
      </mesh>
      {(() => {
        const g = new THREE.PlaneGeometry(1.4, 1.8);
        const e = new THREE.EdgesGeometry(g);
        return <lineSegments geometry={e} position={[0.8, 0.8, 0.01]}><lineBasicMaterial color="#10b981" transparent opacity={0.35} /></lineSegments>;
      })()}
      {/* Divider */}
      <mesh ref={divRef} position={[0, 0.8, 0.02]}>
        <planeGeometry args={[0.03, 1.9]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.5} />
      </mesh>
    </group>
  );
}

/* ═══════ wf-12: Clash Detection — intersecting beams + pulse ═══════ */
function ClashBG() {
  const ref = useRef<THREE.Group>(null);
  const pulseRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (ref.current) ref.current.rotation.y = t * 0.06;
    if (pulseRef.current) {
      const s = 0.9 + Math.sin(t * 2) * 0.3;
      pulseRef.current.scale.setScalar(s);
      (pulseRef.current.material as THREE.MeshBasicMaterial).opacity = 0.3 + Math.sin(t * 2) * 0.2;
    }
  });

  return (
    <group ref={ref}>
      {/* Horizontal beam */}
      <EBox args={[3.5, 0.25, 0.25]} color="#475569" edgeColor="#94a3b8" position={[0, 0.8, 0]} opacity={0.2} eo={0.4} />
      {/* Vertical beam (crossing) */}
      <EBox args={[0.25, 0.25, 3]} color="#475569" edgeColor="#f59e0b" position={[0, 0.8, 0]} opacity={0.2} eo={0.4} />
      {/* Diagonal pipe */}
      <group position={[0, 0.8, 0]} rotation={[0, 0, Math.PI / 6]}>
        <EBox args={[3, 0.15, 0.15]} color="#2d1b69" edgeColor="#a855f7" position={[0, 0, 0]} opacity={0.15} eo={0.35} />
      </group>
      {/* Clash pulse */}
      <mesh ref={pulseRef} position={[0, 0.8, 0]}>
        <sphereGeometry args={[0.25, 16, 16]} />
        <meshBasicMaterial color="#ef4444" transparent opacity={0.4} />
      </mesh>
      {/* Second clash point */}
      <mesh position={[0.6, 0.8, 0.6]}>
        <sphereGeometry args={[0.15, 12, 12]} />
        <meshBasicMaterial color="#f59e0b" transparent opacity={0.3} />
      </mesh>
    </group>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   SCENE REGISTRY + CANVAS WRAPPER
   ═══════════════════════════════════════════════════════════════════ */

const SCENE_MAP: Record<string, React.FC> = {
  "wf-01": FloorPlanBG,
  "wf-03": BuildingBG,
  "wf-04": MassingBG,
  "wf-06": RenderBG,
  "wf-08": PdfToIfcBG,
  "wf-09": BarChartBG,
  "wf-05": Interactive3dBG,
  "wf-11": RenovationBG,
  "wf-12": ClashBG,
};

export function TemplateCardScene({ wfId }: { wfId: string }) {
  const SceneComponent = SCENE_MAP[wfId];
  if (!SceneComponent) return null;

  return (
    <Canvas
      camera={{ position: [3, 2.5, 3], fov: 42, near: 0.1, far: 30 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      dpr={[1, 2]}
      style={{ width: "100%", height: "100%", background: "transparent" }}
    >
      <ambientLight color="#b0c0d0" intensity={0.3} />
      <directionalLight color="#e0e8ff" intensity={0.7} position={[2, 3, 2]} />
      <SceneComponent />
    </Canvas>
  );
}
