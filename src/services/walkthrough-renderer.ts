/**
 * Three.js Client-Side Walkthrough Renderer
 *
 * Renders a 15-second hyper-realistic AEC building walkthrough video
 * entirely in the browser using an offscreen WebGL canvas.
 *
 * Camera sequence:
 *   Phase 1 (0-3s):  Far exterior drone pull-in, golden hour
 *   Phase 2 (3-7s):  Orbit showing all elevations, structural grid
 *   Phase 3 (7-11s): Punch through facade into interior (columns, MEP)
 *   Phase 4 (11-15s): Rise through floor plates (section cut), wide shot
 */

import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import {
  buildBuilding,
  generateRoomsForBuilding,
  getDefaultConfig,
} from "@/components/canvas/artifacts/architectural-viewer/building";
import { createMaterials, disposeMaterials } from "@/components/canvas/artifacts/architectural-viewer/materials";
import { addFurniture } from "@/components/canvas/artifacts/architectural-viewer/furniture";
import type { BuildingStyle } from "@/components/canvas/artifacts/architectural-viewer/types";

// ─── Public Types ────────────────────────────────────────────────────────────

export interface WalkthroughConfig {
  floors: number;
  floorHeight: number;
  footprint: number; // in m²
  buildingType?: string;
  style?: Partial<BuildingStyle>;
  resolution?: { width: number; height: number };
  fps?: number;
  durationSeconds?: number;
  onProgress?: (percent: number, phase: string) => void;
}

export interface WalkthroughResult {
  blobUrl: string;
  blob: Blob;
  durationSeconds: number;
  resolution: { width: number; height: number };
  fps: number;
  fileSizeBytes: number;
}

// ─── Phase Labels ────────────────────────────────────────────────────────────

const PHASE_LABELS = [
  "Exterior Pull-in",
  "Building Orbit",
  "Interior Walkthrough",
  "Section Rise",
] as const;

// Phase time boundaries (normalized 0-1)
const PHASE_BOUNDS = [
  { start: 0, end: 0.2 },     // 0-3s / 15s
  { start: 0.2, end: 0.467 }, // 3-7s / 15s
  { start: 0.467, end: 0.733 }, // 7-11s / 15s
  { start: 0.733, end: 1.0 },   // 11-15s / 15s
];

// ─── MEP Services ────────────────────────────────────────────────────────────

function addMEPServices(
  scene: THREE.Scene,
  config: { floors: number; floorHeight: number; buildingWidth: number; buildingDepth: number }
) {
  const mepGroup = new THREE.Group();
  mepGroup.name = "MEP_Services";

  const ductMat = new THREE.MeshStandardMaterial({
    color: 0xc0c0c0,
    metalness: 0.7,
    roughness: 0.3,
  });
  const pipeMat = new THREE.MeshStandardMaterial({
    color: 0xb87333, // copper
    metalness: 0.85,
    roughness: 0.2,
  });
  const cableTrayMat = new THREE.MeshStandardMaterial({
    color: 0x808080,
    metalness: 0.6,
    roughness: 0.4,
  });

  const halfW = config.buildingWidth / 2;
  const halfD = config.buildingDepth / 2;

  for (let f = 0; f < config.floors; f++) {
    const ceilingY = (f + 1) * config.floorHeight - 0.3;

    // Main duct run (rectangular) along X axis
    const ductGeo = new THREE.BoxGeometry(config.buildingWidth * 0.8, 0.3, 0.5);
    const duct = new THREE.Mesh(ductGeo, ductMat);
    duct.position.set(0, ceilingY, -halfD * 0.3);
    duct.castShadow = true;
    mepGroup.add(duct);

    // Branch ducts along Z
    for (let i = -2; i <= 2; i++) {
      const branchGeo = new THREE.BoxGeometry(0.25, 0.2, config.buildingDepth * 0.4);
      const branch = new THREE.Mesh(branchGeo, ductMat);
      branch.position.set(i * (halfW * 0.35), ceilingY - 0.05, 0);
      mepGroup.add(branch);
    }

    // Pipe runs (cylindrical) along X axis
    const pipeGeo = new THREE.CylinderGeometry(0.04, 0.04, config.buildingWidth * 0.75, 8);
    pipeGeo.rotateZ(Math.PI / 2);
    for (let p = 0; p < 3; p++) {
      const pipe = new THREE.Mesh(pipeGeo, pipeMat);
      pipe.position.set(0, ceilingY - 0.35 - p * 0.08, halfD * 0.2);
      mepGroup.add(pipe);
    }

    // Cable tray (flat channel) along X axis
    const trayGeo = new THREE.BoxGeometry(config.buildingWidth * 0.7, 0.05, 0.3);
    const tray = new THREE.Mesh(trayGeo, cableTrayMat);
    tray.position.set(0, ceilingY - 0.55, -halfD * 0.1);
    mepGroup.add(tray);
  }

  scene.add(mepGroup);
  return { ductMat, pipeMat, cableTrayMat };
}

