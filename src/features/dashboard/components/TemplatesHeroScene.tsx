"use client";

import { useRef, useMemo, useEffect, useState, Suspense } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";

/* ═══════════════════════════════════════════════════════════════════
   SHARED STATE — mouse for parallax
   ═══════════════════════════════════════════════════════════════════ */
const mouse = { x: 0, y: 0 };

/* ═══════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════ */
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

/* ═══════════════════════════════════════════════════════════════════
   PIPELINE NODE DEFINITIONS — positions in 3D space
   ═══════════════════════════════════════════════════════════════════ */
interface PipelineNode {
  id: string;
  label: string;
  position: [number, number, number];
  color: string;
  emissive: string;
  scale: number;
}

const PIPELINE_NODES: PipelineNode[] = [
  { id: "input",     label: "INPUT",     position: [-4.5, 0.8, 0],     color: "#06B6D4", emissive: "#06B6D4", scale: 0.38 },
  { id: "parse",     label: "PARSE",     position: [-2.2, 2.0, -1.2],  color: "#3B82F6", emissive: "#3B82F6", scale: 0.32 },
  { id: "ai",        label: "AI",        position: [0, 0.4, 0.8],      color: "#8B5CF6", emissive: "#8B5CF6", scale: 0.42 },
  { id: "transform", label: "3D",        position: [1.8, 2.5, -0.5],   color: "#06B6D4", emissive: "#06B6D4", scale: 0.35 },
  { id: "generate",  label: "GEN",       position: [2.5, 0.2, 1.5],    color: "#10B981", emissive: "#10B981", scale: 0.30 },
  { id: "render",    label: "RENDER",    position: [4.2, 1.6, 0.2],    color: "#F59E0B", emissive: "#F59E0B", scale: 0.33 },
  { id: "export",    label: "EXPORT",    position: [5.5, 0.5, -0.8],   color: "#06B6D4", emissive: "#06B6D4", scale: 0.36 },
];

/* Connections between nodes — defines the flow */
const CONNECTIONS: [number, number][] = [
  [0, 1], [0, 2], [1, 2], [1, 3],
  [2, 3], [2, 4], [3, 5], [4, 5], [5, 6], [4, 6],
];

/* ═══════════════════════════════════════════════════════════════════
   CAMERA + LIGHTS
   ═══════════════════════════════════════════════════════════════════ */
function CameraController() {
  const { camera } = useThree();

  useFrame(() => {
    const tx = 0.5 + mouse.x * 1.2;
    const ty = 1.8 + mouse.y * 0.5;
    const tz = 10;
    camera.position.x += (tx - camera.position.x) * 0.03;
    camera.position.y += (ty - camera.position.y) * 0.03;
    camera.position.z += (tz - camera.position.z) * 0.03;
    camera.lookAt(0.5, 1, 0);
  });

  return null;
}

