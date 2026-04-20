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
import { Group, Vector3, BufferGeometry, LineBasicMaterial, LineSegments, Points } from "three";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
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
  Check,
  MoveHorizontal,
  PenTool,
  Share2,
  Film,
  AlertTriangle,
} from "lucide-react";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

type WizardStep = "upload" | "processing" | "gallery" | "video";

/** Which video pipeline the user is running. */
type VideoMode = "quick" | "cinematic";

interface RenderResult {
  id: string;
  label: string;
  angle: string;
  apiAngle: string;
  url: string | null;
}

// Mirror of StructuralAnalysisSchema in /api/generate-3d-render. Only the
// fields the client actually consumes are listed here; extras are ignored.
interface StructuralAnalysis {
  buildingType: "residential" | "commercial" | "mixed-use" | "industrial" | "other";
  roomCount: number;
  rooms: string[];
  footprint: "rectangle" | "L-shape" | "U-shape" | "irregular";
  openingsVisible: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CINEMATIC PIPELINE TYPES (mirror /api/cinematic-status response)
// ═══════════════════════════════════════════════════════════════════════════════

type CinematicStageStatus =
  | "pending"
  | "preparing"
  | "submitted"
  | "processing"
  | "complete"
  | "failed";

interface CinematicStageView {
  name: string;
  status: CinematicStageStatus;
  videoUrl?: string;
  imageUrl?: string;
  error?: string;
  durationSeconds?: number;
}

interface CinematicStatusResponse {
  pipelineId: string;
  pipelineStatus: "processing" | "complete" | "partial" | "failed";
  progress: number;
  currentStage: "overview" | "transition" | "lifestyle" | "stitch" | "complete";
  statusMessage: string;
  stages: {
    overview: CinematicStageView;
    transition: CinematicStageView;
    lifestyle: CinematicStageView;
    stitch: CinematicStageView;
  };
  finalVideoUrl?: string;
  durationSeconds?: number;
  pipeline: "cinematic-multi-stage";
}

/** Witty per-stage copy for the cinematic indicator. */
const CINEMATIC_STAGE_LABELS: Record<
  "overview" | "transition" | "lifestyle" | "stitch",
  { label: string; subtitle: string }
> = {
  overview: { label: "Overview", subtitle: "Aerial orbit" },
  transition: { label: "Transition", subtitle: "Descent" },
  lifestyle: { label: "Lifestyle", subtitle: "Family scene" },
  stitch: { label: "Final Cut", subtitle: "Crossfade & color" },
};

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

// Full-layout slot is pinned at id "r4" because the cinematic walkthrough
// pipeline (startCinematicGeneration) selects it by id. Do not re-id.
const FULL_LAYOUT_VIEW: Omit<RenderResult, "url"> = {
  id: "r4",
  label: "Full Layout",
  angle: "Top Down",
  apiAngle: "topDown",
};

// Witty status messages cycled during real video generation. Same tone as
// COPY.processing.stages so the video step feels consistent with rendering.
const VIDEO_STATUS_MESSAGES = [
  "Submitting your masterpiece to the AI render farm...",
  "Teaching pixels how to pretend they're walls...",
  "Convincing the AI that 3D is just 2D with confidence...",
  "Generating exterior cinematic sweep...",
  "Adding that natural lighting your actual apartment doesn't have...",
  "Filming the interior walkthrough — slowly, dramatically...",
  "Arranging furniture with better taste than IKEA...",
  "Almost there — stitching scenes together...",
  "Polishing the final cut. Try not to blink.",
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
  const groupRef = useRef<Group>(null);

  const lineObjects = useMemo(() => {
    const wallColor = "#6366F1";
    const roomColor = "#A5B4FC";
    const accentColor = "#F59E0B";

    const walls: Vector3[] = [
      new Vector3(-3, 0, -2), new Vector3(3, 0, -2),
      new Vector3(3, 0, -2), new Vector3(3, 0, 2),
      new Vector3(3, 0, 2), new Vector3(-3, 0, 2),
      new Vector3(-3, 0, 2), new Vector3(-3, 0, -2),
    ];
    const rooms: Vector3[] = [
      new Vector3(0, 0, -2), new Vector3(0, 0, 0.5),
      new Vector3(-3, 0, 0), new Vector3(-0.5, 0, 0),
      new Vector3(1, 0, 0), new Vector3(3, 0, 0),
      new Vector3(1.5, 0, -2), new Vector3(1.5, 0, 0),
    ];
    const accents: Vector3[] = [
      new Vector3(-0.5, 0, 0), new Vector3(0.2, 0, 0.5),
      new Vector3(0.2, 0, 0.5), new Vector3(1, 0, 0),
    ];

    return [
      { pts: walls, color: wallColor, opacity: 0.7 },
      { pts: rooms, color: roomColor, opacity: 0.5 },
      { pts: accents, color: accentColor, opacity: 0.6 },
    ].map(({ pts, color, opacity }) => {
      const geo = new BufferGeometry().setFromPoints(pts);
      const mat = new LineBasicMaterial({ color, transparent: true, opacity });
      return new LineSegments(geo, mat);
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
  const ref = useRef<Points>(null);
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
  fullWidth = false,
}: {
  beforeSrc: string | null;
  afterSrc: string | null;
  /**
   * When true, the slider fills its parent container's width instead of
   * capping at `max-w-3xl`, and the after-image always uses `object-cover`
   * so the render fills the frame instead of letterboxing when its aspect
   * ratio differs from the uploaded plan. Used on the gallery step where
   * the Full Layout render is the hero of the screen.
   */
  fullWidth?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [sliderPos, setSliderPos] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  // True natural aspect ratio of the BEFORE image — NO CLAMPING.
  // Updated by the <img> onLoad handler below. Any shape (triangle,
  // L-shape, U-shape, panorama, tall portrait) sizes the container to its
  // own ratio.
  const [imageAspect, setImageAspect] = useState<number>(4 / 3);
  // Natural aspect ratio of the AFTER (3D render) image. Used to decide
  // whether the AFTER image should `object-cover` (filling the container,
  // matching BEFORE size) or fall back to `object-contain` (letterboxed)
  // when the ratio mismatch is too large to crop safely.
  const [afterAspect, setAfterAspect] = useState<number | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on src clear
    if (!beforeSrc) setImageAspect(4 / 3);
  }, [beforeSrc]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on src clear
    if (!afterSrc) setAfterAspect(null);
  }, [afterSrc]);

  // Decide AFTER image fit. If the rendered output ratio is within ±20% of
  // the floor plan ratio, use `cover` so the AFTER fills the container at
  // the same scale as BEFORE (cropping a thin band of empty render edge).
  // Beyond 20%, fall back to `contain` so we don't crop the actual building.
  //
  // `fullWidth` (gallery step) forces `cover` regardless of the diff — the
  // caller has opted in to the crop in exchange for no gray letterbox bars.
  const afterFit: "cover" | "contain" = (() => {
    if (fullWidth) return "cover";
    if (!afterAspect || imageAspect <= 0) return "contain";
    const diff = Math.abs(afterAspect - imageAspect) / imageAspect;
    return diff < 0.2 ? "cover" : "contain";
  })();

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
    <div className={fullWidth ? "w-full" : "w-full max-w-3xl mx-auto"}>
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-2xl select-none"
        style={{
          // Container ratio = the BEFORE image's TRUE natural aspect ratio.
          // No clamping. With object-contain on the inner images and the
          // maxHeight cap below, the full image is always shown — letterboxed
          // against #f8f8f8 in the unused dimension. This works for ANY
          // shape: square, wide panorama, tall portrait, triangle, L, U, etc.
          //
          // `fullWidth` lifts the height cap so the slider can scale with
          // a wider parent without the aspect ratio being squashed.
          aspectRatio: imageAspect,
          maxHeight: fullWidth ? "min(80vh, 760px)" : "min(70vh, 600px)",
          minHeight: "240px",
          width: "100%",
          background: "#f8f8f8",
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
        <div className="absolute inset-0" style={{ background: "#f8f8f8" }}>
          {beforeSrc ? (
            // The onLoad handler reads the image's TRUE natural aspect ratio
            // and sets the container ratio so the entire shape is shown,
            // regardless of how unusual the floor plan is. object-contain
            // guarantees no cropping in the (rare) case where maxHeight forces
            // the container into a slightly different ratio than the image.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={beforeSrc}
              alt="2D Floor Plan"
              className="w-full h-full object-contain"
              draggable={false}
              onLoad={(e) => {
                const img = e.currentTarget;
                if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                  setImageAspect(img.naturalWidth / img.naturalHeight);
                }
              }}
            />
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
        <div className="absolute inset-0" style={{ background: "#f8f8f8", clipPath: `inset(0 0 0 ${sliderPos}%)` }}>
          {afterSrc ? (
            // Dynamic object-fit (set via inline style so we can switch it
            // without Tailwind class generation issues):
            //   • cover  → ratio mismatch <20%, fills container like BEFORE
            //              (slider alignment looks correct, may crop a tiny
            //              edge band of empty render area)
            //   • contain → ratio mismatch >20%, letterboxed so building is
            //              never cropped (used when the mapping to GPT-Image-1's
            //              discrete sizes can't get close enough to the floor
            //              plan ratio)
            // The onLoad reads the ACTUAL dimensions of the rendered image
            // so the decision uses ground truth, not API response trust.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={afterSrc}
              alt="3D Render"
              className="w-full h-full"
              style={{ objectFit: afterFit }}
              draggable={false}
              onLoad={(e) => {
                const img = e.currentTarget;
                if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                  setAfterAspect(img.naturalWidth / img.naturalHeight);
                }
              }}
            />
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
  const groupRef = useRef<Group>(null);
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
// CINEMATIC STAGE INDICATOR
// ═══════════════════════════════════════════════════════════════════════════════
//
// Renders the 4-stage progress strip for the cinematic pipeline:
//
//   [✓ Overview] → [● Transition] → [○ Lifestyle] → [○ Final Cut]
//
// Each stage box has:
//   • A status icon (check ✓ for complete, spinner ● for in-progress, ○ for
//     pending, ⚠ for failed)
//   • The stage label + subtitle
//   • A mini auto-playing muted preview of the segment once it's available
//     (this is the magic that makes "progress feels real" — users see actual
//     footage land while the next stages are still cooking)
//
// The component is passive — all state comes from the cinematicStatus prop.

function CinematicStagePreview({
  stage,
  isActive,
  isPast,
}: {
  stage: CinematicStageView;
  isActive: boolean;
  isPast: boolean;
}) {
  const meta = CINEMATIC_STAGE_LABELS[stage.name as keyof typeof CINEMATIC_STAGE_LABELS];
  const failed = stage.status === "failed";
  const complete = stage.status === "complete";
  const inProgress =
    stage.status === "preparing" ||
    stage.status === "submitted" ||
    stage.status === "processing";

  let icon: React.ReactNode;
  let iconBg: string;
  if (failed) {
    icon = <AlertTriangle size={11} className="text-white" strokeWidth={3} />;
    iconBg = "#EF4444";
  } else if (complete) {
    icon = <Check size={11} className="text-white" strokeWidth={3} />;
    iconBg = "#10B981";
  } else if (inProgress) {
    icon = (
      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }}
        className="w-2.5 h-2.5 rounded-full border-2 border-white border-t-transparent"
      />
    );
    iconBg = "linear-gradient(135deg, #6366F1, #4F46E5)";
  } else {
    icon = (
      <span className="text-[9px] font-bold text-gray-400 font-mono">○</span>
    );
    iconBg = "#E5E7EB";
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`relative rounded-xl border-2 transition-all overflow-hidden ${
        isActive
          ? "border-indigo-400 shadow-md shadow-indigo-100"
          : isPast || complete
            ? "border-emerald-200"
            : failed
              ? "border-red-200"
              : "border-gray-200"
      }`}
      style={{
        background: complete
          ? "rgba(16, 185, 129, 0.04)"
          : failed
            ? "rgba(239, 68, 68, 0.04)"
            : isActive
              ? "rgba(99, 102, 241, 0.05)"
              : "rgba(255,255,255,0.85)",
      }}
    >
      {/* Mini preview thumbnail (muted, autoplaying loop) */}
      <div
        className="aspect-video w-full overflow-hidden"
        style={{ background: "#0c0a1a" }}
      >
        {stage.videoUrl ? (
          <video
            src={stage.videoUrl}
            autoPlay
            loop
            muted
            playsInline
            className="w-full h-full object-cover"
            style={{ background: "#000" }}
          />
        ) : stage.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={stage.imageUrl}
            alt={`${meta?.label ?? "Stage"} preview`}
            className="w-full h-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            {inProgress ? (
              <motion.div
                animate={{ opacity: [0.3, 0.7, 0.3] }}
                transition={{ duration: 1.6, repeat: Infinity }}
                className="text-[9px] font-mono text-indigo-300"
              >
                rendering...
              </motion.div>
            ) : failed ? (
              <span className="text-[9px] font-mono text-red-300">failed</span>
            ) : (
              <span className="text-[9px] font-mono text-gray-500">queued</span>
            )}
          </div>
        )}
      </div>

      <div className="px-2.5 py-1.5 flex items-center gap-1.5 bg-white/90 backdrop-blur-sm border-t border-gray-100">
        <div
          className="flex items-center justify-center rounded-full shrink-0"
          style={{ width: 18, height: 18, background: iconBg }}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p
            className={`text-[10px] font-bold truncate ${
              isActive ? "text-indigo-700" : complete ? "text-emerald-700" : failed ? "text-red-700" : "text-gray-700"
            }`}
          >
            {meta?.label ?? stage.name}
          </p>
          <p className="text-[9px] text-gray-400 truncate">
            {failed ? (stage.error ?? "Failed") : meta?.subtitle ?? ""}
            {stage.durationSeconds && complete ? ` · ${stage.durationSeconds}s` : ""}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

function CinematicStageIndicator({
  status,
  elapsed,
}: {
  status: CinematicStatusResponse;
  elapsed: number;
}) {
  const stageOrder = ["overview", "transition", "lifestyle", "stitch"] as const;
  const currentIdx = stageOrder.indexOf(
    status.currentStage === "complete"
      ? "stitch"
      : (status.currentStage as (typeof stageOrder)[number]),
  );

  const elapsedMins = Math.floor(elapsed / 60);
  const elapsedSecs = elapsed % 60;
  const elapsedLabel = `${elapsedMins}:${elapsedSecs.toString().padStart(2, "0")}`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-indigo-100 bg-white/80 backdrop-blur-sm p-4 mb-4"
      style={{ boxShadow: "0 4px 24px rgba(99,102,241,0.08)" }}
    >
      {/* Header — current stage message + elapsed time */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <Film size={14} className="text-indigo-500 shrink-0" />
          <p className="text-xs font-bold text-gray-700 truncate">
            {status.statusMessage}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span
            className="text-[10px] font-mono font-bold text-indigo-600"
            style={{ fontFamily: "var(--font-jetbrains, monospace)" }}
          >
            {elapsedLabel} · {Math.round(status.progress)}%
          </span>
        </div>
      </div>

      {/* Top-level progress bar */}
      <div className="h-1 rounded-full bg-indigo-50 overflow-hidden mb-4">
        <motion.div
          className="h-full"
          style={{
            background: "linear-gradient(90deg, #6366F1, #F59E0B, #10B981)",
          }}
          initial={{ width: "0%" }}
          animate={{ width: `${Math.max(2, status.progress)}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
        />
      </div>

      {/* 4 stage tiles in a row */}
      <div className="grid grid-cols-4 gap-2">
        {stageOrder.map((stageName, idx) => (
          <CinematicStagePreview
            key={stageName}
            stage={status.stages[stageName]}
            isActive={idx === currentIdx}
            isPast={idx < currentIdx}
          />
        ))}
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// VIDEO SECTION
// ═══════════════════════════════════════════════════════════════════════════════

function VideoSection({
  mode,
  videoProgress,
  videoReady,
  videoUrl,
  videoStatusText,
  videoError,
  videoElapsed,
  isSharing,
  cinematicStatus,
  cinematicElapsed,
  onGenerate,
  onGenerateCinematic,
  onDownload,
  onPreview,
  onShare,
  onRetry,
  onDownload4K,
  videoRef,
}: {
  mode: VideoMode | null;
  videoProgress: number;
  videoReady: boolean;
  videoUrl: string | null;
  videoStatusText: string;
  videoError: string | null;
  videoElapsed: number;
  isSharing: boolean;
  cinematicStatus: CinematicStatusResponse | null;
  cinematicElapsed: number;
  onGenerate: () => void;
  onGenerateCinematic: () => void;
  onDownload: () => void;
  onPreview: () => void;
  onShare: () => void;
  onRetry: () => void;
  onDownload4K: () => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  const elapsedMins = Math.floor(videoElapsed / 60);
  const elapsedSecs = videoElapsed % 60;
  const elapsedLabel = `${elapsedMins}:${elapsedSecs.toString().padStart(2, "0")}`;

  // Show the cinematic stage indicator while a cinematic pipeline is in
  // flight OR has completed (it remains visible after completion as a
  // visual record of the 4 stages, with their mini-previews still playing).
  const showCinematicIndicator =
    mode === "cinematic" && cinematicStatus !== null;
  const cinematicPartial =
    cinematicStatus?.pipelineStatus === "partial";

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

      {showCinematicIndicator && cinematicStatus && (
        <CinematicStageIndicator
          status={cinematicStatus}
          elapsed={cinematicElapsed}
        />
      )}

      {cinematicPartial && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-3 px-4 py-2.5 rounded-xl border border-amber-200 bg-amber-50 text-[11px] text-amber-800 flex items-start gap-2"
        >
          <AlertTriangle size={13} className="text-amber-600 shrink-0 mt-[2px]" />
          <span>
            We delivered a partial cinematic walkthrough — some stages couldn&apos;t be
            completed but the rest are stitched into your final video below.
          </span>
        </motion.div>
      )}

      <div
        className="relative rounded-2xl overflow-hidden border border-gray-800/20"
        style={{
          aspectRatio: "16/9",
          background: "linear-gradient(135deg, #0c0a1a 0%, #141028 50%, #0f0d1e 100%)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
        }}
      >
        {videoError ? (
          // ─── ERROR STATE ───
          <div className="absolute inset-0 flex items-center justify-center px-6">
            <div className="text-center max-w-sm">
              <div className="w-12 h-12 rounded-full bg-red-500/15 border border-red-500/30 flex items-center justify-center mx-auto mb-3">
                <AlertTriangle size={20} className="text-red-400" />
              </div>
              <p className="text-sm font-semibold text-red-200 mb-1">Video generation failed</p>
              <p className="text-[11px] text-red-300/70 italic break-words">{videoError}</p>
            </div>
          </div>
        ) : videoReady && videoUrl ? (
          // ─── REAL VIDEO PLAYER ───
          <video
            ref={videoRef}
            src={videoUrl}
            controls
            autoPlay
            muted
            playsInline
            crossOrigin="anonymous"
            className="absolute inset-0 w-full h-full"
            style={{ objectFit: "cover", background: "#000" }}
          />
        ) : videoProgress > 0 ? (
          // ─── PROGRESS STATE ───
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="w-3/5 max-w-sm">
              <div className="flex items-center justify-between text-[11px] text-gray-500 mb-2 font-medium">
                <span>Rendering walkthrough</span>
                <span style={{ fontFamily: "var(--font-jetbrains, monospace)" }}>{elapsedLabel} · {Math.round(videoProgress)}%</span>
              </div>
              <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: "linear-gradient(90deg, #6366F1, #F59E0B)" }}
                  initial={{ width: "0%" }}
                  animate={{ width: `${videoProgress}%` }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                />
              </div>
              <AnimatePresence mode="wait">
                <motion.p
                  key={videoStatusText}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.35 }}
                  className="text-[11px] text-gray-400 mt-2.5 text-center italic"
                >
                  {videoStatusText || COPY.video.generating}
                </motion.p>
              </AnimatePresence>
            </div>
          </div>
        ) : (
          // ─── EMPTY STATE ───
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
        {!videoReady && videoProgress === 0 && !videoError && (
          <>
            {/* QUICK PATH — 15s dual-segment Kling walkthrough (existing flow). */}
            <motion.button
              whileHover={{ scale: 1.03, y: -2 }}
              whileTap={{ scale: 0.97 }}
              onClick={onGenerate}
              className="px-6 py-3 rounded-xl text-white font-bold text-sm flex items-center gap-2.5 relative overflow-hidden"
              style={{ background: "linear-gradient(135deg, #6366F1, #4F46E5)", boxShadow: "0 6px 24px rgba(99,102,241,0.35)" }}
            >
              <Sparkles size={15} />
              Generate 3D Video Walkthrough
              <span className="text-[9px] px-1.5 py-0.5 rounded-md font-bold bg-white/20">
                ~15s · 5 min
              </span>
            </motion.button>

            {/* PREMIUM PATH — multi-stage cinematic pipeline with eye-level
                lifestyle scene + xfade stitching. ~10 min wall time, ~$2.50/run. */}
            <motion.button
              whileHover={{ scale: 1.03, y: -2 }}
              whileTap={{ scale: 0.97 }}
              onClick={onGenerateCinematic}
              className="px-6 py-3 rounded-xl text-white font-bold text-sm flex items-center gap-2.5 relative overflow-hidden"
              style={{
                background:
                  "linear-gradient(135deg, #F59E0B 0%, #EA580C 50%, #B45309 100%)",
                boxShadow: "0 6px 28px rgba(245,158,11,0.45)",
              }}
            >
              <span
                className="absolute inset-0 pointer-events-none"
                style={{
                  background:
                    "linear-gradient(90deg, transparent, rgba(255,255,255,0.18), transparent)",
                  animation: "cta-shimmer 2.5s ease-in-out infinite",
                }}
              />
              <Film size={15} className="relative z-[1]" />
              <span className="relative z-[1]">Create Cinematic Walkthrough</span>
              <span className="relative z-[1] text-[9px] px-1.5 py-0.5 rounded-md font-bold bg-white/25">
                ~24s · 4 stages
              </span>
            </motion.button>
          </>
        )}
        {videoError && (
          <motion.button
            whileHover={{ scale: 1.03, y: -2 }}
            whileTap={{ scale: 0.97 }}
            onClick={onRetry}
            className="px-7 py-3 rounded-xl text-white font-bold text-sm flex items-center gap-2.5"
            style={{ background: "linear-gradient(135deg, #6366F1, #4F46E5)", boxShadow: "0 6px 24px rgba(99,102,241,0.35)" }}
          >
            <RotateCcw size={15} />
            Try Again
          </motion.button>
        )}
        {videoReady && videoUrl && (
          <>
            {/* IMPORTANT: <button> not <a>. Cross-origin <a download> would
                navigate the page (blanking it) instead of downloading. The
                onDownload handler does fetch+blob to force a real save. */}
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={onDownload}
              className="px-5 py-2.5 rounded-xl bg-emerald-500 text-white font-bold text-sm flex items-center gap-2 shadow-lg shadow-emerald-200"
            >
              <Download size={15} /> Download MP4
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={onPreview}
              className="px-5 py-2.5 rounded-xl bg-white text-gray-700 font-bold text-sm flex items-center gap-2 border border-gray-200 shadow-sm"
            >
              <Eye size={15} /> Preview Full Screen
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={onShare}
              disabled={isSharing}
              className="px-5 py-2.5 rounded-xl bg-white text-gray-700 font-bold text-sm flex items-center gap-2 border border-gray-200 shadow-sm disabled:opacity-60"
            >
              <Share2 size={15} /> {isSharing ? "Copying..." : "Share Link"}
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={onDownload4K}
              className="px-5 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 border shadow-sm"
              style={{ background: "linear-gradient(135deg, #FEF3C7, #FDE68A)", borderColor: "#F59E0B", color: "#92400E" }}
            >
              <Download size={15} /> Download 4K
              <span className="text-[9px] px-1.5 py-0.5 rounded-md font-bold bg-amber-600 text-white">PRO</span>
            </motion.button>
          </>
        )}
      </div>

      {videoReady && videoUrl && (
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
  // Natural pixel dimensions of the uploaded floor plan, read from the
  // <img> onLoad. Sent to /api/generate-3d-render so it can pick a non-square
  // GPT-Image-1 output size that matches the floor plan ratio.
  const [uploadedDims, setUploadedDims] = useState<{ width: number; height: number } | null>(null);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renders, setRenders] = useState<RenderResult[]>([]);
  const [selectedRender, setSelectedRender] = useState("r4");
  const [videoProgress, setVideoProgress] = useState(0);
  const [videoReady, setVideoReady] = useState(false);
  // ── Video state (real pipeline) ──
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoStatusText, setVideoStatusText] = useState<string>("");
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoElapsed, setVideoElapsed] = useState(0);
  const [isSharingVideo, setIsSharingVideo] = useState(false);
  const [fullDescription, setFullDescription] = useState<string>("");
  // Structural analysis from the first (full-layout) API call. Drives the
  // dynamic room thumbnails and seeds the cinematic pipeline's buildingType.
  const [structural, setStructural] = useState<StructuralAnalysis | null>(null);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const videoAbortRef = useRef<AbortController | null>(null);
  const videoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const localBlobUrlRef = useRef<string | null>(null);

  // ── Cinematic pipeline state ──
  // Tracks an in-flight or completed multi-stage cinematic walkthrough.
  // Lives alongside (not inside) the quick-path state so the two flows don't
  // step on each other. The active flow is decided by `videoMode`.
  const [videoMode, setVideoMode] = useState<VideoMode | null>(null);
  const [cinematicStatus, setCinematicStatus] =
    useState<CinematicStatusResponse | null>(null);
  const [cinematicElapsed, setCinematicElapsed] = useState(0);
  const cinematicTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cinematicPollAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!uploadedFile) {
      setPreviewUrl(null);
      setUploadedDims(null);
      return;
    }
    const url = URL.createObjectURL(uploadedFile);
    setPreviewUrl(url);
    // Read the floor plan's natural dimensions so we can send them to the
    // render API and pick a matching GPT-Image-1 output size.
    const probe = new Image();
    probe.onload = () => {
      if (probe.naturalWidth > 0 && probe.naturalHeight > 0) {
        setUploadedDims({ width: probe.naturalWidth, height: probe.naturalHeight });
      }
    };
    probe.src = url;
    return () => URL.revokeObjectURL(url);
  }, [uploadedFile]);

  // Elapsed-time ticker — runs while a video is being generated.
  useEffect(() => {
    const isGenerating = videoProgress > 0 && !videoReady && !videoError;
    if (!isGenerating) {
      if (videoTimerRef.current) {
        clearInterval(videoTimerRef.current);
        videoTimerRef.current = null;
      }
      return;
    }
    videoTimerRef.current = setInterval(() => {
      setVideoElapsed((p) => p + 1);
    }, 1000);
    return () => {
      if (videoTimerRef.current) {
        clearInterval(videoTimerRef.current);
        videoTimerRef.current = null;
      }
    };
  }, [videoProgress, videoReady, videoError]);

  // Revoke any local blob URL on unmount (Three.js fallback path).
  useEffect(() => {
    return () => {
      if (localBlobUrlRef.current) {
        URL.revokeObjectURL(localBlobUrlRef.current);
        localBlobUrlRef.current = null;
      }
      if (videoAbortRef.current) videoAbortRef.current.abort();
      if (cinematicPollAbortRef.current) cinematicPollAbortRef.current.abort();
    };
  }, []);

  // ── Cinematic elapsed-time ticker — runs while a cinematic pipeline is in flight. ──
  useEffect(() => {
    const isCinematicGenerating =
      videoMode === "cinematic" &&
      cinematicStatus !== null &&
      cinematicStatus.pipelineStatus === "processing";
    if (!isCinematicGenerating) {
      if (cinematicTimerRef.current) {
        clearInterval(cinematicTimerRef.current);
        cinematicTimerRef.current = null;
      }
      return;
    }
    cinematicTimerRef.current = setInterval(() => {
      setCinematicElapsed((p) => p + 1);
    }, 1000);
    return () => {
      if (cinematicTimerRef.current) {
        clearInterval(cinematicTimerRef.current);
        cinematicTimerRef.current = null;
      }
    };
  }, [videoMode, cinematicStatus]);

  const [renderError, setRenderError] = useState<string | null>(null);
  const [upgradeBlock, setUpgradeBlock] = useState<{ title: string; message: string; action: string; actionUrl: string } | null>(null);
  const handleFileSelect = useCallback((file: File) => setUploadedFile(file), []);

  // ─── Wizard ↔ Browser History API Integration ─────────────────────────────
  // Without this, the browser back button collapses straight back to the
  // previous page (or earlier wizard runs) because each wizard "step" is
  // pure React state with no URL representation.
  //
  // Strategy:
  //   • goToStep() pushes a hashed URL like "#gallery" / "#video" so each
  //     stable step gets its own history entry. We DO NOT push for "upload"
  //     (it's the base state) or "processing" (it's transient).
  //   • A popstate listener watches for browser back/forward and syncs the
  //     React `step` state to the URL hash, aborting in-flight video
  //     generation when the user navigates away from the video step.
  //   • Refs are used inside the listener so we always read the latest
  //     `step`/`renders` values without re-registering the listener.
  const stepRef = useRef(step);
  const rendersRef = useRef(renders);
  useEffect(() => { stepRef.current = step; }, [step]);
  useEffect(() => { rendersRef.current = renders; }, [renders]);

  const goToStep = useCallback((next: WizardStep) => {
    setStep(next);
    if (typeof window === "undefined") return;
    // Only push history for stable, user-meaningful destinations. "upload"
    // is the base state, "processing" is transient — skipping both keeps
    // the back stack matching what the user actually navigated.
    if (next === "gallery" || next === "video") {
      try {
        window.history.pushState({ step: next }, "", `#${next}`);
      } catch {
        /* SecurityError on file:// — ignore */
      }
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const handlePopState = (e: PopStateEvent) => {
      let next: WizardStep = (e.state?.step as WizardStep) ?? "upload";

      // Defensive: bounce to upload if we'd land in a step that needs data
      // we no longer have (e.g. user pressed Reset, then back). The renders
      // array is the gating data for both gallery and video.
      if ((next === "gallery" || next === "video") && rendersRef.current.length === 0) {
        next = "upload";
      }

      // Aborting in-flight video generation when leaving the video step.
      // The fetch in startVideoGeneration / pollKlingTasks listens to this
      // signal and bails out cleanly.
      if (stepRef.current === "video" && next !== "video" && videoAbortRef.current) {
        videoAbortRef.current.abort();
        videoAbortRef.current = null;
      }

      // Use raw setStep here, NOT goToStep — popstate is the browser
      // moving through existing entries; we must not push another entry
      // or we'd lock the user inside the wizard forever.
      setStep(next);
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const startRendering = useCallback(async () => {
    if (!uploadedFile) return;
    setStep("processing");
    setRenderProgress(0);
    setRenderError(null);
    setStructural(null);

    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

    /**
     * POST one render to /api/generate-3d-render. Handles plan-gate / rate
     * limit / retry exactly like the old implementation, but returns the
     * parsed response so the caller can read structural / image / description.
     */
    const callRender = async (
      apiAngle: string,
      label: string,
      cachedStructuralJson: string | null,
      retries = 2
    ): Promise<{ image: string; structural?: StructuralAnalysis; fullDescription?: string }> => {
      const formData = new FormData();
      formData.append("image", uploadedFile);
      formData.append("angle", apiAngle);
      if (cachedStructuralJson) formData.append("cachedStructural", cachedStructuralJson);
      // Send original dimensions so the API can pick a matching output size
      // (1024×1024, 1536×1024, or 1024×1536). Critical for slider alignment.
      if (uploadedDims) {
        formData.append("originalWidth", String(uploadedDims.width));
        formData.append("originalHeight", String(uploadedDims.height));
      }

      const res = await fetch("/api/generate-3d-render", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      // Intercept plan gate / email verification / rate limit gates — show upgrade popup
      if (!res.ok && data.error && typeof data.error === "object" && (data.error.code === "PLAN_001" || data.error.code === "RATE_001" || data.error.code === "AUTH_001")) {
        setUpgradeBlock({ title: data.error.title, message: data.error.message, action: data.error.action, actionUrl: data.error.actionUrl });
        throw new Error("__PLAN_GATE__");
      }

      if (res.status === 429 && retries > 0) {
        const waitMs = (3 - retries) * 15000;
        await delay(waitMs);
        return callRender(apiAngle, label, cachedStructuralJson, retries - 1);
      }

      if (!res.ok) {
        const errMsg = typeof data.error === "object" ? (data.error?.message || "Render failed") : (data.error || `Failed to generate ${label} render`);
        throw new Error(errMsg);
      }

      return {
        image: data.image as string,
        structural: data.structural as StructuralAnalysis | undefined,
        fullDescription: data.fullDescription as string | undefined,
      };
    };

    try {
      // Full Layout is the only render we produce now. The GPT-4o structural
      // analysis is still returned in this response — we keep it (and the
      // detected buildingType in particular) so the cinematic walkthrough
      // pipeline downstream can consume it. Room-interior renders used to
      // follow this call; they're gone because the Full Layout alone already
      // tells the story the user needs before cinematic.
      const first = await callRender(FULL_LAYOUT_VIEW.apiAngle, FULL_LAYOUT_VIEW.label, null);
      setStructural(first.structural ?? null);
      setFullDescription(first.fullDescription ?? "");

      const fullLayoutResult: RenderResult = { ...FULL_LAYOUT_VIEW, url: first.image };
      setRenderProgress(100);
      setRenders([fullLayoutResult]);
      setSelectedRender("r4");
      goToStep("gallery");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Render generation failed";
      if (msg === "__PLAN_GATE__") {
        // upgradeBlock already set — just go back to upload
        setStep("upload");
        return;
      }
      setRenderError(msg);
      setStep("upload");
    }
  }, [uploadedFile, uploadedDims, goToStep]);

  // ─── REAL VIDEO GENERATION PIPELINE ───────────────────────────────────────
  // Calls /api/generate-video-walkthrough → polls /api/video-status →
  // concats via /api/concat-videos → final R2 URL.
  // Falls back to client-side Three.js renderer (walkthrough-renderer.ts)
  // when the server returns status: "client-rendering" (no Kling keys
  // configured or Kling failed gracefully).
  const startVideoGeneration = useCallback(async () => {
    // Reset state for a fresh run
    if (videoAbortRef.current) videoAbortRef.current.abort();
    if (localBlobUrlRef.current) {
      URL.revokeObjectURL(localBlobUrlRef.current);
      localBlobUrlRef.current = null;
    }
    setVideoUrl(null);
    setVideoReady(false);
    setVideoError(null);
    setVideoElapsed(0);
    setVideoProgress(0.1);
    setVideoStatusText(VIDEO_STATUS_MESSAGES[0]);

    const abort = new AbortController();
    videoAbortRef.current = abort;

    // Pick the best source image: Full Layout render is ideal because it's
    // a top-down photorealistic 3D view of the entire floor plan. Fall back
    // to whichever render is available, then to the original upload.
    const fullLayout = renders.find((r) => r.id === "r4");
    const firstWithUrl = renders.find((r) => !!r.url);
    const sourceImageRaw = fullLayout?.url ?? firstWithUrl?.url ?? previewUrl ?? null;

    if (!sourceImageRaw) {
      setVideoError("No source image available. Please re-render the floor plan first.");
      setVideoProgress(0);
      return;
    }

    // Build rooms list from render labels (exclude "Full Layout")
    const rooms = renders
      .filter((r) => r.id !== "r4" && !!r.url)
      .map((r) => r.label);

    try {
      // ── Step 1: Submit to backend ──
      const res = await fetch("/api/generate-video-walkthrough", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceImage: sourceImageRaw,
          description: fullDescription,
          rooms,
          buildingType: rooms.length > 0 ? "modern apartment" : "modern building",
        }),
        signal: abort.signal,
      });

      const data = await res.json();
      if (!res.ok) {
        const msg = data?.error?.message ?? data?.error ?? `HTTP ${res.status}`;
        throw new Error(typeof msg === "string" ? msg : "Video request failed");
      }

      // ── Step 2a: Three.js client-side fallback ──
      if (data.status === "client-rendering") {
        // Pass the reason so renderClientFallback can show the right
        // status text (e.g. "no keys" vs "Kling failed: <error>").
        await renderClientFallback(
          data.buildingConfig,
          typeof data.reason === "string" ? data.reason : undefined,
          typeof data.klingError === "string" ? data.klingError : undefined,
          abort,
        );
        return;
      }

      // ── Step 2b: Kling dual-task polling ──
      if (data.status === "processing" && data.exteriorTaskId && data.interiorTaskId) {
        await pollKlingTasks(data.exteriorTaskId, data.interiorTaskId, abort);
        return;
      }

      throw new Error("Unexpected response from video service");
    } catch (err) {
      if (abort.signal.aborted) return; // user cancelled — silent
      const msg = err instanceof Error ? err.message : "Video generation failed";
      console.error("[VideoRenderStudio] startVideoGeneration error:", msg);
      setVideoError(msg);
      setVideoProgress(0);
      setVideoStatusText("");
    } finally {
      if (videoAbortRef.current === abort) videoAbortRef.current = null;
    }
  }, [renders, previewUrl, fullDescription]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Three.js fallback: render the walkthrough fully client-side ──
  // Receives `reason` and `klingError` from the server response so we can
  // tell the user WHY we're falling back instead of always claiming "no
  // Kling keys configured" (which is wrong when Kling actually failed).
  const renderClientFallback = useCallback(
    async (
      buildingConfig: { floors?: number; floorHeight?: number; footprint?: number; buildingType?: string } | null,
      reason: string | undefined,
      klingError: string | undefined,
      abort: AbortController,
    ) => {
      // Differentiate the three cases:
      //   1. kling-failed → real Kling outage → loud toast with error details
      //   2. kling-not-configured → env vars missing → quiet status update
      //   3. anything else → generic fallback message
      if (reason === "kling-failed" && klingError) {
        const truncated =
          klingError.length > 80 ? klingError.slice(0, 77) + "..." : klingError;
        setVideoStatusText(`Kling AI unavailable, rendering locally... (${truncated})`);
        // Surface the real Kling error in a toast so the dev/admin can see
        // exactly what went wrong (expired account, network, bad signature,
        // image format, etc.). 8s duration so it doesn't disappear too fast.
        toast.error("Kling AI unavailable", {
          description: klingError,
          duration: 8000,
        });
      } else if (reason === "kling-not-configured") {
        setVideoStatusText("Rendering locally (Kling API not configured)");
      } else {
        setVideoStatusText("Rendering locally with Three.js...");
      }
      setVideoProgress(5);

      try {
        const { renderWalkthrough } = await import("@/features/3d-render/services/walkthrough-renderer");
        const result = await renderWalkthrough({
          floors: buildingConfig?.floors ?? 2,
          floorHeight: buildingConfig?.floorHeight ?? 3.0,
          footprint: buildingConfig?.footprint ?? 200,
          buildingType: buildingConfig?.buildingType ?? "modern apartment",
          onProgress: (percent, phase) => {
            if (abort.signal.aborted) return;
            setVideoProgress(Math.max(5, Math.min(99, percent)));
            setVideoStatusText(`${phase} (${percent}%)`);
          },
        });

        if (abort.signal.aborted) {
          URL.revokeObjectURL(result.blobUrl);
          return;
        }

        // Track the blob URL so we can revoke it on reset/unmount
        localBlobUrlRef.current = result.blobUrl;
        setVideoUrl(result.blobUrl);
        setVideoProgress(100);
        setVideoStatusText("Your video is ready!");
        setVideoReady(true);
      } catch (err) {
        if (abort.signal.aborted) return;
        const msg = err instanceof Error ? err.message : "Three.js rendering failed";
        throw new Error(msg);
      }
    },
    [],
  );

  // ── Poll Kling dual tasks → concat → done ──
  const pollKlingTasks = useCallback(
    async (
      exteriorTaskId: string,
      interiorTaskId: string,
      abort: AbortController,
    ) => {
      const POLL_INTERVAL_MS = 6000;
      const TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
      const startedAt = Date.now();
      let messageIdx = 1; // we already showed message[0] in the parent

      const setRotatingStatus = () => {
        setVideoStatusText(VIDEO_STATUS_MESSAGES[messageIdx % VIDEO_STATUS_MESSAGES.length]);
        messageIdx++;
      };

      while (!abort.signal.aborted) {
        if (Date.now() - startedAt > TIMEOUT_MS) {
          throw new Error("Video generation timed out after 10 minutes. Please try again.");
        }

        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        if (abort.signal.aborted) return;

        let statusJson: {
          exteriorStatus?: string;
          interiorStatus?: string;
          exteriorVideoUrl?: string | null;
          interiorVideoUrl?: string | null;
          progress?: number;
          isComplete?: boolean;
          hasFailed?: boolean;
          failureMessage?: string | null;
        };
        try {
          const params = new URLSearchParams({
            exteriorTaskId,
            interiorTaskId,
            pipeline: "image2video",
          });
          const sres = await fetch(`/api/video-status?${params}`, { signal: abort.signal });
          if (!sres.ok) {
            // Transient — keep polling, don't break the loop
            console.warn("[VideoRenderStudio] poll non-200:", sres.status);
            continue;
          }
          statusJson = await sres.json();
        } catch (pollErr) {
          if (abort.signal.aborted) return;
          console.warn("[VideoRenderStudio] poll error (transient):", pollErr);
          continue;
        }

        if (statusJson.hasFailed) {
          throw new Error(statusJson.failureMessage ?? "Kling video generation failed");
        }

        // Animate progress bar smoothly toward server-reported value, capped at 80
        // until we hit the concat/persist phases (so the bar still has room to grow).
        const serverProgress = typeof statusJson.progress === "number" ? statusJson.progress : 0;
        const cappedProgress = Math.max(10, Math.min(80, serverProgress));
        setVideoProgress(cappedProgress);

        // Rotate the status messages every poll
        setRotatingStatus();

        if (
          statusJson.isComplete &&
          statusJson.exteriorVideoUrl &&
          statusJson.interiorVideoUrl
        ) {
          // ── Step 3: Concat the two segments via ffmpeg ──
          setVideoProgress(85);
          setVideoStatusText("Stitching scenes together...");

          let finalUrl: string | null = null;
          try {
            const cres = await fetch("/api/concat-videos", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                exteriorUrl: statusJson.exteriorVideoUrl,
                interiorUrl: statusJson.interiorVideoUrl,
              }),
              signal: abort.signal,
            });
            const cdata = await cres.json();
            if (cres.ok && cdata.videoUrl) {
              finalUrl = cdata.videoUrl as string;
            } else if (cres.status === 503) {
              // R2 not configured in this environment — gracefully use the
              // longer of the two Kling URLs (interior is 10s vs exterior 5s).
              console.warn("[VideoRenderStudio] R2 not configured, using interior segment directly");
              finalUrl = statusJson.interiorVideoUrl;
            } else {
              const cmsg = cdata?.error?.message ?? cdata?.error ?? "Concat failed";
              throw new Error(typeof cmsg === "string" ? cmsg : "Concat failed");
            }
          } catch (concatErr) {
            if (abort.signal.aborted) return;
            // Final fallback: use the interior segment alone so the user still
            // gets a video. This is the longer (10s) of the two.
            console.warn("[VideoRenderStudio] concat failed, falling back to interior:", concatErr);
            finalUrl = statusJson.interiorVideoUrl;
          }

          if (!finalUrl) {
            throw new Error("Both concat and fallback failed — no video URL available");
          }

          setVideoProgress(100);
          setVideoStatusText("Your video is ready!");
          setVideoUrl(finalUrl);
          setVideoReady(true);
          return;
        }
      }
    },
    [],
  );

  // ─── CINEMATIC PIPELINE — multi-stage walkthrough ────────────────────────
  // Calls /api/generate-cinematic-walkthrough → polls /api/cinematic-status
  // until the pipeline reaches "complete" or "failed". On completion the
  // final stitched MP4 URL is set on `videoUrl` so the existing player +
  // download / share / fullscreen actions all work unchanged.
  const startCinematicGeneration = useCallback(async () => {
    // Reset state for a fresh cinematic run
    if (videoAbortRef.current) videoAbortRef.current.abort();
    if (cinematicPollAbortRef.current) cinematicPollAbortRef.current.abort();
    if (localBlobUrlRef.current) {
      URL.revokeObjectURL(localBlobUrlRef.current);
      localBlobUrlRef.current = null;
    }
    setVideoUrl(null);
    setVideoReady(false);
    setVideoError(null);
    setVideoElapsed(0);
    setVideoProgress(0);
    setVideoStatusText("");
    setVideoMode("cinematic");
    setCinematicStatus(null);
    setCinematicElapsed(0);

    // Pick the photorealistic Full Layout (r4) as the source image — it's
    // the only render that's a true top-down view of the entire floor plan,
    // which is what the OVERVIEW stage's prompt expects.
    const fullLayout = renders.find((r) => r.id === "r4");
    const sourceImage = fullLayout?.url ?? null;
    if (!sourceImage) {
      toast.error("Cinematic walkthrough needs the Full Layout render", {
        description: "Please render the floor plan first, then try again.",
      });
      setVideoMode(null);
      return;
    }
    // We need the ORIGINAL uploaded File so we can read it as a data URL
    // (see the floorPlanDataUrl block below). The previewUrl state variable
    // is a `blob:` URL that only exists in this browser tab — the server
    // can't fetch it, so we must encode the bytes inline.
    if (!uploadedFile) {
      toast.error("Original floor plan missing", {
        description: "Re-upload your floor plan before generating a cinematic walkthrough.",
      });
      setVideoMode(null);
      return;
    }

    // ── Encode the uploaded floor plan as a data URL ──
    // The /api/generate-cinematic-walkthrough endpoint needs the floor plan
    // bytes server-side (it feeds them to GPT-Image-1's images.edit). We
    // can't send `previewUrl` here because that's a `blob:http://...` URL
    // produced by URL.createObjectURL — those URLs only exist in the
    // browser tab that created them, so the server can't fetch them.
    // Reading the actual File via FileReader.readAsDataURL gives us a
    // self-contained `data:image/...;base64,...` string the server can
    // decode directly.
    let floorPlanDataUrl: string;
    try {
      floorPlanDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () =>
          reject(reader.error ?? new Error("FileReader failed"));
        reader.readAsDataURL(uploadedFile);
      });
    } catch (readErr) {
      const msg = readErr instanceof Error ? readErr.message : String(readErr);
      toast.error("Could not read floor plan file", { description: msg });
      setVideoMode(null);
      return;
    }

    // Build the rooms list from render labels (exclude the Full Layout tile).
    const rooms = renders
      .filter((r) => r.id !== "r4" && !!r.url)
      .map((r) => r.label);

    // The primary room (the one we descend into) defaults to "Living Room"
    // if it's in the renders, otherwise the first available room.
    const primaryRoom =
      rooms.find((r) => r.toLowerCase().includes("living")) ??
      rooms[0] ??
      "Living Room";

    const submitAbort = new AbortController();
    cinematicPollAbortRef.current = submitAbort;

    let pipelineId: string;
    try {
      toast.info("Producing cinematic walkthrough", {
        description: "Generating the eye-level lifestyle render...",
        duration: 4000,
      });
      // Derive building type from the GPT-4o structural analysis when
      // available — otherwise fall back to a neutral "building" so the
      // downstream cinematic pipeline does not assume a modern apartment
      // for commercial / mixed-use / industrial floor plans.
      const detectedBuildingType =
        structural && structural.buildingType !== "other"
          ? structural.buildingType
          : "building";

      const res = await fetch("/api/generate-cinematic-walkthrough", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceImage,
          // floor plan as a data URL — see floorPlanDataUrl block above for
          // why we can't send `previewUrl` (it's a blob: URL the server
          // can't fetch).
          floorPlanImage: floorPlanDataUrl,
          description: fullDescription,
          rooms,
          buildingType: detectedBuildingType,
          primaryRoom,
        }),
        signal: submitAbort.signal,
      });
      const data = await res.json();
      if (!res.ok) {
        // Intercept plan gate / email verification — show upgrade popup
        if (data?.error && typeof data.error === "object" && (data.error.code === "PLAN_001" || data.error.code === "RATE_001" || data.error.code === "AUTH_001")) {
          setUpgradeBlock({ title: data.error.title, message: data.error.message, action: data.error.action, actionUrl: data.error.actionUrl });
          setVideoMode(null);
          return;
        }
        const msg =
          data?.error?.message ?? data?.error ?? `HTTP ${res.status}`;
        const msgStr = typeof msg === "string" ? msg : "Cinematic submit failed";
        const tagged = res.status === 429 ? `RATE_LIMIT::${msgStr}` : msgStr;
        throw new Error(tagged);
      }
      pipelineId = data.pipelineId as string;
      // Initial state — we already have the stages map back from the orchestrator.
      // We synthesize a minimal CinematicStatusResponse so the UI can render
      // the indicator immediately, before the first poll round-trip.
      setCinematicStatus({
        pipelineId,
        pipelineStatus: "processing",
        progress: 5,
        currentStage: "overview",
        statusMessage: "Creating cinematic overview of your floor plan...",
        stages: {
          overview: {
            name: "overview",
            status: data.stages?.overview?.status ?? "submitted",
            durationSeconds: 10,
          },
          transition: {
            name: "transition",
            status: data.stages?.transition?.status ?? "pending",
            durationSeconds: 5,
          },
          lifestyle: {
            name: "lifestyle",
            status: data.stages?.lifestyle?.status ?? "submitted",
            imageUrl: data.stages?.lifestyle?.sourceImageUrl,
            durationSeconds: 10,
          },
          stitch: {
            name: "stitch",
            status: data.stages?.stitch?.status ?? "pending",
          },
        },
        pipeline: "cinematic-multi-stage",
      });
    } catch (err) {
      if (submitAbort.signal.aborted) return;
      const rawMsg = err instanceof Error ? err.message : "Cinematic submit failed";
      // Detect rate-limit responses (tagged in the throw above) so the
      // user gets a friendlier message and a clear next step instead of a
      // scary "video generation failed" panel.
      const isRateLimit = rawMsg.startsWith("RATE_LIMIT::");
      const msg = isRateLimit ? rawMsg.slice("RATE_LIMIT::".length) : rawMsg;
      console.error("[VideoRenderStudio] cinematic submit error:", msg);
      if (isRateLimit) {
        toast.warning("Cinematic walkthrough limit reached", {
          description:
            "Try the standard 3D Video Walkthrough — same source image, no extra wait.",
          duration: 8000,
        });
      } else {
        toast.error("Cinematic walkthrough failed", { description: msg });
      }
      setVideoError(msg);
      setVideoMode(null);
      return;
    }

    // ── Poll cinematic status until complete or failed ──
    const POLL_INTERVAL_MS = 5000;
    const TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes max
    const startedAt = Date.now();

    while (!submitAbort.signal.aborted) {
      if (Date.now() - startedAt > TIMEOUT_MS) {
        toast.error("Cinematic walkthrough timed out", {
          description: "Generation took longer than 20 minutes. Please try again.",
        });
        setVideoError("Cinematic generation timed out after 20 minutes");
        return;
      }

      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      if (submitAbort.signal.aborted) return;

      let statusJson: CinematicStatusResponse;
      try {
        const sres = await fetch(
          `/api/cinematic-status?pipelineId=${encodeURIComponent(pipelineId)}`,
          { signal: submitAbort.signal },
        );
        if (!sres.ok) {
          if (sres.status === 404) {
            // Pipeline expired or never existed
            const data = await sres.json().catch(() => ({}));
            const msg =
              data?.error?.message ?? "Cinematic pipeline not found (it may have expired)";
            setVideoError(msg);
            return;
          }
          // Transient — keep polling
          console.warn("[VideoRenderStudio] cinematic poll non-200:", sres.status);
          continue;
        }
        statusJson = (await sres.json()) as CinematicStatusResponse;
      } catch (pollErr) {
        if (submitAbort.signal.aborted) return;
        console.warn("[VideoRenderStudio] cinematic poll error (transient):", pollErr);
        continue;
      }

      setCinematicStatus(statusJson);

      if (
        statusJson.pipelineStatus === "complete" &&
        statusJson.finalVideoUrl
      ) {
        setVideoUrl(statusJson.finalVideoUrl);
        setVideoReady(true);
        setVideoProgress(100);
        setVideoStatusText("Your cinematic walkthrough is ready!");
        toast.success("Cinematic walkthrough ready!", {
          description: "Try not to watch it 47 times.",
        });
        return;
      }

      if (statusJson.pipelineStatus === "failed") {
        const errors: string[] = [];
        if (statusJson.stages.overview.error)
          errors.push(`Overview: ${statusJson.stages.overview.error}`);
        if (statusJson.stages.lifestyle.error)
          errors.push(`Lifestyle: ${statusJson.stages.lifestyle.error}`);
        if (statusJson.stages.stitch.error)
          errors.push(`Stitch: ${statusJson.stages.stitch.error}`);
        const errMsg =
          errors.length > 0
            ? errors.join(" · ")
            : "Cinematic generation failed";
        setVideoError(errMsg);
        toast.error("Cinematic walkthrough failed", { description: errMsg });
        return;
      }

      // partial → keep going if stitch isn't done yet; otherwise show what we have.
      if (
        statusJson.pipelineStatus === "partial" &&
        statusJson.finalVideoUrl
      ) {
        setVideoUrl(statusJson.finalVideoUrl);
        setVideoReady(true);
        setVideoProgress(100);
        setVideoStatusText(
          "Partial walkthrough delivered — some stages couldn't be completed.",
        );
        toast.warning("Partial cinematic walkthrough", {
          description: "Some stages failed but we delivered what we have.",
          duration: 6000,
        });
        return;
      }
    }
  }, [renders, uploadedFile, fullDescription, structural]);

  // ── Action handlers (download / preview / share / 4K) ──
  // Real download — fetch the bytes and trigger a same-origin blob download.
  // We do NOT use a plain `<a href download>` because:
  //   1. R2 URLs are cross-origin → the browser silently strips the download
  //      attribute and treats the click as a navigation, blanking the page.
  //   2. blob: URLs from the Three.js fallback work with `download` but they
  //      should be saved as .webm not .mp4.
  // The fetch+blob approach handles both consistently.
  const handleDownloadVideo = useCallback(async () => {
    if (!videoUrl) return;

    const isBlobUrl = videoUrl.startsWith("blob:");
    const filename = isBlobUrl
      ? "buildflow-walkthrough.webm"
      : "buildflow-walkthrough.mp4";

    // Local blob — already same-origin, the download attribute always works.
    if (isBlobUrl) {
      const a = document.createElement("a");
      a.href = videoUrl;
      a.download = filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success("Downloading your walkthrough...");
      return;
    }

    // Remote URL — fetch as blob so the browser saves it instead of navigating.
    toast.info("Preparing download...");
    try {
      const res = await fetch(videoUrl, { mode: "cors" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revoke after the click has registered (200ms is plenty).
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      toast.success("Downloaded!");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Download failed";
      console.error("[Download MP4] Error:", msg);
      // Last-resort fallback: open the URL in a new tab so the user can
      // right-click → Save As. Better than a silent failure.
      toast.error("Couldn't download — opening in a new tab", { description: msg });
      window.open(videoUrl, "_blank", "noopener,noreferrer");
    }
  }, [videoUrl]);

  const handlePreviewFullscreen = useCallback(() => {
    const el = videoElementRef.current;
    if (!el) return;
    // Some browsers (Safari iOS) only expose webkitEnterFullscreen
    const anyEl = el as HTMLVideoElement & {
      webkitEnterFullscreen?: () => void;
      webkitRequestFullscreen?: () => Promise<void>;
    };
    try {
      if (typeof el.requestFullscreen === "function") {
        void el.requestFullscreen();
      } else if (typeof anyEl.webkitRequestFullscreen === "function") {
        void anyEl.webkitRequestFullscreen();
      } else if (typeof anyEl.webkitEnterFullscreen === "function") {
        anyEl.webkitEnterFullscreen();
      } else {
        toast.info("Fullscreen isn't supported in this browser.");
      }
    } catch (err) {
      console.warn("[VideoRenderStudio] fullscreen failed:", err);
      toast.error("Couldn't enter fullscreen.");
    }
  }, []);

  const handleShareVideo = useCallback(async () => {
    if (!videoUrl || isSharingVideo) return;
    // Local blob URLs (Three.js fallback) can't be shared publicly.
    if (videoUrl.startsWith("blob:")) {
      toast.error("Local previews can't be shared. Generate a Kling video to share publicly.");
      return;
    }
    setIsSharingVideo(true);
    try {
      const res = await fetch("/api/share/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoUrl,
          title: "3D Walkthrough",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data?.error?.message ?? data?.error ?? `HTTP ${res.status}`;
        throw new Error(typeof msg === "string" ? msg : "Share failed");
      }
      const shareUrl: string = data.shareUrl;
      try {
        await navigator.clipboard.writeText(shareUrl);
      } catch {
        // Fallback for browsers that block the clipboard API
        const ta = document.createElement("textarea");
        ta.value = shareUrl;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand("copy");
        } catch {
          /* noop */
        }
        document.body.removeChild(ta);
      }
      toast.success("Share link copied!", { description: shareUrl, duration: 6000 });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error("Couldn't create share link", { description: msg });
    } finally {
      setIsSharingVideo(false);
    }
  }, [videoUrl, isSharingVideo]);

  const handleDownload4K = useCallback(() => {
    toast.info("4K renders coming soon", {
      description: "Pro plan unlocks 4K. The current 1080p MP4 is already downloaded.",
      duration: 5000,
    });
  }, []);

  const handleRetryVideo = useCallback(() => {
    setVideoError(null);
    // Retry the same mode the user was on. If they were running cinematic
    // and it failed, hitting "Try Again" should restart the cinematic
    // pipeline, not silently switch them to the quick path.
    if (videoMode === "cinematic") {
      void startCinematicGeneration();
    } else {
      void startVideoGeneration();
    }
  }, [videoMode, startCinematicGeneration, startVideoGeneration]);

  const handleReset = useCallback(() => {
    if (videoAbortRef.current) {
      videoAbortRef.current.abort();
      videoAbortRef.current = null;
    }
    if (videoTimerRef.current) {
      clearInterval(videoTimerRef.current);
      videoTimerRef.current = null;
    }
    if (cinematicPollAbortRef.current) {
      cinematicPollAbortRef.current.abort();
      cinematicPollAbortRef.current = null;
    }
    if (cinematicTimerRef.current) {
      clearInterval(cinematicTimerRef.current);
      cinematicTimerRef.current = null;
    }
    if (localBlobUrlRef.current) {
      URL.revokeObjectURL(localBlobUrlRef.current);
      localBlobUrlRef.current = null;
    }
    // Replace the current history entry so the URL no longer points at a
    // wizard step the user has explicitly reset away from. We can't erase
    // earlier back-stack entries (browsers don't allow it), but the popstate
    // handler's defensive bounce-to-upload will catch any stale ones.
    if (typeof window !== "undefined") {
      try {
        window.history.replaceState({ step: "upload" }, "", window.location.pathname);
      } catch {
        /* ignore */
      }
    }
    setStep("upload");
    setUploadedFile(null);
    setPreviewUrl(null);
    setUploadedDims(null);
    setRenderProgress(0);
    setRenders([]);
    setSelectedRender("r4");
    setVideoProgress(0);
    setVideoReady(false);
    setVideoUrl(null);
    setVideoStatusText("");
    setVideoError(null);
    setVideoElapsed(0);
    setFullDescription("");
    // Cinematic-specific resets
    setVideoMode(null);
    setCinematicStatus(null);
    setCinematicElapsed(0);
  }, []);

  return (
    <div className="h-full overflow-y-auto flex flex-col" style={{
      background: "linear-gradient(180deg, #FAFBFE 0%, #F0F1F8 50%, #FAFBFE 100%)",
      position: "relative",
    }}>
      {/* Upgrade / Verify popup */}
      {upgradeBlock && (() => {
        const isVerify = upgradeBlock.actionUrl?.includes("settings");
        const isUp = !isVerify;
        return (
          <div style={{ position: "fixed", inset: 0, zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.75)", backdropFilter: "blur(12px)" }}>
            <div style={{ maxWidth: 460, width: "100%", borderRadius: 28, overflow: "hidden", background: "linear-gradient(180deg, #0F0F2A, #080816)", border: "1px solid rgba(139,92,246,0.12)", boxShadow: "0 40px 120px rgba(0,0,0,0.8), 0 0 80px rgba(139,92,246,0.06)", position: "relative" }}>
              <div style={{ height: 3, background: isUp ? "linear-gradient(90deg, #8B5CF6, #EC4899, #F59E0B, #8B5CF6)" : "linear-gradient(90deg, #4F8AFF, #A855F7, #10B981, #4F8AFF)", backgroundSize: "200% 100%", animation: "fp-shimmer 3s linear infinite" }} />
              <div style={{ padding: "40px 32px 12px", textAlign: "center", background: isUp ? "radial-gradient(ellipse at 50% 0%, rgba(139,92,246,0.06) 0%, transparent 70%)" : "radial-gradient(ellipse at 50% 0%, rgba(79,138,255,0.06) 0%, transparent 70%)" }}>
                <div style={{ fontSize: 64, lineHeight: 1, marginBottom: 8 }}>{isUp ? "\uD83C\uDFAC" : "\uD83D\uDCEC"}</div>
                <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 16 }}>{["\u2728", "\uD83C\uDFA8", "\uD83E\uDDCA", "\uD83C\uDFA8", "\u2728"].map((s, i) => <span key={i} style={{ fontSize: 14, opacity: 0.6 }}>{s}</span>)}</div>
                <h2 style={{ fontSize: 24, fontWeight: 800, color: "#F0F2F8", letterSpacing: "-0.03em", margin: "0 0 8px" }}>{isUp ? "This feature needs a bigger engine" : "One quick thing before your render"}</h2>
                <p style={{ fontSize: 13, color: "#8888A8", lineHeight: 1.65, margin: "0 auto 20px", maxWidth: 380 }}>{isUp ? "3D renders, cinematic walkthroughs, AI video — the premium stuff. You've tasted the free tier, now unlock the full creative arsenal." : "Verify your email to unlock your final free render. Quick click, back in 10 seconds."}</p>
              </div>
              <div style={{ padding: "0 32px 24px" }}>
                <div style={{ background: isUp ? "rgba(139,92,246,0.04)" : "rgba(79,138,255,0.04)", border: `1px solid ${isUp ? "rgba(139,92,246,0.08)" : "rgba(79,138,255,0.08)"}`, borderRadius: 16, padding: "16px 20px", marginBottom: 20 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.5px", marginBottom: 12, color: isUp ? "#8B5CF6" : "#4F8AFF" }}>{isUp ? "Unlock with Starter" : "After verification"}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {(isUp ? [{ icon: "\uD83C\uDFAC", text: "Cinematic video walkthroughs" }, { icon: "\uD83E\uDDCA", text: "Interactive 3D models" }, { icon: "\uD83C\uDFA8", text: "10 photorealistic renders/month" }, { icon: "\u26A1", text: "Priority render queue" }] : [{ icon: "\u2705", text: "Unlock your final free render" }, { icon: "\uD83D\uDD10", text: "Secure your account" }, { icon: "\uD83D\uDCE9", text: "Get notified on new features" }, { icon: "\u26A1", text: "Takes 10 seconds" }]).map((f, i) => <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}><span style={{ fontSize: 16 }}>{f.icon}</span><span style={{ fontSize: 12.5, color: "#C0C0D8", fontWeight: 500 }}>{f.text}</span></div>)}
                  </div>
                </div>
                <a href={upgradeBlock.actionUrl} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, width: "100%", padding: "16px 24px", borderRadius: 16, background: isUp ? "linear-gradient(135deg, #8B5CF6, #EC4899)" : "linear-gradient(135deg, #4F8AFF, #A855F7)", color: "#fff", fontSize: 15, fontWeight: 800, textDecoration: "none", boxShadow: isUp ? "0 8px 32px rgba(139,92,246,0.3)" : "0 8px 32px rgba(79,138,255,0.3)", letterSpacing: "-0.01em" }}>{upgradeBlock.action} &rarr;</a>
                <button onClick={() => setUpgradeBlock(null)} style={{ width: "100%", marginTop: 10, padding: "10px", borderRadius: 12, background: "transparent", border: "none", color: "#3A3A52", fontSize: 11, cursor: "pointer", fontStyle: "italic" }}>{isUp ? "I'll stick with blueprints and imagination" : "I'll verify later"}</button>
              </div>
              <style>{`@keyframes fp-shimmer { 0% { background-position: 0% 50%; } 100% { background-position: 200% 50%; } }`}</style>
            </div>
          </div>
        );
      })()}

      {/* ─── HERO — Three.js background + centered text ─── */}
      {/* Rendered only on the Upload step. On Render/Gallery/Video the hero
          is purely decorative and costs ~220px of vertical space that's
          needed for the progress ring, the full-width render comparison,
          and the video player. HeroScene + radial-fade + content hooks
          have no side effects, so unmounting them on step change is safe;
          the Canvas fully re-initializes when the user returns to Upload
          via "Start Over". */}
      {step === "upload" && (
        <div className="relative overflow-hidden" style={{ minHeight: 220 }}>
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
      )}

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
              <ComparisonSlider
                beforeSrc={previewUrl}
                afterSrc={renders.find(r => r.id === selectedRender)?.url ?? null}
                fullWidth
              />
              <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="flex justify-center mt-8">
                <motion.button whileHover={{ scale: 1.04, y: -2 }} whileTap={{ scale: 0.96 }}
                  onClick={() => goToStep("video")}
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
              <VideoSection
                mode={videoMode}
                videoProgress={videoProgress}
                videoReady={videoReady}
                videoUrl={videoUrl}
                videoStatusText={videoStatusText}
                videoError={videoError}
                videoElapsed={videoElapsed}
                isSharing={isSharingVideo}
                cinematicStatus={cinematicStatus}
                cinematicElapsed={cinematicElapsed}
                videoRef={videoElementRef}
                onGenerate={() => {
                  setVideoMode("quick");
                  void startVideoGeneration();
                }}
                onGenerateCinematic={startCinematicGeneration}
                onDownload={handleDownloadVideo}
                onPreview={handlePreviewFullscreen}
                onShare={handleShareVideo}
                onRetry={handleRetryVideo}
                onDownload4K={handleDownload4K}
              />
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
