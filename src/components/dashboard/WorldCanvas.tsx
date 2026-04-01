"use client";

import { useRef, useMemo, useState, useEffect, Suspense } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import * as THREE from "three";

/* ═══════════════════════════════════════════════════════════════════
   SHARED STATE
   ═══════════════════════════════════════════════════════════════════ */
export const scrollState = { progress: 0 };
const mouse = { x: 0, y: 0 };

function smoothstep(x: number, lo: number, hi: number): number {
  const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

/* ═══════════════════════════════════════════════════════════════════
   CINEMATIC LIGHTING
   ═══════════════════════════════════════════════════════════════════ */
function CinematicLights() {
  return (
    <>
      {/* Ambient — very low, just enough to see shadow areas */}
      <ambientLight color="#a0b4d0" intensity={0.08} />
      {/* Key light — upper right, slightly blue-white */}
      <directionalLight color="#d0e0ff" intensity={0.9} position={[6, 10, 4]} />
      {/* Rim light — behind and below, cyan backlight */}
      <pointLight color="#06b6d4" intensity={3} distance={50} position={[-4, -1, -6]} />
      {/* Accent light — left side, purple tint */}
      <pointLight color="#7c3aed" intensity={2} distance={40} position={[-7, 5, 3]} />
      {/* Warm fill from front-right */}
      <pointLight color="#f59e0b" intensity={0.6} distance={30} position={[8, 2, 8]} />
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   CAMERA CONTROLLER — scroll-driven + dramatic mouse parallax
   ═══════════════════════════════════════════════════════════════════ */
function CameraController() {
  const { camera } = useThree();

  useFrame(() => {
    const p = scrollState.progress;
    let tx: number, ty: number, tz: number;

    if (p < 0.2) {
      const t = p / 0.2;
      tx = lerp(0, 2, t);
      ty = lerp(5, 4, t);
      tz = lerp(14, 12, t);
    } else if (p < 0.5) {
      const t = (p - 0.2) / 0.3;
      tx = lerp(2, -0.5, t);
      ty = lerp(4, 6, t);
      tz = lerp(12, 14, t);
    } else if (p < 0.8) {
      const t = (p - 0.5) / 0.3;
      tx = lerp(-0.5, 0.5, t);
      ty = lerp(6, 5.5, t);
      tz = lerp(14, 13, t);
    } else {
      tx = 0.5; ty = 5.5; tz = 13;
    }

    // Dramatic mouse parallax — user "tilts the holographic table"
    tx += mouse.x * 1.8;
    ty += mouse.y * 0.8;

    camera.position.x += (tx - camera.position.x) * 0.025;
    camera.position.y += (ty - camera.position.y) * 0.025;
    camera.position.z += (tz - camera.position.z) * 0.025;
    camera.lookAt(0, 1, 0);
  });

  return null;
}

/* ═══════════════════════════════════════════════════════════════════
   ARCHITECTURAL BUILDING — Solid + wireframe overlay = premium look
   ═══════════════════════════════════════════════════════════════════ */
interface BuildingDef {
  pos: [number, number, number];
  size: [number, number, number];
  color: string;
  delay: number;       // stagger delay for rise animation (seconds)
  type?: "box" | "cylinder" | "setback";
}

function ArchBuilding({ def, groupOpacity }: { def: BuildingDef; groupOpacity: number }) {
  const meshRef = useRef<THREE.Group>(null);
  const riseRef = useRef(0);
  const startTime = useRef(-1);

  const edgeColor = useMemo(() => new THREE.Color(def.color), [def.color]);
  const bodyColor = useMemo(() => {
    const c = new THREE.Color(def.color);
    c.multiplyScalar(0.3);
    return c;
  }, [def.color]);

  // Edge geometry
  const edgesGeo = useMemo(() => {
    if (def.type === "cylinder") {
      return new THREE.EdgesGeometry(new THREE.CylinderGeometry(def.size[0] / 2, def.size[0] / 2, def.size[1], 12));
    }
    return new THREE.EdgesGeometry(new THREE.BoxGeometry(...def.size));
  }, [def.size, def.type]);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.elapsedTime;

    // Init start time
    if (startTime.current < 0) startTime.current = t;
    const elapsed = t - startTime.current;

    // Rise animation: begins after delay, takes 1.2s
    const riseProgress = Math.max(0, Math.min(1, (elapsed - def.delay) / 1.2));
    const eased = riseProgress * riseProgress * (3 - 2 * riseProgress); // smoothstep
    riseRef.current = eased;

    const h = def.size[1];
    meshRef.current.scale.y = Math.max(0.001, eased);
    meshRef.current.position.y = (h * eased) / 2;

    // Gentle float after fully risen
    if (eased >= 0.99) {
      meshRef.current.position.y += Math.sin(t * 0.8 + def.delay * 10) * 0.03;
    }

    // Update opacities
    meshRef.current.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const mat = child.material as THREE.MeshStandardMaterial;
        mat.opacity = groupOpacity * eased * 0.35;
      } else if (child instanceof THREE.LineSegments) {
        const mat = child.material as THREE.LineBasicMaterial;
        mat.opacity = groupOpacity * eased * 0.7;
      }
    });
  });

  return (
    <group ref={meshRef} position={[def.pos[0], 0, def.pos[2]]}>
      {/* Solid body */}
      <mesh>
        {def.type === "cylinder" ? (
          <cylinderGeometry args={[def.size[0] / 2, def.size[0] / 2, def.size[1], 12]} />
        ) : (
          <boxGeometry args={def.size} />
        )}
        <meshStandardMaterial
          color={bodyColor}
          transparent
          opacity={0.35}
          metalness={0.8}
          roughness={0.2}
        />
      </mesh>
      {/* Glowing edge lines */}
      <lineSegments geometry={edgesGeo}>
        <lineBasicMaterial color={edgeColor} transparent opacity={0.7} />
      </lineSegments>

      {/* Setback upper portion for tower types */}
      {def.type === "setback" && (
        <group position={[0, def.size[1] * 0.4, 0]}>
          <mesh>
            <boxGeometry args={[def.size[0] * 0.65, def.size[1] * 0.35, def.size[2] * 0.65]} />
            <meshStandardMaterial color={bodyColor} transparent opacity={0.3} metalness={0.8} roughness={0.2} />
          </mesh>
          <lineSegments geometry={new THREE.EdgesGeometry(new THREE.BoxGeometry(def.size[0] * 0.65, def.size[1] * 0.35, def.size[2] * 0.65))}>
            <lineBasicMaterial color={edgeColor} transparent opacity={0.6} />
          </lineSegments>
        </group>
      )}
    </group>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   HERO CITY — Architectural cityscape (scroll 0-25%)
   ═══════════════════════════════════════════════════════════════════ */

const HERO_CITY: BuildingDef[] = [
  // Main tower with setback
  { pos: [0, 0, -0.5], size: [1.3, 5, 1.3], color: "#4F8AFF", delay: 0.2, type: "setback" },
  // Podium base
  { pos: [0, 0, 1], size: [3, 0.8, 1.8], color: "#3B82F6", delay: 0.1 },
  // Cylindrical tower
  { pos: [-2.5, 0, 0.3], size: [1.2, 3.2, 1.2], color: "#06B6D4", delay: 0.4, type: "cylinder" },
  // Right block
  { pos: [2.3, 0, -0.3], size: [1.2, 2.2, 1], color: "#8B5CF6", delay: 0.5 },
  // Small annex left
  { pos: [-1.5, 0, 2], size: [0.8, 0.7, 0.8], color: "#06B6D4", delay: 0.7 },
  // Right annex
  { pos: [1.6, 0, 1.6], size: [0.9, 1, 0.6], color: "#A78BFA", delay: 0.6 },
  // Far left low-rise
  { pos: [-3.5, 0, -1.5], size: [0.9, 1.2, 0.8], color: "#3B82F6", delay: 0.8 },
  // Far right
  { pos: [3.2, 0, 1.2], size: [0.7, 0.9, 1], color: "#818CF8", delay: 0.9 },
  // Background tower
  { pos: [1, 0, -2.5], size: [0.8, 2.8, 0.8], color: "#A78BFA", delay: 0.35, type: "setback" },
  // Left background
  { pos: [-1.2, 0, -2.2], size: [0.7, 1.5, 0.6], color: "#4F8AFF", delay: 0.55 },
  // Connector bridge 1
  { pos: [-0.6, 0, 0.3], size: [0.15, 0.08, 2.5], color: "#06B6D4", delay: 1.0 },
  // Connector bridge 2
  { pos: [1.1, 0, 0.3], size: [0.15, 0.08, 2.5], color: "#4F8AFF", delay: 1.1 },
];

function HeroCity() {
  const group = useRef<THREE.Group>(null);
  const [opacity, setOpacity] = useState(1);

  useFrame(({ clock }) => {
    if (!group.current) return;
    const p = scrollState.progress;

    // Slow rotation
    group.current.rotation.y = clock.elapsedTime * 0.015;

    // Tilt based on mouse — holographic table feel
    group.current.rotation.x = mouse.y * 0.04;
    group.current.rotation.z = mouse.x * -0.02;

    // Fade out after 20% scroll
    const op = 1 - smoothstep(p, 0.15, 0.3);
    setOpacity(op);
    group.current.visible = op > 0.01;
  });

  return (
    <group ref={group}>
      {HERO_CITY.map((def, i) => (
        <ArchBuilding key={i} def={def} groupOpacity={opacity} />
      ))}
    </group>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   DATA FLOW CURVES — Glowing paths with traveling dots
   ═══════════════════════════════════════════════════════════════════ */

const FLOW_PATHS = [
  { points: [[-3, 2, 0], [-1, 3.5, 1.5], [1, 3, -0.5], [2.5, 2, 0]], color: "#06b6d4" },
  { points: [[-2, 1, 1.5], [0, 2.5, 2], [2, 1.5, 1], [3, 1, 1.5]], color: "#8B5CF6" },
  { points: [[2, 2.5, -1], [0.5, 4, 0.5], [-1.5, 3, -0.5], [-3, 2, 0.5]], color: "#4F8AFF" },
];

function DataFlows() {
  const dotsRef = useRef<THREE.Mesh[]>([]);
  const tubeRefs = useRef<THREE.Mesh[]>([]);

  const curves = useMemo(() =>
    FLOW_PATHS.map((fp) => new THREE.CatmullRomCurve3(
      fp.points.map((p) => new THREE.Vector3(p[0], p[1], p[2]))
    )),
  []);

  const tubeGeos = useMemo(() =>
    curves.map((c) => new THREE.TubeGeometry(c, 48, 0.015, 6, false)),
  [curves]);

  useFrame(({ clock }) => {
    const p = scrollState.progress;
    const vis = 1 - smoothstep(p, 0.15, 0.3);
    if (vis < 0.01) return;

    const t = clock.elapsedTime;
    dotsRef.current.forEach((dot, i) => {
      if (!dot) return;
      const progress = ((t * 0.25 + i * 0.33) % 1);
      const point = curves[i].getPointAt(progress);
      dot.position.copy(point);
      (dot.material as THREE.MeshBasicMaterial).opacity = vis * 0.9;
    });

    tubeRefs.current.forEach((tube) => {
      if (!tube) return;
      (tube.material as THREE.MeshBasicMaterial).opacity = vis * 0.25;
    });
  });

  return (
    <group>
      {FLOW_PATHS.map((fp, i) => (
        <group key={i}>
          {/* Path tube */}
          <mesh
            geometry={tubeGeos[i]}
            ref={(el) => { if (el) tubeRefs.current[i] = el; }}
          >
            <meshBasicMaterial color={fp.color} transparent opacity={0.25} blending={THREE.AdditiveBlending} depthWrite={false} />
          </mesh>
          {/* Traveling dot */}
          <mesh ref={(el) => { if (el) dotsRef.current[i] = el; }}>
            <sphereGeometry args={[0.06, 8, 8]} />
            <meshBasicMaterial color={fp.color} transparent opacity={0.9} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   CITY RISE — Grid of buildings, wave construction (scroll 12-55%)
   ═══════════════════════════════════════════════════════════════════ */

const PALETTE = ["#4F8AFF", "#06B6D4", "#8B5CF6", "#3B82F6", "#A78BFA"];

const CITY_GRID: BuildingDef[] = [];
for (let gx = -2; gx <= 2; gx++) {
  for (let gz = -2; gz <= 2; gz++) {
    const dist = Math.sqrt(gx * gx + gz * gz);
    const h = Math.max(0.4, 0.8 + (3 - dist * 0.6) * Math.max(0, 1 - dist * 0.1));
    const w = 0.6 + Math.abs(Math.sin(gx * 3 + gz * 7)) * 0.5;
    const d = 0.6 + Math.abs(Math.cos(gx * 5 + gz * 3)) * 0.5;
    const ci = (gx + gz + 10) % PALETTE.length;
    const useCyl = (gx === 0 && gz === 0) || (gx === 1 && gz === -1);
    CITY_GRID.push({
      pos: [gx * 1.6, 0, gz * 1.6],
      size: [w, h, d],
      color: PALETTE[ci],
      delay: dist * 0.025,
      type: useCyl ? "cylinder" : "box",
    });
  }
}

function CityRise() {
  const group = useRef<THREE.Group>(null);
  const [opacity, setOpacity] = useState(0);

  useFrame(({ clock }) => {
    if (!group.current) return;
    const p = scrollState.progress;

    const vis = smoothstep(p, 0.12, 0.2) * (1 - smoothstep(p, 0.32, 0.42));
    setOpacity(vis);
    group.current.visible = vis > 0.01;
    group.current.rotation.y = clock.elapsedTime * 0.01 + 0.5;
  });

  return (
    <group ref={group} position={[0, 0, -2]}>
      {CITY_GRID.map((def, i) => (
        <CityRiseBuilding key={i} def={def} sectionOpacity={opacity} />
      ))}
    </group>
  );
}

function CityRiseBuilding({ def, sectionOpacity }: { def: BuildingDef; sectionOpacity: number }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const edgesRef = useRef<THREE.LineSegments>(null);

  const edgesGeo = useMemo(() => {
    if (def.type === "cylinder") {
      return new THREE.EdgesGeometry(new THREE.CylinderGeometry(def.size[0] / 2, def.size[0] / 2, def.size[1], 10));
    }
    return new THREE.EdgesGeometry(new THREE.BoxGeometry(...def.size));
  }, [def.size, def.type]);

  useFrame(() => {
    if (!meshRef.current || !edgesRef.current) return;
    const p = scrollState.progress;
    const riseBase = smoothstep(p, 0.14, 0.42);
    const rise = smoothstep(riseBase, def.delay, def.delay + 0.15);
    const h = def.size[1];

    meshRef.current.scale.y = Math.max(0.001, rise);
    meshRef.current.position.y = (h * rise) / 2;
    edgesRef.current.scale.y = Math.max(0.001, rise);
    edgesRef.current.position.y = (h * rise) / 2;

    (meshRef.current.material as THREE.MeshStandardMaterial).opacity = sectionOpacity * 0.3 * rise;
    (edgesRef.current.material as THREE.LineBasicMaterial).opacity = sectionOpacity * 0.65 * rise;
  });

  const bodyColor = useMemo(() => { const c = new THREE.Color(def.color); c.multiplyScalar(0.3); return c; }, [def.color]);

  return (
    <group position={[def.pos[0], 0, def.pos[2]]}>
      <mesh ref={meshRef}>
        {def.type === "cylinder" ? (
          <cylinderGeometry args={[def.size[0] / 2, def.size[0] / 2, def.size[1], 10]} />
        ) : (
          <boxGeometry args={def.size} />
        )}
        <meshStandardMaterial color={bodyColor} transparent opacity={0.3} metalness={0.7} roughness={0.3} />
      </mesh>
      <lineSegments ref={edgesRef} geometry={edgesGeo}>
        <lineBasicMaterial color={def.color} transparent opacity={0} />
      </lineSegments>
    </group>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   NODE CONSTELLATION — Floating ring (scroll 46-85%)
   ═══════════════════════════════════════════════════════════════════ */

const NODE_COLORS = ["#4F8AFF", "#4F8AFF", "#4F8AFF", "#4F8AFF", "#8B5CF6", "#8B5CF6", "#10B981", "#10B981", "#F59E0B", "#F59E0B"];

function NodeConstellation() {
  const group = useRef<THREE.Group>(null);

  const nodes = useMemo(() =>
    NODE_COLORS.map((c, i) => {
      const angle = (i / NODE_COLORS.length) * Math.PI * 2;
      const r = 3.2;
      return { position: [Math.cos(angle) * r, Math.sin(angle * 2) * 0.6 + 1.5, Math.sin(angle) * r] as [number, number, number], color: c };
    }),
  []);

  const lineGeo = useMemo(() => {
    const pos: number[] = [];
    for (let i = 0; i < nodes.length; i++) {
      const next = (i + 1) % nodes.length;
      pos.push(...nodes[i].position, ...nodes[next].position);
      if (i + 3 < nodes.length) pos.push(...nodes[i].position, ...nodes[i + 3].position);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    return geo;
  }, [nodes]);

  useFrame(({ clock }) => {
    if (!group.current) return;
    const p = scrollState.progress;
    const vis = smoothstep(p, 0.68, 0.76) * (1 - smoothstep(p, 0.88, 0.95));
    group.current.visible = vis > 0.01;
    group.current.rotation.y = clock.elapsedTime * 0.08;

    group.current.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        const mat = child.material as THREE.MeshBasicMaterial;
        mat.opacity = vis * (mat.wireframe ? 0.7 : 0.8);
      } else if (child instanceof THREE.LineSegments) {
        (child.material as THREE.LineBasicMaterial).opacity = vis * 0.15;
      }
    });
  });

  return (
    <group ref={group} position={[0, 0, 0]}>
      {nodes.map((n, i) => (
        <group key={i} position={n.position}>
          <mesh>
            <icosahedronGeometry args={[0.28, 1]} />
            <meshBasicMaterial color={n.color} transparent opacity={0} wireframe />
          </mesh>
          <mesh>
            <sphereGeometry args={[0.08, 8, 8]} />
            <meshBasicMaterial color={n.color} transparent opacity={0} />
          </mesh>
        </group>
      ))}
      <lineSegments geometry={lineGeo}>
        <lineBasicMaterial color="#4F8AFF" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} />
      </lineSegments>
    </group>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   AMBIENT PARTICLES — Always visible atmospheric dust
   ═══════════════════════════════════════════════════════════════════ */

function AmbientParticles({ count = 250 }: { count?: number }) {
  const ref = useRef<THREE.Points>(null);

  const { positions, velocities, colors } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const pal = [...PALETTE, "#ffffff", "#ffffff"].map((c) => new THREE.Color(c));
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 20;
      pos[i * 3 + 1] = Math.random() * 10 - 1;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 18;
      vel[i * 3] = (Math.random() - 0.5) * 0.002;
      vel[i * 3 + 1] = Math.random() * 0.003 + 0.001;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 0.002;
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
      if (arr[i * 3 + 1] > 10) {
        arr[i * 3] = (Math.random() - 0.5) * 20;
        arr[i * 3 + 1] = -1;
        arr[i * 3 + 2] = (Math.random() - 0.5) * 18;
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
      <pointsMaterial size={0.03} vertexColors transparent opacity={0.4} blending={THREE.AdditiveBlending} depthWrite={false} sizeAttenuation />
    </points>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   GROUND GRID — Architectural floor plan reference
   ═══════════════════════════════════════════════════════════════════ */

function GroundGrid() {
  return (
    <group position={[0, -0.02, 0]}>
      {/* Main grid */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[30, 30, 60, 60]} />
        <meshBasicMaterial color="#1a2a45" wireframe transparent opacity={0.04} />
      </mesh>
      {/* Inner detail grid — floor plan feel */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <planeGeometry args={[10, 10, 20, 20]} />
        <meshBasicMaterial color="#06b6d4" wireframe transparent opacity={0.02} />
      </mesh>
    </group>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   SCENE COMPOSITION
   ═══════════════════════════════════════════════════════════════════ */

function Scene({ isMobile }: { isMobile: boolean }) {
  const { scene } = useThree();

  // Set fog for atmospheric depth
  useEffect(() => {
    scene.fog = new THREE.FogExp2("#0a0c14", 0.035);
    return () => { scene.fog = null; };
  }, [scene]);

  return (
    <>
      <color attach="background" args={["#07070D"]} />
      <CinematicLights />
      <CameraController />
      <GroundGrid />
      <AmbientParticles count={isMobile ? 80 : 250} />
      <HeroCity />
      <DataFlows />
      <CityRise />
      <NodeConstellation />
      {!isMobile && (
        <EffectComposer>
          <Bloom intensity={0.7} luminanceThreshold={0.15} luminanceSmoothing={0.85} mipmapBlur />
          <Vignette eskil={false} offset={0.1} darkness={0.8} />
        </EffectComposer>
      )}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   EXPORT
   ═══════════════════════════════════════════════════════════════════ */

export function WorldCanvas() {
  const [ready, setReady] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
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
      camera={{ position: [0, 5, 14], fov: 38, near: 0.1, far: 100 }}
      dpr={[1, 2]}
      gl={{ antialias: !isMobile, alpha: false, powerPreference: "high-performance" }}
      style={{ width: "100%", height: "100%" }}
    >
      <Suspense fallback={null}>
        <Scene isMobile={isMobile} />
      </Suspense>
    </Canvas>
  );
}