// ─── PBR Material Upgrade ────────────────────────────────────────────────────

function upgradeToPBR(scene: THREE.Scene) {
  scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    const mat = obj.material as THREE.Material;
    if (mat instanceof THREE.MeshStandardMaterial) return; // already PBR

    if (mat instanceof THREE.MeshBasicMaterial) {
      const pbr = new THREE.MeshStandardMaterial({
        color: mat.color.clone(),
        map: mat.map,
        transparent: mat.transparent,
        opacity: mat.opacity,
        side: mat.side,
      });

      // Detect material type by name and apply PBR properties
      const name = (mat.name || "").toLowerCase();
      if (name.includes("glass") || (mat.transparent && mat.opacity < 0.8)) {
        pbr.metalness = 0.9;
        pbr.roughness = 0.05;
        pbr.transparent = true;
        pbr.opacity = Math.min(mat.opacity, 0.35);
        pbr.envMapIntensity = 1.5;
      } else if (name.includes("metal") || name.includes("steel")) {
        pbr.metalness = 0.95;
        pbr.roughness = 0.15;
      } else if (name.includes("concrete")) {
        pbr.metalness = 0.0;
        pbr.roughness = 0.85;
      } else if (name.includes("wood")) {
        pbr.metalness = 0.0;
        pbr.roughness = 0.6;
      } else {
        pbr.metalness = 0.0;
        pbr.roughness = 0.5;
      }

      obj.material = pbr;
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });
}

// ─── Lighting Setup ──────────────────────────────────────────────────────────

function setupLighting(scene: THREE.Scene, buildingHeight: number) {
  // Golden hour sun
  const sun = new THREE.DirectionalLight(0xffd4a0, 2.5);
  sun.position.set(50, buildingHeight * 1.5, 30);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = buildingHeight * 4;
  const shadowExtent = buildingHeight * 1.5;
  sun.shadow.camera.left = -shadowExtent;
  sun.shadow.camera.right = shadowExtent;
  sun.shadow.camera.top = shadowExtent;
  sun.shadow.camera.bottom = -shadowExtent;
  sun.shadow.bias = -0.001;
  scene.add(sun);

  // Hemisphere ambient
  const hemi = new THREE.HemisphereLight(0x87ceeb, 0xffd4a0, 0.6);
  scene.add(hemi);

  // Subtle ambient fill
  const ambient = new THREE.AmbientLight(0xffffff, 0.15);
  scene.add(ambient);

  // Interior warm point lights
  const interiorLights: THREE.PointLight[] = [];
  for (let f = 0; f < Math.min(buildingHeight / 3.6, 8); f++) {
    const light = new THREE.PointLight(0xffeedd, 0.4, 20);
    light.position.set(0, f * 3.6 + 2, 0);
    scene.add(light);
    interiorLights.push(light);
  }

  return { sun, hemi, ambient, interiorLights };
}

// ─── Camera Path Builder ─────────────────────────────────────────────────────

