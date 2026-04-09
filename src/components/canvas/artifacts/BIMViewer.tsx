"use client";

/**
 * BIMViewer — Ultra-realistic BIM 3D viewer with PBR materials, SSAO,
 * bloom, environment mapping, element selection, properties panel,
 * section planes, discipline coloring, and storey isolation.
 */

import { useEffect, useRef, useCallback, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { RGBELoader } from "three/examples/jsm/loaders/RGBELoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { FXAAShader } from "three/examples/jsm/shaders/FXAAShader.js";
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";
import {
  Loader2, AlertCircle, RotateCcw, Maximize2, Minimize2,
  MousePointerClick, X, Download, Layers, Scissors, Eye,
} from "lucide-react";
import type { BIMMetadata, BIMElementMeta } from "@/services/metadata-extractor";
import { getDisciplineColor, getStoreyColor } from "@/services/material-mapping";
import {
  createBIMMaterials, getMaterialKey, disposeBIMMaterials,
  createSkyTexture,
  type BIMMaterialLib,
} from "@/lib/3d-generation/bim-materials";

// ─── Types ───────────────────────────────────────────────────────────────────

interface BIMViewerProps {
  glbUrl: string;
  metadataUrl?: string;
  ifcUrl?: string;
  height?: number;
}

type ColorMode = "default" | "discipline" | "storey";

// ─── Highlight Material ──────────────────────────────────────────────────────

const HIGHLIGHT_MAT = new THREE.MeshStandardMaterial({
  color: 0x4FC3F7,
  emissive: 0x2288BB,
  emissiveIntensity: 0.4,
  roughness: 0.3,
  metalness: 0.1,
  transparent: true,
  opacity: 0.85,
  side: THREE.DoubleSide,
});

// ─── Component ───────────────────────────────────────────────────────────────

export default function BIMViewer({ glbUrl, metadataUrl, ifcUrl, height = 500 }: BIMViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const composerRef = useRef<EffectComposer | null>(null);
  const animFrameRef = useRef<number>(0);
  const controlsRef = useRef<OrbitControls | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const modelRef = useRef<THREE.Group | null>(null);
  const metadataRef = useRef<BIMMetadata | null>(null);
  const originalMatsRef = useRef<Map<string, THREE.Material | THREE.Material[]>>(new Map());
  const raycasterRef = useRef(new THREE.Raycaster());
  const mouseRef = useRef(new THREE.Vector2());
  const materialsRef = useRef<BIMMaterialLib | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [selectedElement, setSelectedElement] = useState<BIMElementMeta | null>(null);
  const [colorMode, setColorMode] = useState<ColorMode>("default");
  const [sectionEnabled, setSectionEnabled] = useState(false);
  const [sectionY, setSectionY] = useState(0.5);

  const selectedMeshRef = useRef<THREE.Mesh | null>(null);

  // ─── Load Metadata ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!metadataUrl) return;
    fetch(metadataUrl)
      .then((r) => r.json())
      .then((data: BIMMetadata) => {
        metadataRef.current = data;
      })
      .catch((err) => console.warn("[BIMViewer] Metadata load failed:", err));
  }, [metadataUrl]);

  // ─── Cleanup ───────────────────────────────────────────────────────────────

  const cleanup = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    composerRef.current = null;
    if (rendererRef.current) {
      rendererRef.current.dispose();
      rendererRef.current = null;
    }
    controlsRef.current?.dispose();
    controlsRef.current = null;
    sceneRef.current = null;
    cameraRef.current = null;
    modelRef.current = null;
    originalMatsRef.current.clear();
    if (materialsRef.current) {
      disposeBIMMaterials(materialsRef.current);
      materialsRef.current = null;
    }
  }, []);

  // ─── Deselect ──────────────────────────────────────────────────────────────

  const deselectElement = useCallback(() => {
    if (selectedMeshRef.current) {
      const orig = originalMatsRef.current.get(selectedMeshRef.current.name);
      if (orig) selectedMeshRef.current.material = orig;
      selectedMeshRef.current = null;
    }
    setSelectedElement(null);
  }, []);

  // ─── Color Mode Application ────────────────────────────────────────────────

  const applyColorMode = useCallback((mode: ColorMode) => {
    const model = modelRef.current;
    if (!model) return;

    model.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh) || obj.name === "ground-plane") return;

      if (mode === "default") {
        const orig = originalMatsRef.current.get(obj.name);
        if (orig) obj.material = orig;
      } else if (mode === "discipline") {
        const disc = obj.userData.discipline as string;
        const color = getDisciplineColor(disc);
        obj.material = new THREE.MeshStandardMaterial({
          color, roughness: 0.6, metalness: 0.1, side: THREE.DoubleSide,
        });
      } else if (mode === "storey") {
        const storeyIdx = obj.userData.storeyIndex as number;
        const color = getStoreyColor(storeyIdx ?? 0);
        obj.material = new THREE.MeshStandardMaterial({
          color, roughness: 0.6, metalness: 0.1, side: THREE.DoubleSide,
        });
      }
    });
  }, []);

  // ─── Build Scene ───────────────────────────────────────────────────────────

  const buildScene = useCallback(() => {
    const container = containerRef.current;
    if (!container || !glbUrl) return;

    cleanup();
    container.innerHTML = "";
    setLoading(true);
    setError(null);
    setProgress(0);

    const w = container.clientWidth || 800;
    const h = expanded ? Math.min(window.innerHeight * 0.85, 800) : height;

    // ═══ Create ultra-realistic PBR materials ═══
    const mats = createBIMMaterials();
    materialsRef.current = mats;

    // ═══ Renderer (high quality) ═══
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.35; // Warm golden-hour exposure
    renderer.localClippingEnabled = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // ═══ Scene ═══
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0xE8DDD0, 0.003); // Warm atmospheric haze
    sceneRef.current = scene;

    // ═══ Real HDRI Environment (with procedural fallback) ═══
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();

    // Try loading real HDRI first, fall back to procedural
    let envMap: THREE.Texture | null = null;

    // Procedural sky dome (always added as visible background)
    const mainSkyGeo = new THREE.SphereGeometry(400, 64, 32);
    const mainSkyTex = createSkyTexture();
    const mainSkyMat = new THREE.MeshBasicMaterial({
      map: mainSkyTex,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    });
    const mainSkyMesh = new THREE.Mesh(mainSkyGeo, mainSkyMat);
    mainSkyMesh.name = "sky-dome";
    mainSkyMesh.renderOrder = -1;
    scene.add(mainSkyMesh);

    // Load real HDRI for ultra-realistic reflections
    const rgbeLoader = new RGBELoader();
    rgbeLoader.load(
      "/textures/hdri/industrial_sunset_2k.hdr",
      (hdrTexture) => {
        hdrTexture.mapping = THREE.EquirectangularReflectionMapping;
        const hdrEnvMap = pmremGenerator.fromEquirectangular(hdrTexture).texture;
        scene.environment = hdrEnvMap;
        // Also use HDRI as visible background for ultra-realistic sky
        scene.background = hdrEnvMap;
        // Remove procedural sky dome when HDRI loads
        scene.remove(mainSkyMesh);
        mainSkyMat.dispose();
        mainSkyGeo.dispose();
        hdrTexture.dispose();
        pmremGenerator.dispose();
      },
      undefined,
      () => {
        // HDRI load failed — fall back to procedural environment
        console.warn("[BIMViewer] HDRI load failed, using procedural sky environment");
        const envScene = new THREE.Scene();
        const skyGeo = new THREE.SphereGeometry(100, 64, 32);
        const skyTex = createSkyTexture();
        skyTex.mapping = THREE.EquirectangularReflectionMapping;
        envScene.add(new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide })));
        const envGround = new THREE.Mesh(
          new THREE.PlaneGeometry(200, 200),
          new THREE.MeshBasicMaterial({ color: 0x6B7A4A })
        );
        envGround.rotation.x = -Math.PI / 2;
        envGround.position.y = -10;
        envScene.add(envGround);
        envMap = pmremGenerator.fromScene(envScene, 0.02).texture;
        scene.environment = envMap;
        pmremGenerator.dispose();
      }
    );

    // ═══ Camera ═══
    const camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 1000); // Tighter FOV for architectural drama
    camera.position.set(40, 20, 45); // Lower eye level for more imposing view
    cameraRef.current = camera;

    // ═══ Controls ═══
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.25;
    controls.minDistance = 0.5; // Allow very close zoom for detailed inspection
    controls.maxDistance = 300;
    controls.maxPolarAngle = Math.PI / 2.05;
    controlsRef.current = controls;

    // ═══ Lighting (cinematic golden-hour setup) ═══

    // Ambient — warm soft fill
    const ambientLight = new THREE.AmbientLight(0xE8D8C8, 0.4);
    scene.add(ambientLight);

    // Hemisphere — warm sky / cool ground for contrast
    const hemiLight = new THREE.HemisphereLight(0xFFE8C0, 0x3A5533, 0.9);
    scene.add(hemiLight);

    // Sun — low-angle golden hour with dramatic shadows
    const sunLight = new THREE.DirectionalLight(0xFFD4A0, 3.2);
    sunLight.position.set(60, 35, 50); // Lower angle = longer, more dramatic shadows
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 4096;
    sunLight.shadow.mapSize.height = 4096;
    sunLight.shadow.camera.left = -80;
    sunLight.shadow.camera.right = 80;
    sunLight.shadow.camera.top = 80;
    sunLight.shadow.camera.bottom = -80;
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 300;
    sunLight.shadow.bias = -0.0002;
    sunLight.shadow.normalBias = 0.03;
    sunLight.shadow.radius = 3; // Softer shadow edges
    scene.add(sunLight);

    // Fill light — cool blue from opposite side for cinematic warm/cool contrast
    const fillLight = new THREE.DirectionalLight(0x8AACDD, 0.6);
    fillLight.position.set(-30, 40, -20);
    scene.add(fillLight);

    // Rim light — warm back-lighting for edge glow
    const rimLight = new THREE.DirectionalLight(0xFFD090, 0.5);
    rimLight.position.set(-20, 15, -40);
    scene.add(rimLight);

    // Warm ground bounce light — stronger for ambient warmth
    const bounceLight = new THREE.DirectionalLight(0xFFDDBB, 0.35);
    bounceLight.position.set(0, -10, 0);
    scene.add(bounceLight);

    // Section plane (Y-axis cut)
    const sectionPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 100);

    // ═══ Post-processing Pipeline ═══
    const composer = new EffectComposer(renderer);

    // 1. Base render
    composer.addPass(new RenderPass(scene, camera));

    // 2. SSAO — Screen Space Ambient Occlusion for deep contact shadows
    const ssaoPass = new SSAOPass(scene, camera, w, h);
    ssaoPass.kernelRadius = 1.4;      // Wider radius for deeper AO
    ssaoPass.minDistance = 0.0005;     // Finer detail
    ssaoPass.maxDistance = 0.12;       // Tight reach for crisp contact shadows
    ssaoPass.output = SSAOPass.OUTPUT.Default;
    composer.addPass(ssaoPass);

    // 3. Bloom — golden glow on glass edges, sun-lit surfaces
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(w, h), 0.08, 0.6, 0.9 // Lower threshold = more glow on bright areas
    );
    composer.addPass(bloomPass);

    // 4. FXAA — edge anti-aliasing
    const fxaaPass = new ShaderPass(FXAAShader);
    fxaaPass.uniforms["resolution"].value.set(
      1 / (w * renderer.getPixelRatio()),
      1 / (h * renderer.getPixelRatio())
    );
    composer.addPass(fxaaPass);

    // 5. Output (tone mapping)
    composer.addPass(new OutputPass());
    composerRef.current = composer;

    // ═══ Load GLB ═══
    const loader = new GLTFLoader();
    loader.load(
      glbUrl,
      (gltf) => {
        const model = gltf.scene;
        modelRef.current = model;

        // Compute bounding box for camera fitting
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        const maxDim = Math.max(size.x, size.y, size.z);

        // ═══ MATERIAL REPLACEMENT — upgrade flat GLB materials to ultra-realistic PBR ═══
        model.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) return;

          child.castShadow = true;
          child.receiveShadow = true;

          const elemType = child.userData.elementType as string;
          const isExterior = child.userData.discipline === "architectural" &&
            (child.name.includes("exterior") || child.userData.isExterior);

          if (child.name === "ground-plane") {
            // Replace ground with rich grass material
            child.material = mats.ground;
            child.castShadow = false;
            child.receiveShadow = true;
          } else if (child.name.startsWith("tree-trunk") || child.name.startsWith("tree-far-trunk")) {
            child.material = mats.treeTrunk;
          } else if (child.name.startsWith("tree-crown") || child.name.startsWith("tree-far-crown")) {
            child.material = mats.treeCrown;
          } else if (elemType) {
            // Replace with ultra-realistic PBR material
            const matKey = getMaterialKey(elemType, isExterior);
            child.material = mats[matKey];
          } else {
            // ═══ External model (AI-generated) — enhance existing materials ═══
            // These models already have textures from 3D AI Studio/Meshy.
            // scene.environment provides reflections automatically to all PBR materials.
            // Tune envMapIntensity and PBR properties for richer look.
            const mat = child.material;
            if (mat && "isMeshStandardMaterial" in mat && (mat as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
              const stdMat = mat as THREE.MeshStandardMaterial;
              stdMat.envMapIntensity = 1.5;
              // Enhance roughness for more realistic look
              if (stdMat.roughness > 0.9) stdMat.roughness = 0.82;
              if (stdMat.transparent && stdMat.opacity < 0.5) {
                // Looks like glass — boost reflections
                stdMat.envMapIntensity = 2.5;
                stdMat.metalness = Math.max(stdMat.metalness, 0.08);
              }
              stdMat.needsUpdate = true;
            }
            if (mat && "isMeshPhysicalMaterial" in mat && (mat as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial) {
              const physMat = mat as THREE.MeshPhysicalMaterial;
              physMat.envMapIntensity = 2.0;
              physMat.needsUpdate = true;
            }
          }

          // Store the upgraded material as "original" for color mode reset
          originalMatsRef.current.set(child.name, child.material);
        });

        scene.add(model);

        // ═══ Enhanced Ground Plane ═══
        // If the model has a ground-plane, scale it up; otherwise add one
        let hasGround = false;
        model.traverse((obj) => {
          if (obj instanceof THREE.Mesh && obj.name === "ground-plane") {
            hasGround = true;
          }
        });
        if (!hasGround) {
          const groundSize = Math.max(maxDim * 4, 100);
          const groundMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(groundSize, groundSize),
            mats.ground
          );
          groundMesh.rotation.x = -Math.PI / 2;
          groundMesh.position.y = box.min.y - 0.02;
          groundMesh.receiveShadow = true;
          groundMesh.name = "ground-plane";
          scene.add(groundMesh);
        }

        // ═══ Contact Shadow Plane (soft ground shadow beneath building) ═══
        const shadowPlane = new THREE.Mesh(
          new THREE.PlaneGeometry(maxDim * 5, maxDim * 5),
          new THREE.ShadowMaterial({ opacity: 0.25, color: 0x000000 })
        );
        shadowPlane.rotation.x = -Math.PI / 2;
        shadowPlane.position.y = box.min.y - 0.01;
        shadowPlane.receiveShadow = true;
        shadowPlane.name = "contact-shadow";
        scene.add(shadowPlane);

        // ═══ Fit camera to model ═══
        // Lower eye-level angle for imposing architectural perspective
        const dist = Math.max(maxDim * 1.5, maxDim + 3);
        camera.position.set(
          center.x + dist * 0.7,
          center.y + dist * 0.28, // Lower eye level — more dramatic
          center.z + dist * 0.7
        );
        camera.near = 0.01; // Allow very close zoom for inspection
        camera.updateProjectionMatrix();
        controls.target.copy(center);
        controls.minDistance = Math.max(maxDim * 0.1, 0.5); // Allow zooming very close
        controls.update();

        // ═══ Update shadow camera to fit building precisely ═══
        const shadowExtent = maxDim * 1.5;
        sunLight.shadow.camera.left = -shadowExtent;
        sunLight.shadow.camera.right = shadowExtent;
        sunLight.shadow.camera.top = shadowExtent;
        sunLight.shadow.camera.bottom = -shadowExtent;
        sunLight.shadow.camera.far = shadowExtent * 4;
        sunLight.shadow.camera.updateProjectionMatrix();
        // Golden-hour sun: lower Y = longer dramatic shadows across the facade
        sunLight.position.set(
          center.x + shadowExtent * 1.0,
          center.y + shadowExtent * 0.7,
          center.z + shadowExtent * 0.6
        );
        sunLight.target.position.copy(center);
        scene.add(sunLight.target);

        // Position fill/rim relative to building
        fillLight.position.set(
          center.x - shadowExtent * 0.6,
          center.y + shadowExtent * 0.8,
          center.z - shadowExtent * 0.4
        );
        rimLight.position.set(
          center.x - shadowExtent * 0.3,
          center.y + shadowExtent * 0.3,
          center.z - shadowExtent * 0.8
        );

        // Warm atmospheric haze scales with building size
        (scene.fog as THREE.FogExp2).density = 0.4 / Math.max(maxDim, 30);

        // Section plane default to mid-height
        setSectionY(center.y + size.y * 0.5);

        setLoading(false);
      },
      (xhr) => {
        if (xhr.total > 0) setProgress(Math.round((xhr.loaded / xhr.total) * 100));
      },
      (err) => {
        console.error("[BIMViewer]", err);
        cleanup();
        setError("Failed to load 3D model");
        setLoading(false);
      }
    );

    // ═══ Click handler (element selection — only for BIM models with metadata) ═══
    const onClick = (event: MouseEvent) => {
      // Skip click-to-inspect for AI-generated models without BIM metadata
      // (they only have generic mesh names like "texture_pbr_v128", not real BIM elements)
      if (!metadataUrl) return;

      const rect = renderer.domElement.getBoundingClientRect();
      mouseRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouseRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycasterRef.current.setFromCamera(mouseRef.current, camera);
      const model = modelRef.current;
      if (!model) return;

      const meshes: THREE.Mesh[] = [];
      model.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.name && obj.name !== "ground-plane"
            && !obj.name.startsWith("tree-") && obj.name !== "sky-dome") {
          meshes.push(obj);
        }
      });

      const intersects = raycasterRef.current.intersectObjects(meshes, false);
      deselectElement();

      if (intersects.length > 0) {
        const hit = intersects[0].object as THREE.Mesh;
        const elementId = hit.name;

        originalMatsRef.current.set(hit.name, hit.material);
        hit.material = HIGHLIGHT_MAT;
        selectedMeshRef.current = hit;

        const meta = metadataRef.current?.elements[elementId];
        if (meta) {
          setSelectedElement(meta);
        } else {
          setSelectedElement({
            id: elementId,
            ifcType: hit.userData.ifcType ?? "Unknown",
            type: hit.userData.elementType ?? "unknown",
            storeyIndex: hit.userData.storeyIndex ?? 0,
            storeyName: `Storey ${hit.userData.storeyIndex ?? 0}`,
            properties: { name: elementId, storeyIndex: hit.userData.storeyIndex ?? 0 },
          });
        }

        controls.autoRotate = false;
      }
    };

    renderer.domElement.addEventListener("click", onClick);

    // ═══ Animate ═══
    function animate() {
      animFrameRef.current = requestAnimationFrame(animate);
      controls.update();

      if (sectionPlane) {
        renderer.clippingPlanes = sectionEnabled
          ? [new THREE.Plane(new THREE.Vector3(0, -1, 0), sectionY)]
          : [];
      }

      composer.render();
    }
    animate();

    // ═══ Resize ═══
    const onResize = () => {
      const newW = container.clientWidth;
      const newH = expanded ? Math.min(window.innerHeight * 0.85, 800) : height;
      camera.aspect = newW / newH;
      camera.updateProjectionMatrix();
      renderer.setSize(newW, newH);
      composer.setSize(newW, newH);
      fxaaPass.uniforms["resolution"].value.set(
        1 / (newW * renderer.getPixelRatio()),
        1 / (newH * renderer.getPixelRatio())
      );
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      renderer.domElement.removeEventListener("click", onClick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glbUrl, height, expanded, cleanup, deselectElement]);

  useEffect(() => {
    const removeListeners = buildScene();
    return () => {
      removeListeners?.();
      cleanup();
    };
  }, [buildScene, cleanup]);

  // Apply color mode changes
  useEffect(() => {
    applyColorMode(colorMode);
  }, [colorMode, applyColorMode]);

  // Update section plane
  useEffect(() => {
    const renderer = rendererRef.current;
    if (renderer) {
      renderer.clippingPlanes = sectionEnabled
        ? [new THREE.Plane(new THREE.Vector3(0, -1, 0), sectionY)]
        : [];
    }
  }, [sectionEnabled, sectionY]);

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="relative w-full" style={{ minHeight: expanded ? 800 : height }}>
      {/* ── Toolbar (BIM controls only when metadata available) ── */}
      {metadataUrl && <div className="absolute top-2 left-2 z-10 flex gap-1">
        <button
          onClick={() => setColorMode(colorMode === "discipline" ? "default" : "discipline")}
          className="rounded px-2 py-1 text-[10px] font-medium transition-colors"
          style={{
            background: colorMode === "discipline" ? "rgba(79, 195, 247, 0.3)" : "rgba(13, 13, 26, 0.7)",
            color: colorMode === "discipline" ? "#4FC3F7" : "#888",
            border: `1px solid ${colorMode === "discipline" ? "rgba(79, 195, 247, 0.5)" : "transparent"}`,
          }}
          title="Color by discipline (Arch/Struct/MEP)"
        >
          <Layers size={12} className="inline mr-1" />
          Discipline
        </button>
        <button
          onClick={() => setColorMode(colorMode === "storey" ? "default" : "storey")}
          className="rounded px-2 py-1 text-[10px] font-medium transition-colors"
          style={{
            background: colorMode === "storey" ? "rgba(79, 195, 247, 0.3)" : "rgba(13, 13, 26, 0.7)",
            color: colorMode === "storey" ? "#4FC3F7" : "#888",
            border: `1px solid ${colorMode === "storey" ? "rgba(79, 195, 247, 0.5)" : "transparent"}`,
          }}
          title="Color by storey"
        >
          <Layers size={12} className="inline mr-1" />
          Storey
        </button>
        <button
          onClick={() => setSectionEnabled(!sectionEnabled)}
          className="rounded px-2 py-1 text-[10px] font-medium transition-colors"
          style={{
            background: sectionEnabled ? "rgba(79, 195, 247, 0.3)" : "rgba(13, 13, 26, 0.7)",
            color: sectionEnabled ? "#4FC3F7" : "#888",
            border: `1px solid ${sectionEnabled ? "rgba(79, 195, 247, 0.5)" : "transparent"}`,
          }}
          title="Section cut"
        >
          <Scissors size={12} className="inline mr-1" />
          Section
        </button>
      </div>}

      {/* Section height slider */}
      {sectionEnabled && metadataUrl && (
        <div className="absolute top-10 left-2 z-10 flex items-center gap-2 rounded px-2 py-1"
          style={{ background: "rgba(13, 13, 26, 0.8)" }}>
          <span style={{ color: "#888", fontSize: 10 }}>Cut Height</span>
          <input
            type="range"
            min={0}
            max={Math.max(sectionY * 2, 30)}
            step={0.5}
            value={sectionY}
            onChange={(e) => setSectionY(parseFloat(e.target.value))}
            style={{ width: 100, accentColor: "#4FC3F7" }}
          />
          <span style={{ color: "#4FC3F7", fontSize: 10 }}>{sectionY.toFixed(1)}m</span>
        </div>
      )}

      {/* Right toolbar */}
      <div className="absolute top-2 right-2 z-10 flex gap-1">
        {ifcUrl && (
          <a
            href={ifcUrl}
            download="model.ifc"
            className="rounded p-1.5 transition-colors"
            style={{ background: "rgba(13, 13, 26, 0.7)", color: "#4FC3F7" }}
            title="Download IFC file"
          >
            <Download size={14} />
          </a>
        )}
        <button
          onClick={() => controlsRef.current?.reset()}
          className="rounded p-1.5 transition-colors"
          style={{ background: "rgba(13, 13, 26, 0.7)", color: "#4FC3F7" }}
          title="Reset camera"
        >
          <RotateCcw size={14} />
        </button>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="rounded p-1.5 transition-colors"
          style={{ background: "rgba(13, 13, 26, 0.7)", color: "#4FC3F7" }}
          title={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
      </div>

      {/* ── Properties Panel ── */}
      {selectedElement && (
        <div
          className="absolute top-2 right-14 z-20 overflow-auto rounded-lg"
          style={{
            background: "rgba(13, 13, 26, 0.92)",
            border: "1px solid rgba(79, 195, 247, 0.3)",
            width: 260,
            maxHeight: expanded ? 700 : height - 20,
            backdropFilter: "blur(8px)",
          }}
        >
          <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            <span style={{ color: "#4FC3F7", fontSize: 11, fontWeight: 600 }}>
              <MousePointerClick size={12} className="inline mr-1" />
              BIM PROPERTIES
            </span>
            <button onClick={deselectElement} style={{ color: "#666" }}>
              <X size={14} />
            </button>
          </div>
          <div className="px-3 py-2 space-y-1" style={{ fontSize: 11 }}>
            <PropRow label="Element" value={selectedElement.properties.name} accent />
            <PropRow label="IFC Type" value={selectedElement.ifcType} />
            <PropRow label="Category" value={selectedElement.type} />
            <PropRow label="Storey" value={selectedElement.storeyName} />
            {selectedElement.properties.height != null && (
              <PropRow label="Height" value={`${selectedElement.properties.height.toFixed(2)} m`} />
            )}
            {selectedElement.properties.width != null && (
              <PropRow label="Width" value={`${selectedElement.properties.width.toFixed(2)} m`} />
            )}
            {selectedElement.properties.length != null && (
              <PropRow label="Length" value={`${selectedElement.properties.length?.toFixed(2)} m`} />
            )}
            {selectedElement.properties.thickness != null && (
              <PropRow label="Thickness" value={`${(selectedElement.properties.thickness * 1000).toFixed(0)} mm`} />
            )}
            {selectedElement.properties.area != null && (
              <PropRow label="Area" value={`${selectedElement.properties.area.toFixed(1)} m²`} />
            )}
            {selectedElement.properties.volume != null && (
              <PropRow label="Volume" value={`${selectedElement.properties.volume.toFixed(2)} m³`} />
            )}
            {selectedElement.properties.radius != null && (
              <PropRow label="Radius" value={`${(selectedElement.properties.radius * 1000).toFixed(0)} mm`} />
            )}
            {selectedElement.properties.material && (
              <PropRow label="Material" value={selectedElement.properties.material} />
            )}
            {selectedElement.properties.discipline && (
              <PropRow label="Discipline" value={selectedElement.properties.discipline} />
            )}
            {selectedElement.properties.isExterior != null && (
              <PropRow label="Exterior" value={selectedElement.properties.isExterior ? "Yes" : "No"} />
            )}
            {selectedElement.properties.isPartition != null && (
              <PropRow label="Partition" value={selectedElement.properties.isPartition ? "Yes" : "No"} />
            )}
            {selectedElement.properties.spaceName && (
              <PropRow label="Space" value={selectedElement.properties.spaceName} />
            )}
            {selectedElement.properties.spaceUsage && (
              <PropRow label="Usage" value={selectedElement.properties.spaceUsage} />
            )}
            {selectedElement.properties.sillHeight != null && (
              <PropRow label="Sill Height" value={`${selectedElement.properties.sillHeight.toFixed(2)} m`} />
            )}
            {selectedElement.properties.riserCount != null && (
              <PropRow label="Risers" value={String(selectedElement.properties.riserCount)} />
            )}
            {selectedElement.properties.diameter != null && (
              <PropRow label="Diameter" value={`${(selectedElement.properties.diameter * 1000).toFixed(0)} mm`} />
            )}
          </div>
        </div>
      )}

      {/* ── Loading overlay ── */}
      {loading && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2"
          style={{ background: "linear-gradient(135deg, #0D0D1A 0%, #1A1A2E 100%)", borderRadius: 8 }}>
          <Loader2 size={24} className="animate-spin" style={{ color: "#4FC3F7" }} />
          <span style={{ fontSize: 11, color: "#888" }}>
            Loading BIM Model{progress > 0 ? ` (${progress}%)` : "..."}
          </span>
        </div>
      )}

      {/* ── Error overlay ── */}
      {error && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3"
          style={{ background: "#0D0D1A", borderRadius: 8 }}>
          <AlertCircle size={24} style={{ color: "#ef4444" }} />
          <span style={{ fontSize: 11, color: "#ef4444" }}>{error}</span>
          <button onClick={buildScene} className="rounded px-3 py-1 text-xs"
            style={{ background: "rgba(79, 195, 247, 0.15)", color: "#4FC3F7", border: "1px solid rgba(79, 195, 247, 0.3)" }}>
            Retry
          </button>
        </div>
      )}

      <div
        ref={containerRef}
        className="w-full"
        style={{
          height: expanded ? Math.min(typeof window !== "undefined" ? window.innerHeight * 0.85 : 800, 800) : height,
          borderRadius: 8,
          overflow: "hidden",
        }}
      />

      {/* ── Attribution + info ── */}
      <div className="absolute bottom-2 left-2 z-10 flex items-center gap-2">
        <span style={{ fontSize: 9, color: "rgba(255,255,255,0.5)" }}>
          <Eye size={9} className="inline mr-0.5" />
          {metadataUrl ? "BIM Viewer • Click elements to inspect" : "3D Model Viewer"}
        </span>
        {metadataRef.current && (
          <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)" }}>
            • {metadataRef.current.summary.totalElements} elements
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Property Row ────────────────────────────────────────────────────────────

function PropRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex justify-between items-start gap-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", paddingBottom: 3 }}>
      <span style={{ color: "#666", flexShrink: 0 }}>{label}</span>
      <span style={{ color: accent ? "#4FC3F7" : "#CCC", textAlign: "right", wordBreak: "break-word", fontWeight: accent ? 600 : 400 }}>
        {value}
      </span>
    </div>
  );
}
