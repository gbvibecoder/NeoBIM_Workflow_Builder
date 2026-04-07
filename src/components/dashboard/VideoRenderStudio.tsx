"use client";

import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  Suspense,
} from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import {
  Upload,
  Video,
  Sparkles,
  ArrowRight,
  RotateCcw,
  Download,
  ChevronRight,
  Zap,
  Eye,
  Layers,
  Camera,
  Play,
  Check,
  MoveHorizontal,
  PenTool,
  Share2,
  Film,
  Maximize2,
} from "lucide-react";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

type WizardStep = "upload" | "processing" | "gallery" | "video";

interface RenderResult {
  id: string;
  label: string;
  angle: string;
  apiAngle: string;
  url: string | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// COPY — Sarcastic microcopy bank
// ═══════════════════════════════════════════════════════════════════════════════

const COPY = {
  hero: {
    title: "Your Floor Plan Deserves Better Than Your Imagination",
    subtitle:
      "We take your 2D lines and give them a personality, depth, and honestly? A glow-up they've been needing since AutoCAD.",
  },
  upload: {
    title: "Feed Us Your Blueprint",
    subtitle: "Drop your floor plan here. We promise not to judge your room sizes... much.",
    dragActive: "Yes, right there. Perfect aim.",
    generating: "Don't have one? We'll hallucinate one. Responsibly.",
  },
  processing: {
    stages: [
      "Teaching your walls about depth perception...",
      "Convincing the bathroom tiles to look expensive...",
      "Our AI is overthinking your kitchen island. Give it a moment.",
      "Making it look like you hired an architect...",
      "Adding that natural lighting your actual apartment doesn't have...",
      "Almost done. Our AI just needed a coffee break.",
    ],
  },
  gallery: {
    title: "Plot Twist: Your Design Actually Looks Good",
    subtitle: "Drag the slider to witness the glow-up. Left = your plan. Right = what we made of it.",
  },
  video: {
    title: "Now in Cinematic Universe",
    subtitle: "Because static images are so 2024. Let's turn this into a walkthrough that'll make your clients weep.",
    generating: "Rendering frames... each one more dramatic than the last.",
    done: "Your video is ready. Try not to watch it 47 times.",
  },
  models: {
    nanoBanana: "Fast and stylized. Like an architect who drinks too much espresso.",
    seedance: "Slow and gorgeous. The Architectural Digest of render engines.",
    photorealistic: "So real you'll try to walk into the screen.",
  },
};

const RENDER_VIEWS: Omit<RenderResult, "url">[] = [
  { id: "r1", label: "Living Room", angle: "Interior View", apiAngle: "roomInterior:Living Room" },
  { id: "r2", label: "Kitchen", angle: "Interior View", apiAngle: "roomInterior:Kitchen" },
  { id: "r3", label: "Bedroom", angle: "Interior View", apiAngle: "roomInterior:Bedroom" },
  { id: "r4", label: "Full Layout", angle: "Top Down", apiAngle: "topDown" },
];

// Model options kept for future use but not rendered in current UI
// const MODEL_OPTIONS = [
//   { id: "nano", label: "Nano Banana 2", desc: COPY.models.nanoBanana, badge: "Fast" },
//   { id: "seedance", label: "Seedance 2.0", desc: COPY.models.seedance, badge: "Premium" },
//   { id: "photo", label: "Photorealistic", desc: COPY.models.photorealistic, badge: "HD" },
// ];

// ═══════════════════════════════════════════════════════════════════════════════
// THREE.JS — FLOATING ARCHITECTURAL WIREFRAME
// ═══════════════════════════════════════════════════════════════════════════════

function FloorPlanGrid() {
  const groupRef = useRef<THREE.Group>(null);

  const lineObjects = useMemo(() => {
    const wallColor = "#6366F1";
    const roomColor = "#A5B4FC";
    const accentColor = "#F59E0B";

    const walls: THREE.Vector3[] = [
      new THREE.Vector3(-3, 0, -2), new THREE.Vector3(3, 0, -2),
      new THREE.Vector3(3, 0, -2), new THREE.Vector3(3, 0, 2),
      new THREE.Vector3(3, 0, 2), new THREE.Vector3(-3, 0, 2),
      new THREE.Vector3(-3, 0, 2), new THREE.Vector3(-3, 0, -2),
    ];
    const rooms: THREE.Vector3[] = [
      new THREE.Vector3(0, 0, -2), new THREE.Vector3(0, 0, 0.5),
      new THREE.Vector3(-3, 0, 0), new THREE.Vector3(-0.5, 0, 0),
      new THREE.Vector3(1, 0, 0), new THREE.Vector3(3, 0, 0),
      new THREE.Vector3(1.5, 0, -2), new THREE.Vector3(1.5, 0, 0),
    ];
    const accents: THREE.Vector3[] = [
      new THREE.Vector3(-0.5, 0, 0), new THREE.Vector3(0.2, 0, 0.5),
      new THREE.Vector3(0.2, 0, 0.5), new THREE.Vector3(1, 0, 0),
    ];

    return [
      { pts: walls, color: wallColor, opacity: 0.7 },
      { pts: rooms, color: roomColor, opacity: 0.5 },
      { pts: accents, color: accentColor, opacity: 0.6 },
    ].map(({ pts, color, opacity }) => {
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity });
      return new THREE.LineSegments(geo, mat);
    });
  }, []);

  const extrudedWalls = useMemo(() => {
    const positions: { p: [number, number, number]; s: [number, number, number] }[] = [
      { p: [0, 0.3, -2], s: [6, 0.6, 0.08] },
      { p: [0, 0.3, 2], s: [6, 0.6, 0.08] },
      { p: [-3, 0.3, 0], s: [0.08, 0.6, 4] },
      { p: [3, 0.3, 0], s: [0.08, 0.6, 4] },
      { p: [0, 0.3, -0.75], s: [0.06, 0.6, 2.5] },
      { p: [-1.75, 0.3, 0], s: [2.5, 0.6, 0.06] },
      { p: [2, 0.3, 0], s: [2, 0.6, 0.06] },
    ];
    return positions;
  }, []);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    groupRef.current.rotation.x = -0.45 + Math.sin(clock.elapsedTime * 0.12) * 0.04;
    groupRef.current.rotation.y = clock.elapsedTime * 0.06;
    groupRef.current.position.y = Math.sin(clock.elapsedTime * 0.25) * 0.06;
  });

  return (
    <group ref={groupRef}>
      {lineObjects.map((obj, i) => (
        <primitive key={i} object={obj} />
      ))}
      {extrudedWalls.map((w, i) => (
        <mesh key={`w${i}`} position={w.p}>
          <boxGeometry args={w.s} />
          <meshBasicMaterial color="#6366F1" transparent opacity={0.08} />
        </mesh>
      ))}
      {([[-1.5, 0.05, -1], [2.2, 0.05, -1], [-1.5, 0.05, 1], [1.5, 0.05, 1]] as [number, number, number][]).map((pos, i) => (
        <mesh key={`d${i}`} position={pos}>
          <sphereGeometry args={[0.08, 16, 16]} />
          <meshBasicMaterial
            color={["#6366F1", "#F59E0B", "#10B981", "#EC4899"][i]}
            transparent
            opacity={0.7}
          />
        </mesh>
      ))}
    </group>
  );
}

