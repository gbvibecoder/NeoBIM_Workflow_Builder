"use client";

import { useRef, useMemo, useState, useEffect, Suspense } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";

/* ═══════════════════════════════════════════════════════════════════
   ARCHITECTURAL MASSING — Procedural city block
   ═══════════════════════════════════════════════════════════════════ */

const BUILDINGS: { p: [number, number, number]; s: [number, number, number]; c: string }[] = [
  // Core tower cluster
  { p: [0, 2, -0.5], s: [1.1, 4, 1.1], c: "#4F8AFF" },
  { p: [0, 0.35, 1], s: [3, 0.7, 1.8], c: "#3B82F6" },       // podium
  { p: [0, 3.8, -0.5], s: [0.7, 0.6, 0.7], c: "#818CF8" },    // crown
  // Left wing
  { p: [-2.2, 1, 0], s: [0.9, 2, 1.2], c: "#06B6D4" },
  { p: [-1.6, 0.3, 1.6], s: [0.7, 0.6, 0.7], c: "#06B6D4" },
  // Right wing
  { p: [2, 0.85, -0.3], s: [1.1, 1.7, 0.9], c: "#8B5CF6" },
  { p: [1.6, 0.4, 1.4], s: [0.8, 0.8, 0.6], c: "#A78BFA" },
  // Connectors / bridges
  { p: [1, 0.5, 0.3], s: [0.2, 0.08, 2.2], c: "#4F8AFF" },
  { p: [-1, 0.5, 0.3], s: [0.2, 0.08, 2.2], c: "#06B6D4" },
  // Outlying blocks
  { p: [-3, 0.5, -1.5], s: [0.8, 1, 0.7], c: "#3B82F6" },
  { p: [3, 0.35, 1], s: [0.6, 0.7, 0.9], c: "#818CF8" },
  { p: [0.6, 0.2, 2.4], s: [1.8, 0.4, 0.5], c: "#06B6D4" },
  { p: [-0.9, 0.65, -2.2], s: [0.7, 1.3, 0.6], c: "#A78BFA" },
  { p: [2.6, 0.25, -1.8], s: [0.5, 0.5, 0.8], c: "#3B82F6" },
];

function BuildingEdges({ size, color }: { size: [number, number, number]; color: string }) {
  const geo = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(...size)), [size]);
  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial color={color} transparent opacity={0.65} />
    </lineSegments>
  );
}

function BuildingCluster() {
  const group = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (!group.current) return;
    group.current.rotation.y = clock.elapsedTime * 0.04;
    group.current.position.y = Math.sin(clock.elapsedTime * 0.35) * 0.06;
  });

  return (
    <group ref={group}>
      {BUILDINGS.map((b, i) => (
        <group key={i} position={b.p}>
          <mesh>
            <boxGeometry args={b.s} />
            <meshBasicMaterial color={b.c} transparent opacity={0.035} />
          </mesh>
          <BuildingEdges size={b.s} color={b.c} />
        </group>
      ))}
    </group>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   PARTICLE SYSTEM — floating data points
   ═══════════════════════════════════════════════════════════════════ */

const PALETTE = ["#06B6D4", "#4F8AFF", "#8B5CF6", "#A78BFA", "#3B82F6"];

function Particles({ count = 180 }: { count?: number }) {
  const ref = useRef<THREE.Points>(null);

  const { positions, velocities, colors } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const pal = PALETTE.map((c) => new THREE.Color(c));
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 12;
      pos[i * 3 + 1] = Math.random() * 6;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 10;
      vel[i * 3] = (Math.random() - 0.5) * 0.003;
      vel[i * 3 + 1] = Math.random() * 0.005 + 0.002;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 0.003;
      const c = pal[Math.floor(Math.random() * pal.length)];
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    return { positions: pos, velocities: vel, colors: col };
  }, [count]);

  useFrame(() => {
    if (!ref.current) return;
    const arr = ref.current.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < count; i++) {
      arr[i * 3] += velocities[i * 3];
      arr[i * 3 + 1] += velocities[i * 3 + 1];
      arr[i * 3 + 2] += velocities[i * 3 + 2];
      if (arr[i * 3 + 1] > 7) {
        arr[i * 3] = (Math.random() - 0.5) * 12;
        arr[i * 3 + 1] = -0.5;
        arr[i * 3 + 2] = (Math.random() - 0.5) * 10;
      }
    }
    ref.current.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.045}
        vertexColors
        transparent
        opacity={0.85}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        sizeAttenuation
      />
    </points>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   GROUND GRID — subtle architectural baseline
   ═══════════════════════════════════════════════════════════════════ */

function GroundGrid() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
      <planeGeometry args={[24, 24, 48, 48]} />
      <meshBasicMaterial color="#1a2a45" wireframe transparent opacity={0.05} />
    </mesh>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   CAMERA RIG — mouse parallax
   ═══════════════════════════════════════════════════════════════════ */

// Module-level mouse state (avoids R3F context boundaries)
const mouse = { x: 0, y: 0 };

function CameraRig() {
  const { camera } = useThree();

  useFrame(() => {
    const tx = mouse.x * 1.2;
    const ty = 5.5 + mouse.y * 0.6;
    camera.position.x += (tx - camera.position.x) * 0.012;
    camera.position.y += (ty - camera.position.y) * 0.012;
    camera.lookAt(0, 0.8, 0);
  });

  return null;
}

/* ═══════════════════════════════════════════════════════════════════
   SCENE — composition of all 3D elements
   ═══════════════════════════════════════════════════════════════════ */

function Scene({ isMobile }: { isMobile: boolean }) {
  return (
    <>
      <CameraRig />
      <BuildingCluster />
      <Particles count={isMobile ? 50 : 180} />
      <GroundGrid />
      {!isMobile && (
        <EffectComposer>
          <Bloom
            intensity={0.5}
            luminanceThreshold={0.2}
            luminanceSmoothing={0.9}
            mipmapBlur
          />
        </EffectComposer>
      )}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   EXPORT — Main Canvas wrapper
   ═══════════════════════════════════════════════════════════════════ */

export function HeroCanvas() {
  const [ready, setReady] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    // WebGL check
    try {
      const c = document.createElement("canvas");
      if (!c.getContext("webgl2") && !c.getContext("webgl")) return;
    } catch {
      return;
    }
    setIsMobile(window.innerWidth < 768);
    setReady(true);

    const onMove = (e: MouseEvent) => {
      mouse.x = (e.clientX / window.innerWidth - 0.5) * 2;
      mouse.y = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  if (!ready) return null;

  return (
    <Canvas
      camera={{ position: [0, 5.5, 13], fov: 38, near: 0.1, far: 100 }}
      dpr={[1, 2]}
      gl={{ antialias: !isMobile, alpha: true, powerPreference: "high-performance" }}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      <Suspense fallback={null}>
        <Scene isMobile={isMobile} />
      </Suspense>
    </Canvas>
  );
}
