"use client";

/* ═══════════════════════════════════════════════════════════════════════
   HeroBuildingShowcase — "Eat your own dog food"

   The dashboard hero IS the product. We mount the project's in-house
   procedural architectural building generator (the same one BuildFlow
   uses to render BIM artifacts) inside a cinematic stage with:

   - Real industrial-sunset HDRI environment for IBL & background
   - 4K shadow-mapped golden-hour sun + 4-light cinematic rig
   - Postprocessing chain: RenderPass → SSAO → UnrealBloom → FXAA → Output
   - ACES Filmic tone mapping
   - 3-second cinematic camera intro
   - OrbitControls (auto-rotate) + PointerLockControls (WASD walk-through)
   - Day / Dusk / Night relighting
   - Exploded view, section cut, X-ray analysis modes
   - Framer-motion animated HUD that fades in after the intro
   - Mobile graceful fallback (static gradient hero)
   - IntersectionObserver: pauses render loop when off-screen
   ═══════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { FXAAShader } from "three/examples/jsm/shaders/FXAAShader.js";
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";
import { motion, AnimatePresence } from "framer-motion";
import {
  Move3D,
  Footprints,
  Sun,
  Sunset,
  Moon,
  Layers,
  Scissors,
  ScanLine,
  MousePointerClick,
} from "lucide-react";
import { createMaterials, disposeMaterials } from "@/components/canvas/artifacts/architectural-viewer/materials";
import {
  buildBuilding,
  getDefaultConfig,
  generateRoomsForBuilding,
} from "@/components/canvas/artifacts/architectural-viewer/building";
import { addFurniture } from "@/components/canvas/artifacts/architectural-viewer/furniture";
import type {
  BuildingStyle,
  DoorMesh,
} from "@/components/canvas/artifacts/architectural-viewer/types";

// ─── Hero building config ─────────────────────────────────────────────
// Minimalist: a single elegant glass tower, no podium, no site context.
const HERO_STYLE: BuildingStyle = {
  glassHeavy: true,
  hasRiver: false,
  hasLake: false,
  isModern: true,
  isTower: true,
  exteriorMaterial: "glass",
  environment: "urban",
  usage: "office",
  promptText: "Modern glass office tower",
  typology: "tower",
  facadePattern: "curtain-wall",
  maxFloorCap: 10,
};
const HERO_FLOORS = 8;
const HERO_FOOTPRINT = 300; // m²

type ViewMode = "orbit" | "walk";
type TimeOfDay = "day" | "dusk" | "night";

// ═══════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════
export function HeroBuildingShowcase() {
  const containerRef = useRef<HTMLDivElement>(null);

  // Three.js refs
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const composerRef = useRef<EffectComposer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const orbitRef = useRef<OrbitControls | null>(null);
  const fpRef = useRef<PointerLockControls | null>(null);
  const buildingGroupRef = useRef<THREE.Group | null>(null);
  const roomLabelsRef = useRef<THREE.Group | null>(null);
  const doorsRef = useRef<DoorMesh[]>([]);
  const sunLightRef = useRef<THREE.DirectionalLight | null>(null);
  const ambientRef = useRef<THREE.AmbientLight | null>(null);
  const hemiRef = useRef<THREE.HemisphereLight | null>(null);
  const fillRef = useRef<THREE.DirectionalLight | null>(null);
  const rimRef = useRef<THREE.DirectionalLight | null>(null);
  const animFrameRef = useRef<number>(0);
  const isVisibleRef = useRef(true);
  const lastRenderRef = useRef(0);
  const introT = useRef(0);
  const explodeT = useRef(0);
  const sectionPlaneRef = useRef<THREE.Plane | null>(null);
  const matsRef = useRef<ReturnType<typeof createMaterials> | null>(null);

  // UI state (refs mirror so animate loop can read without re-running effect)
  const [viewMode, setViewMode] = useState<ViewMode>("orbit");
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>("dusk");
  const [exploded, setExploded] = useState(false);
  const [section, setSection] = useState(false);
  const [xray, setXray] = useState(false);
  const [hudReady, setHudReady] = useState(false);
  const [bootError, setBootError] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  const viewModeRef = useRef(viewMode);
  const explodedRef = useRef(exploded);
  const sectionRef = useRef(section);
  const xrayRef = useRef(xray);
  const lastXrayState = useRef(false);
  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);
  useEffect(() => { explodedRef.current = exploded; }, [exploded]);
  useEffect(() => { sectionRef.current = section; }, [section]);
  useEffect(() => { xrayRef.current = xray; }, [xray]);

  // ─── Mobile detection ──────────────────────────────────────────────
  useEffect(() => {
    const check = () => {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      setIsMobile(window.innerWidth < 820 || reduced);
    };
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // ─── Time of day relight ───────────────────────────────────────────
  useEffect(() => {
    const sun = sunLightRef.current;
    const amb = ambientRef.current;
    const hemi = hemiRef.current;
    const fill = fillRef.current;
    const rim = rimRef.current;
    const renderer = rendererRef.current;
    const scene = sceneRef.current;
    if (!sun || !amb || !hemi || !fill || !rim || !renderer || !scene) return;

    switch (timeOfDay) {
      case "day":
        sun.color.set(0xfff0d4); sun.intensity = 1.7;
        sun.position.set(60, 80, 50);
        amb.color.set(0xe8d8c8); amb.intensity = 0.32;
        hemi.color.set(0xa8c5ff); hemi.groundColor.set(0x556633); hemi.intensity = 0.55;
        fill.color.set(0x8aacdd); fill.intensity = 0.38;
        rim.color.set(0xffd090); rim.intensity = 0.32;
        renderer.toneMappingExposure = 0.82;
        scene.fog = new THREE.Fog(0xb6d4ff, 80, 280);
        break;
      case "dusk":
        sun.color.set(0xffd4a0); sun.intensity = 1.6;
        sun.position.set(60, 35, 50);
        amb.color.set(0xe8d8c8); amb.intensity = 0.32;
        hemi.color.set(0xffe8c0); hemi.groundColor.set(0x3a5533); hemi.intensity = 0.55;
        fill.color.set(0x8aacdd); fill.intensity = 0.35;
        rim.color.set(0xffd090); rim.intensity = 0.35;
        renderer.toneMappingExposure = 0.88;
        scene.fog = new THREE.Fog(0xff9966, 80, 260);
        break;
      case "night":
        sun.color.set(0x4466aa); sun.intensity = 0.6;
        sun.position.set(-15, 40, -20);
        amb.color.set(0x223355); amb.intensity = 0.35;
        hemi.color.set(0x223355); hemi.groundColor.set(0x111122); hemi.intensity = 0.45;
        fill.color.set(0x556699); fill.intensity = 0.4;
        rim.color.set(0x88aaff); rim.intensity = 0.6;
        renderer.toneMappingExposure = 0.7;
        scene.fog = new THREE.Fog(0x0a0a1a, 30, 160);
        break;
    }
  }, [timeOfDay]);

  // ─── Toggle walk / orbit ───────────────────────────────────────────
  const toggleWalk = useCallback(() => {
    const cam = cameraRef.current;
    const orbit = orbitRef.current;
    const fp = fpRef.current;
    if (!cam || !orbit || !fp) return;
    if (viewMode === "orbit") {
      setViewMode("walk");
      cam.position.set(0, 1.7, 8);
      orbit.autoRotate = false;
      fp.lock();
    } else {
      setViewMode("orbit");
      fp.unlock();
      cam.position.set(56, 28, 60);
      orbit.target.set(0, 13, 0);
      orbit.autoRotate = true;
    }
  }, [viewMode]);

  // ─── Build the entire scene (init effect) ──────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container || isMobile) return;

    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;
    let onKeyDown: ((e: KeyboardEvent) => void) | null = null;
    let onKeyUp: ((e: KeyboardEvent) => void) | null = null;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const moveState = { f: false, b: false, l: false, r: false };
    const velocity = new THREE.Vector3();

    try {
      const w = container.clientWidth || 1280;
      const h = container.clientHeight || 720;

      // ═══ Renderer ═══
      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: "high-performance",
      });
      renderer.setSize(w, h);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.85;
      renderer.localClippingEnabled = true;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      container.appendChild(renderer.domElement);
      rendererRef.current = renderer;

      // ═══ Scene ═══
      const scene = new THREE.Scene();
      // No fog — minimalist dark void, no atmospheric haze
      // No background color — canvas is alpha:true and blends with the
      // dashboard's CSS gradient backdrop behind it.
      sceneRef.current = scene;

      // ═══ Camera — pulled back, framed slightly above mid-building ═══
      const camera = new THREE.PerspectiveCamera(28, w / h, 0.1, 1000);
      camera.position.set(110, 65, 110); // matches introStart for clean first frame
      cameraRef.current = camera;

      // ═══ HDRI — IBL ONLY, never as background ═══
      const pmrem = new THREE.PMREMGenerator(renderer);
      pmrem.compileEquirectangularShader();
      const rgbe = new RGBELoader();
      rgbe.load(
        "/textures/hdri/industrial_sunset_2k.hdr",
        (tex) => {
          if (disposed) { tex.dispose(); pmrem.dispose(); return; }
          tex.mapping = THREE.EquirectangularReflectionMapping;
          const envMap = pmrem.fromEquirectangular(tex).texture;
          // ONLY environment — drives PBR reflections on the building.
          // No scene.background → canvas stays transparent, dashboard
          // gradient shows through.
          scene.environment = envMap;
          tex.dispose();
          pmrem.dispose();
        },
        undefined,
        () => {
          console.warn("[HeroBuildingShowcase] HDRI failed — IBL disabled");
          pmrem.dispose();
        }
      );

      // ═══ Cinematic 5-light rig (toned down — matte reads, no glare) ═══
      const ambient = new THREE.AmbientLight(0xe8d8c8, 0.32);
      scene.add(ambient);
      ambientRef.current = ambient;

      const hemi = new THREE.HemisphereLight(0xffe8c0, 0x3a5533, 0.55);
      scene.add(hemi);
      hemiRef.current = hemi;

      const sun = new THREE.DirectionalLight(0xffd4a0, 1.6);
      sun.position.set(60, 35, 50);
      sun.castShadow = true;
      sun.shadow.mapSize.width = 4096;
      sun.shadow.mapSize.height = 4096;
      sun.shadow.camera.left = -80;
      sun.shadow.camera.right = 80;
      sun.shadow.camera.top = 80;
      sun.shadow.camera.bottom = -80;
      sun.shadow.camera.near = 0.5;
      sun.shadow.camera.far = 300;
      sun.shadow.bias = -0.0002;
      sun.shadow.normalBias = 0.03;
      sun.shadow.radius = 3;
      scene.add(sun);
      sunLightRef.current = sun;

      const fill = new THREE.DirectionalLight(0x8aacdd, 0.35);
      fill.position.set(-30, 40, -20);
      scene.add(fill);
      fillRef.current = fill;

      const rim = new THREE.DirectionalLight(0xffd090, 0.35);
      rim.position.set(-20, 15, -40);
      scene.add(rim);
      rimRef.current = rim;

      // ═══ Materials + procedural building ═══
      const mats = createMaterials();
      matsRef.current = mats;
      const rooms = generateRoomsForBuilding(HERO_FLOORS, HERO_STYLE, HERO_FOOTPRINT);
      const config = { ...getDefaultConfig(HERO_STYLE), rooms, floors: HERO_FLOORS };

      // Snapshot scene children BEFORE build so we can strip auxiliaries
      // (ground plane, road, sidewalk, trees, canopy, entrance lights, etc.)
      // that buildBuilding adds directly to the scene. We want ONLY the
      // building itself for the minimalist hero.
      const beforeChildren = new Set(scene.children);

      const buildResult = buildBuilding(config, mats, scene);
      buildingGroupRef.current = buildResult.buildingGroup;
      roomLabelsRef.current = buildResult.roomLabels;
      doorsRef.current = buildResult.doors;
      buildResult.roomLabels.visible = false;

      // Strip everything that's not the building or roomLabels
      scene.children.slice().forEach((child) => {
        if (!beforeChildren.has(child) &&
            child !== buildResult.buildingGroup &&
            child !== buildResult.roomLabels) {
          // Dispose any disposable resources before removing
          scene.remove(child);
          child.traverse((obj) => {
            if (obj instanceof THREE.Mesh) {
              obj.geometry?.dispose();
            }
          });
        }
      });

      // ═══ Matte pass — kill the high-gloss "showroom" sheen ═══
      // The building's stock materials are too reflective for the dashboard
      // hero. Walk the group once and tone down envMap reflections + bump
      // roughness so glass/metal read as architectural, not chrome.
      buildResult.buildingGroup.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (!m) continue;
          const std = m as THREE.MeshStandardMaterial;
          if (typeof std.envMapIntensity === "number") {
            std.envMapIntensity = Math.min(std.envMapIntensity, 0.18);
          }
          if (typeof std.roughness === "number") {
            std.roughness = Math.min(1, std.roughness + 0.35);
          }
          if (typeof std.metalness === "number") {
            std.metalness = Math.max(0, std.metalness * 0.5);
          }
          // MeshPhysicalMaterial extras
          const phys = m as THREE.MeshPhysicalMaterial;
          if (typeof phys.clearcoat === "number") {
            phys.clearcoat = Math.min(phys.clearcoat, 0.1);
          }
          if (typeof phys.clearcoatRoughness === "number") {
            phys.clearcoatRoughness = Math.max(phys.clearcoatRoughness, 0.6);
          }
          if (typeof phys.reflectivity === "number") {
            phys.reflectivity = Math.min(phys.reflectivity, 0.25);
          }
          m.needsUpdate = true;
        }
      });

      // Center the building horizontally on world origin (it may have been
      // built off-center based on room coordinates)
      const bbox = new THREE.Box3().setFromObject(buildResult.buildingGroup);
      const center = bbox.getCenter(new THREE.Vector3());
      buildResult.buildingGroup.position.x -= center.x;
      buildResult.buildingGroup.position.z -= center.z;

      // ═══ Custom dark reflective ground disc ═══
      // A clean circular plane (not the harsh rectangular one from build)
      // that catches the sun shadows and provides a subtle ground anchor.
      const groundGeo = new THREE.CircleGeometry(70, 96);
      const groundMat = new THREE.MeshStandardMaterial({
        color: 0x0a0d14,
        metalness: 0.55,
        roughness: 0.42,
        envMapIntensity: 0.6,
      });
      const ground = new THREE.Mesh(groundGeo, groundMat);
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = 0;
      ground.receiveShadow = true;
      scene.add(ground);

      // Soft cyan ring outline — subtle "BIM plot marker" hint
      const ringGeo = new THREE.RingGeometry(18, 18.18, 96);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x06b6d4,
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.005;
      scene.add(ring);

      // Furniture (in try-catch so a furniture bug doesn't kill the scene)
      try {
        let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
        for (const r of rooms) {
          minX = Math.min(minX, r.x);
          minZ = Math.min(minZ, r.z);
          maxX = Math.max(maxX, r.x + r.width);
          maxZ = Math.max(maxZ, r.z + r.depth);
        }
        addFurniture(rooms, (minX + maxX) / 2, (minZ + maxZ) / 2, config.floorHeight, mats, buildResult.buildingGroup);
      } catch (furnErr) {
        console.warn("[HeroBuildingShowcase] Furniture skipped:", furnErr);
      }

      // ═══ OrbitControls + PointerLockControls ═══
      const orbit = new OrbitControls(camera, renderer.domElement);
      orbit.enableDamping = true;
      orbit.dampingFactor = 0.06;
      orbit.target.set(0, 13, 0); // ~mid-height of an 8-floor 28.8m tower
      orbit.minDistance = 20;
      orbit.maxDistance = 160;
      orbit.maxPolarAngle = Math.PI / 2.1;
      orbit.autoRotate = true;
      orbit.autoRotateSpeed = 0.28;
      orbit.enablePan = false;
      orbit.enableZoom = false; // let wheel/touchpad scroll the page instead of zooming
      orbitRef.current = orbit;

      const fp = new PointerLockControls(camera, renderer.domElement);
      fp.addEventListener("lock", () => { orbit.enabled = false; });
      fp.addEventListener("unlock", () => {
        orbit.enabled = true;
        setViewMode("orbit");
      });
      fpRef.current = fp;

      onKeyDown = (e: KeyboardEvent) => {
        if (!fp.isLocked) return;
        switch (e.code) {
          case "KeyW": case "ArrowUp": moveState.f = true; break;
          case "KeyS": case "ArrowDown": moveState.b = true; break;
          case "KeyA": case "ArrowLeft": moveState.l = true; break;
          case "KeyD": case "ArrowRight": moveState.r = true; break;
        }
      };
      onKeyUp = (e: KeyboardEvent) => {
        switch (e.code) {
          case "KeyW": case "ArrowUp": moveState.f = false; break;
          case "KeyS": case "ArrowDown": moveState.b = false; break;
          case "KeyA": case "ArrowLeft": moveState.l = false; break;
          case "KeyD": case "ArrowRight": moveState.r = false; break;
        }
      };
      document.addEventListener("keydown", onKeyDown);
      document.addEventListener("keyup", onKeyUp);

      // ═══ Section plane ═══
      const sectionPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 8);
      sectionPlaneRef.current = sectionPlane;

      // ═══ Postprocessing ═══
      const composer = new EffectComposer(renderer);
      composer.addPass(new RenderPass(scene, camera));

      const ssao = new SSAOPass(scene, camera, w, h);
      ssao.kernelRadius = 1.4;
      ssao.minDistance = 0.0005;
      ssao.maxDistance = 0.12;
      ssao.output = SSAOPass.OUTPUT.Default;
      composer.addPass(ssao);

      const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.18, 0.6, 0.85);
      composer.addPass(bloom);

      const fxaa = new ShaderPass(FXAAShader);
      fxaa.uniforms["resolution"].value.set(
        1 / (w * renderer.getPixelRatio()),
        1 / (h * renderer.getPixelRatio())
      );
      composer.addPass(fxaa);

      composer.addPass(new OutputPass());
      composerRef.current = composer;

      // ═══ Resize — synchronous, flicker-free.
      // PROBLEM (old approach): the 30ms setTimeout debounce meant the
      // canvas was the wrong size for ~30ms during sidebar collapse → a
      // visible black gap on the right edge.
      //
      // FIX: ResizeObserver fires *before paint*. If we run applyResize
      // synchronously inside the callback, the renderer/composer resize
      // and one frame is rendered in the SAME tick as the layout change,
      // so the user never sees a stale canvas. A 300ms sidebar animation
      // is ~18 frames — reallocating the framebuffer that many times is
      // perfectly fine on modern GPUs. ═══
      const applyResize = () => {
        if (!container) return;
        const nw = container.clientWidth;
        const nh = container.clientHeight;
        if (!nw || !nh) return;
        camera.aspect = nw / nh;
        camera.updateProjectionMatrix();
        renderer.setSize(nw, nh);
        composer.setSize(nw, nh);
        bloom.resolution.set(nw, nh);
        fxaa.uniforms["resolution"].value.set(
          1 / (nw * renderer.getPixelRatio()),
          1 / (nh * renderer.getPixelRatio())
        );
        // Render synchronously so the new framebuffer is painted this tick.
        composer.render();
      };
      resizeObserver = new ResizeObserver(() => {
        // SYNCHRONOUS: ResizeObserver runs after layout but before paint, so
        // resizing the renderer here means the new framebuffer is committed
        // in the SAME frame as the layout change — no stale-canvas flash.
        applyResize();
      });
      resizeObserver.observe(container);

      // ═══ Animate loop ═══
      const clock = new THREE.Clock();
      const introStart = new THREE.Vector3(110, 65, 110);
      const introEnd = new THREE.Vector3(56, 28, 60);
      const introTarget = new THREE.Vector3(0, 13, 0);
      const introDuration = 3.0;
      camera.position.copy(introStart);
      camera.lookAt(introTarget);
      const direction = new THREE.Vector3();
      const FPS_TARGET = 16; // ms ≈ 60fps cap

      const animate = () => {
        animFrameRef.current = requestAnimationFrame(animate);
        if (!isVisibleRef.current) return;
        const now = performance.now();
        if (now - lastRenderRef.current < FPS_TARGET) return;
        lastRenderRef.current = now;

        const delta = Math.min(clock.getDelta(), 0.05);

        // Cinematic intro
        if (introT.current < introDuration && !fp.isLocked) {
          introT.current += delta;
          const t = Math.min(introT.current / introDuration, 1);
          const ease = 1 - Math.pow(1 - t, 4);
          camera.position.lerpVectors(introStart, introEnd, ease);
          camera.lookAt(introTarget);
          orbit.target.copy(introTarget);
          if (t >= 1 && !hudReady) setHudReady(true);
        }

        // First-person walk
        if (fp.isLocked) {
          const friction = 1 - Math.min(1, 10 * delta);
          velocity.x *= friction;
          velocity.z *= friction;
          direction.z = Number(moveState.f) - Number(moveState.b);
          direction.x = Number(moveState.r) - Number(moveState.l);
          direction.normalize();
          const accel = 6 * delta;
          if (moveState.f || moveState.b) velocity.z -= direction.z * accel;
          if (moveState.l || moveState.r) velocity.x -= direction.x * accel;
          fp.moveRight(-velocity.x);
          fp.moveForward(-velocity.z);
          camera.position.y = 1.7;
        }

        // Door spring animation
        for (const door of doorsRef.current) {
          const diff = door.targetAngle - door.currentAngle;
          if (Math.abs(diff) > 0.005) {
            door.currentAngle += diff * Math.min(1, 6 * delta);
            door.pivot.rotation.y = door.currentAngle;
          }
        }

        // Exploded view animation
        const buildingGroup = buildingGroupRef.current;
        if (buildingGroup) {
          const explodeGap = 4.2;
          const target = explodedRef.current ? explodeGap : 0;
          const diff = target - explodeT.current;
          if (Math.abs(diff) > 0.01) {
            explodeT.current += diff * Math.min(1, 4 * delta);
            buildingGroup.traverse((child) => {
              if (child.userData.floor !== undefined) {
                child.position.y = child.userData.originalY + child.userData.floor * explodeT.current;
              }
            });
          }
        }

        // Section cut
        renderer.clippingPlanes = sectionRef.current && sectionPlaneRef.current
          ? [sectionPlaneRef.current]
          : [];

        // X-ray toggle (only on change) — translucent ghost, not wireframe
        if (xrayRef.current !== lastXrayState.current) {
          lastXrayState.current = xrayRef.current;
          const on = xrayRef.current;
          buildingGroup?.traverse((child) => {
            if (!(child instanceof THREE.Mesh) || !child.material) return;
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach((m) => {
              const mat = m as THREE.Material & {
                transparent?: boolean; opacity?: number; depthWrite?: boolean;
                emissive?: THREE.Color; emissiveIntensity?: number;
              };
              const ud = (mat.userData ||= {});
              if (on) {
                if (!ud.__xraySaved) {
                  ud.__xraySaved = {
                    transparent: mat.transparent,
                    opacity: mat.opacity,
                    depthWrite: mat.depthWrite,
                    emissive: mat.emissive ? mat.emissive.clone() : null,
                    emissiveIntensity: mat.emissiveIntensity,
                  };
                }
                mat.transparent = true;
                mat.opacity = 0.18;
                mat.depthWrite = false;
                if (mat.emissive) {
                  mat.emissive.setRGB(0.05, 0.5, 0.65);
                  mat.emissiveIntensity = 0.45;
                }
                mat.needsUpdate = true;
              } else if (ud.__xraySaved) {
                const s = ud.__xraySaved;
                mat.transparent = s.transparent;
                mat.opacity = s.opacity;
                mat.depthWrite = s.depthWrite;
                if (mat.emissive && s.emissive) mat.emissive.copy(s.emissive);
                if (typeof s.emissiveIntensity === "number") mat.emissiveIntensity = s.emissiveIntensity;
                delete ud.__xraySaved;
                mat.needsUpdate = true;
              }
            });
          });
        }

        if (!fp.isLocked) orbit.update();
        composer.render();
      };
      animate();

      // Hint HUD ready after intro even if animate's check missed it
      setTimeout(() => setHudReady(true), 3200);
    } catch (err) {
      console.error("[HeroBuildingShowcase] Boot failed:", err);
      setBootError(true);
    }

    // ═══ IntersectionObserver — pause off-screen ═══
    const io = new IntersectionObserver(
      ([entry]) => { isVisibleRef.current = entry.isIntersecting; },
      { threshold: 0.05 }
    );
    if (container) io.observe(container);

    // ═══ Cleanup ═══
    return () => {
      disposed = true;
      io.disconnect();
      if (onKeyDown) document.removeEventListener("keydown", onKeyDown);
      if (onKeyUp) document.removeEventListener("keyup", onKeyUp);
      if (resizeObserver) resizeObserver.disconnect();
      if (resizeTimer) clearTimeout(resizeTimer);
      cancelAnimationFrame(animFrameRef.current);
      try {
        fpRef.current?.dispose();
        orbitRef.current?.dispose();
        sceneRef.current?.traverse((obj) => {
          if (obj instanceof THREE.Mesh) obj.geometry?.dispose();
        });
        sceneRef.current?.clear();
        rendererRef.current?.dispose();
        if (matsRef.current) disposeMaterials(matsRef.current);
      } catch { /* non-critical */ }
      composerRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      orbitRef.current = null;
      fpRef.current = null;
      buildingGroupRef.current = null;
      roomLabelsRef.current = null;
      doorsRef.current = [];
      sunLightRef.current = null;
      ambientRef.current = null;
      hemiRef.current = null;
      fillRef.current = null;
      rimRef.current = null;
      matsRef.current = null;
      sectionPlaneRef.current = null;
      // Remove canvas DOM
      while (container && container.firstChild) container.removeChild(container.firstChild);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile]);

  // ═════════════════════════════════════════════════════════════════════
  // RENDER
  // ═════════════════════════════════════════════════════════════════════
  if (isMobile) {
    return <MobileFallback />;
  }

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
      {/* Three.js mount point — shifted right on desktop so the centered
          building doesn't overlap the left-side hero text overlay. */}
      <div
        ref={containerRef}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          cursor: viewMode === "orbit" ? "grab" : "crosshair",
          transform: "translateX(clamp(60px, 9vw, 160px))",
          willChange: "transform",
        }}
      />

      {/* Boot error fallback */}
      {bootError && <MobileFallback />}

      {/* HUD — single compact icon row, fades in after cinematic intro */}
      <AnimatePresence>
        {hudReady && !bootError && (
          <>
            {/* TOP-RIGHT — minimalist single-row icon command bar */}
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
              style={{
                position: "absolute",
                top: 28,
                right: 28,
                zIndex: 5,
                display: "flex",
                alignItems: "center",
                gap: 2,
                padding: 4,
                borderRadius: 14,
                background: "rgba(8,10,18,0.62)",
                border: "1px solid rgba(255,255,255,0.06)",
                backdropFilter: "blur(20px)",
                WebkitBackdropFilter: "blur(20px)",
                boxShadow: "0 18px 48px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.04)",
                pointerEvents: "auto",
              }}
            >
              <IconBtn icon={<Move3D size={14} />} active={viewMode === "orbit"} onClick={() => { if (viewMode === "walk") toggleWalk(); }} title="Orbit" />
              <IconBtn icon={<Footprints size={14} />} active={viewMode === "walk"} onClick={() => { if (viewMode === "orbit") toggleWalk(); }} title="Walk through" />
              <Divider />
              <IconBtn icon={<Sun size={14} />} active={timeOfDay === "day"} onClick={() => setTimeOfDay("day")} title="Day" />
              <IconBtn icon={<Sunset size={14} />} active={timeOfDay === "dusk"} onClick={() => setTimeOfDay("dusk")} title="Dusk" />
              <IconBtn icon={<Moon size={14} />} active={timeOfDay === "night"} onClick={() => setTimeOfDay("night")} title="Night" />
              <Divider />
              <IconBtn icon={<Layers size={14} />} active={exploded} onClick={() => setExploded((v) => !v)} title="Exploded view" />
              <IconBtn icon={<Scissors size={14} />} active={section} onClick={() => setSection((v) => !v)} title="Section cut" />
              <IconBtn icon={<ScanLine size={14} />} active={xray} onClick={() => setXray((v) => !v)} title="X-Ray" />
            </motion.div>

            {/* Tiny non-intrusive interactive cue — under the HUD */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.7, delay: 0.9 }}
              style={{
                position: "absolute",
                top: 78,
                right: 28,
                zIndex: 5,
                display: "flex",
                alignItems: "center",
                gap: 6,
                pointerEvents: "none",
              }}
            >
              <MousePointerClick size={10} style={{ color: "rgba(125,249,255,0.55)" }} />
              <span style={{
                fontSize: 9,
                fontWeight: 500,
                letterSpacing: "0.18em",
                color: "rgba(125,249,255,0.55)",
                fontFamily: "var(--font-jetbrains), monospace",
                textTransform: "uppercase",
              }}>
                Drag to orbit
              </span>
            </motion.div>

            {/* Walk-mode keyboard hint */}
            {viewMode === "walk" && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                style={{
                  position: "absolute",
                  bottom: 90,
                  left: "50%",
                  transform: "translateX(-50%)",
                  zIndex: 5,
                  padding: "8px 16px",
                  borderRadius: 10,
                  background: "rgba(8,10,18,0.78)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  backdropFilter: "blur(14px)",
                  pointerEvents: "none",
                }}
              >
                <span style={{
                  fontSize: 10,
                  fontWeight: 500,
                  letterSpacing: "0.12em",
                  color: "rgba(226,232,240,0.78)",
                  fontFamily: "var(--font-jetbrains), monospace",
                  textTransform: "uppercase",
                }}>
                  WASD · Mouse look · Esc to exit
                </span>
              </motion.div>
            )}
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// HUD subcomponents — minimalist icon-only command bar
// ═════════════════════════════════════════════════════════════════════
function IconBtn({
  icon,
  active,
  onClick,
  title,
}: {
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height: 32,
        borderRadius: 9,
        border: "1px solid",
        borderColor: active ? "rgba(125,249,255,0.42)" : "transparent",
        background: active
          ? "linear-gradient(135deg, rgba(6,182,212,0.22), rgba(99,102,241,0.18))"
          : "transparent",
        color: active ? "#a8f5ff" : "rgba(226,232,240,0.7)",
        cursor: "pointer",
        transition: "all 0.22s cubic-bezier(0.22,1,0.36,1)",
        boxShadow: active ? "0 0 14px rgba(125,249,255,0.18)" : "none",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background = "rgba(255,255,255,0.05)";
          e.currentTarget.style.color = "#e2e8f0";
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.background = "transparent";
          e.currentTarget.style.color = "rgba(226,232,240,0.7)";
        }
      }}
    >
      {icon}
    </button>
  );
}

function Divider() {
  return (
    <div
      style={{
        width: 1,
        height: 18,
        background: "rgba(255,255,255,0.08)",
        margin: "0 4px",
      }}
    />
  );
}

// ─── Mobile / fallback hero ────────────────────────────────────────────
function MobileFallback() {
  return (
    <div style={{
      position: "absolute",
      inset: 0,
      background: `
        radial-gradient(ellipse 75% 60% at 65% 55%, rgba(255,153,102,0.18) 0%, transparent 60%),
        radial-gradient(ellipse 60% 50% at 30% 40%, rgba(125,249,255,0.10) 0%, transparent 55%),
        linear-gradient(180deg, #03050c 0%, #06080f 60%, #03050c 100%)
      `,
    }} />
  );
}
