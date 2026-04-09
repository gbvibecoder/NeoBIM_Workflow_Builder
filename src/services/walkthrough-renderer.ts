/**
 * Three.js Client-Side Walkthrough Renderer
 *
 * Renders a 22-second cinematic AEC building walkthrough video entirely in
 * the browser using an offscreen WebGL canvas. Used as the fallback for
 * /dashboard/3d-render when Kling AI keys are not configured.
 *
 * Camera sequence (22s, 5 phases):
 *   Phase 1 (0-4s):    Aerial establishing — high orbit looking down at 60°
 *   Phase 2 (4-7s):    Smooth descent — ease down to 45° hero shot
 *   Phase 3 (7-12s):   45° exterior orbit — circle showing all elevations
 *   Phase 4 (12-18s):  Interior entry + walkthrough — enter front, glide through
 *   Phase 5 (18-22s):  Pullback reveal — rise back up, show full layout
 *
 * All transitions use ease-in-out cubic. Subtle handheld camera shake.
 * Renders at 1920×1080 / 30fps / VP9 8 Mbps for cinematic quality.
 */

import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { FXAAPass } from "three/examples/jsm/postprocessing/FXAAPass.js";
import { VignetteShader } from "three/examples/jsm/shaders/VignetteShader.js";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import {
  buildBuilding,
  generateRoomsForBuilding,
  getDefaultConfig,
} from "@/components/canvas/artifacts/architectural-viewer/building";
import { createMaterials, disposeMaterials } from "@/lib/3d-generation/materials";
import { addFurniture } from "@/components/canvas/artifacts/architectural-viewer/furniture";
import type { BuildingStyle } from "@/types/architectural-viewer";

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
  "Aerial Establishing",
  "Smooth Descent",
  "Exterior Orbit",
  "Interior Walkthrough",
  "Pullback Reveal",
] as const;

// Phase time boundaries (normalized 0-1) for a 22s walkthrough.
//   Phase 0 (0-4s):    Aerial establishing  → 0.000 - 0.182
//   Phase 1 (4-7s):    Smooth descent       → 0.182 - 0.318
//   Phase 2 (7-12s):   Exterior orbit       → 0.318 - 0.545
//   Phase 3 (12-18s):  Interior walkthrough → 0.545 - 0.818
//   Phase 4 (18-22s):  Pullback reveal      → 0.818 - 1.000
const PHASE_BOUNDS = [
  { start: 0.000, end: 0.182 },
  { start: 0.182, end: 0.318 },
  { start: 0.318, end: 0.545 },
  { start: 0.545, end: 0.818 },
  { start: 0.818, end: 1.000 },
];

// ─── Easing & Camera Helpers ─────────────────────────────────────────────────

/** Cubic ease-in-out — equivalent to cubic-bezier(0.42, 0, 0.58, 1). */
function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Quartic ease-in-out for more dramatic acceleration on descent / pullback. */
function easeInOutQuart(t: number): number {
  return t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;
}

/** Tiny pseudo-handheld camera shake. Output is in world units (meters). */
function cameraShake(timeSeconds: number, intensity: number): THREE.Vector3 {
  // Mix of sines at incommensurate frequencies → looks organic, not periodic.
  const sx = Math.sin(timeSeconds * 11.7) * Math.cos(timeSeconds * 4.3);
  const sy = Math.sin(timeSeconds * 13.4) * Math.cos(timeSeconds * 5.1);
  const sz = Math.sin(timeSeconds * 9.5)  * Math.cos(timeSeconds * 6.2);
  return new THREE.Vector3(sx * intensity, sy * intensity, sz * intensity);
}

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

/**
 * Walks the scene and upgrades MeshBasicMaterial → MeshStandardMaterial with
 * physically-plausible roughness/metalness tuned by material name. Also
 * tunes existing MeshStandardMaterials so they pick up the env map.
 *
 * Material parameters loosely match threejs-builder.ts so the walkthrough
 * looks consistent with the main 3D viewer.
 */
