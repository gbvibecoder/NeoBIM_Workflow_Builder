"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import type { ArchitecturalViewerProps, DoorMesh, RoomDef } from "./types";
import { createMaterials, disposeMaterials } from "./materials";
import { buildBuilding, getDefaultConfig, getDefaultRooms } from "./building";
import { addFurniture } from "./furniture";

// ─── Control Mode ─────────────────────────────────────────────────────────────

type ViewMode = "orbit" | "firstperson";
type TimeOfDay = "day" | "sunset" | "night";

// ─── Component ────────────────────────────────────────────────────────────────

export default function ArchitecturalViewer({ floors, height, footprint, buildingType, rooms }: ArchitecturalViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const animFrameRef = useRef<number>(0);
  const sceneRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    orbitControls: OrbitControls;
    fpControls: PointerLockControls;
    doors: DoorMesh[];
    roomLabels: THREE.Group;
    buildingGroup: THREE.Group;
    sunLight: THREE.DirectionalLight;
    ambientLight: THREE.AmbientLight;
    hemiLight: THREE.HemisphereLight;
    skyMesh: THREE.Mesh;
    clock: THREE.Clock;
    velocity: THREE.Vector3;
    moveForward: boolean;
    moveBackward: boolean;
    moveLeft: boolean;
    moveRight: boolean;
    raycaster: THREE.Raycaster;
    minimapRenderer: THREE.WebGLRenderer | null;
    minimapCamera: THREE.OrthographicCamera | null;
    explodedOffset: number;
    sectionPlane: THREE.Plane;
    sectionEnabled: boolean;
  } | null>(null);

  const [viewMode, setViewMode] = useState<ViewMode>("orbit");
  const [timeOfDay, setTimeOfDay] = useState<TimeOfDay>("day");
  const [showLabels, setShowLabels] = useState(true);
  const [showMinimap, setShowMinimap] = useState(true);
  const [isExploded, setIsExploded] = useState(false);
  const [isSectionCut, setIsSectionCut] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isXray, setIsXray] = useState(false);
  const [hoveredRoom, setHoveredRoom] = useState<string | null>(null);

  const viewModeRef = useRef(viewMode);
  const timeRef = useRef(timeOfDay);
  const showLabelsRef = useRef(showLabels);
  const showMinimapRef = useRef(showMinimap);
  const isExplodedRef = useRef(isExploded);
  const isSectionRef = useRef(isSectionCut);
  const isXrayRef = useRef(isXray);

  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);
  useEffect(() => { timeRef.current = timeOfDay; }, [timeOfDay]);
  useEffect(() => { showLabelsRef.current = showLabels; }, [showLabels]);
  useEffect(() => { showMinimapRef.current = showMinimap; }, [showMinimap]);
  useEffect(() => { isExplodedRef.current = isExploded; }, [isExploded]);
  useEffect(() => { isSectionRef.current = isSectionCut; }, [isSectionCut]);
  useEffect(() => { isXrayRef.current = isXray; }, [isXray]);

  const buildScene = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    // Cleanup
    if (rendererRef.current) {
      rendererRef.current.dispose();
      cancelAnimationFrame(animFrameRef.current);
      while (container.firstChild) container.removeChild(container.firstChild);
    }

    const w = container.clientWidth;
    const h = container.clientHeight;

    // ─── Renderer ──────────────────────────────────────────────
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
    renderer.toneMappingExposure = 1.2;
    renderer.localClippingEnabled = true;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // ─── Scene ─────────────────────────────────────────────────
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x87CEEB, 40, 120);

    // Sky dome
    const skyGeo = new THREE.SphereGeometry(100, 32, 16);
    const skyMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide });
    const skyMesh = new THREE.Mesh(skyGeo, skyMat);
    updateSkyColors(skyMat, "day");
    scene.add(skyMesh);

    // ─── Camera ────────────────────────────────────────────────
    const camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 200);
    camera.position.set(20, 15, 25);
    camera.lookAt(0, 3, 0);

    // ─── Controls ──────────────────────────────────────────────
    const orbitControls = new OrbitControls(camera, renderer.domElement);
    orbitControls.enableDamping = true;
    orbitControls.dampingFactor = 0.08;
    orbitControls.target.set(0, 3, 0);
    orbitControls.maxPolarAngle = Math.PI / 2.05;
    orbitControls.minDistance = 5;
    orbitControls.maxDistance = 50;
    orbitControls.autoRotate = true;
    orbitControls.autoRotateSpeed = 0.4;

    const fpControls = new PointerLockControls(camera, renderer.domElement);
    fpControls.addEventListener("lock", () => {
      orbitControls.enabled = false;
    });
    fpControls.addEventListener("unlock", () => {
      orbitControls.enabled = true;
    });

    // ─── Lighting ──────────────────────────────────────────────
    const ambientLight = new THREE.AmbientLight(0x8899AA, 0.5);
    scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0x87CEEB, 0x556633, 0.4);
    scene.add(hemiLight);

    // Sun
    const sunLight = new THREE.DirectionalLight(0xFFEECC, 1.5);
    sunLight.position.set(25, 40, 20);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.setScalar(2048);
    sunLight.shadow.camera.near = 0.5;
    sunLight.shadow.camera.far = 100;
    const shadowSize = 25;
    sunLight.shadow.camera.left = -shadowSize;
    sunLight.shadow.camera.right = shadowSize;
    sunLight.shadow.camera.top = shadowSize;
    sunLight.shadow.camera.bottom = -shadowSize;
    sunLight.shadow.bias = -0.0005;
    sunLight.shadow.normalBias = 0.02;
    scene.add(sunLight);

    // Fill light
    const fillLight = new THREE.DirectionalLight(0xAABBDD, 0.3);
    fillLight.position.set(-20, 25, -10);
    scene.add(fillLight);

    // ─── Materials ─────────────────────────────────────────────
    const mats = createMaterials();

    // ─── Building config ───────────────────────────────────────
    let buildingRooms: RoomDef[];
    if (rooms && rooms.length > 0 && rooms.some(r => r.x !== undefined)) {
      buildingRooms = rooms.map(r => ({
        name: r.name,
        x: r.x ?? 0,
        z: r.z ?? 0,
        width: r.width ?? Math.sqrt(r.area),
        depth: r.depth ?? Math.sqrt(r.area),
        floor: 0,
        type: (r.type as RoomDef["type"]) ?? "living",
      }));
    } else {
      buildingRooms = getDefaultRooms();
    }

    const config = { ...getDefaultConfig(), rooms: buildingRooms, floors: Math.min(floors, 2) };

    // ─── Build ─────────────────────────────────────────────────
    const { doors, roomLabels, buildingGroup } = buildBuilding(config, mats, scene);

    // Find building center for furniture
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const room of buildingRooms) {
      minX = Math.min(minX, room.x);
      minZ = Math.min(minZ, room.z);
      maxX = Math.max(maxX, room.x + room.width);
      maxZ = Math.max(maxZ, room.z + room.depth);
    }
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;

    addFurniture(buildingRooms, centerX, centerZ, config.floorHeight, mats, buildingGroup);

    // ─── Environment map ───────────────────────────────────────
    const pmremGen = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x87CEEB);
    envScene.add(new THREE.AmbientLight(0xFFFFFF, 0.8));
    const envDir = new THREE.DirectionalLight(0xFFFFFF, 1);
    envDir.position.set(1, 2, 1);
    envScene.add(envDir);
    const envTex = pmremGen.fromScene(envScene, 0.04).texture;
    scene.environment = envTex;
    pmremGen.dispose();

    // ─── Minimap ───────────────────────────────────────────────
    const minimapSize = 180;
    const minimapRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    minimapRenderer.setSize(minimapSize, minimapSize);
    minimapRenderer.setPixelRatio(1);
    minimapRenderer.domElement.style.position = "absolute";
    minimapRenderer.domElement.style.bottom = "12px";
    minimapRenderer.domElement.style.right = "12px";
    minimapRenderer.domElement.style.borderRadius = "10px";
    minimapRenderer.domElement.style.border = "2px solid rgba(255,255,255,0.2)";
    minimapRenderer.domElement.style.pointerEvents = "none";
    container.appendChild(minimapRenderer.domElement);

    const bw = maxX - minX;
    const bd = maxZ - minZ;
    const mmS = Math.max(bw, bd) * 0.8;
    const minimapCamera = new THREE.OrthographicCamera(-mmS, mmS, mmS, -mmS, 0.1, 100);
    minimapCamera.position.set(0, 30, 0);
    minimapCamera.lookAt(0, 0, 0);

    // ─── Section plane ─────────────────────────────────────────
    const sectionPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), config.floorHeight + 1.5);

    // ─── Movement state ────────────────────────────────────────
    const velocity = new THREE.Vector3();
    const moveState = {
      forward: false, backward: false, left: false, right: false,
    };

    const onKeyDown = (e: KeyboardEvent) => {
      switch (e.code) {
        case "KeyW": case "ArrowUp": moveState.forward = true; break;
        case "KeyS": case "ArrowDown": moveState.backward = true; break;
        case "KeyA": case "ArrowLeft": moveState.left = true; break;
        case "KeyD": case "ArrowRight": moveState.right = true; break;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      switch (e.code) {
        case "KeyW": case "ArrowUp": moveState.forward = false; break;
        case "KeyS": case "ArrowDown": moveState.backward = false; break;
        case "KeyA": case "ArrowLeft": moveState.left = false; break;
        case "KeyD": case "ArrowRight": moveState.right = false; break;
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);

    // ─── Door click interaction ────────────────────────────────
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const onMouseClick = (e: MouseEvent) => {
      if (viewModeRef.current !== "orbit") return;
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);

      for (const door of doors) {
        const intersects = raycaster.intersectObject(door.mesh, true);
        if (intersects.length > 0) {
          door.isOpen = !door.isOpen;
          door.targetAngle = door.isOpen ? -Math.PI / 2 : 0;
          break;
        }
      }
    };
    renderer.domElement.addEventListener("click", onMouseClick);

    // ─── Hover detection ───────────────────────────────────────
    const onMouseMove = (e: MouseEvent) => {
      if (viewModeRef.current !== "orbit") return;
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);

      let found = false;
      for (const door of doors) {
        const intersects = raycaster.intersectObject(door.mesh, true);
        if (intersects.length > 0) {
          setHoveredRoom(door.roomName);
          renderer.domElement.style.cursor = "pointer";
          found = true;
          break;
        }
      }
      if (!found) {
        setHoveredRoom(null);
        renderer.domElement.style.cursor = viewModeRef.current === "orbit" ? "grab" : "crosshair";
      }
    };
    renderer.domElement.addEventListener("mousemove", onMouseMove);

    // ─── Store refs ────────────────────────────────────────────
    const clock = new THREE.Clock();
    sceneRef.current = {
      scene, camera, orbitControls, fpControls, doors, roomLabels, buildingGroup,
      sunLight, ambientLight, hemiLight, skyMesh, clock, velocity,
      moveForward: false, moveBackward: false, moveLeft: false, moveRight: false,
      raycaster, minimapRenderer, minimapCamera,
      explodedOffset: 0, sectionPlane, sectionEnabled: false,
    };

    // ─── Cinematic intro ───────────────────────────────────────
    let introTime = 0;
    const introDuration = 3.5; // seconds
    const introStartPos = new THREE.Vector3(35, 20, 35);
    const introEndPos = new THREE.Vector3(20, 15, 25);
    const introTarget = new THREE.Vector3(0, 3, 0);
    camera.position.copy(introStartPos);

    // ─── Animate ───────────────────────────────────────────────
    const direction = new THREE.Vector3();
    const fpMoveSpeed = 5;

    function animate() {
      animFrameRef.current = requestAnimationFrame(animate);
      const delta = Math.min(clock.getDelta(), 0.1);
      const sr = sceneRef.current;
      if (!sr) return;

      // ─── Cinematic intro sweep ─────────────────────────────
      if (introTime < introDuration && !fpControls.isLocked) {
        introTime += delta;
        const t = Math.min(introTime / introDuration, 1);
        // Smooth ease-out
        const ease = 1 - Math.pow(1 - t, 3);
        camera.position.lerpVectors(introStartPos, introEndPos, ease);
        camera.lookAt(introTarget);
        orbitControls.target.copy(introTarget);
      }

      // ─── First-person movement ───────────────────────────
      if (fpControls.isLocked) {
        velocity.x -= velocity.x * 8 * delta;
        velocity.z -= velocity.z * 8 * delta;

        direction.z = Number(moveState.forward) - Number(moveState.backward);
        direction.x = Number(moveState.right) - Number(moveState.left);
        direction.normalize();

        if (moveState.forward || moveState.backward) velocity.z -= direction.z * fpMoveSpeed * delta;
        if (moveState.left || moveState.right) velocity.x -= direction.x * fpMoveSpeed * delta;

        fpControls.moveRight(-velocity.x * delta * 10);
        fpControls.moveForward(-velocity.z * delta * 10);

        // Keep camera at eye height
        camera.position.y = 1.7;
      }

      // ─── Door animation ──────────────────────────────────
      for (const door of doors) {
        if (Math.abs(door.currentAngle - door.targetAngle) > 0.01) {
          door.currentAngle += (door.targetAngle - door.currentAngle) * 5 * delta;
          door.pivot.rotation.y = door.currentAngle;
        }
      }

      // ─── Room labels visibility ──────────────────────────
      roomLabels.visible = showLabelsRef.current && !fpControls.isLocked;

      // ─── Exploded view animation ─────────────────────────
      const targetExplode = isExplodedRef.current ? 4.0 : 0;
      sr.explodedOffset += (targetExplode - sr.explodedOffset) * 3 * delta;
      buildingGroup.traverse((child) => {
        if (child.userData.floor !== undefined) {
          child.position.y = child.userData.originalY + child.userData.floor * sr.explodedOffset;
        }
      });

      // ─── Section cut ─────────────────────────────────────
      if (isSectionRef.current !== sr.sectionEnabled) {
        sr.sectionEnabled = isSectionRef.current;
        renderer.clippingPlanes = sr.sectionEnabled ? [sectionPlane] : [];
      }

      // ─── X-ray wireframe mode ──────────────────────────
      buildingGroup.traverse((child) => {
        if (child instanceof THREE.Mesh && child.material) {
          const mat = child.material as THREE.Material & { wireframe?: boolean };
          if ("wireframe" in mat) {
            mat.wireframe = isXrayRef.current;
          }
        }
      });

      // ─── Orbit controls update ───────────────────────────
      if (!fpControls.isLocked) {
        orbitControls.update();
      }

      // ─── Render ──────────────────────────────────────────
      renderer.render(scene, camera);

      // ─── Minimap ─────────────────────────────────────────
      if (sr.minimapRenderer && sr.minimapCamera) {
        sr.minimapRenderer.domElement.style.display = showMinimapRef.current ? "block" : "none";
        if (showMinimapRef.current) {
          sr.minimapRenderer.render(scene, sr.minimapCamera);
        }
      }
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

    // ─── Cleanup ───────────────────────────────────────────────
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      renderer.domElement.removeEventListener("click", onMouseClick);
      renderer.domElement.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(animFrameRef.current);
      fpControls.dispose();
      orbitControls.dispose();
      renderer.dispose();
      minimapRenderer?.dispose();
      envTex.dispose();
      disposeMaterials(mats);
      scene.clear();
      sceneRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floors, height, footprint, buildingType]);

  useEffect(() => {
    const cleanup = buildScene();
    return () => { cleanup?.(); };
  }, [buildScene]);

  // ─── Time of Day Update ──────────────────────────────────────────
  useEffect(() => {
    const sr = sceneRef.current;
    if (!sr) return;

    const { sunLight, ambientLight, hemiLight, skyMesh, scene } = sr;

    switch (timeOfDay) {
      case "day":
        sunLight.color.set(0xFFEECC);
        sunLight.intensity = 1.5;
        sunLight.position.set(25, 40, 20);
        ambientLight.color.set(0x8899AA);
        ambientLight.intensity = 0.5;
        hemiLight.color.set(0x87CEEB);
        hemiLight.groundColor.set(0x556633);
        scene.fog = new THREE.Fog(0x87CEEB, 40, 120);
        updateSkyColors((skyMesh.material as THREE.MeshBasicMaterial), "day");
        if (rendererRef.current) rendererRef.current.toneMappingExposure = 1.2;
        break;
      case "sunset":
        sunLight.color.set(0xFF8844);
        sunLight.intensity = 1.2;
        sunLight.position.set(35, 10, 15);
        ambientLight.color.set(0x664433);
        ambientLight.intensity = 0.4;
        hemiLight.color.set(0xFF7744);
        hemiLight.groundColor.set(0x332211);
        scene.fog = new THREE.Fog(0xFF9966, 40, 120);
        updateSkyColors((skyMesh.material as THREE.MeshBasicMaterial), "sunset");
        if (rendererRef.current) rendererRef.current.toneMappingExposure = 1.0;
        break;
      case "night":
        sunLight.color.set(0x4466AA);
        sunLight.intensity = 0.3;
        sunLight.position.set(-15, 20, -20);
        ambientLight.color.set(0x112244);
        ambientLight.intensity = 0.2;
        hemiLight.color.set(0x223355);
        hemiLight.groundColor.set(0x111122);
        scene.fog = new THREE.Fog(0x0A0A1A, 20, 80);
        updateSkyColors((skyMesh.material as THREE.MeshBasicMaterial), "night");
        if (rendererRef.current) rendererRef.current.toneMappingExposure = 0.6;
        break;
    }
  }, [timeOfDay]);

  // ─── View Mode Toggle ────────────────────────────────────────────
  const toggleViewMode = useCallback(() => {
    const sr = sceneRef.current;
    if (!sr) return;

    if (viewMode === "orbit") {
      setViewMode("firstperson");
      // Position camera inside the building
      sr.camera.position.set(0, 1.7, 2);
      sr.fpControls.lock();
      sr.orbitControls.autoRotate = false;
    } else {
      setViewMode("orbit");
      sr.fpControls.unlock();
      sr.camera.position.set(20, 15, 25);
      sr.orbitControls.target.set(0, 3, 0);
      sr.orbitControls.autoRotate = true;
    }
  }, [viewMode]);

  // ─── Fullscreen ──────────────────────────────────────────────────
  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!isFullscreen) {
      container.requestFullscreen?.();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setIsFullscreen(false);
    }
  }, [isFullscreen]);

  useEffect(() => {
    const onFSChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
      // Trigger resize
      setTimeout(() => {
        const sr = sceneRef.current;
        const container = containerRef.current;
        if (sr && container && rendererRef.current) {
          const nw = container.clientWidth;
          const nh = container.clientHeight;
          sr.camera.aspect = nw / nh;
          sr.camera.updateProjectionMatrix();
          rendererRef.current.setSize(nw, nh);
        }
      }, 100);
    };
    document.addEventListener("fullscreenchange", onFSChange);
    return () => document.removeEventListener("fullscreenchange", onFSChange);
  }, []);

  return (
    <div style={{ position: "relative" }}>
      <div
        ref={containerRef}
        style={{
          width: "100%",
          aspectRatio: isFullscreen ? undefined : "16 / 9",
          minHeight: isFullscreen ? "100vh" : 320,
          maxHeight: isFullscreen ? "100vh" : 500,
          borderRadius: isFullscreen ? 0 : 12,
          overflow: "hidden",
          cursor: viewMode === "orbit" ? "grab" : "crosshair",
          background: "#0D0D1A",
        }}
      />

      {/* ─── UI Overlay ────────────────────────────────────── */}
      <div style={{
        position: "absolute", top: 10, left: 10,
        display: "flex", flexDirection: "column", gap: 6,
        pointerEvents: "none",
      }}>
        {/* View mode toggle */}
        <div style={{ display: "flex", gap: 4, pointerEvents: "all" }}>
          <ToolbarBtn
            active={viewMode === "orbit"}
            onClick={() => { if (viewMode !== "orbit") toggleViewMode(); }}
            label="Orbit"
          />
          <ToolbarBtn
            active={viewMode === "firstperson"}
            onClick={() => { if (viewMode !== "firstperson") toggleViewMode(); }}
            label="Walk"
          />
        </div>

        {/* Time of day */}
        <div style={{ display: "flex", gap: 4, pointerEvents: "all" }}>
          <ToolbarBtn active={timeOfDay === "day"} onClick={() => setTimeOfDay("day")} label="Day" />
          <ToolbarBtn active={timeOfDay === "sunset"} onClick={() => setTimeOfDay("sunset")} label="Sunset" />
          <ToolbarBtn active={timeOfDay === "night"} onClick={() => setTimeOfDay("night")} label="Night" />
        </div>

        {/* Feature toggles */}
        <div style={{ display: "flex", gap: 4, pointerEvents: "all" }}>
          <ToolbarBtn active={showLabels} onClick={() => setShowLabels(v => !v)} label="Labels" />
          <ToolbarBtn active={showMinimap} onClick={() => setShowMinimap(v => !v)} label="Map" />
          <ToolbarBtn active={isExploded} onClick={() => setIsExploded(v => !v)} label="Explode" />
          <ToolbarBtn active={isSectionCut} onClick={() => setIsSectionCut(v => !v)} label="Section" />
          <ToolbarBtn active={isXray} onClick={() => setIsXray(v => !v)} label="X-Ray" />
        </div>
      </div>

      {/* Right side controls */}
      <div style={{
        position: "absolute", top: 10, right: 10,
        display: "flex", flexDirection: "column", gap: 6,
        alignItems: "flex-end",
        pointerEvents: "none",
      }}>
        <div style={{ pointerEvents: "all" }}>
          <ToolbarBtn active={isFullscreen} onClick={toggleFullscreen} label={isFullscreen ? "Exit" : "Full"} />
        </div>

        {/* Building info badge */}
        <div style={{
          background: "rgba(0,0,0,0.55)",
          backdropFilter: "blur(10px)",
          borderRadius: 8,
          padding: "8px 12px",
          border: "1px solid rgba(255,255,255,0.08)",
          pointerEvents: "none",
        }}>
          <div style={{ fontSize: 8, color: "rgba(255,255,255,0.35)", textTransform: "uppercase" as const, letterSpacing: "0.1em", marginBottom: 4 }}>
            Building Info
          </div>
          <div style={{ fontSize: 11, color: "#E0E0EA", fontWeight: 600 }}>
            {floors}F · {height.toFixed(1)}m · {footprint} m²
          </div>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
            {buildingType ?? "Mixed-Use"} · GFA {Math.round(floors * footprint * 0.98).toLocaleString()} m²
          </div>
        </div>
      </div>

      {/* Hovered room info */}
      {hoveredRoom && (
        <div style={{
          position: "absolute", bottom: isFullscreen ? 20 : 12, left: "50%",
          transform: "translateX(-50%)",
          padding: "6px 16px",
          background: "rgba(0,0,0,0.7)",
          backdropFilter: "blur(10px)",
          borderRadius: 8,
          fontSize: 12,
          color: "#FFFFFF",
          fontWeight: 600,
          pointerEvents: "none",
          whiteSpace: "nowrap",
        }}>
          Click to open door: {hoveredRoom}
        </div>
      )}

      {/* First person instructions */}
      {viewMode === "firstperson" && (
        <div style={{
          position: "absolute", bottom: isFullscreen ? 20 : 12, left: "50%",
          transform: "translateX(-50%)",
          padding: "8px 20px",
          background: "rgba(0,0,0,0.7)",
          backdropFilter: "blur(10px)",
          borderRadius: 8,
          fontSize: 11,
          color: "rgba(255,255,255,0.7)",
          pointerEvents: "none",
          whiteSpace: "nowrap",
        }}>
          WASD to move · Mouse to look · ESC to exit walkthrough
        </div>
      )}

      {/* Bottom hint */}
      {viewMode === "orbit" && !hoveredRoom && (
        <div style={{
          position: "absolute", bottom: 8, left: 10,
          fontSize: 9, color: "rgba(255,255,255,0.3)",
          pointerEvents: "none",
        }}>
          Drag to orbit · Scroll to zoom · Click doors to open
        </div>
      )}
    </div>
  );
}

