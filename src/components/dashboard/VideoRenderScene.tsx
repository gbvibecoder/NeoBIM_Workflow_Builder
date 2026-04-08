"use client";

/* ═══════════════════════════════════════════════════════════════════
   VIDEO RENDER SCENE — "The Render Farm"

   Scroll-driven scene matching FloorPlanScene / IFCViewerScene API.

   Composition (cinematic 3D video render metaphor):
   - A small architectural building (subject of the render)
   - A circular camera dolly track orbiting the building (curved line)
   - An animated virtual camera w/ frustum lines moving along the track
   - Vertical "render scan-line" sweeping up the building (the classic
     "rendering in progress" trope)
   - 6 floating "render output frames" arranged in an arc behind the
     scene that pop in as scroll progresses (rendered film stills)
   - Amber accent throughout to match the dashboard flagship color
   ═══════════════════════════════════════════════════════════════════ */

import { useRef, useMemo, useState, Suspense } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";

/* ── Smoothstep helper ── */
function ss(x: number, lo: number, hi: number) {
  const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

const AMBER = "#f59e0b";
const AMBER_BRIGHT = "#fbbf24";
const STEEL = "#7c8ea8";
const STEEL_LIGHT = "#cbd5e1";
const GLASS_BLUE = "#5a7fa8";

/* ─── Subject building ──────────────────────────────────────────────
   A small 3-floor glass mass — the thing being "rendered".
   ─────────────────────────────────────────────────────────────────── */
function SubjectBuilding({ progress }: { progress: number }) {
  const vis = ss(progress, 0, 0.18);

  // Floor slabs
  const slabs: number[] = [0, 2.6, 5.2, 7.8];
  // Glass tower body
  const TOWER_W = 4.2;
  const TOWER_D = 4.2;
  const TOWER_H = 7.8;

  return (
    <group position={[0, 0, 0]}>
      {/* Glass mass */}
      <mesh position={[0, TOWER_H / 2, 0]} scale={[1, vis, 1]}>
        <boxGeometry args={[TOWER_W, TOWER_H, TOWER_D]} />
        <meshStandardMaterial
          color={GLASS_BLUE}
          emissive={GLASS_BLUE}
          emissiveIntensity={0.18}
          metalness={0.85}
          roughness={0.18}
          transparent
          opacity={vis * 0.82}
        />
      </mesh>

      {/* Floor slab edges */}
      {slabs.map((y, i) => {
        const stagger = i / slabs.length;
        const v = ss(progress, stagger * 0.15, stagger * 0.15 + 0.15);
        return (
          <mesh key={i} position={[0, y, 0]}>
            <boxGeometry args={[TOWER_W + 0.15, 0.06, TOWER_D + 0.15]} />
            <meshStandardMaterial
              color={STEEL_LIGHT}
              metalness={0.95}
              roughness={0.18}
              transparent
              opacity={v * 0.95}
            />
          </mesh>
        );
      })}

      {/* Corner mullions */}
      {[
        [TOWER_W / 2, TOWER_D / 2],
        [-TOWER_W / 2, TOWER_D / 2],
        [TOWER_W / 2, -TOWER_D / 2],
        [-TOWER_W / 2, -TOWER_D / 2],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, TOWER_H / 2, z]} scale={[1, vis, 1]}>
          <boxGeometry args={[0.12, TOWER_H, 0.12]} />
          <meshStandardMaterial color={STEEL} metalness={0.9} roughness={0.25} transparent opacity={vis * 0.95} />
        </mesh>
      ))}

      {/* Wireframe outline — gives the BIM/CAD hint */}
      <lineSegments position={[0, TOWER_H / 2, 0]}>
        <edgesGeometry args={[new THREE.BoxGeometry(TOWER_W + 0.05, TOWER_H, TOWER_D + 0.05)]} />
        <lineBasicMaterial color={AMBER_BRIGHT} transparent opacity={vis * 0.7} />
      </lineSegments>
    </group>
  );
}

/* ─── Render scan-line ──────────────────────────────────────────────
   Horizontal glowing plane that sweeps top-to-bottom up the building
   to show the "rendering in progress" trope.
   ─────────────────────────────────────────────────────────────────── */
