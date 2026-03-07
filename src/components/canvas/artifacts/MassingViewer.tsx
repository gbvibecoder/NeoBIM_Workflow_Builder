"use client";

import { useEffect, useRef, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

interface MassingViewerProps {
  floors: number;
  height: number;
  footprint: number;
  gfa: number;
  buildingType?: string;
}

export default function MassingViewer({ floors, height, footprint, buildingType }: MassingViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const animFrameRef = useRef<number>(0);

  const buildScene = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    // Cleanup previous
    if (rendererRef.current) {
      rendererRef.current.dispose();
      cancelAnimationFrame(animFrameRef.current);
      container.innerHTML = "";
    }

    const w = container.clientWidth;
    const h = container.clientHeight;

    // ─── Renderer ──────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // ─── Scene ─────────────────────────────────────────────────
    const scene = new THREE.Scene();

    // Gradient background via a fullscreen quad behind everything
    const bgCanvas = document.createElement("canvas");
    bgCanvas.width = 2;
    bgCanvas.height = 256;
    const bgCtx = bgCanvas.getContext("2d")!;
    const grad = bgCtx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, "#12121E");
    grad.addColorStop(0.5, "#0E0E18");
    grad.addColorStop(1, "#0B0B13");
    bgCtx.fillStyle = grad;
    bgCtx.fillRect(0, 0, 2, 256);
    const bgTex = new THREE.CanvasTexture(bgCanvas);
    scene.background = bgTex;

    scene.fog = new THREE.FogExp2("#0D0D18", 0.006);

    // ─── Camera ────────────────────────────────────────────────
    const camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 800);
    const maxDim = Math.max(height, Math.sqrt(footprint));
    const dist = maxDim * 2.4;
    // 3/4 perspective view
    camera.position.set(dist * 0.9, dist * 0.65, dist * 0.7);
    camera.lookAt(0, height * 0.35, 0);

    // ─── Controls ──────────────────────────────────────────────
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.target.set(0, height * 0.35, 0);
    controls.maxPolarAngle = Math.PI / 2.05;
    controls.minDistance = maxDim * 0.6;
    controls.maxDistance = maxDim * 6;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.2; // ~0.2 rpm, gentle spin

    // ─── Lighting ──────────────────────────────────────────────
    // Soft ambient base
    const ambient = new THREE.AmbientLight("#8899bb", 0.4);
    scene.add(ambient);

    // Hemisphere: sky blue top, warm ground bounce
    const hemi = new THREE.HemisphereLight("#7aaad4", "#3a2a1a", 0.35);
    scene.add(hemi);

    // Key light — top-right, warm white
    const keyLight = new THREE.DirectionalLight("#fff5e6", 0.85);
    keyLight.position.set(35, 55, 25);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.setScalar(1024);
    keyLight.shadow.camera.near = 0.5;
    keyLight.shadow.camera.far = 250;
    const shadowSize = maxDim * 2.5;
    keyLight.shadow.camera.left = -shadowSize;
    keyLight.shadow.camera.right = shadowSize;
    keyLight.shadow.camera.top = shadowSize;
    keyLight.shadow.camera.bottom = -shadowSize;
    keyLight.shadow.bias = -0.001;
    scene.add(keyLight);

    // Fill light — cooler, from opposite side
    const fillLight = new THREE.DirectionalLight("#aabbdd", 0.3);
    fillLight.position.set(-25, 35, -15);
    scene.add(fillLight);

    // Rim/back light — subtle edge definition
    const rimLight = new THREE.DirectionalLight("#6688cc", 0.25);
    rimLight.position.set(-10, 20, -40);
    scene.add(rimLight);

    // ─── Ground plane ──────────────────────────────────────────
    const groundSize = maxDim * 8;
    const groundGeo = new THREE.PlaneGeometry(groundSize, groundSize);
    const groundMat = new THREE.MeshStandardMaterial({
      color: "#141420",
      roughness: 0.92,
      metalness: 0.05,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Subtle grid
    const gridSize = maxDim * 5;
    const gridDivisions = Math.round(gridSize / 5);
    const grid = new THREE.GridHelper(gridSize, gridDivisions, "#1E1E30", "#18182A");
    grid.position.y = 0.02;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.5;
    scene.add(grid);

    // ─── Building data ─────────────────────────────────────────
    const aspect = 1.5;
    const bWidth = Math.sqrt(footprint * aspect);
    const bDepth = footprint / bWidth;

    const isMixedUse =
      buildingType?.toLowerCase().includes("mixed") ||
      buildingType?.toLowerCase().includes("tower");

    const groundFloorH = 4.5; // commercial/retail height
    const typicalFloorH = floors > 1 ? (height - groundFloorH) / (floors - 1) : height;
    const floorGap = 0.15;

    // Podium config
    const hasPodium = isMixedUse && floors > 3;
    const podiumFloorCount = hasPodium ? Math.min(2, Math.floor(floors * 0.3)) : 0;
    const podiumWidthScale = 1.25;
    const podiumDepthScale = 1.15;

    // ─── Materials ─────────────────────────────────────────────
    // Glass-like building volume
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: "#4F8AFF",
      roughness: 0.08,
      metalness: 0.35,
      transparent: true,
      opacity: 0.35,
      envMapIntensity: 0.8,
      clearcoat: 0.3,
      clearcoatRoughness: 0.2,
      side: THREE.DoubleSide,
    });

    // Podium: slightly more opaque, darker
    const podiumMat = new THREE.MeshPhysicalMaterial({
      color: "#3A5A8C",
      roughness: 0.15,
      metalness: 0.25,
      transparent: true,
      opacity: 0.55,
      clearcoat: 0.2,
      side: THREE.DoubleSide,
    });

    // Floor slab edges — emissive accent
    const slabMat = new THREE.MeshBasicMaterial({
      color: "#4F8AFF",
      transparent: true,
      opacity: 0.12,
    });

    // Wireframe overlay material
    const wireMat = new THREE.LineBasicMaterial({
      color: "#7AB4FF",
      transparent: true,
      opacity: 0.45,
    });

    // Edge glow material
    const glowWireMat = new THREE.LineBasicMaterial({
      color: "#4F8AFF",
      transparent: true,
      opacity: 0.25,
    });

    // ─── Build floor plates ────────────────────────────────────
    const buildingGroup = new THREE.Group();

    let currentY = 0;

    for (let i = 0; i < floors; i++) {
      const isPodiumFloor = hasPodium && i < podiumFloorCount;
      const isGroundFloor = i === 0;

      const floorH = isGroundFloor ? groundFloorH : typicalFloorH;
      const fw = isPodiumFloor ? bWidth * podiumWidthScale : bWidth;
      const fd = isPodiumFloor ? bDepth * podiumDepthScale : bDepth;

      // Floor plate solid
      const plateGeo = new THREE.BoxGeometry(fw, floorH - floorGap, fd);
      const mat = isPodiumFloor ? podiumMat.clone() : glassMat.clone();

      // Slight color variation per floor for depth
      if (!isPodiumFloor) {
        const hueShift = (i / floors) * 0.06;
        const baseColor = new THREE.Color("#4F8AFF");
        baseColor.offsetHSL(hueShift, 0, -0.02 * (i / floors));
        mat.color = baseColor;
      }

      const plate = new THREE.Mesh(plateGeo, mat);
      plate.position.y = currentY + (floorH - floorGap) / 2;
      plate.castShadow = true;
      plate.receiveShadow = true;
      buildingGroup.add(plate);

      // Wireframe overlay per floor plate
      const edgeGeo = new THREE.EdgesGeometry(plateGeo);
      const wireframe = new THREE.LineSegments(edgeGeo, wireMat);
      wireframe.position.copy(plate.position);
      buildingGroup.add(wireframe);

      // Floor slab line at bottom of each floor (thin highlight)
      if (i > 0) {
        const slabThickness = 0.12;
        const slabGeo = new THREE.BoxGeometry(fw + 0.3, slabThickness, fd + 0.3);
        const slab = new THREE.Mesh(slabGeo, slabMat);
        slab.position.y = currentY + slabThickness / 2;
        buildingGroup.add(slab);
      }

      currentY += floorH;
    }

    // ─── Roof slab accent ──────────────────────────────────────
    const roofW = hasPodium ? bWidth : bWidth;
    const roofD = hasPodium ? bDepth : bDepth;
    const roofGeo = new THREE.BoxGeometry(roofW + 0.2, 0.15, roofD + 0.2);
    const roofMat = new THREE.MeshBasicMaterial({
      color: "#4F8AFF",
      transparent: true,
      opacity: 0.2,
    });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.y = currentY + 0.075;
    buildingGroup.add(roof);

    // Roof edge wireframe
    const roofEdgeGeo = new THREE.EdgesGeometry(roofGeo);
    const roofWire = new THREE.LineSegments(roofEdgeGeo, glowWireMat);
    roofWire.position.copy(roof.position);
    buildingGroup.add(roofWire);

    // ─── Overall bounding wireframe (subtle outer glow) ───────
    // Full building bounding box wireframe for silhouette read
    const fullH = currentY;
    const boundGeo = new THREE.BoxGeometry(bWidth + 0.05, fullH, bDepth + 0.05);
    const boundEdge = new THREE.EdgesGeometry(boundGeo);
    const boundWire = new THREE.LineSegments(boundEdge, glowWireMat.clone());
    (boundWire.material as THREE.LineBasicMaterial).opacity = 0.12;
    boundWire.position.y = fullH / 2;
    buildingGroup.add(boundWire);

    scene.add(buildingGroup);

    // ─── Site context hint — thin outline on ground ────────────
    const siteOutlineGeo = new THREE.EdgesGeometry(
      new THREE.PlaneGeometry(bWidth * podiumWidthScale + 6, bDepth * podiumDepthScale + 6)
    );
    const siteOutlineMat = new THREE.LineBasicMaterial({
      color: "#4F8AFF",
      transparent: true,
      opacity: 0.15,
    });
    const siteOutline = new THREE.LineSegments(siteOutlineGeo, siteOutlineMat);
    siteOutline.rotation.x = -Math.PI / 2;
    siteOutline.position.y = 0.03;
    scene.add(siteOutline);

    // ─── Environment map (simple procedural) ───────────────────
    // Create a minimal env map for reflections on the glass material
    const pmremGen = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color("#0E0E18");
    // Add a subtle light to the env scene
    envScene.add(new THREE.AmbientLight("#4466aa", 0.5));
    const envDir = new THREE.DirectionalLight("#ffffff", 0.8);
    envDir.position.set(1, 1, 1);
    envScene.add(envDir);
    const envTex = pmremGen.fromScene(envScene, 0.04).texture;
    scene.environment = envTex;
    pmremGen.dispose();

    // ─── Animate ───────────────────────────────────────────────
    function animate() {
      animFrameRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    // ─── Resize ────────────────────────────────────────────────
    const onResize = () => {
      if (!container) return;
      const nw = container.clientWidth;
      const nh = container.clientHeight;
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
      renderer.setSize(nw, nh);
    };
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(animFrameRef.current);
      controls.dispose();
      renderer.dispose();
      bgTex.dispose();
      envTex.dispose();
      scene.clear();
    };
  }, [floors, height, footprint, buildingType]);

  useEffect(() => {
    const cleanup = buildScene();
    return () => { cleanup?.(); };
  }, [buildScene]);

  return (
    <div style={{ position: "relative" }}>
      <div
        ref={containerRef}
        style={{
          width: "100%",
          aspectRatio: "16 / 10",
          minHeight: 200,
          maxHeight: 300,
          borderRadius: 10,
          overflow: "hidden",
          cursor: "grab",
          border: "1px solid rgba(79,138,255,0.08)",
        }}
      />
      <div style={{
        position: "absolute", bottom: 8, left: 10,
        fontSize: 9, color: "rgba(255,255,255,0.25)",
        pointerEvents: "none",
        letterSpacing: "0.02em",
      }}>
        Drag to orbit · Scroll to zoom
      </div>
    </div>
  );
}
