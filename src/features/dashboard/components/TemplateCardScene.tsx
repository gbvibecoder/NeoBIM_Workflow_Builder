"use client";

/* ═══════════════════════════════════════════════════════════════════
   INLINE 3D SCENES — rendered behind text on each template card
   Each scene auto-rotates and represents the workflow's output.

   Extracted into its own module so the ~750KB three + @react-three/fiber
   bundle is code-split out of /dashboard/templates' initial chunk and
   loaded on demand via next/dynamic from page.tsx.
   ═══════════════════════════════════════════════════════════════════ */

import React, { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { BoxGeometry, EdgesGeometry, Group, Mesh, Vector3, CatmullRomCurve3, BufferGeometry, PlaneGeometry, InstancedMesh, Object3D, DoubleSide } from "three";

function EBox({ args, color, edgeColor, pos, op = 0.25, eo = 0.5 }: {
  args: [number, number, number]; color: string; edgeColor: string;
  pos: [number, number, number]; op?: number; eo?: number;
}) {
  const geo = useMemo(() => new BoxGeometry(...args), [args]);
  const edges = useMemo(() => new EdgesGeometry(geo), [geo]);
  return (
    <group position={pos}>
      <mesh geometry={geo}><meshStandardMaterial color={color} transparent opacity={op} roughness={0.8} /></mesh>
      <lineSegments geometry={edges}><lineBasicMaterial color={edgeColor} transparent opacity={eo} /></lineSegments>
    </group>
  );
}

// wf-01: Floor plan lines
function Scene01() {
  const ref = useRef<Group>(null);
  const dotRef = useRef<Mesh>(null);
  const path = useMemo(() => {
    const pts = [[0,0],[5,0],[5,4],[0,4],[0,0]].map(([x,z]) => new Vector3(x-2.5, 0.05, z-2));
    return new CatmullRomCurve3(pts, true);
  }, []);
  const lines = useMemo(() => {
    const segs: [number,number,number,number][] = [[0,0,5,0],[5,0,5,4],[5,4,0,4],[0,4,0,0],[0,2.2,3,2.2],[3.3,2.2,5,2.2],[3,0,3,2],[3,2.4,3,4]];
    return segs.map(([x1,z1,x2,z2]) => new BufferGeometry().setFromPoints([new Vector3(x1-2.5,0,z1-2), new Vector3(x2-2.5,0,z2-2)]));
  }, []);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.rotation.y = clock.getElapsedTime() * 0.08;
    if (dotRef.current) { const p = path.getPoint((clock.getElapsedTime()*0.1)%1); dotRef.current.position.copy(p); }
  });
  return (
    <group ref={ref} position={[0,-0.5,0]}>
      {lines.map((g,i) => <lineSegments key={i} geometry={g}><lineBasicMaterial color="#06b6d4" transparent opacity={0.5} /></lineSegments>)}
      <mesh ref={dotRef}><sphereGeometry args={[0.08,8,8]} /><meshBasicMaterial color="#06b6d4" /></mesh>
      <mesh rotation={[-Math.PI/2,0,0]} position={[0,-0.02,0]}><planeGeometry args={[6,5,12,10]} /><meshBasicMaterial color="#06b6d4" wireframe transparent opacity={0.05} /></mesh>
    </group>
  );
}

// wf-03: Wireframe building
function Scene03() {
  const ref = useRef<Group>(null);
  useFrame(({ clock }) => { if (ref.current) ref.current.rotation.y = clock.getElapsedTime()*0.1; });
  return (
    <group ref={ref}>
      <EBox args={[2,3,1.5]} color="#1e1e3a" edgeColor="#a855f7" pos={[0,1.5,0]} op={0.15} eo={0.55} />
      <EBox args={[2.1,0.06,1.6]} color="#a855f7" edgeColor="#a855f7" pos={[0,1,0]} op={0.08} eo={0.3} />
      <EBox args={[2.1,0.06,1.6]} color="#a855f7" edgeColor="#a855f7" pos={[0,2,0]} op={0.08} eo={0.3} />
      {[[-0.8,-0.6],[0.8,-0.6],[-0.8,0.6],[0.8,0.6]].map(([x,z],i) => <EBox key={i} args={[0.12,3,0.12]} color="#475569" edgeColor="#94a3b8" pos={[x,1.5,z]} op={0.25} eo={0.4} />)}
      <EBox args={[2.3,0.08,1.8]} color="#1e293b" edgeColor="#a855f7" pos={[0,3.04,0]} op={0.2} eo={0.45} />
    </group>
  );
}