function buildCameraPath(
  buildingWidth: number,
  buildingDepth: number,
  buildingHeight: number,
) {
  const hw = buildingWidth / 2;
  const hd = buildingDepth / 2;
  const midH = buildingHeight / 2;

  // Phase 1: Far exterior pull-in (0 → 0.2)
  // Start far back, slightly elevated, pull toward the facade
  const phase1Points = [
    new THREE.Vector3(hw * 3, buildingHeight * 0.8, hd * 3),
    new THREE.Vector3(hw * 2, buildingHeight * 0.6, hd * 2),
    new THREE.Vector3(hw * 1.3, midH * 0.9, hd * 1.5),
  ];

  // Phase 2: Orbit around building (0.2 → 0.467)
  // Circle at mid-height showing all elevations
  const orbitRadius = Math.max(hw, hd) * 1.8;
  const orbitPoints: THREE.Vector3[] = [];
  const orbitSteps = 12;
  for (let i = 0; i <= orbitSteps; i++) {
    const angle = (i / orbitSteps) * Math.PI * 1.5 + Math.PI * 0.25;
    orbitPoints.push(new THREE.Vector3(
      Math.cos(angle) * orbitRadius,
      midH * 0.8 + Math.sin(i / orbitSteps * Math.PI) * 3,
      Math.sin(angle) * orbitRadius,
    ));
  }

  // Phase 3: Punch through facade into interior (0.467 → 0.733)
  // Approach facade, penetrate, glide through interior
  const entryZ = hd * 1.2;
  const interiorY = 3.6 * 0.6; // ground floor, eye level
  const phase3Points = [
    new THREE.Vector3(hw * 0.3, midH * 0.4, entryZ),
    new THREE.Vector3(hw * 0.2, interiorY + 1, hd * 0.5),
    new THREE.Vector3(0, interiorY + 1, 0),
    new THREE.Vector3(-hw * 0.3, interiorY + 1, -hd * 0.3),
    new THREE.Vector3(-hw * 0.5, interiorY + 1.5, -hd * 0.6),
  ];

  // Phase 4: Rise through floors + section cut (0.733 → 1.0)
  // Vertical rise showing stacked floors, end with dramatic wide shot
  const phase4Points = [
    new THREE.Vector3(-hw * 0.3, interiorY + 2, -hd * 0.3),
    new THREE.Vector3(0, buildingHeight * 0.4, 0),
    new THREE.Vector3(hw * 0.2, buildingHeight * 0.7, hd * 0.2),
    new THREE.Vector3(hw * 1.5, buildingHeight * 1.1, hd * 1.5),
  ];

  // Build splines for each phase
  const splines = [
    new THREE.CatmullRomCurve3(phase1Points, false, "centripetal"),
    new THREE.CatmullRomCurve3(orbitPoints, false, "centripetal"),
    new THREE.CatmullRomCurve3(phase3Points, false, "centripetal"),
    new THREE.CatmullRomCurve3(phase4Points, false, "centripetal"),
  ];

  return splines;
}

// Get camera look-at target for each phase
function getCameraTarget(
  phaseIndex: number,
  localT: number,
  buildingWidth: number,
  buildingDepth: number,
  buildingHeight: number,
): THREE.Vector3 {
  const midH = buildingHeight / 2;
  switch (phaseIndex) {
    case 0: // Pull-in: look at building center
      return new THREE.Vector3(0, midH * 0.6, 0);
    case 1: // Orbit: look at building center
      return new THREE.Vector3(0, midH * 0.5, 0);
    case 2: // Interior: look ahead along path
      return new THREE.Vector3(
        -buildingWidth * 0.2 * localT,
        3.6 * 0.6 + 1,
        -buildingDepth * 0.3 * localT,
      );
    case 3: {
      // Rise: look at center, then pull back for wide shot
      const lookY = THREE.MathUtils.lerp(buildingHeight * 0.3, midH, localT);
      const pullBack = localT > 0.7 ? (localT - 0.7) / 0.3 : 0;
      return new THREE.Vector3(
        pullBack * buildingWidth * 0.3,
        lookY,
        pullBack * buildingDepth * 0.3,
      );
    }
    default:
      return new THREE.Vector3(0, midH, 0);
  }
}

// ─── Section Cut (Phase 4) ───────────────────────────────────────────────────

function createSectionPlane() {
  const plane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  return plane;
}

// ─── Fog & Environment ───────────────────────────────────────────────────────

function setupEnvironment(scene: THREE.Scene, _buildingHeight: number) {
  // Atmospheric fog
  scene.fog = new THREE.FogExp2(0xd4c5a9, 0.003);

  // Sky gradient background
  scene.background = new THREE.Color(0x1a1a2e);

  // Ground plane
  const groundGeo = new THREE.PlaneGeometry(500, 500);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x3a3a3a,
    roughness: 0.95,
    metalness: 0,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  ground.receiveShadow = true;
  scene.add(ground);

  // Simple env map for reflections
  let tempRenderer: THREE.WebGLRenderer | null = null;
  try {
    tempRenderer = new THREE.WebGLRenderer({ canvas: document.createElement("canvas") });
    const pmremGenerator = new THREE.PMREMGenerator(tempRenderer);
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x87ceeb);

    // Gradient hemisphere for the env map
    const envHemi = new THREE.HemisphereLight(0x87ceeb, 0xffd4a0, 1);
    envScene.add(envHemi);

    const envMap = pmremGenerator.fromScene(envScene, 0.04).texture;
    scene.environment = envMap;
    pmremGenerator.dispose();
  } catch (e) {
    console.warn("[walkthrough] PMREM env map failed, skipping:", e);
  } finally {
    // Always dispose the temp renderer to avoid WebGL context leak
    tempRenderer?.dispose();
  }

  return { groundMat };
}