// Seeded pseudo-random for deterministic particle positions (React 19 purity)
function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

// Pre-compute particle positions (deterministic, pure)
function createParticlePositions(count: number) {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (seededRandom(i * 3 + 1) - 0.5) * 14;
    pos[i * 3 + 1] = (seededRandom(i * 3 + 2) - 0.5) * 10;
    pos[i * 3 + 2] = (seededRandom(i * 3 + 3) - 0.5) * 10;
  }
  return pos;
}

const POSITIONS_80 = createParticlePositions(80);
const POSITIONS_50 = createParticlePositions(50);

function FloatingParticles({ count = 80 }: { count?: number }) {
  const ref = useRef<THREE.Points>(null);
  const velRef = useRef<Float32Array | null>(null);
  const positions = count === 50 ? POSITIONS_50 : POSITIONS_80;

  useEffect(() => {
    const vel = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      vel[i * 3] = (seededRandom(i * 7 + 100) - 0.5) * 0.004;
      vel[i * 3 + 1] = (seededRandom(i * 7 + 200) - 0.5) * 0.004;
      vel[i * 3 + 2] = (seededRandom(i * 7 + 300) - 0.5) * 0.004;
    }
    velRef.current = vel;
  }, [count]);

  useFrame(() => {
    if (!ref.current || !velRef.current) return;
    const arr = ref.current.geometry.attributes.position.array as Float32Array;
    const vel = velRef.current;
    for (let i = 0; i < count; i++) {
      for (let j = 0; j < 3; j++) {
        arr[i * 3 + j] += vel[i * 3 + j];
        if (Math.abs(arr[i * 3 + j]) > 7) vel[i * 3 + j] *= -1;
      }
    }
    ref.current.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial color="#818CF8" size={0.05} transparent opacity={0.6} sizeAttenuation />
    </points>
  );
}

function HeroScene() {
  return (
    <Canvas
      camera={{ position: [0, 3.5, 6.5], fov: 42 }}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
      gl={{ alpha: true, antialias: true }}
    >
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 5, 5]} intensity={0.4} />
      <Suspense fallback={null}>
        <FloorPlanGrid />
        <FloatingParticles />
      </Suspense>
    </Canvas>
  );
}

// ModelSelector component removed from UI — kept commented for future use

// ═══════════════════════════════════════════════════════════════════════════════
// COMPARISON SLIDER
// ═══════════════════════════════════════════════════════════════════════════════