// wf-04: Breathing massing volumes
function Scene04() {
  const ref = useRef<Group>(null);
  const v0 = useRef<Group>(null);
  const v1 = useRef<Group>(null);
  const v2 = useRef<Group>(null);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (ref.current) ref.current.rotation.y = t*0.07;
    if (v0.current) { v0.current.scale.y = 1+Math.sin(t*0.8)*0.1; }
    if (v1.current) { v1.current.scale.y = 1+Math.sin(t*0.6+2)*0.12; }
    if (v2.current) { v2.current.scale.y = 1+Math.sin(t*0.9+1)*0.08; }
  });
  return (
    <group ref={ref}>
      <group ref={v0} position={[-1,1.25,-0.3]}><EBox args={[1.3,2.5,1.3]} color="#0e1e30" edgeColor="#06b6d4" pos={[0,0,0]} op={0.15} eo={0.5} /></group>
      <group ref={v1} position={[0.8,0.5,0.5]}><EBox args={[2,1,1.5]} color="#1a0e30" edgeColor="#a855f7" pos={[0,0,0]} op={0.12} eo={0.45} /></group>
      <group ref={v2} position={[0.2,1.5,-0.8]}><EBox args={[1,3,1]} color="#0e2a20" edgeColor="#10b981" pos={[0,0,0]} op={0.12} eo={0.5} /></group>
    </group>
  );
}

// wf-06: Orbiting camera around render screen
function Scene06() {
  const ref = useRef<Group>(null);
  const camRef = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (ref.current) ref.current.rotation.y = t*0.05;
    if (camRef.current) { camRef.current.position.set(Math.cos(t*0.4)*2.2, 0.5+Math.sin(t*0.2)*0.3, Math.sin(t*0.4)*2.2); }
  });
  const screenEdges = useMemo(() => new EdgesGeometry(new BoxGeometry(2.5,1.5,0.05)), []);
  return (
    <group ref={ref}>
      <mesh position={[0,0.5,0]}><boxGeometry args={[2.5,1.5,0.05]} /><meshStandardMaterial color="#10b981" transparent opacity={0.08} emissive="#10b981" emissiveIntensity={0.3} /></mesh>
      <lineSegments geometry={screenEdges} position={[0,0.5,0]}><lineBasicMaterial color="#10b981" transparent opacity={0.45} /></lineSegments>
      <mesh ref={camRef}><octahedronGeometry args={[0.12,0]} /><meshBasicMaterial color="#8b5cf6" transparent opacity={0.8} /></mesh>
      <mesh rotation={[-Math.PI/2,0,0]} position={[0,0.5,0]}><ringGeometry args={[2.1,2.2,48]} /><meshBasicMaterial color="#8b5cf6" transparent opacity={0.1} side={DoubleSide} /></mesh>
    </group>
  );
}

// wf-08: PDF → Building flow with particles
function Scene08() {
  const ref = useRef<Group>(null);
  const particles = useRef<InstancedMesh>(null);
  const dummy = useMemo(() => new Object3D(), []);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (ref.current) ref.current.rotation.y = t*0.04;
    if (particles.current) {
      for (let i = 0; i < 8; i++) {
        const p = ((t*0.3+i/8)%1);
        dummy.position.set(-1.5+p*3, 0.8+Math.sin(p*Math.PI)*0.3, 0);
        dummy.scale.setScalar(0.04+Math.sin(p*Math.PI)*0.02);
        dummy.updateMatrix();
        particles.current.setMatrixAt(i, dummy.matrix);
      }
      particles.current.instanceMatrix.needsUpdate = true;
    }
  });
  return (
    <group ref={ref}>
      <EBox args={[1,1.4,0.05]} color="#1e293b" edgeColor="#3b82f6" pos={[-1.5,0.8,0]} op={0.15} eo={0.45} />
      <instancedMesh ref={particles} args={[undefined,undefined,8]}><sphereGeometry args={[1,6,6]} /><meshBasicMaterial color="#06b6d4" transparent opacity={0.7} /></instancedMesh>
      <EBox args={[1.2,1.8,0.8]} color="#0e1e30" edgeColor="#06b6d4" pos={[1.5,0.9,0]} op={0.12} eo={0.45} />
      <EBox args={[1.3,0.05,0.9]} color="#06b6d4" edgeColor="#06b6d4" pos={[1.5,1.8,0]} op={0.1} eo={0.3} />
    </group>
  );
}

// wf-09: Animated bar chart
function Scene09() {
  const ref = useRef<Group>(null);
  const bars = useRef<Mesh[]>([]);
  const heights = [1.5,2.4,1.0,2.8,1.8];
  const colors = ["#06b6d4","#a855f7","#10b981","#f59e0b","#3b82f6"];
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (ref.current) ref.current.rotation.y = t*0.06;
    bars.current.forEach((bar,i) => { if (bar) { const h = heights[i]*(1+Math.sin(t*0.7+i*1.2)*0.12); bar.scale.y = h/heights[i]; bar.position.y = h/2; } });
  });
  return (
    <group ref={ref}>
      {heights.map((h,i) => {
        const geo = new BoxGeometry(0.35,h,0.35);
        const edgeGeo = new EdgesGeometry(geo);
        return (
          <group key={i}>
            <mesh ref={el => { if (el) bars.current[i]=el; }} position={[-1.2+i*0.6,h/2,0]}><boxGeometry args={[0.35,h,0.35]} /><meshStandardMaterial color={colors[i]} transparent opacity={0.2} /></mesh>
            <lineSegments geometry={edgeGeo} position={[-1.2+i*0.6,h/2,0]}><lineBasicMaterial color={colors[i]} transparent opacity={0.5} /></lineSegments>
          </group>
        );
      })}
    </group>
  );
}