function RenderScanLine({ progress }: { progress: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const vis = ss(progress, 0.18, 0.3);

  useFrame(({ clock }) => {
    if (!ref.current || !matRef.current) return;
    const cycle = 5;
    const k = (clock.elapsedTime % cycle) / cycle;
    ref.current.position.y = k * 8;
    matRef.current.opacity = (1 - Math.abs(k - 0.5) * 1.6) * vis * 0.7;
  });

  return (
    <mesh ref={ref}>
      <boxGeometry args={[5.2, 0.04, 5.2]} />
      <meshBasicMaterial
        ref={matRef}
        color={AMBER_BRIGHT}
        transparent
        opacity={0}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  );
}

/* ─── Camera dolly track ────────────────────────────────────────────
   A circular tube around the building showing the camera's orbit path.
   ─────────────────────────────────────────────────────────────────── */
function DollyTrack({ progress }: { progress: number }) {
  const vis = ss(progress, 0.25, 0.45);
  const RADIUS = 9;
  const Y = 4.5;

  // Build a circle as a TubeGeometry along a CatmullRom curve
  const curve = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    const segs = 64;
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * RADIUS, Y, Math.sin(a) * RADIUS));
    }
    return new THREE.CatmullRomCurve3(pts, true);
  }, []);

  const tubeGeo = useMemo(() => new THREE.TubeGeometry(curve, 96, 0.045, 8, true), [curve]);

  return (
    <mesh geometry={tubeGeo}>
      <meshBasicMaterial color={AMBER} transparent opacity={vis * 0.55} blending={THREE.AdditiveBlending} depthWrite={false} />
    </mesh>
  );
}

/* ─── Virtual camera w/ frustum ─────────────────────────────────────
   Small camera body sliding along the dolly track with 4 frustum
   lines pointing at the subject.
   ─────────────────────────────────────────────────────────────────── */
function VirtualCamera({ progress }: { progress: number }) {
  const groupRef = useRef<THREE.Group>(null);
  const vis = ss(progress, 0.35, 0.5);

  const frustumPoints = useMemo(() => {
    // 4 lines from camera origin to frustum corners pointing forward (-Z)
    const fwd = 4.2;
    const w = 1.4;
    const h = 0.85;
    return [
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(w, h, -fwd),
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(-w, h, -fwd),
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(w, -h, -fwd),
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(-w, -h, -fwd),
      // Far plane rectangle
      new THREE.Vector3(w, h, -fwd), new THREE.Vector3(-w, h, -fwd),
      new THREE.Vector3(-w, h, -fwd), new THREE.Vector3(-w, -h, -fwd),
      new THREE.Vector3(-w, -h, -fwd), new THREE.Vector3(w, -h, -fwd),
      new THREE.Vector3(w, -h, -fwd), new THREE.Vector3(w, h, -fwd),
    ];
  }, []);

  const frustumGeo = useMemo(() => {
    const g = new THREE.BufferGeometry().setFromPoints(frustumPoints);
    return g;
  }, [frustumPoints]);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const RADIUS = 9;
    const Y = 4.5;
    // Slow orbit + tiny progress offset
    const angle = clock.elapsedTime * 0.18 + progress * Math.PI * 0.4;
    const x = Math.cos(angle) * RADIUS;
    const z = Math.sin(angle) * RADIUS;
    groupRef.current.position.set(x, Y, z);
    // Look at the building center
    groupRef.current.lookAt(0, 4, 0);
  });

  return (
    <group ref={groupRef} visible={vis > 0.01}>
      {/* Camera body — small dark box */}
      <mesh>
        <boxGeometry args={[0.42, 0.32, 0.5]} />
        <meshStandardMaterial color="#0f172a" metalness={0.85} roughness={0.32} />
      </mesh>
      {/* Camera lens */}
      <mesh position={[0, 0, -0.3]}>
        <cylinderGeometry args={[0.13, 0.13, 0.18, 16]} />
        <meshStandardMaterial color="#1e293b" metalness={0.95} roughness={0.18} />
      </mesh>
      <mesh position={[0, 0, -0.42]}>
        <cylinderGeometry args={[0.11, 0.11, 0.04, 16]} />
        <meshStandardMaterial color={AMBER} emissive={AMBER} emissiveIntensity={1.4} />
      </mesh>
      {/* Top accent */}
      <mesh position={[0, 0.18, 0]}>
        <boxGeometry args={[0.12, 0.04, 0.12]} />
        <meshStandardMaterial color={AMBER_BRIGHT} emissive={AMBER_BRIGHT} emissiveIntensity={1.2} />
      </mesh>
      {/* Frustum lines */}
      <lineSegments geometry={frustumGeo}>
        <lineBasicMaterial color={AMBER} transparent opacity={vis * 0.85} />
      </lineSegments>
    </group>
  );
}

/* ─── Floating render output frames ─────────────────────────────────
   Small flat planes arranged in an arc behind the building, popping in
   one by one as scroll progresses — the "rendered stills coming off
   the render farm" metaphor.
   ─────────────────────────────────────────────────────────────────── */