function ComparisonSlider({
  beforeSrc,
  afterSrc,
}: {
  beforeSrc: string | null;
  afterSrc: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [sliderPos, setSliderPos] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const [imgRatio, setImgRatio] = useState("4/3");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset ratio when source clears
    if (!beforeSrc) { setImgRatio("4/3"); return; }
    const img = new Image();
    img.onload = () => setImgRatio(`${img.naturalWidth}/${img.naturalHeight}`);
    img.src = beforeSrc;
  }, [beforeSrc]);

  const handleMove = useCallback((clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pct = Math.max(5, Math.min(95, ((clientX - rect.left) / rect.width) * 100));
    setSliderPos(pct);
  }, []);

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      handleMove("touches" in e ? e.touches[0].clientX : e.clientX);
    };
    const onUp = () => setIsDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchend", onUp);
    };
  }, [isDragging, handleMove]);

  // Auto-reveal animation on first load
  const [hasRevealed, setHasRevealed] = useState(false);
  useEffect(() => {
    if (hasRevealed || (!beforeSrc && !afterSrc)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time reveal flag
    setHasRevealed(true);
    let frame: number;
    let start: number | null = null;
    const animate = (ts: number) => {
      if (!start) start = ts;
      const elapsed = ts - start;
      if (elapsed < 1200) {
        setSliderPos(5 + (45 * elapsed) / 1200);
        frame = requestAnimationFrame(animate);
      } else {
        setSliderPos(50);
      }
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [beforeSrc, afterSrc, hasRevealed]);

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-2xl select-none"
        style={{
          aspectRatio: imgRatio,
          maxHeight: "65vh",
          cursor: isDragging ? "grabbing" : "ew-resize",
          boxShadow: "0 20px 60px rgba(99,102,241,0.15), 0 4px 20px rgba(0,0,0,0.08)",
        }}
        onMouseDown={(e) => { setIsDragging(true); handleMove(e.clientX); }}
        onTouchStart={(e) => { setIsDragging(true); handleMove(e.touches[0].clientX); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setSliderPos((p) => Math.max(5, p - 2));
          if (e.key === "ArrowRight") setSliderPos((p) => Math.min(95, p + 2));
        }}
        tabIndex={0}
        role="slider"
        aria-label="Before/After comparison slider"
        aria-valuemin={5}
        aria-valuemax={95}
        aria-valuenow={Math.round(sliderPos)}
      >
        {/* BEFORE */}
        <div className="absolute inset-0 bg-white">
          {beforeSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={beforeSrc} alt="2D Floor Plan" className="w-full h-full object-contain bg-white" draggable={false} />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gray-50">
              <div className="text-center text-gray-300">
                <Layers size={40} className="mx-auto mb-2" />
                <p className="text-xs font-medium">2D Floor Plan</p>
              </div>
            </div>
          )}
        </div>

        {/* AFTER */}
        <div className="absolute inset-0" style={{ clipPath: `inset(0 0 0 ${sliderPos}%)` }}>
          {afterSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={afterSrc} alt="3D Render" className="w-full h-full object-cover" draggable={false} />
          ) : (
            <div className="w-full h-full flex items-center justify-center" style={{
              background: "linear-gradient(145deg, #EEF2FF 0%, #E0E7FF 35%, #C7D2FE 65%, #A5B4FC 100%)",
            }}>
              <div className="absolute inset-0 opacity-[0.07]" style={{
                backgroundImage: "linear-gradient(rgba(99,102,241,1) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,1) 1px, transparent 1px)",
                backgroundSize: "40px 40px",
              }} />
              <div className="absolute inset-0" style={{ background: "radial-gradient(circle at 50% 50%, rgba(255,255,255,0.5) 0%, transparent 70%)" }} />
              <div className="relative text-center z-10">
                <div className="w-14 h-14 rounded-2xl mx-auto mb-3 flex items-center justify-center" style={{ background: "rgba(99,102,241,0.12)", backdropFilter: "blur(8px)" }}>
                  <Sparkles size={24} className="text-indigo-500" />
                </div>
                <p className="text-sm font-bold text-indigo-700">3D Render</p>
                <p className="text-[11px] text-indigo-400 mt-1">AI-generated preview</p>
              </div>
            </div>
          )}
        </div>

        {/* Slider line + handle */}
        <div className="absolute top-0 bottom-0 z-20" style={{ left: `${sliderPos}%`, transform: "translateX(-50%)" }}>
          <div className="absolute inset-y-0 w-[2px] bg-white" style={{ left: "50%", transform: "translateX(-50%)", boxShadow: "0 0 8px rgba(0,0,0,0.3)" }} />
          <div
            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 rounded-full flex items-center justify-center cursor-grab active:cursor-grabbing"
            style={{
              background: "linear-gradient(135deg, #6366F1, #4F46E5)",
              boxShadow: "0 4px 20px rgba(99,102,241,0.5), 0 0 0 3px rgba(255,255,255,0.9)",
              touchAction: "none",
            }}
          >
            <MoveHorizontal size={18} className="text-white" />
          </div>
        </div>

        {/* Corner labels */}
        <div className="absolute top-3 left-3 z-10">
          <span className="px-3 py-1.5 rounded-full text-[11px] font-bold bg-white/95 text-gray-700 shadow-md backdrop-blur-sm">BEFORE</span>
        </div>
        <div className="absolute top-3 right-3 z-10">
          <span className="px-3 py-1.5 rounded-full text-[11px] font-bold text-white shadow-md backdrop-blur-sm" style={{ background: "linear-gradient(135deg, #6366F1, #4F46E5)" }}>AFTER</span>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// UPLOAD ZONE
// ═══════════════════════════════════════════════════════════════════════════════

function UploadZone({
  onFileSelect,
  uploadedFile,
  previewUrl,
}: {
  onFileSelect: (file: File) => void;
  uploadedFile: File | null;
  previewUrl: string | null;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith("image/")) onFileSelect(file);
  }, [onFileSelect]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2, duration: 0.5, ease: [0.25, 0.4, 0.25, 1] }}
      className="max-w-2xl mx-auto"
    >
      {!uploadedFile ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className="cursor-pointer"
        >
          <motion.div
            animate={{
              borderColor: dragOver ? "#6366F1" : "#D1D5DB",
              background: dragOver ? "rgba(99,102,241,0.06)" : "rgba(255,255,255,0.8)",
            }}
            className="border-2 border-dashed rounded-2xl p-10 text-center backdrop-blur-sm"
            style={{ boxShadow: "0 4px 24px rgba(0,0,0,0.04)" }}
          >
            <motion.div
              animate={{ scale: dragOver ? 1.15 : 1, rotate: dragOver ? 8 : 0 }}
              transition={{ type: "spring", stiffness: 300 }}
              className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4"
              style={{ background: "linear-gradient(135deg, #EEF2FF, #E0E7FF)" }}
            >
              <Upload size={24} className="text-indigo-500" />
            </motion.div>
            <h3 className="text-lg font-bold text-gray-800 mb-1.5">
              {dragOver ? COPY.upload.dragActive : COPY.upload.title}
            </h3>
            <p className="text-sm text-gray-500 max-w-sm mx-auto mb-4 italic">
              {COPY.upload.subtitle}
            </p>
            <div className="flex items-center justify-center gap-2 text-xs text-gray-400">
              {["PNG", "JPG", "WEBP"].map((f) => (
                <span key={f} className="px-2.5 py-1 rounded-md bg-gray-100 font-mono font-medium">{f}</span>
              ))}
              <span className="text-gray-300 mx-1">|</span>
              <span>Max 10MB</span>
            </div>
          </motion.div>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFileSelect(f); }}
          />
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-2xl overflow-hidden border border-gray-200 bg-white"
          style={{ boxShadow: "0 8px 32px rgba(0,0,0,0.08)" }}
        >
          {previewUrl && (
            <div className="relative bg-white p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={previewUrl} alt="Uploaded floor plan" className="w-full rounded-xl" style={{ maxHeight: 320, objectFit: "contain" }} />
              <div className="absolute top-5 right-5">
                <span className="px-3 py-1.5 rounded-full text-xs font-bold bg-emerald-500 text-white flex items-center gap-1.5 shadow-lg">
                  <Check size={12} /> Uploaded
                </span>
              </div>
            </div>
          )}
          <div className="px-4 py-2.5 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
            <span className="text-sm text-gray-600 truncate max-w-[200px] font-medium">{uploadedFile.name}</span>
            <span className="text-xs text-gray-400">{(uploadedFile.size / 1024 / 1024).toFixed(1)} MB</span>
          </div>
        </motion.div>
      )}

      {/* OR divider */}
      <div className="flex items-center gap-4 mt-5">
        <div className="flex-1 h-px bg-gray-200" />
        <span className="text-[10px] text-gray-400 font-bold uppercase tracking-[3px]">or</span>
        <div className="flex-1 h-px bg-gray-200" />
      </div>

      {/* Generate floor plan link */}
      <Link href="/dashboard/floor-plan">
        <motion.div
          whileHover={{ scale: 1.01, y: -1 }}
          whileTap={{ scale: 0.99 }}
          className="mt-4 flex items-center gap-4 p-4 rounded-xl border border-indigo-100 bg-indigo-50/60 cursor-pointer group hover:border-indigo-200 transition-colors"
        >
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg, #E0E7FF, #C7D2FE)" }}>
            <PenTool size={18} className="text-indigo-600" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-gray-800">Generate a 2D Floor Plan with AI</p>
            <p className="text-xs text-gray-500 mt-0.5 italic">{COPY.upload.generating}</p>
          </div>
          <ChevronRight size={16} className="text-indigo-400 group-hover:translate-x-1 transition-transform shrink-0" />
        </motion.div>
      </Link>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// IMMERSIVE PROCESSING VIEW