function upgradeToPBR(scene: THREE.Scene) {
  scene.traverse((obj) => {
    if (!(obj instanceof THREE.Mesh)) return;
    obj.castShadow = true;
    obj.receiveShadow = true;

    const mat = obj.material as THREE.Material;

    // Already a Standard or Physical material — just nudge the env map
    // contribution so it picks up reflections from the new sky env.
    if (
      mat instanceof THREE.MeshStandardMaterial ||
      mat instanceof THREE.MeshPhysicalMaterial
    ) {
      if (mat.envMapIntensity < 0.2) mat.envMapIntensity = 0.3;
      mat.needsUpdate = true;
      return;
    }

    if (mat instanceof THREE.MeshBasicMaterial) {
      const pbr = new THREE.MeshStandardMaterial({
        color: mat.color.clone(),
        map: mat.map,
        transparent: mat.transparent,
        opacity: mat.opacity,
        side: mat.side,
      });

      const name = (mat.name || "").toLowerCase();
      if (name.includes("glass") || (mat.transparent && mat.opacity < 0.8)) {
        // Window glass: highly reflective, slight tint
        pbr.metalness = 0.05;
        pbr.roughness = 0.04;
        pbr.transparent = true;
        pbr.opacity = Math.min(mat.opacity, 0.32);
        pbr.envMapIntensity = 1.4;
      } else if (name.includes("metal") || name.includes("steel") || name.includes("chrome")) {
        // Polished metal — picks up env reflections strongly
        pbr.metalness = 0.92;
        pbr.roughness = 0.18;
        pbr.envMapIntensity = 1.0;
      } else if (name.includes("concrete") || name.includes("stone")) {
        pbr.metalness = 0.0;
        pbr.roughness = 0.88;
        pbr.envMapIntensity = 0.25;
      } else if (name.includes("wood") || name.includes("oak") || name.includes("walnut")) {
        // Wood floor — slight reflectivity for that "polished plank" look
        pbr.metalness = 0.02;
        pbr.roughness = 0.55;
        pbr.envMapIntensity = 0.35;
      } else if (name.includes("plaster") || name.includes("wall") || name.includes("white")) {
        // Painted plaster wall — very matte, but not zero
        pbr.metalness = 0.0;
        pbr.roughness = 0.84;
        pbr.envMapIntensity = 0.15;
      } else if (name.includes("fabric") || name.includes("sofa") || name.includes("cushion")) {
        pbr.metalness = 0.0;
        pbr.roughness = 0.92;
        pbr.envMapIntensity = 0.08;
      } else {
        pbr.metalness = 0.05;
        pbr.roughness = 0.55;
        pbr.envMapIntensity = 0.3;
      }

      obj.material = pbr;
    }
  });
}

// ─── Lighting Setup ──────────────────────────────────────────────────────────