// ─── Toolbar Button ───────────────────────────────────────────────────────────

function ToolbarBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "4px 10px",
        borderRadius: 6,
        background: active ? "rgba(79,138,255,0.25)" : "rgba(0,0,0,0.5)",
        border: `1px solid ${active ? "rgba(79,138,255,0.5)" : "rgba(255,255,255,0.15)"}`,
        color: active ? "#7AB4FF" : "rgba(255,255,255,0.5)",
        fontSize: 10,
        fontWeight: 600,
        cursor: "pointer",
        backdropFilter: "blur(10px)",
        transition: "all 0.15s ease",
        letterSpacing: "0.02em",
      }}
    >
      {label}
    </button>
  );
}

// ─── Sky Color Helper ─────────────────────────────────────────────────────────

function updateSkyColors(mat: THREE.MeshBasicMaterial, time: TimeOfDay) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createLinearGradient(0, 0, 0, 512);

  switch (time) {
    case "day":
      grad.addColorStop(0, "#1A6BCC");
      grad.addColorStop(0.3, "#4A9BE8");
      grad.addColorStop(0.6, "#87CEEB");
      grad.addColorStop(1, "#B8E0F0");
      break;
    case "sunset":
      grad.addColorStop(0, "#1A1A4A");
      grad.addColorStop(0.2, "#4A2266");
      grad.addColorStop(0.4, "#CC4444");
      grad.addColorStop(0.6, "#FF8844");
      grad.addColorStop(0.8, "#FFCC66");
      grad.addColorStop(1, "#FFEE88");
      break;
    case "night":
      grad.addColorStop(0, "#050510");
      grad.addColorStop(0.3, "#0A0A20");
      grad.addColorStop(0.6, "#111133");
      grad.addColorStop(1, "#1A1A3A");
      break;
  }

  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 512, 512);

  // Stars for night sky
  if (time === "night") {
    for (let i = 0; i < 200; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 300; // Mostly upper portion
      const size = 0.5 + Math.random() * 1.5;
      const brightness = 0.3 + Math.random() * 0.7;
      ctx.fillStyle = `rgba(255, 255, 255, ${brightness})`;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }
    // Moon
    const moonGrad = ctx.createRadialGradient(100, 80, 0, 100, 80, 20);
    moonGrad.addColorStop(0, "rgba(255, 255, 230, 0.9)");
    moonGrad.addColorStop(0.5, "rgba(255, 255, 220, 0.5)");
    moonGrad.addColorStop(1, "rgba(255, 255, 200, 0)");
    ctx.fillStyle = moonGrad;
    ctx.fillRect(80, 60, 40, 40);
  }

  // Clouds for day/sunset
  if (time === "day" || time === "sunset") {
    const cloudColor = time === "day" ? "rgba(255,255,255,0.15)" : "rgba(255,200,150,0.12)";
    for (let i = 0; i < 6; i++) {
      const cx = Math.random() * 512;
      const cy = 100 + Math.random() * 150;
      ctx.fillStyle = cloudColor;
      for (let j = 0; j < 5; j++) {
        const r = 20 + Math.random() * 30;
        ctx.beginPath();
        ctx.arc(cx + (j - 2) * 18, cy + (Math.random() - 0.5) * 10, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  if (mat.map) mat.map.dispose();
  const tex = new THREE.CanvasTexture(canvas);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  mat.map = tex;
  mat.needsUpdate = true;
}