function SceneLights() {
  return (
    <>
      <ambientLight color="#a0b4d0" intensity={0.06} />
      <directionalLight color="#d0e0ff" intensity={0.5} position={[5, 8, 4]} />
      <pointLight color="#06b6d4" intensity={2.5} distance={40} position={[-3, -1, -5]} />
      <pointLight color="#7c3aed" intensity={1.5} distance={30} position={[-6, 4, 2]} />
      <pointLight color="#f59e0b" intensity={0.4} distance={20} position={[7, 2, 6]} />
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   GLOWING NODE SPHERE
   ═══════════════════════════════════════════════════════════════════ */
function GlowNode({ node, delay }: { node: PipelineNode; delay: number }) {
  const groupRef = useRef<THREE.Group>(null);
  const innerRef = useRef<THREE.Mesh>(null);
  const outerRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (groupRef.current) {
      // Gentle float up/down
      groupRef.current.position.y =
        node.position[1] + Math.sin(t * 0.8 + delay * 2) * 0.12;
    }
    if (innerRef.current) {
      innerRef.current.rotation.y = t * 0.3 + delay;
    }
    if (outerRef.current) {
      const pulse = 0.9 + Math.sin(t * 1.2 + delay * 3) * 0.1;
      outerRef.current.scale.setScalar(pulse);
    }
  });

  const color = new THREE.Color(node.color);

  return (
    <group ref={groupRef} position={node.position}>
      {/* Inner solid core — icosahedron */}
      <mesh ref={innerRef}>
        <icosahedronGeometry args={[node.scale * 0.6, 1]} />
        <meshStandardMaterial
          color={node.color}
          emissive={node.emissive}
          emissiveIntensity={0.8}
          metalness={0.3}
          roughness={0.4}
          transparent
          opacity={0.9}
        />
      </mesh>

      {/* Outer wireframe shell */}
      <mesh ref={outerRef}>
        <icosahedronGeometry args={[node.scale, 1]} />
        <meshBasicMaterial
          color={node.color}
          wireframe
          transparent
          opacity={0.25}
        />
      </mesh>

      {/* Glow sphere — additive blending */}
      <mesh>
        <sphereGeometry args={[node.scale * 1.4, 16, 16]} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={0.06}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   CONNECTION TUBES — curved glowing lines between nodes
   ═══════════════════════════════════════════════════════════════════ */
function ConnectionTube({ from, to, index }: { from: PipelineNode; to: PipelineNode; index: number }) {
  const tubeRef = useRef<THREE.Mesh>(null);

  const { geometry, curve } = useMemo(() => {
    const p0 = new THREE.Vector3(...from.position);
    const p3 = new THREE.Vector3(...to.position);
    const mid = new THREE.Vector3().addVectors(p0, p3).multiplyScalar(0.5);
    // Curve upward for visual interest
    const lift = 0.5 + Math.abs(p3.y - p0.y) * 0.3;
    const offset = (index % 2 === 0 ? 1 : -1) * 0.3;
    const p1 = new THREE.Vector3(
      lerp(p0.x, mid.x, 0.33) + offset,
      lerp(p0.y, mid.y, 0.33) + lift,
      lerp(p0.z, mid.z, 0.33) + offset * 0.5,
    );
    const p2 = new THREE.Vector3(
      lerp(mid.x, p3.x, 0.66) - offset,
      lerp(mid.y, p3.y, 0.66) + lift * 0.7,
      lerp(mid.z, p3.z, 0.66) - offset * 0.5,
    );
    const c = new THREE.CatmullRomCurve3([p0, p1, p2, p3]);
    const g = new THREE.TubeGeometry(c, 48, 0.018, 6, false);
    return { geometry: g, curve: c };
  }, [from, to, index]);

  // Alternate between cyan and purple
  const color = index % 3 === 0 ? "#8B5CF6" : index % 3 === 1 ? "#06B6D4" : "#4F8AFF";

  return (
    <mesh ref={tubeRef} geometry={geometry}>
      <meshBasicMaterial
        color={color}
        transparent
        opacity={0.35}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   FLOWING PARTICLES — animated dots traveling along connection paths
   ═══════════════════════════════════════════════════════════════════ */
function FlowParticles({ from, to, index, count = 3 }: { from: PipelineNode; to: PipelineNode; index: number; count?: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const curve = useMemo(() => {
    const p0 = new THREE.Vector3(...from.position);
    const p3 = new THREE.Vector3(...to.position);
    const mid = new THREE.Vector3().addVectors(p0, p3).multiplyScalar(0.5);
    const lift = 0.5 + Math.abs(p3.y - p0.y) * 0.3;
    const offset = (index % 2 === 0 ? 1 : -1) * 0.3;
    const p1 = new THREE.Vector3(
      lerp(p0.x, mid.x, 0.33) + offset,
      lerp(p0.y, mid.y, 0.33) + lift,
      lerp(p0.z, mid.z, 0.33) + offset * 0.5,
    );
    const p2 = new THREE.Vector3(
      lerp(mid.x, p3.x, 0.66) - offset,
      lerp(mid.y, p3.y, 0.66) + lift * 0.7,
      lerp(mid.z, p3.z, 0.66) - offset * 0.5,
    );
    return new THREE.CatmullRomCurve3([p0, p1, p2, p3]);
  }, [from, to, index]);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.getElapsedTime();
    const speed = 0.15 + (index % 3) * 0.05;
    for (let i = 0; i < count; i++) {
      const progress = ((t * speed + i / count) % 1);
      const point = curve.getPoint(progress);
      dummy.position.copy(point);
      const s = 0.04 + Math.sin(progress * Math.PI) * 0.03;
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  const particleColor = index % 2 === 0 ? "#ffffff" : "#FFBF00";

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <sphereGeometry args={[1, 8, 8]} />
      <meshBasicMaterial
        color={particleColor}
        transparent
        opacity={0.9}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </instancedMesh>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   AMBIENT PARTICLES — floating background particles
   ═══════════════════════════════════════════════════════════════════ */
function AmbientParticles({ count = 150 }: { count?: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const particles = useMemo(() => {
    return Array.from({ length: count }, () => ({
      x: (Math.random() - 0.5) * 20,
      y: Math.random() * 6 - 1,
      z: (Math.random() - 0.5) * 12,
      speed: 0.02 + Math.random() * 0.04,
      phase: Math.random() * Math.PI * 2,
      size: 0.01 + Math.random() * 0.025,
    }));
  }, [count]);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.getElapsedTime();
    for (let i = 0; i < count; i++) {
      const p = particles[i];
      dummy.position.set(
        p.x + Math.sin(t * 0.3 + p.phase) * 0.3,
        ((p.y + t * p.speed) % 7) - 1,
        p.z + Math.cos(t * 0.2 + p.phase) * 0.2,
      );
      dummy.scale.setScalar(p.size);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <sphereGeometry args={[1, 6, 6]} />
      <meshBasicMaterial
        color="#a0c4e8"
        transparent
        opacity={0.35}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </instancedMesh>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   GROUND GRID — subtle holographic floor
   ═══════════════════════════════════════════════════════════════════ */
function GroundGrid() {
  return (
    <group position={[0.5, -1.2, 0]}>
      <gridHelper
        args={[20, 40, new THREE.Color("#06b6d4"), new THREE.Color("#06b6d4")]}
        rotation={[0, 0, 0]}
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <planeGeometry args={[20, 20]} />
        <meshBasicMaterial color="#06b6d4" transparent opacity={0.008} />
      </mesh>
    </group>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   ROTATING PIPELINE GROUP — slowly spins everything
   ═══════════════════════════════════════════════════════════════════ */
function PipelineNetwork() {
  const groupRef = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = clock.getElapsedTime() * 0.03;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Nodes */}
      {PIPELINE_NODES.map((node, i) => (
        <GlowNode key={node.id} node={node} delay={i * 0.5} />
      ))}

      {/* Connection tubes */}
      {CONNECTIONS.map(([fromIdx, toIdx], i) => (
        <ConnectionTube
          key={`tube-${i}`}
          from={PIPELINE_NODES[fromIdx]}
          to={PIPELINE_NODES[toIdx]}
          index={i}
        />
      ))}

      {/* Flow particles on each connection */}
      {CONNECTIONS.map(([fromIdx, toIdx], i) => (
        <FlowParticles
          key={`flow-${i}`}
          from={PIPELINE_NODES[fromIdx]}
          to={PIPELINE_NODES[toIdx]}
          index={i}
          count={2}
        />
      ))}
    </group>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   POST-PROCESSING — bloom glow
   ═══════════════════════════════════════════════════════════════════ */
function PostFX() {
  return (
    <EffectComposer>
      <Bloom
        intensity={0.6}
        luminanceThreshold={0.15}
        luminanceSmoothing={0.9}
        mipmapBlur
      />
    </EffectComposer>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   INNER SCENE — all 3D content
   ═══════════════════════════════════════════════════════════════════ */
function InnerScene({ isMobile }: { isMobile: boolean }) {
  return (
    <>
      <CameraController />
      <SceneLights />
      <fog attach="fog" args={["#07070D", 12, 28]} />
      <PipelineNetwork />
      <AmbientParticles count={isMobile ? 50 : 150} />
      <GroundGrid />
      {!isMobile && <PostFX />}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   EXPORTED COMPONENT
   ═══════════════════════════════════════════════════════════════════ */
export function TemplatesHeroScene() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [canRender, setCanRender] = useState(false);

  useEffect(() => {
    setIsMobile(window.innerWidth < 768);
    // Check WebGL support
    try {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl2") || c.getContext("webgl");
      setCanRender(!!gl);
    } catch {
      setCanRender(false);
    }
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      mouse.x = (e.clientX / window.innerWidth - 0.5) * 2;
      mouse.y = -(e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMove);
  }, []);

  if (!canRender) return null;

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 0,
      }}
    >
      <Canvas
        camera={{ position: [0.5, 1.8, 10], fov: 45, near: 0.1, far: 100 }}
        gl={{
          antialias: !isMobile,
          alpha: true,
          powerPreference: "high-performance",
        }}
        dpr={[1, 2]}
        style={{ background: "transparent" }}
      >
        <InnerScene isMobile={isMobile} />
      </Canvas>
    </div>
  );
}