function setupLighting(
  scene: THREE.Scene,
  buildingHeight: number,
  buildingWidth: number,
  buildingDepth: number,
) {
  const extent = Math.max(buildingWidth, buildingDepth);

  // ── Key light: warm golden-hour sun coming from the front-right ──
  // Color is a saturated 5500K → 4500K warm yellow. Strong intensity since
  // it's the dominant light. Casts soft shadows.
  const sun = new THREE.DirectionalLight(0xffd28a, 3.4);
  sun.position.set(extent * 1.2, buildingHeight * 2.4 + 8, extent * 0.9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = buildingHeight * 6 + 30;
  const shadowExtent = extent * 2.2 + buildingHeight;
  sun.shadow.camera.left = -shadowExtent;
  sun.shadow.camera.right = shadowExtent;
  sun.shadow.camera.top = shadowExtent;
  sun.shadow.camera.bottom = -shadowExtent;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.04;
  // Soft PCF shadows blur the edges naturally
  sun.shadow.radius = 6;
  sun.shadow.blurSamples = 16;
  scene.add(sun);

  // ── Cool sky fill from the opposite side (bounce light from the sky) ──
  // Lower intensity, cooler color. Doesn't cast shadows (perf).
  const skyFill = new THREE.DirectionalLight(0x9bc4ff, 1.0);
  skyFill.position.set(-extent * 1.0, buildingHeight * 1.6 + 4, -extent * 0.6);
  scene.add(skyFill);

  // ── Subtle rim/back light for edge highlights on furniture ──
  const rim = new THREE.DirectionalLight(0xfff2dd, 0.5);
  rim.position.set(-extent * 0.4, buildingHeight * 1.0, extent * 1.4);
  scene.add(rim);

  // ── Hemisphere ambient (sky color from above, warm bounce from below) ──
  const hemi = new THREE.HemisphereLight(0x9fc8ff, 0xffe1bd, 0.55);
  hemi.position.set(0, buildingHeight * 2, 0);
  scene.add(hemi);

  // ── Tiny global ambient fill so dark corners aren't pure black ──
  const ambient = new THREE.AmbientLight(0xffffff, 0.12);
  scene.add(ambient);

  // ── Interior warm point lights — one per floor, slightly off-center ──
  // Bumped intensity + range so interior reads as "lights are on" during
  // the walkthrough phase. Warm 2700K bulb color.
  const interiorLights: THREE.PointLight[] = [];
  const floorCount = Math.max(1, Math.min(8, Math.round(buildingHeight / 3.0)));
  for (let f = 0; f < floorCount; f++) {
    // Place 2 lights per floor for richer falloff
    for (let i = 0; i < 2; i++) {
      const light = new THREE.PointLight(0xffd9a8, 0.7, Math.max(extent, 12), 1.5);
      const offsetX = (i === 0 ? -1 : 1) * Math.min(buildingWidth * 0.2, 4);
      const offsetZ = (i === 0 ? 1 : -1) * Math.min(buildingDepth * 0.2, 4);
      light.position.set(offsetX, f * 3.0 + 2.4, offsetZ);
      scene.add(light);
      interiorLights.push(light);
    }
  }

  return { sun, skyFill, rim, hemi, ambient, interiorLights };
}

// ─── Camera Path Builder ─────────────────────────────────────────────────────

/**
 * Build the 5-phase cinematic camera path. All splines use centripetal
 * Catmull-Rom for smooth interpolation without overshoot.
 *
 * Phase sizing is calibrated against `extent = max(width, depth)` so the path
 * scales with the building.
 */
function buildCameraPath(
  buildingWidth: number,
  buildingDepth: number,
  buildingHeight: number,
) {
  const hw = buildingWidth / 2;
  const hd = buildingDepth / 2;
  const extent = Math.max(hw, hd);
  // Eye level for interior shots — avg human standing height (~1.65m)
  const eyeY = Math.min(buildingHeight * 0.45, 1.65);

  // ── Phase 0: Aerial establishing (0-4s) ──
  // Start dramatically high above the building, looking down at ~60° angle.
  // Slowly drift in a small arc — gives a "discovering" feeling without
  // committing to a specific vantage yet.
  const aerialRadius = extent * 4.0;
  const aerialHeight = buildingHeight * 3.5 + 12;
  const phase0Points: THREE.Vector3[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const angle = -Math.PI * 0.85 + t * Math.PI * 0.45; // ~80° arc
    phase0Points.push(new THREE.Vector3(
      Math.cos(angle) * aerialRadius,
      aerialHeight - t * (buildingHeight * 0.4), // gentle descent during arc
      Math.sin(angle) * aerialRadius,
    ));
  }

  // ── Phase 1: Smooth descent (4-7s) ──
  // Drop from the aerial position into a 45° hero shot in front of the
  // building. This is the visual "reveal" — speed eases out at the end.
  const heroRadius = extent * 2.6;
  const heroHeight = buildingHeight * 1.3 + 4;
  const phase1Points = [
    phase0Points[phase0Points.length - 1].clone(), // continuity
    new THREE.Vector3(extent * 2.8, buildingHeight * 2.2 + 6, extent * 2.0),
    new THREE.Vector3(extent * 2.2, buildingHeight * 1.7 + 4, extent * 1.6),
    new THREE.Vector3(extent * 1.8, heroHeight + 1, extent * 1.2),
    new THREE.Vector3(heroRadius * 0.78, heroHeight, heroRadius * 0.78),
  ];

  // ── Phase 2: 45° exterior orbit (7-12s) ──
  // Circle the building at hero height, sweeping ~270° around it so all
  // sides are revealed. End nudged toward the front entrance for the
  // interior approach in phase 3.
  const orbitRadius = extent * 2.4;
  const orbitHeight = buildingHeight * 1.05 + 3;
  const orbitPoints: THREE.Vector3[] = [];
  const orbitSteps = 14;
  // Start angle aligned with end of phase 1, sweep ~270° clockwise
  const startAngle = Math.PI * 0.25;
  const sweep = Math.PI * 1.55;
  for (let i = 0; i <= orbitSteps; i++) {
    const t = i / orbitSteps;
    const angle = startAngle + t * sweep;
    // Subtle vertical bob (sine) keeps the orbit visually interesting
    const yBob = Math.sin(t * Math.PI) * 1.5;
    orbitPoints.push(new THREE.Vector3(
      Math.cos(angle) * orbitRadius,
      orbitHeight + yBob,
      Math.sin(angle) * orbitRadius,
    ));
  }

  // ── Phase 3: Interior entry + walkthrough (12-18s) ──
  // Approach the front facade, descend to eye level, glide through the
  // interior visiting room-like positions. We don't have real room geometry,
  // so we trace a smooth S-curve through the building footprint that
  // visually feels like a room-by-room walkthrough.
  const entryZ = hd * 1.4;
  const phase3Points = [
    orbitPoints[orbitPoints.length - 1].clone(), // continuity from orbit end
    new THREE.Vector3(hw * 0.6, buildingHeight * 0.7, entryZ * 0.95),
    new THREE.Vector3(hw * 0.4, eyeY + 1.0, hd * 0.85),     // approach front door
    new THREE.Vector3(hw * 0.2, eyeY + 0.6, hd * 0.45),     // crossing entry
    new THREE.Vector3(-hw * 0.1, eyeY + 0.4, hd * 0.15),    // entering main room
    new THREE.Vector3(-hw * 0.4, eyeY + 0.4, -hd * 0.05),   // mid-house
    new THREE.Vector3(-hw * 0.3, eyeY + 0.4, -hd * 0.4),    // back-left room
    new THREE.Vector3(hw * 0.2, eyeY + 0.5, -hd * 0.55),    // back-right room
    new THREE.Vector3(hw * 0.45, eyeY + 0.7, -hd * 0.25),   // corridor
    new THREE.Vector3(hw * 0.55, eyeY + 1.2, hd * 0.2),     // rising as exit
  ];

  // ── Phase 4: Pullback reveal (18-22s) ──
  // Camera rises and pulls back to a high 60° angle showing the entire
  // building footprint with the surroundings. Final framing matches the
  // aerial start so the loop "feels resolved".
  const finalRadius = extent * 3.4;
  const finalHeight = buildingHeight * 2.6 + 10;
  const phase4Points = [
    phase3Points[phase3Points.length - 1].clone(), // continuity
    new THREE.Vector3(hw * 1.2, buildingHeight * 1.5 + 4, hd * 1.0),
    new THREE.Vector3(extent * 1.8, buildingHeight * 2.0 + 6, extent * 1.6),
    new THREE.Vector3(extent * 2.6, buildingHeight * 2.4 + 8, extent * 2.4),
    new THREE.Vector3(finalRadius * 0.78, finalHeight, finalRadius * 0.78),
  ];

  return [
    new THREE.CatmullRomCurve3(phase0Points, false, "centripetal"),
    new THREE.CatmullRomCurve3(phase1Points, false, "centripetal"),
    new THREE.CatmullRomCurve3(orbitPoints, false, "centripetal"),
    new THREE.CatmullRomCurve3(phase3Points, false, "centripetal"),
    new THREE.CatmullRomCurve3(phase4Points, false, "centripetal"),
  ];
}

/**
 * Get camera look-at target for each phase. The target moves smoothly so the
 * camera never visibly snaps between phases.
 */
function getCameraTarget(
  phaseIndex: number,
  localT: number,
  buildingWidth: number,
  buildingDepth: number,
  buildingHeight: number,
): THREE.Vector3 {
  const midH = buildingHeight / 2;
  const eyeY = Math.min(buildingHeight * 0.45, 1.65);

  switch (phaseIndex) {
    case 0: {
      // Aerial: look down at the building roof, slight forward drift
      const driftX = -buildingWidth * 0.05 * (1 - localT);
      const driftZ = -buildingDepth * 0.05 * (1 - localT);
      return new THREE.Vector3(driftX, buildingHeight * 0.55, driftZ);
    }
    case 1: {
      // Descent: target eases from roof level → mid building (matches camera)
      const lookY = THREE.MathUtils.lerp(buildingHeight * 0.7, midH * 0.85, localT);
      return new THREE.Vector3(0, lookY, 0);
    }
    case 2: {
      // Orbit: keep building center in frame; lift target slightly so we
      // include the roofline rather than centering on the ground.
      return new THREE.Vector3(0, midH * 0.95, 0);
    }
    case 3: {
      // Interior walkthrough: target leads the camera by a small offset
      // along its movement direction so the camera "looks where it's going".
      const leadX = THREE.MathUtils.lerp(0, -buildingWidth * 0.1, localT);
      const leadZ = THREE.MathUtils.lerp(0, -buildingDepth * 0.15, localT);
      return new THREE.Vector3(leadX, eyeY + 0.3, leadZ);
    }
    case 4: {
      // Pullback: track from interior point → building center as we rise
      const lookY = THREE.MathUtils.lerp(eyeY + 0.5, midH * 0.85, localT);
      return new THREE.Vector3(0, lookY, 0);
    }
    default:
      return new THREE.Vector3(0, midH, 0);
  }
}

// ─── Fog & Environment ───────────────────────────────────────────────────────

function setupEnvironment(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
) {
  // Warm haze fog matching the golden-hour palette. Distant objects fade
  // into amber so the building reads as "lit by warm sun".
  scene.fog = new THREE.FogExp2(0xe5cca8, 0.0028);

  // ── Procedural sky (Preetham model) ──
  // The Sky shader produces a physically-plausible day-sky based on the
  // sun position. We pick golden-hour values: low sun, warm scattering.
  const sky = new Sky();
  sky.scale.setScalar(8000);
  const skyUniforms = sky.material.uniforms as Record<string, { value: unknown }>;
  (skyUniforms.turbidity as { value: number }).value = 6;
  (skyUniforms.rayleigh as { value: number }).value = 2.4;
  (skyUniforms.mieCoefficient as { value: number }).value = 0.006;
  (skyUniforms.mieDirectionalG as { value: number }).value = 0.85;

  // Sun position: ~12° above horizon, in front-right of the scene
  const sunElevationDeg = 12;
  const sunAzimuthDeg = 50;
  const phi = THREE.MathUtils.degToRad(90 - sunElevationDeg);
  const theta = THREE.MathUtils.degToRad(sunAzimuthDeg);
  const sunVec = new THREE.Vector3();
  sunVec.setFromSphericalCoords(1, phi, theta);
  (skyUniforms.sunPosition as { value: THREE.Vector3 }).value.copy(sunVec);
  scene.add(sky);

  // ── Ground plane: warm taupe, slightly reflective ──
  const groundGeo = new THREE.PlaneGeometry(800, 800);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x6b5a48,
    roughness: 0.86,
    metalness: 0.02,
    envMapIntensity: 0.4,
  });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  ground.receiveShadow = true;
  scene.add(ground);

  // ── PMREM env map FROM the actual sky scene ──
  // This captures the sky's gradient + sun glow into an environment map,
  // which is then used for reflections on glass / metal materials. Re-uses
  // the main renderer to avoid a second WebGL context (was a leak before).
  try {
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    // Render the sky alone (without the building) into the env map
    const envScene = new THREE.Scene();
    envScene.add(sky.clone());
    const envMap = pmremGenerator.fromScene(envScene, 0.04).texture;
    scene.environment = envMap;
    pmremGenerator.dispose();
  } catch (e) {
    console.warn("[walkthrough] PMREM env map failed, falling back to hemisphere:", e);
    // Fallback: a flat hemisphere env so PBR materials still get *some* reflection
    const envHemi = new THREE.HemisphereLight(0x9fc8ff, 0xffe1bd, 1);
    scene.add(envHemi);
  }

  return { groundMat, sky };
}