// ═══════════════════════════════════════════════════════════════════════════════

function MaterializingBuilding({ progress }: { progress: number }) {
  const groupRef = useRef<THREE.Group>(null);
  const materialized = progress / 100;

  const walls = useMemo(() => [
    { p: [0, 0.5, -2] as [number, number, number], s: [6, 1, 0.08] as [number, number, number] },
    { p: [0, 0.5, 2] as [number, number, number], s: [6, 1, 0.08] as [number, number, number] },
    { p: [-3, 0.5, 0] as [number, number, number], s: [0.08, 1, 4] as [number, number, number] },
    { p: [3, 0.5, 0] as [number, number, number], s: [0.08, 1, 4] as [number, number, number] },
    { p: [0, 0.5, -0.5] as [number, number, number], s: [0.06, 1, 3] as [number, number, number] },
    { p: [-1.5, 0.5, 0.5] as [number, number, number], s: [3, 1, 0.06] as [number, number, number] },
    { p: [1.5, 0.5, 0] as [number, number, number], s: [3, 1, 0.06] as [number, number, number] },
  ], []);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    groupRef.current.rotation.y = clock.elapsedTime * 0.08;
    groupRef.current.position.y = Math.sin(clock.elapsedTime * 0.3) * 0.05;
  });

  return (
    <group ref={groupRef} rotation={[-0.5, 0, 0]}>
      <mesh position={[0, -0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[7, 5]} />
        <meshBasicMaterial color="#6366F1" transparent opacity={0.03 + materialized * 0.04} />
      </mesh>
      {walls.map((w, i) => (
        <mesh key={`wire-${i}`} position={w.p}>
          <boxGeometry args={w.s} />
          <meshBasicMaterial color="#A5B4FC" wireframe transparent opacity={0.3 * (1 - materialized * 0.5)} />
        </mesh>
      ))}
      {walls.map((w, i) => {
        const wallProgress = Math.max(0, Math.min(1, (materialized - i * 0.1) / 0.3));
        return (
          <mesh key={`solid-${i}`} position={w.p} scale={[1, wallProgress, 1]}>
            <boxGeometry args={w.s} />
            <meshBasicMaterial color="#6366F1" transparent opacity={wallProgress * 0.15} />
          </mesh>
        );
      })}
      {Array.from({ length: 30 }).map((_, i) => {
        const angle = (i / 30) * Math.PI * 2;
        const radius = 3.5 + Math.sin(i * 1.7) * 0.5;
        const height = (i / 30) * materialized * 1.5;
        return (
          <mesh key={`p-${i}`} position={[Math.cos(angle) * radius, height, Math.sin(angle) * radius]}>
            <sphereGeometry args={[0.03, 8, 8]} />
            <meshBasicMaterial color={i % 3 === 0 ? "#10B981" : "#818CF8"} transparent opacity={0.5 + materialized * 0.3} />
          </mesh>
        );
      })}
    </group>
  );
}

function ProcessingScene({ progress }: { progress: number }) {
  return (
    <Canvas camera={{ position: [0, 3, 6], fov: 40 }} style={{ position: "absolute", inset: 0 }} gl={{ alpha: true, antialias: true }}>
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 8, 5]} intensity={0.4} color="#A5B4FC" />
      <pointLight position={[-3, 2, -3]} intensity={0.2} color="#10B981" />
      <Suspense fallback={null}>
        <MaterializingBuilding progress={progress} />
        <FloatingParticles count={50} />
      </Suspense>
    </Canvas>
  );
}