// ─── Main Render Function ────────────────────────────────────────────────────

export async function renderWalkthrough(
  config: WalkthroughConfig,
): Promise<WalkthroughResult> {
  const WIDTH = config.resolution?.width ?? 960;
  const HEIGHT = config.resolution?.height ?? 540;
  const FPS = config.fps ?? 24;
  const DURATION = config.durationSeconds ?? 15;
  const TOTAL_FRAMES = FPS * DURATION;

  const report = (percent: number, phase: string) => {
    config.onProgress?.(Math.round(percent), phase);
  };

  report(0, PHASE_LABELS[0]);

  // ── Scene Setup ──
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, WIDTH / HEIGHT, 0.1, 1000);

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false, // Disabled for faster rendering
    alpha: false,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance",
  });
  renderer.setSize(WIDTH, HEIGHT);
  renderer.setPixelRatio(1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  renderer.shadowMap.enabled = false; // Disabled for speed — shadows are expensive
  renderer.localClippingEnabled = true;

  // ── Build the building ──
  const floorHeight = config.floorHeight || 3.6;
  const floors = Math.min(config.floors || 5, 30);
  const footprint = config.footprint || 800;
  const buildingHeight = floors * floorHeight;

  // Compute approximate building dimensions from footprint
  const buildingWidth = Math.sqrt(footprint * 1.6); // slightly rectangular
  const buildingDepth = footprint / buildingWidth;

  const defaultStyle: BuildingStyle = {
    glassHeavy: true,
    hasRiver: false,
    hasLake: false,
    isModern: true,
    isTower: floors > 8,
    exteriorMaterial: "glass",
    environment: "urban",
    usage: "office",
    promptText: config.buildingType || "modern office building",
    typology: floors > 8 ? "tower" : "slab",
    facadePattern: "curtain-wall",
    maxFloorCap: 30,
  };

  const style: BuildingStyle = { ...defaultStyle, ...config.style } as BuildingStyle;

  const materials = createMaterials();
  const rooms = generateRoomsForBuilding(floors, style, footprint);
  const buildingConfig = getDefaultConfig(style);
  buildingConfig.floors = floors;
  buildingConfig.floorHeight = floorHeight;
  buildingConfig.rooms = rooms;

  const { buildingGroup } = buildBuilding(buildingConfig, materials, scene);

  // Add furniture
  const furnitureGroup = new THREE.Group();
  addFurniture(rooms, 0, 0, floorHeight, materials, furnitureGroup);
  buildingGroup.add(furnitureGroup);

  report(5, PHASE_LABELS[0]);

  // Upgrade all materials to PBR
  upgradeToPBR(scene);

  // Add MEP services
  const mepMats = addMEPServices(scene, {
    floors,
    floorHeight,
    buildingWidth,
    buildingDepth,
  });

  // Environment & lighting
  setupEnvironment(scene, buildingHeight);
  setupLighting(scene, buildingHeight);

  // Post-processing
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(WIDTH / 2, HEIGHT / 2), // Half-res bloom for speed
    0.25, // strength (slightly reduced)
    0.4,  // radius
    0.9,  // threshold (higher = fewer pixels bloomed = faster)
  );
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());

  // Section cut plane for Phase 4
  const sectionPlane = createSectionPlane();

  // Camera paths
  const splines = buildCameraPath(buildingWidth, buildingDepth, buildingHeight);

  report(10, PHASE_LABELS[0]);

  // ── Recording Setup ──
  if (typeof canvas.captureStream !== "function") {
    throw new Error("Browser does not support canvas.captureStream() — try Chrome or Edge");
  }
  const stream = canvas.captureStream(FPS);

  // Detect best supported codec with fallback chain
  const codecCandidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  let mimeType = "";
  for (const candidate of codecCandidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(candidate)) {
      mimeType = candidate;
      break;
    }
  }
  if (!mimeType) {
    throw new Error("Browser does not support WebM video recording — try Chrome or Edge");
  }

  const mediaRecorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 3_000_000, // 3 Mbps — good quality at 960×540
  });
  const chunks: Blob[] = [];
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const recordingDone = new Promise<Blob>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error("Video recording timed out"));
    }, 90_000); // 90s max — render should complete in ~20-40s

    mediaRecorder.onstop = () => {
      clearTimeout(timeout);
      resolve(new Blob(chunks, { type: "video/webm" }));
    };
    mediaRecorder.onerror = (event) => {
      clearTimeout(timeout);
      reject(new Error(`MediaRecorder error: ${(event as ErrorEvent).message || "unknown"}`));
    };
  });

  mediaRecorder.start();

  // ── Frame-by-Frame Render Loop ──
  try {
    for (let frame = 0; frame < TOTAL_FRAMES; frame++) {
      const t = frame / TOTAL_FRAMES; // normalized time 0→1

      // Determine which phase we're in
      let phaseIndex = 0;
      let localT = 0;
      for (let p = 0; p < PHASE_BOUNDS.length; p++) {
        if (t >= PHASE_BOUNDS[p].start && t < PHASE_BOUNDS[p].end) {
          phaseIndex = p;
          localT = (t - PHASE_BOUNDS[p].start) / (PHASE_BOUNDS[p].end - PHASE_BOUNDS[p].start);
          break;
        }
      }
      if (t >= PHASE_BOUNDS[3].start) {
        phaseIndex = 3;
        localT = (t - PHASE_BOUNDS[3].start) / (PHASE_BOUNDS[3].end - PHASE_BOUNDS[3].start);
      }

      // Smooth easing
      const easedT = smoothstep(localT);

      // Guard against NaN from spline interpolation
      const safeT = Number.isFinite(easedT) ? Math.min(easedT, 0.999) : 0;

      // Position camera along the current spline
      const pos = splines[phaseIndex].getPointAt(safeT);
      camera.position.copy(pos);

      // Look-at target
      const target = getCameraTarget(phaseIndex, easedT, buildingWidth, buildingDepth, buildingHeight);
      camera.lookAt(target);

      // Phase 4: Section cut - animate clipping plane rising with camera
      if (phaseIndex === 3) {
        const cutHeight = THREE.MathUtils.lerp(floorHeight, buildingHeight * 0.9, easedT);
        sectionPlane.constant = cutHeight;
        renderer.clippingPlanes = [sectionPlane];
      } else {
        renderer.clippingPlanes = [];
      }

      // Phase transition: adjust bloom for interior
      if (phaseIndex >= 2) {
        bloomPass.strength = THREE.MathUtils.lerp(0.3, 0.5, (phaseIndex === 3) ? easedT : localT * 0.5);
      }

      // Render frame
      composer.render();

      // Report progress
      const percent = 10 + (t * 88); // 10-98%
      report(percent, PHASE_LABELS[phaseIndex]);

      // Yield to browser every 6 frames to avoid blocking but keep rendering fast
      if (frame % 6 === 0) {
        await yieldFrame();
      }
    }
  } catch (renderErr) {
    // Ensure mediaRecorder is stopped even on frame loop error
    try { mediaRecorder.stop(); } catch { /* already stopped */ }
    throw renderErr;
  }

  // ── Finalize ──
  mediaRecorder.stop();
  const blob = await recordingDone;
  const blobUrl = URL.createObjectURL(blob);

  // Cleanup
  renderer.dispose();
  composer.dispose();
  disposeMaterials(materials);
  mepMats.ductMat.dispose();
  mepMats.pipeMat.dispose();
  mepMats.cableTrayMat.dispose();
  scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry?.dispose();
    }
  });

  report(100, "Complete");

  return {
    blobUrl,
    blob,
    durationSeconds: DURATION,
    resolution: { width: WIDTH, height: HEIGHT },
    fps: FPS,
    fileSizeBytes: blob.size,
  };
}

// ─── Utilities ───────────────────────────────────────────────────────────────

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function yieldFrame(): Promise<void> {
  // Use setTimeout(0) instead of requestAnimationFrame — rAF throttles to 1fps
  // when the tab is not focused, which would make rendering take 6+ minutes
  return new Promise((resolve) => setTimeout(resolve, 0));
}