// ─── Main Render Function ────────────────────────────────────────────────────

export async function renderWalkthrough(
  config: WalkthroughConfig,
): Promise<WalkthroughResult> {
  // Cinematic defaults: 1920×1080 / 30fps / 22s. Caller can override via
  // config — e.g. drop to 1280×720 if rendering on a low-end device.
  const WIDTH = config.resolution?.width ?? 1920;
  const HEIGHT = config.resolution?.height ?? 1080;
  const FPS = config.fps ?? 30;
  const DURATION = config.durationSeconds ?? 22;
  const TOTAL_FRAMES = FPS * DURATION;

  const report = (percent: number, phase: string) => {
    config.onProgress?.(Math.round(percent), phase);
  };

  report(0, PHASE_LABELS[0]);

  // ── Scene Setup ──
  const scene = new THREE.Scene();
  // Cinematic 35mm-equivalent FOV for less wide-angle distortion
  const camera = new THREE.PerspectiveCamera(42, WIDTH / HEIGHT, 0.1, 4000);

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false, // Antialiasing handled by FXAAPass for better perf
    alpha: false,
    preserveDrawingBuffer: true,
    powerPreference: "high-performance",
  });
  renderer.setSize(WIDTH, HEIGHT);
  renderer.setPixelRatio(1); // Pixel ratio 1 — already at 1080p, more would be wasted
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  // Slightly hot exposure for warm "architectural photography" look
  renderer.toneMappingExposure = 1.35;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.localClippingEnabled = false; // No section cut in new camera path

  // ── Build the building ──
  const floorHeight = config.floorHeight || 3.6;
  const floors = Math.min(config.floors || 5, 30);
  const footprint = config.footprint || 800;
  const buildingHeight = floors * floorHeight;

  // Compute approximate building dimensions from footprint
  const buildingWidth = Math.sqrt(footprint * 1.6); // slightly rectangular
  const buildingDepth = footprint / buildingWidth;
  // Used by camera-shake intensity scaling and any local helpers below
  const extent = Math.max(buildingWidth, buildingDepth);

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

  // Environment & lighting (must be called before PMREM so the sky is in scene)
  setupEnvironment(scene, renderer);
  setupLighting(scene, buildingHeight, buildingWidth, buildingDepth);

  // ── Post-processing pipeline ──
  // RenderPass → Bloom → FXAA → Vignette → Output (tonemap + sRGB)
  // Each pass adds ~10-15% to per-frame cost. Bloom and FXAA are visible
  // wins; vignette is cheap and gives the cinematic frame.
  const composer = new EffectComposer(renderer);
  composer.setSize(WIDTH, HEIGHT);
  composer.addPass(new RenderPass(scene, camera));

  // Soft, atmospheric bloom — picks up sun glints and interior point lights.
  // Half-res bloom resolution to halve the cost.
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(WIDTH / 2, HEIGHT / 2),
    0.55, // strength — noticeable but not blown out
    0.85, // radius — soft, wide glow
    0.78, // threshold — only highlights bloom
  );
  composer.addPass(bloomPass);

  // Anti-aliasing on the composited image
  const fxaaPass = new FXAAPass();
  // FXAAShader uses resolution uniform — set it to inverse pixel size
  const fxaaUniforms = fxaaPass.material.uniforms as { resolution?: { value: THREE.Vector2 } };
  if (fxaaUniforms.resolution) {
    fxaaUniforms.resolution.value.set(1 / WIDTH, 1 / HEIGHT);
  }
  composer.addPass(fxaaPass);

  // Subtle vignette darkens the frame edges → focuses the eye on the building
  const vignettePass = new ShaderPass(VignetteShader);
  const vUniforms = vignettePass.uniforms as { offset: { value: number }; darkness: { value: number } };
  vUniforms.offset.value = 1.05;
  vUniforms.darkness.value = 1.05;
  composer.addPass(vignettePass);

  // Output pass: tone mapping + sRGB conversion (must be last)
  composer.addPass(new OutputPass());

  // Camera paths (5 splines)
  const splines = buildCameraPath(buildingWidth, buildingDepth, buildingHeight);

  report(8, PHASE_LABELS[0]);

  // ── Recording Setup ──
  if (typeof canvas.captureStream !== "function") {
    throw new Error("Browser does not support canvas.captureStream() — try Chrome or Edge");
  }
  const stream = canvas.captureStream(FPS);

  // Detect best supported codec — VP9 first for sharper output at our bitrate
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
    // 8 Mbps target — crisp 1080p for both VP9 and VP8 encoders
    videoBitsPerSecond: 8_000_000,
  });
  const chunks: Blob[] = [];
  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  const recordingDone = new Promise<Blob>((resolve, reject) => {
    // Higher-res / longer renders take longer — be generous with the timeout.
    const timeout = setTimeout(() => {
      reject(new Error("Video recording timed out"));
    }, 240_000); // 4 min max — 1080p 22s render is typically 60-180s

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

  // Camera shake intensity scales with the building so it stays subtle on
  // small homes and visible on tall buildings. ~3-5 cm of jitter at most.
  const shakeIntensity = Math.min(0.05, Math.max(0.018, extent * 0.0015));
  // Per-phase bloom strength — interior phase punches up the warm point lights
  const bloomBaseStrength = 0.55;

  // ── Frame-by-Frame Render Loop ──
  try {
    for (let frame = 0; frame < TOTAL_FRAMES; frame++) {
      const t = frame / TOTAL_FRAMES; // normalized time 0→1
      const timeSeconds = (frame / FPS);

      // Determine which phase we're in (5 phases)
      let phaseIndex = 0;
      let localT = 0;
      for (let p = 0; p < PHASE_BOUNDS.length; p++) {
        if (t >= PHASE_BOUNDS[p].start && t < PHASE_BOUNDS[p].end) {
          phaseIndex = p;
          localT = (t - PHASE_BOUNDS[p].start) / (PHASE_BOUNDS[p].end - PHASE_BOUNDS[p].start);
          break;
        }
      }
      // Clamp into the last phase if we overshoot the final bound
      const lastIdx = PHASE_BOUNDS.length - 1;
      if (t >= PHASE_BOUNDS[lastIdx].start) {
        phaseIndex = lastIdx;
        const span = PHASE_BOUNDS[lastIdx].end - PHASE_BOUNDS[lastIdx].start;
        localT = Math.min(1, (t - PHASE_BOUNDS[lastIdx].start) / span);
      }

      // Cubic ease-in-out for most phases; quartic for the dramatic descent
      // and pullback so the camera "settles" with more weight.
      const easedT =
        phaseIndex === 1 || phaseIndex === 4
          ? easeInOutQuart(localT)
          : easeInOutCubic(localT);

      // Guard against NaN from spline interpolation
      const safeT = Number.isFinite(easedT) ? Math.min(easedT, 0.999) : 0;

      // Position camera along the current spline + apply camera shake
      const pos = splines[phaseIndex].getPointAt(safeT);
      const shake = cameraShake(timeSeconds, shakeIntensity);
      camera.position.copy(pos).add(shake);

      // Look-at target — also gets a tiny offset so the shake doesn't
      // cause the look direction to wobble too sharply.
      const target = getCameraTarget(phaseIndex, easedT, buildingWidth, buildingDepth, buildingHeight);
      target.add(shake.clone().multiplyScalar(0.5));
      camera.lookAt(target);

      // Per-phase bloom: interior walkthrough boosts strength (warm room
      // lights bloom more visibly), exterior phases use the base strength.
      if (phaseIndex === 3) {
        bloomPass.strength = THREE.MathUtils.lerp(bloomBaseStrength, 0.85, easedT);
      } else if (phaseIndex === 4) {
        bloomPass.strength = THREE.MathUtils.lerp(0.85, bloomBaseStrength, easedT);
      } else {
        bloomPass.strength = bloomBaseStrength;
      }

      // Render frame
      composer.render();

      // Report progress (8% setup → 98% render)
      const percent = 8 + (t * 90);
      report(percent, PHASE_LABELS[phaseIndex]);

      // Yield to browser every 4 frames so the page stays responsive.
      // Less frequent yields → faster total render time.
      if (frame % 4 === 0) {
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

function yieldFrame(): Promise<void> {
  // Use setTimeout(0) instead of requestAnimationFrame — rAF throttles to 1fps
  // when the tab is not focused, which would make rendering take 6+ minutes
  return new Promise((resolve) => setTimeout(resolve, 0));
}