// wf-05: Mini extruded floor plan
function Scene05() {
  const ref = useRef<Group>(null);
  useFrame(({ clock }) => { if (ref.current) ref.current.rotation.y = clock.getElapsedTime()*0.12; });
  return (
    <group ref={ref} position={[0,-0.3,0]}>
      <EBox args={[2,0.5,1.5]} color="#0e1e30" edgeColor="#3b82f6" pos={[-0.5,0.25,-0.5]} op={0.1} eo={0.4} />
      <EBox args={[1.2,0.5,1.5]} color="#1a0e30" edgeColor="#a78bfa" pos={[1.1,0.25,-0.5]} op={0.1} eo={0.4} />
      <EBox args={[3.2,0.5,1.2]} color="#0e2a20" edgeColor="#06b6d4" pos={[0.1,0.25,0.85]} op={0.1} eo={0.4} />
    </group>
  );
}

// wf-11: Before/after split
function Scene11() {
  const ref = useRef<Group>(null);
  const divRef = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (ref.current) ref.current.rotation.y = t*0.04;
    if (divRef.current) divRef.current.position.x = Math.sin(t*0.5)*0.3;
  });
  const eL = useMemo(() => new EdgesGeometry(new PlaneGeometry(1.4,1.8)), []);
  const eR = useMemo(() => new EdgesGeometry(new PlaneGeometry(1.4,1.8)), []);
  return (
    <group ref={ref}>
      <mesh position={[-0.8,0.8,0]}><planeGeometry args={[1.4,1.8]} /><meshStandardMaterial color="#7f1d1d" transparent opacity={0.12} /></mesh>
      <lineSegments geometry={eL} position={[-0.8,0.8,0.01]}><lineBasicMaterial color="#ef4444" transparent opacity={0.3} /></lineSegments>
      <mesh position={[0.8,0.8,0]}><planeGeometry args={[1.4,1.8]} /><meshStandardMaterial color="#0e2a20" transparent opacity={0.12} /></mesh>
      <lineSegments geometry={eR} position={[0.8,0.8,0.01]}><lineBasicMaterial color="#10b981" transparent opacity={0.35} /></lineSegments>
      <mesh ref={divRef} position={[0,0.8,0.02]}><planeGeometry args={[0.03,1.9]} /><meshBasicMaterial color="#ffffff" transparent opacity={0.5} /></mesh>
    </group>
  );
}

// wf-12: Clash detection — intersecting beams + pulse
function Scene12() {
  const ref = useRef<Group>(null);
  const pulseRef = useRef<Mesh>(null);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (ref.current) ref.current.rotation.y = t*0.06;
    if (pulseRef.current) { const s = 0.9+Math.sin(t*2)*0.3; pulseRef.current.scale.setScalar(s); }
  });
  return (
    <group ref={ref}>
      <EBox args={[3.5,0.25,0.25]} color="#475569" edgeColor="#94a3b8" pos={[0,0.8,0]} op={0.2} eo={0.4} />
      <EBox args={[0.25,0.25,3]} color="#475569" edgeColor="#f59e0b" pos={[0,0.8,0]} op={0.2} eo={0.4} />
      <group position={[0,0.8,0]} rotation={[0,0,Math.PI/6]}>
        <EBox args={[3,0.15,0.15]} color="#2d1b69" edgeColor="#a855f7" pos={[0,0,0]} op={0.15} eo={0.35} />
      </group>
      <mesh ref={pulseRef} position={[0,0.8,0]}><sphereGeometry args={[0.25,16,16]} /><meshBasicMaterial color="#ef4444" transparent opacity={0.4} /></mesh>
      <mesh position={[0.6,0.8,0.6]}><sphereGeometry args={[0.15,12,12]} /><meshBasicMaterial color="#f59e0b" transparent opacity={0.3} /></mesh>
    </group>
  );
}

// Scene registry
const CARD_SCENES: Record<string, React.FC> = {
  "wf-01": Scene01, "wf-03": Scene03, "wf-04": Scene04,
  "wf-06": Scene06, "wf-08": Scene08, "wf-09": Scene09,
  "wf-05": Scene05, "wf-11": Scene11, "wf-12": Scene12,
};

export default function CardScene3D({ wfId }: { wfId: string }) {
  const SceneComp = CARD_SCENES[wfId];
  if (!SceneComp) return null;
  return (
    <Canvas
      camera={{ position: [3, 2.5, 3], fov: 42, near: 0.1, far: 30 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      dpr={[1, 2]}
      style={{ width: "100%", height: "100%", background: "transparent" }}
    >
      <ambientLight color="#b0c0d0" intensity={0.3} />
      <directionalLight color="#e0e8ff" intensity={0.7} position={[2, 3, 2]} />
      <SceneComp />
    </Canvas>
  );
}