function ProcessingView({ progress }: { progress: number }) {
  const [stageIdx, setStageIdx] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setStageIdx((prev) => (prev + 1) % COPY.processing.stages.length);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const iv = setInterval(() => setElapsed((p) => p + 1), 1000);
    return () => clearInterval(iv);
  }, []);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="relative flex flex-col items-center justify-center"
      style={{ minHeight: 480 }}
    >
      {/* R3F background */}
      <div className="absolute inset-0 rounded-2xl overflow-hidden" style={{
        background: "radial-gradient(ellipse 80% 60% at 50% 40%, rgba(99,102,241,0.04) 0%, transparent 70%)",
      }}>
        <ProcessingScene progress={progress} />
      </div>

      {/* Light overlay for readability */}
      <div className="absolute inset-0 pointer-events-none rounded-2xl" style={{
        background: "radial-gradient(ellipse at center, rgba(250,251,254,0.5) 0%, rgba(250,251,254,0.85) 100%)",
      }} />

      {/* Content */}
      <div className="relative z-10 flex flex-col items-center text-center px-6 py-12">
        <div className="relative w-32 h-32 mb-8">
          <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
            <circle cx="60" cy="60" r="52" fill="none" stroke="#E5E7EB" strokeWidth="4" />
            <motion.circle
              cx="60" cy="60" r="52"
              fill="none" stroke="url(#progGradLight)" strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 52}
              initial={{ strokeDashoffset: 2 * Math.PI * 52 }}
              animate={{ strokeDashoffset: 2 * Math.PI * 52 * (1 - progress / 100) }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            />
            <defs>
              <linearGradient id="progGradLight" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#6366F1" />
                <stop offset="100%" stopColor="#F59E0B" />
              </linearGradient>
            </defs>
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-2xl font-bold text-gray-800">{Math.round(progress)}%</span>
            <span className="text-[9px] font-mono text-gray-400 mt-0.5">{mins}:{secs.toString().padStart(2, "0")}</span>
          </div>
        </div>

        <div className="h-12 flex items-center">
          <AnimatePresence mode="wait">
            <motion.p
              key={stageIdx}
              initial={{ opacity: 0, y: 12, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -12, filter: "blur(4px)" }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
              className="text-sm font-medium text-center text-gray-600 italic"
              style={{ maxWidth: 400 }}
            >
              {COPY.processing.stages[stageIdx]}
            </motion.p>
          </AnimatePresence>
        </div>

        <div className="flex gap-2 mt-4">
          {[0, 1, 2, 3, 4].map((i) => (
            <motion.div
              key={i}
              className="w-1 h-1 rounded-full"
              style={{ background: i % 2 === 0 ? "#6366F1" : "#F59E0B" }}
              animate={{ opacity: [0.2, 1, 0.2], scale: [0.6, 1.4, 0.6] }}
              transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.15 }}
            />
          ))}
        </div>

        <div className="w-full max-w-xs mt-8">
          <div className="h-[3px] rounded-full overflow-hidden bg-gray-200">
            <motion.div
              className="h-full rounded-full"
              style={{ background: "linear-gradient(90deg, #6366F1, #F59E0B)" }}
              initial={{ width: "0%" }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            />
          </div>
          <div className="flex justify-between mt-1.5 text-[10px] font-mono text-gray-400">
            <span>Rendering...</span>
            <span>{Math.round(progress)}%</span>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// RENDER GALLERY
// ═══════════════════════════════════════════════════════════════════════════════

function RenderGallery({
  renders,
  selectedId,
  onSelect,
}: {
  renders: RenderResult[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const roomIcons: Record<string, React.ReactNode> = {
    "Living Room": <Layers size={14} />,
    "Kitchen": <Camera size={14} />,
    "Bedroom": <Eye size={14} />,
    "Full Layout": <Maximize2 size={14} />,
  };

  const gradients = [
    "linear-gradient(135deg, #fef3c7, #fde68a)",
    "linear-gradient(135deg, #dbeafe, #bfdbfe)",
    "linear-gradient(135deg, #ede9fe, #ddd6fe)",
    "linear-gradient(135deg, #d1fae5, #a7f3d0)",
  ];

  return (
    <div className="grid grid-cols-4 gap-2.5 mt-5 max-w-3xl mx-auto">
      {renders.map((r, i) => {
        const active = selectedId === r.id;
        return (
          <motion.button
            key={r.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            whileHover={{ y: -4, scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => onSelect(r.id)}
            className={`relative rounded-xl overflow-hidden border-2 transition-all text-left ${
              active ? "border-indigo-500 shadow-lg shadow-indigo-100 scale-[1.03]" : "border-gray-150 hover:border-indigo-200"
            }`}
          >
            <div
              className="aspect-[4/3] flex items-center justify-center overflow-hidden"
              style={{ background: r.url ? undefined : (active ? gradients[i] : "#F9FAFB") }}
            >
              {r.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={r.url} alt={r.label} className="w-full h-full object-cover" draggable={false} />
              ) : (
                <div className="text-center">
                  <div className={active ? "text-indigo-500" : "text-gray-300"}>{roomIcons[r.label] || <Camera size={14} />}</div>
                  <p className={`text-[10px] mt-1 font-semibold ${active ? "text-indigo-600" : "text-gray-400"}`}>{r.angle}</p>
                </div>
              )}
            </div>
            <div className="px-2.5 py-1.5 bg-white border-t border-gray-100">
              <div className="flex items-center gap-1.5">
                <span className={active ? "text-indigo-500" : "text-gray-300"}>{roomIcons[r.label]}</span>
                <p className="text-[11px] font-bold text-gray-700 truncate">{r.label}</p>
              </div>
            </div>
          </motion.button>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// VIDEO SECTION
// ═══════════════════════════════════════════════════════════════════════════════

function VideoSection({
  videoProgress,
  videoReady,
  onGenerate,
}: {
  videoProgress: number;
  videoReady: boolean;
  onGenerate: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 }}
      className="mt-8 max-w-3xl mx-auto"
    >
      <div className="text-center mb-6">
        <div className="inline-flex items-center gap-2 mb-2">
          <Film size={16} className="text-amber-500" />
          <h2 className="text-xl font-bold text-gray-900">{COPY.video.title}</h2>
        </div>
        <p className="text-sm text-gray-500 mt-1.5 max-w-md mx-auto italic">{COPY.video.subtitle}</p>
      </div>

      <div
        className="relative rounded-2xl overflow-hidden border border-gray-800/20"
        style={{
          aspectRatio: "16/9",
          background: "linear-gradient(135deg, #0c0a1a 0%, #141028 50%, #0f0d1e 100%)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
        }}
      >
        {videoReady ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", bounce: 0.4 }} className="text-center">
              <motion.div
                className="w-16 h-16 rounded-full bg-white/10 backdrop-blur-xl flex items-center justify-center mx-auto mb-3 border border-white/20 cursor-pointer"
                whileHover={{ scale: 1.1, boxShadow: "0 0 30px rgba(99,102,241,0.3)" }}
                whileTap={{ scale: 0.95 }}
                animate={{ boxShadow: ["0 0 0px rgba(99,102,241,0)", "0 0 20px rgba(99,102,241,0.3)", "0 0 0px rgba(99,102,241,0)"] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <Play size={28} className="text-white ml-1" />
              </motion.div>
              <p className="text-xs text-gray-400 font-medium italic">{COPY.video.done}</p>
            </motion.div>
          </div>
        ) : videoProgress > 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="w-3/5 max-w-sm">
              <div className="flex items-center justify-between text-[11px] text-gray-500 mb-2 font-medium">
                <span>Rendering walkthrough</span>
                <span>{Math.round(videoProgress)}%</span>
              </div>
              <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                <motion.div className="h-full rounded-full" style={{ background: "linear-gradient(90deg, #6366F1, #F59E0B)" }}
                  initial={{ width: "0%" }} animate={{ width: `${videoProgress}%` }} transition={{ duration: 0.4 }} />
              </div>
              <p className="text-[11px] text-gray-600 mt-2.5 text-center italic">{COPY.video.generating}</p>
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="text-center">
              <Video size={36} className="text-gray-700 mx-auto mb-2" />
              <p className="text-xs text-gray-600">Your cinematic walkthrough will appear here</p>
            </div>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center justify-center gap-3 mt-5 flex-wrap">
        {!videoReady && videoProgress === 0 && (
          <motion.button whileHover={{ scale: 1.03, y: -2 }} whileTap={{ scale: 0.97 }} onClick={onGenerate}
            className="px-7 py-3 rounded-xl text-white font-bold text-sm flex items-center gap-2.5 relative overflow-hidden"
            style={{ background: "linear-gradient(135deg, #6366F1, #4F46E5)", boxShadow: "0 6px 24px rgba(99,102,241,0.35)" }}>
            <Sparkles size={15} />
            Generate 3D Video Walkthrough
          </motion.button>
        )}
        {videoReady && (
          <>
            <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
              className="px-5 py-2.5 rounded-xl bg-emerald-500 text-white font-bold text-sm flex items-center gap-2 shadow-lg shadow-emerald-200">
              <Download size={15} /> Download MP4
            </motion.button>
            <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
              className="px-5 py-2.5 rounded-xl bg-white text-gray-700 font-bold text-sm flex items-center gap-2 border border-gray-200 shadow-sm">
              <Eye size={15} /> Preview Full Screen
            </motion.button>
            <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
              className="px-5 py-2.5 rounded-xl bg-white text-gray-700 font-bold text-sm flex items-center gap-2 border border-gray-200 shadow-sm">
              <Share2 size={15} /> Share Link
            </motion.button>
            <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
              className="px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 border shadow-sm"
              style={{ background: "linear-gradient(135deg, #FEF3C7, #FDE68A)", borderColor: "#F59E0B", color: "#92400E" }}>
              <Download size={15} /> Download 4K
              <span className="text-[9px] px-1.5 py-0.5 rounded-md font-bold bg-amber-600 text-white">PRO</span>
            </motion.button>
          </>
        )}
      </div>

      {videoReady && (
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }}
          className="text-xs text-gray-400 text-center mt-6 italic">
          &quot;Don&apos;t pretend you won&apos;t screenshot this.&quot;
        </motion.p>
      )}
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// STEP INDICATOR
// ═══════════════════════════════════════════════════════════════════════════════

function StepIndicator({ step }: { step: WizardStep }) {
  const steps: { key: WizardStep; label: string; num: number }[] = [
    { key: "upload", label: "Upload", num: 1 },
    { key: "processing", label: "Render", num: 2 },
    { key: "gallery", label: "Gallery", num: 3 },
    { key: "video", label: "Video", num: 4 },
  ];
  const currentIdx = steps.findIndex((s) => s.key === step);

  return (
    <div className="flex items-center justify-center mb-8">
      {steps.map((s, i) => {
        const isActive = i === currentIdx;
        const isPast = i < currentIdx;
        return (
          <React.Fragment key={s.key}>
            <div className="flex items-center gap-2">
              {/* Circle number / check */}
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.06 }}
                className="flex items-center justify-center rounded-full"
                style={{
                  width: 24, height: 24, flexShrink: 0,
                  background: isActive
                    ? "linear-gradient(135deg, #6366F1, #4F46E5)"
                    : isPast
                    ? "#10B981"
                    : "#E5E7EB",
                  boxShadow: isActive ? "0 2px 8px rgba(99,102,241,0.3)" : "none",
                  transition: "all 300ms ease",
                }}
              >
                {isPast ? (
                  <Check size={12} className="text-white" strokeWidth={3} />
                ) : (
                  <span style={{
                    fontSize: 10, fontWeight: 700,
                    color: isActive ? "#fff" : "#9CA3AF",
                    fontFamily: "var(--font-jetbrains, monospace)",
                  }}>
                    {s.num}
                  </span>
                )}
              </motion.div>
              {/* Label */}
              <span style={{
                fontSize: 12, fontWeight: isActive ? 700 : 500,
                color: isActive ? "#312E81" : isPast ? "#10B981" : "#B0B0B8",
                transition: "all 300ms ease",
                whiteSpace: "nowrap",
              }}>
                {s.label}
              </span>
            </div>
            {/* Connector line */}
            {i < steps.length - 1 && (
              <div className="relative mx-3 rounded-full overflow-hidden" style={{ width: 40, height: 2, background: "#E5E7EB", flexShrink: 0 }}>
                {i < currentIdx && (
                  <motion.div
                    className="absolute inset-0 rounded-full"
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    transition={{ duration: 0.4, delay: 0.1, ease: "easeOut" }}
                    style={{ background: "#10B981", transformOrigin: "left" }}
                  />
                )}
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function VideoRenderStudio() {
  const [step, setStep] = useState<WizardStep>("upload");
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renders, setRenders] = useState<RenderResult[]>([]);
  const [selectedRender, setSelectedRender] = useState("r1");
  const [videoProgress, setVideoProgress] = useState(0);
  const [videoReady, setVideoReady] = useState(false);

  useEffect(() => {
    if (!uploadedFile) { setPreviewUrl(null); return; }
    const url = URL.createObjectURL(uploadedFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [uploadedFile]);

  const [renderError, setRenderError] = useState<string | null>(null);
  const handleFileSelect = useCallback((file: File) => setUploadedFile(file), []);

  const startRendering = useCallback(async () => {
    if (!uploadedFile) return;
    setStep("processing");
    setRenderProgress(0);
    setRenderError(null);

    const results: RenderResult[] = RENDER_VIEWS.map((v) => ({ ...v, url: null }));
    let completed = 0;
    const total = RENDER_VIEWS.length;

    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const callRender = async (
      view: (typeof RENDER_VIEWS)[number],
      idx: number,
      cachedDesc?: string,
      retries = 2
    ): Promise<string> => {
      const formData = new FormData();
      formData.append("image", uploadedFile);
      formData.append("angle", view.apiAngle);
      if (cachedDesc) formData.append("cachedDescription", cachedDesc);

      const res = await fetch("/api/generate-3d-render", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (res.status === 429 && retries > 0) {
        const waitMs = (3 - retries) * 15000;
        await delay(waitMs);
        return callRender(view, idx, cachedDesc, retries - 1);
      }

      if (!res.ok) throw new Error(data.error || `Failed to generate ${view.label} render`);

      results[idx] = { ...view, url: data.image };
      completed++;
      setRenderProgress((completed / total) * 100);
      return data.fullDescription as string;
    };

    try {
      const fullLayoutIdx = RENDER_VIEWS.findIndex((v) => v.id === "r4");
      const desc = await callRender(RENDER_VIEWS[fullLayoutIdx], fullLayoutIdx);

      const roomViews = RENDER_VIEWS.map((v, i) => ({ view: v, idx: i })).filter(
        (_, i) => i !== fullLayoutIdx
      );

      for (const { view, idx } of roomViews) {
        await delay(2000);
        await callRender(view, idx, desc);
      }

      setRenders(results);
      setSelectedRender("r4");
      setStep("gallery");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Render generation failed";
      setRenderError(msg);
      setStep("upload");
    }
  }, [uploadedFile]);

  const startVideoGeneration = useCallback(() => {
    setVideoProgress(0.1);
    let p = 0;
    const iv = setInterval(() => {
      p += Math.random() * 5 + 1;
      if (p >= 100) {
        clearInterval(iv);
        setVideoProgress(100);
        setTimeout(() => setVideoReady(true), 500);
      } else {
        setVideoProgress(p);
      }
    }, 600);
  }, []);

  const handleReset = useCallback(() => {
    setStep("upload");
    setUploadedFile(null);
    setPreviewUrl(null);
    setRenderProgress(0);
    setRenders([]);
    setSelectedRender("r1");
    setVideoProgress(0);
    setVideoReady(false);
  }, []);

  return (
    <div className="h-full overflow-y-auto flex flex-col" style={{
      background: "linear-gradient(180deg, #FAFBFE 0%, #F0F1F8 50%, #FAFBFE 100%)",
    }}>
      {/* ─── HERO — Three.js background + centered text ─── */}
      <div className="relative overflow-hidden" style={{ height: 220 }}>
        {/* Three.js scene — alive and breathing */}
        <div className="absolute inset-0" style={{ opacity: 0.55 }}>
          <HeroScene />
        </div>

        {/* Radial fade overlay for text readability */}
        <div className="absolute inset-0 pointer-events-none" style={{
          background: "radial-gradient(ellipse 60% 70% at 50% 55%, rgba(250,251,254,0.15) 0%, rgba(250,251,254,0.88) 65%, rgba(250,251,254,0.97) 100%)",
        }} />

        {/* Content */}
        <div className="relative z-10 h-full flex flex-col items-center justify-center text-center px-6">
          {/* Badge */}
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="flex items-center justify-center gap-2 mb-3">
            <div style={{ width: 24, height: 1.5, background: "linear-gradient(90deg, transparent, #6366F1)", borderRadius: 1 }} />
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "3px", textTransform: "uppercase", color: "#6366F1", fontFamily: "var(--font-jetbrains, monospace)" }}>
              AI-Powered Render Engine
            </span>
            <div style={{ width: 24, height: 1.5, background: "linear-gradient(90deg, #6366F1, transparent)", borderRadius: 1 }} />
          </motion.div>

          {/* Title */}
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            className="text-2xl sm:text-3xl font-black leading-[1.12] tracking-tight"
            style={{
              background: "linear-gradient(135deg, #1E1B4B 0%, #312E81 40%, #4338CA 80%, #6366F1 100%)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
            }}
          >
            Your Floor Plan Deserves Better
          </motion.h1>

          {/* Subtitle */}
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.5 }}
            className="text-sm mt-2 max-w-lg mx-auto leading-relaxed"
            style={{ color: "#6B7280" }}
          >
            2D to 3D in under 3 minutes.{" "}
            <span className="italic" style={{ color: "#9CA3AF" }}>A glow-up they&apos;ve been needing since AutoCAD.</span>
          </motion.p>

          {/* Stats row */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }}
            className="flex items-center justify-center gap-5 mt-3">
            {[
              { value: "< 3 min", label: "Render" },
              { value: "4 Angles", label: "Views" },
              { value: "4K", label: "Quality" },
            ].map((stat, i) => (
              <React.Fragment key={stat.label}>
                {i > 0 && <div style={{ width: 1, height: 20, background: "rgba(99,102,241,0.1)" }} />}
                <div className="text-center">
                  <div className="text-sm font-black" style={{ color: "#312E81" }}>{stat.value}</div>
                  <div className="text-[8px] font-semibold uppercase tracking-widest" style={{ color: "#B0B0B8" }}>{stat.label}</div>
                </div>
              </React.Fragment>
            ))}
          </motion.div>
        </div>
      </div>

      {/* ─── CONTENT — grows to push footer down ─── */}
      <div className="flex-1 max-w-4xl mx-auto px-6 pb-12 pt-6 w-full">
        <StepIndicator step={step} />

        {step !== "upload" && (
          <div className="flex justify-end mb-3">
            <motion.button
              initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
              onClick={handleReset}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold text-gray-500 bg-white border border-gray-200 hover:border-gray-300 transition-colors shadow-sm"
            >
              <RotateCcw size={11} /> Start Over
            </motion.button>
          </div>
        )}

        <AnimatePresence mode="wait">
          {step === "upload" && (
            <motion.div key="upload" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, x: -40 }}>
              {renderError && (
                <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
                  className="mb-4 p-4 rounded-xl border border-red-200 bg-red-50 max-w-2xl mx-auto">
                  <p className="text-sm font-semibold text-red-700">Render failed</p>
                  <p className="text-xs text-red-500 mt-1">{renderError}</p>
                  <p className="text-[10px] text-red-400 mt-2 italic">Something broke. It&apos;s not you, it&apos;s us. Actually, it might be you.</p>
                </motion.div>
              )}
              <UploadZone onFileSelect={handleFileSelect} uploadedFile={uploadedFile} previewUrl={previewUrl} />
              {uploadedFile && (
                <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="flex justify-center mt-7">
                  <motion.button
                    whileHover={{ scale: 1.04, y: -2 }} whileTap={{ scale: 0.96 }}
                    onClick={startRendering}
                    className="px-8 py-3.5 rounded-2xl text-white font-black text-sm flex items-center gap-2.5 relative overflow-hidden"
                    style={{ background: "linear-gradient(135deg, #6366F1 0%, #4F46E5 50%, #4338CA 100%)", boxShadow: "0 8px 28px rgba(99,102,241,0.35)" }}
                  >
                    <span className="absolute inset-0 pointer-events-none" style={{
                      background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.15), transparent)",
                      animation: "cta-shimmer 2.5s ease-in-out infinite",
                    }} />
                    <Zap size={16} className="relative z-[1]" />
                    <span className="relative z-[1]">Transform to Photorealistic 3D</span>
                    <ArrowRight size={16} className="relative z-[1]" />
                  </motion.button>
                </motion.div>
              )}
            </motion.div>
          )}

          {step === "processing" && (
            <motion.div key="processing" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }}>
              <ProcessingView progress={renderProgress} />
            </motion.div>
          )}

          {step === "gallery" && (
            <motion.div key="gallery" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }}>
              <div className="text-center mb-6">
                <motion.h2 initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-xl font-bold text-gray-900">{COPY.gallery.title}</motion.h2>
                <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}
                  className="text-sm text-gray-500 mt-1.5 max-w-md mx-auto italic">{COPY.gallery.subtitle}</motion.p>
              </div>
              <ComparisonSlider beforeSrc={previewUrl} afterSrc={renders.find(r => r.id === selectedRender)?.url ?? null} />
              <RenderGallery renders={renders} selectedId={selectedRender} onSelect={setSelectedRender} />
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="flex justify-center mt-8">
                <motion.button whileHover={{ scale: 1.04, y: -2 }} whileTap={{ scale: 0.96 }}
                  onClick={() => setStep("video")}
                  className="px-7 py-3 rounded-xl text-white font-bold text-sm flex items-center gap-2.5"
                  style={{ background: "linear-gradient(135deg, #6366F1, #7C3AED)", boxShadow: "0 6px 24px rgba(99,102,241,0.3)" }}>
                  <Video size={15} /> Create 3D Video Walkthrough <ArrowRight size={15} />
                </motion.button>
              </motion.div>
            </motion.div>
          )}

          {step === "video" && (
            <motion.div key="video" initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -40 }}>
              <ComparisonSlider beforeSrc={previewUrl} afterSrc={renders.find(r => r.id === selectedRender)?.url ?? null} />
              <VideoSection videoProgress={videoProgress} videoReady={videoReady} onGenerate={startVideoGeneration} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ─── FOOTER ─── */}
      <div className="border-t border-gray-100 bg-white/60 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-6 py-4 flex flex-col items-center gap-1">
          <p className="text-[11px] text-gray-400 italic text-center">
            Powered by AI that probably knows your floor plan better than your architect
          </p>
          <p className="text-[10px] text-gray-300 text-center">
            Floor Plan to 3D in under 3 minutes — because patience is overrated
          </p>
        </div>
      </div>
    </div>
  );
}