function RenderFrames({ progress }: { progress: number }) {
  const FRAMES = 6;
  const ARC_RADIUS = 14;
  const ARC_Y = 7.5;
  const ARC_SPAN = Math.PI * 0.7;

  return (
    <group>
      {Array.from({ length: FRAMES }).map((_, i) => {
        const t = i / (FRAMES - 1);
        // Stagger: each frame appears at progress 0.5 + i * 0.07
        const localStart = 0.5 + i * 0.07;
        const v = ss(progress, localStart, localStart + 0.12);

        const angle = -ARC_SPAN / 2 + t * ARC_SPAN;
        const x = Math.cos(angle - Math.PI / 2) * ARC_RADIUS;
        const z = Math.sin(angle - Math.PI / 2) * ARC_RADIUS - 2;
        const y = ARC_Y + Math.sin(t * Math.PI) * 1.5;

        // Slight tilt toward viewer
        const lookAtCenter = new THREE.Vector3(0, 4, 0);
        const pos = new THREE.Vector3(x, y, z);
        const dir = new THREE.Vector3().subVectors(lookAtCenter, pos);
        const yaw = Math.atan2(dir.x, dir.z);

        return (
          <group key={i} position={[x, y, z]} rotation={[0, yaw, 0]} scale={[v, v, v]}>
            {/* Frame back */}
            <mesh>
              <planeGeometry args={[2.4, 1.5]} />
              <meshBasicMaterial
                color="#0f172a"
                transparent
                opacity={v * 0.92}
                side={THREE.DoubleSide}
              />
            </mesh>
            {/* Frame border */}
            <lineSegments>
              <edgesGeometry args={[new THREE.PlaneGeometry(2.4, 1.5)]} />
              <lineBasicMaterial color={AMBER} transparent opacity={v * 0.85} />
            </lineSegments>
            {/* Inner gradient bar — fake "rendered image" preview */}
            <mesh position={[0, 0, 0.005]}>
              <planeGeometry args={[2.2, 1.3]} />
              <meshBasicMaterial color={i % 2 === 0 ? "#1e293b" : "#0c1828"} transparent opacity={v * 0.8} side={THREE.DoubleSide} />
            </mesh>
            {/* Tiny amber accent line at bottom of frame (like a film label) */}
            <mesh position={[0, -0.6, 0.01]}>
              <planeGeometry args={[1.8, 0.04]} />
              <meshBasicMaterial color={AMBER_BRIGHT} transparent opacity={v * 0.9} />
            </mesh>
            {/* Tiny dots simulating render content */}
            {[0, 1, 2].map((j) => (
              <mesh key={j} position={[-0.7 + j * 0.7, 0, 0.012]}>
                <circleGeometry args={[0.18, 16]} />
                <meshBasicMaterial color={AMBER} transparent opacity={v * 0.18} blending={THREE.AdditiveBlending} />
              </mesh>
            ))}
          </group>
        );
      })}
    </group>
  );
}

/* ─── Ground reflection plate ───────────────────────────────────────
   Subtle dark disc to ground the building, no harsh edges.
   ─────────────────────────────────────────────────────────────────── */
function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
      <circleGeometry args={[22, 64]} />
      <meshStandardMaterial color="#0a0d14" metalness={0.45} roughness={0.6} />
    </mesh>
  );
}

/* ─── Camera controller ─────────────────────────────────────────────
   Slow auto-orbit + slight progress-driven dolly so the scene feels
   alive even when the user is reading the text.
   ─────────────────────────────────────────────────────────────────── */
function SceneCamera({ progress }: { progress: number }) {
  const { camera } = useThree();

  useFrame(({ clock }) => {
    const orbitAngle = clock.elapsedTime * 0.06 + progress * Math.PI * 0.4;
    const r = 18 - progress * 2;
    const y = 7 + progress * 2;
    const x = Math.cos(orbitAngle) * r;
    const z = Math.sin(orbitAngle) * r;
    camera.position.lerp(new THREE.Vector3(x, y, z), 0.04);
    camera.lookAt(0, 4, 0);
  });

  return null;
}

/* ─── Scene root ────────────────────────────────────────────────────*/
function Scene({ progress }: { progress: number }) {
  return (
    <>
      <color attach="background" args={["#07070D"]} />
      <ambientLight color="#b0c0d0" intensity={0.45} />
      <directionalLight color="#ffe8c0" intensity={1.6} position={[8, 12, 6]} castShadow />
      <pointLight color={AMBER} intensity={3.2} distance={18} position={[6, 5, 6]} />
      <pointLight color="#06b6d4" intensity={1.1} distance={20} position={[-7, 4, -5]} />
      <fog attach="fog" args={["#07070D", 22, 50]} />

      <SceneCamera progress={progress} />
      <Ground />
      <SubjectBuilding progress={progress} />
      <RenderScanLine progress={progress} />
      <DollyTrack progress={progress} />
      <VirtualCamera progress={progress} />
      <RenderFrames progress={progress} />

      <EffectComposer>
        <Bloom intensity={0.55} luminanceThreshold={0.35} luminanceSmoothing={0.85} mipmapBlur />
      </EffectComposer>
    </>
  );
}

/* ─── Export ───────────────────────────────────────────────────────*/
export function VideoRenderScene({ progress }: { progress: number }) {
  const [ready] = useState(() => {
    if (typeof document === "undefined") return false;
    try {
      const c = document.createElement("canvas");
      return !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch { return false; }
  });

  if (!ready) return <div style={{ width: "100%", height: "100%", background: "#07070D" }} />;

  return (
    <Canvas
      camera={{ position: [16, 8, 16], fov: 38, near: 0.1, far: 80 }}
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
