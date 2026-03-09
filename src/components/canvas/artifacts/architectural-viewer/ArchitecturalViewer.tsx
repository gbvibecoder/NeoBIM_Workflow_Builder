"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import type { ArchitecturalViewerProps, DoorMesh, RoomDef, BuildingStyle } from "./types";
import { createMaterials, disposeMaterials } from "./materials";
import { buildBuilding, getDefaultConfig, generateRoomsForBuilding } from "./building";
import { addFurniture } from "./furniture";

// ─── Control Mode ─────────────────────────────────────────────────────────────

type ViewMode = "orbit" | "firstperson";
type TimeOfDay = "day" | "sunset" | "night";

// ─── Component ────────────────────────────────────────────────────────────────

export default function ArchitecturalViewer({ floors, height, footprint, buildingType, rooms, style: styleProp }: ArchitecturalViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const animFrameRef = useRef<number>(0);
  const isVisibleRef = useRef(true);
  const lastRenderTimeRef = useRef(0);
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
    raycaster: THREE.Raycaster;
    minimapRenderer: THREE.WebGLRenderer | null;
    minimapCamera: THREE.OrthographicCamera | null;
    explodedOffset: number;
    sectionPlane: THREE.Plane;
    sectionEnabled: boolean;
    camDist: number;
    camHeight: number;
    bldgHeight: number;
    frameCount: number;
    lastXrayState: boolean;
    lastHoveredRoom: string | null;
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
  const [isLoading, setIsLoading] = useState(true);

  const viewModeRef = useRef(viewMode);
  const showLabelsRef = useRef(showLabels);
  const showMinimapRef = useRef(showMinimap);
  const isExplodedRef = useRef(isExploded);
  const isSectionRef = useRef(isSectionCut);
  const isXrayRef = useRef(isXray);

  useEffect(() => { viewModeRef.current = viewMode; }, [viewMode]);
  useEffect(() => { showLabelsRef.current = showLabels; }, [showLabels]);
  useEffect(() => { showMinimapRef.current = showMinimap; }, [showMinimap]);
  useEffect(() => { isExplodedRef.current = isExploded; }, [isExploded]);
  useEffect(() => { isSectionRef.current = isSectionCut; }, [isSectionCut]);
  useEffect(() => { isXrayRef.current = isXray; }, [isXray]);

  // Stable style ref to avoid unnecessary rebuilds
  const styleRef = useRef(styleProp);
  styleRef.current = styleProp;

  const buildScene = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    setIsLoading(true);

    // Cleanup previous scene thoroughly
    if (rendererRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      rendererRef.current.dispose();
    }
    if (sceneRef.current) {
      const { scene, minimapRenderer } = sceneRef.current;
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry?.dispose();
        }
      });
      scene.clear();
      minimapRenderer?.dispose();
      sceneRef.current = null;
    }
    while (container.firstChild) container.removeChild(container.firstChild);

    // Container must have real pixel dimensions — if not, retry after layout
    let w = container.clientWidth;
    let h = container.clientHeight;
    if (w === 0 || h === 0) {
      // Fallback: force minimum dimensions so scene always renders
      w = w || container.offsetWidth || 600;
      h = h || container.offsetHeight || 400;
      if (w === 0 || h === 0) {
        // Still zero — defer to next frame when layout is ready
        const retryId = requestAnimationFrame(() => {
          setIsLoading(true); // keep loading state
          buildScene();
        });
        return () => { cancelAnimationFrame(retryId); };
      }
    }

    // Everything below is wrapped in try-catch so errors never leave viewer stuck on loading
    let renderer: THREE.WebGLRenderer;
    let scene: THREE.Scene;
    let camera: THREE.PerspectiveCamera;
    let orbitControls: OrbitControls;
    let fpControls: PointerLockControls;
    let mats: ReturnType<typeof createMaterials>;
    let minimapRenderer: THREE.WebGLRenderer;
    let sectionPlane: THREE.Plane;
    let doors: DoorMesh[] = [];
    let roomLabels: THREE.Group = new THREE.Group();
    let buildingGroup: THREE.Group = new THREE.Group();
    let velocity: THREE.Vector3;
    let clock: THREE.Clock;

    // Event handler refs for cleanup
    let onKeyDown: ((e: KeyboardEvent) => void) | null = null;
    let onKeyUp: ((e: KeyboardEvent) => void) | null = null;
    let onMouseClick: ((e: MouseEvent) => void) | null = null;
    let onMouseMove: ((e: MouseEvent) => void) | null = null;
    let onResize: (() => void) | null = null;
    let resizeTimer: ReturnType<typeof setTimeout>;
    let hoverThrottleId: ReturnType<typeof setTimeout> | null = null;

    try {
    // ─── Renderer ──────────────────────────────────────────────
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "default",
    });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.shadowMap.enabled = false;
    renderer.localClippingEnabled = true;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // ─── Building dimensions (needed for camera/scene setup) ──
    const effectiveFloors = Math.max(1, Math.min(floors, 30));
    const floorH = styleProp?.floorHeightOverride ?? 3.6;
    const bldgHeight = effectiveFloors * floorH;
    const approxWidth = Math.sqrt(footprint * 1.5);
    const maxDimension = Math.max(bldgHeight, approxWidth);
    const camDist = Math.max(30, maxDimension * 1.8, bldgHeight * 1.5);
    const camHeight = Math.max(12, bldgHeight * 0.55, 8 + bldgHeight * 0.3);
    // Fog: push far enough that building is NEVER hidden at orbit distance
    const fogNear = Math.max(60, camDist * 2);
    const fogFar = Math.max(300, camDist * 6);

    // ─── Scene ─────────────────────────────────────────────────
    scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0x87CEEB, fogNear, fogFar);

    // Sky dome
    const skyGeo = new THREE.SphereGeometry(Math.max(200, camDist * 5), 32, 16);
    const skyMat = new THREE.MeshBasicMaterial({ side: THREE.BackSide });
    const skyMesh = new THREE.Mesh(skyGeo, skyMat);
    updateSkyColors(skyMat, "day");
    scene.add(skyMesh);

    // ─── Camera ─────────────────────────────────────────────────
    camera = new THREE.PerspectiveCamera(50, w / h, 0.1, Math.max(500, camDist * 4));
    camera.position.set(camDist, camHeight, camDist);
    camera.lookAt(0, bldgHeight * 0.4, 0);

    // ─── Controls ──────────────────────────────────────────────
    orbitControls = new OrbitControls(camera, renderer.domElement);
    orbitControls.enableDamping = true;
    orbitControls.dampingFactor = 0.06;
    orbitControls.rotateSpeed = 0.6;
    orbitControls.zoomSpeed = 0.8;
    orbitControls.panSpeed = 0.5;
    orbitControls.target.set(0, bldgHeight * 0.4, 0);
    orbitControls.maxPolarAngle = Math.PI / 2.05;
    orbitControls.minDistance = 5;
    orbitControls.maxDistance = Math.max(100, camDist * 2.5);
    orbitControls.autoRotate = true;
    orbitControls.autoRotateSpeed = 0.3;
    orbitControls.enablePan = true;

    fpControls = new PointerLockControls(camera, renderer.domElement);
    fpControls.addEventListener("lock", () => {
      orbitControls.enabled = false;
    });
    fpControls.addEventListener("unlock", () => {
      orbitControls.enabled = true;
    });

    // ─── Lighting ──────────────────────────────────────────────
    const ambientLight = new THREE.AmbientLight(0x8899AA, effectiveFloors > 10 ? 0.6 : 0.5);
    scene.add(ambientLight);

    const hemiLight = new THREE.HemisphereLight(0x87CEEB, 0x556633, 0.4);
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xFFEECC, 1.5);
    sunLight.position.set(25, Math.max(40, bldgHeight * 0.8), 20);
    scene.add(sunLight);

    const fillLight = new THREE.DirectionalLight(0xAABBDD, 0.3);
    fillLight.position.set(-20, Math.max(25, bldgHeight * 0.7), -10);
    scene.add(fillLight);

    // ─── Materials ─────────────────────────────────────────────
    mats = createMaterials();

    // ─── Building style (from prompt analysis) ────────────────
    const buildingStyle: BuildingStyle = styleRef.current ?? {
      glassHeavy: false,
      hasRiver: false,
      hasLake: false,
      isModern: true,
      isTower: floors >= 10,
      exteriorMaterial: "mixed",
      environment: "suburban",
      usage: "mixed",
      promptText: "",
      typology: "generic",
      facadePattern: "none",
      maxFloorCap: 30,
    };

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
      buildingRooms = generateRoomsForBuilding(floors, buildingStyle, footprint);
    }

    const config = { ...getDefaultConfig(buildingStyle), rooms: buildingRooms, floors: effectiveFloors };

    // ─── Build ─────────────────────────────────────────────────
    const buildResult = buildBuilding(config, mats, scene);
    doors = buildResult.doors;
    roomLabels = buildResult.roomLabels;
    buildingGroup = buildResult.buildingGroup;

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

    // Furniture — wrapped in its own try-catch so a furniture error doesn't kill the whole scene
    try {
      addFurniture(buildingRooms, centerX, centerZ, config.floorHeight, mats, buildingGroup);
    } catch (furnitureErr) {
      console.warn("[ArchitecturalViewer] Furniture generation failed, continuing without:", furnitureErr);
    }

    // ─── Minimap ───────────────────────────────────────────────
    const minimapSize = 160;
    minimapRenderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    minimapRenderer.setSize(minimapSize, minimapSize);
    minimapRenderer.setPixelRatio(1);
    minimapRenderer.domElement.style.cssText =
      "position:absolute;bottom:12px;right:12px;border-radius:10px;" +
      "border:2px solid rgba(255,255,255,0.2);pointer-events:none;" +
      "opacity:0;transition:opacity 0.5s ease;";
    container.appendChild(minimapRenderer.domElement);

    const bw = maxX - minX;
    const bd = maxZ - minZ;
    const mmS = Math.max(bw, bd, 10) * 0.8;
    const minimapCamera = new THREE.OrthographicCamera(-mmS, mmS, mmS, -mmS, 0.1, Math.max(200, bldgHeight + 50));
    minimapCamera.position.set(0, Math.max(50, bldgHeight + 20), 0);
    minimapCamera.lookAt(0, 0, 0);

    // ─── Section plane ─────────────────────────────────────────
    const sectionCutHeight = Math.max(config.floorHeight + 1.5, bldgHeight * 0.4);
    sectionPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), sectionCutHeight);

    // ─── Movement state ────────────────────────────────────────
    velocity = new THREE.Vector3();
    const moveState = {
      forward: false, backward: false, left: false, right: false,
    };

    onKeyDown = (e: KeyboardEvent) => {
      switch (e.code) {
        case "KeyW": case "ArrowUp": moveState.forward = true; break;
        case "KeyS": case "ArrowDown": moveState.backward = true; break;
        case "KeyA": case "ArrowLeft": moveState.left = true; break;
        case "KeyD": case "ArrowRight": moveState.right = true; break;
      }
    };
    onKeyUp = (e: KeyboardEvent) => {
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

    onMouseClick = (e: MouseEvent) => {
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

    // ─── Throttled hover detection ──────────────────────────────
    onMouseMove = (e: MouseEvent) => {
      if (viewModeRef.current !== "orbit" || hoverThrottleId) return;
      hoverThrottleId = setTimeout(() => { hoverThrottleId = null; }, 50);

      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);

      let foundRoom: string | null = null;
      for (const door of doors) {
        const intersects = raycaster.intersectObject(door.mesh, true);
        if (intersects.length > 0) {
          foundRoom = door.roomName;
          break;
        }
      }

      const sr = sceneRef.current;
      if (sr && sr.lastHoveredRoom !== foundRoom) {
        sr.lastHoveredRoom = foundRoom;
        setHoveredRoom(foundRoom);
        renderer.domElement.style.cursor = foundRoom ? "pointer" : "grab";
      }
    };
    renderer.domElement.addEventListener("mousemove", onMouseMove);

    // ─── Store refs ────────────────────────────────────────────
    clock = new THREE.Clock();
    sceneRef.current = {
      scene, camera, orbitControls, fpControls, doors, roomLabels, buildingGroup,
      sunLight, ambientLight, hemiLight, skyMesh, clock, velocity,
      raycaster, minimapRenderer, minimapCamera,
      explodedOffset: 0, sectionPlane, sectionEnabled: false,
      camDist, camHeight, bldgHeight,
      frameCount: 0, lastXrayState: false, lastHoveredRoom: null,
    };

    // ─── Cinematic intro ───────────────────────────────────────
    let introTime = 0;
    const introDuration = 3.0;
    const introStartPos = new THREE.Vector3(camDist * 1.4, camHeight * 1.2, camDist * 1.4);
    const introEndPos = new THREE.Vector3(camDist, camHeight, camDist);
    const introTarget = new THREE.Vector3(0, bldgHeight * 0.4, 0);
    camera.position.copy(introStartPos);

    // Fade minimap in after intro
    setTimeout(() => {
      if (minimapRenderer.domElement) minimapRenderer.domElement.style.opacity = "1";
    }, 800);

    // ─── Animate ───────────────────────────────────────────────
    const direction = new THREE.Vector3();
    const fpMoveSpeed = 6;

    // Target ~30 FPS (33ms per frame) instead of uncapped 60 FPS
    const TARGET_FRAME_MS = 33;

    function animate() {
      animFrameRef.current = requestAnimationFrame(animate);

      // Skip rendering when viewer is off-screen (IntersectionObserver)
      if (!isVisibleRef.current) return;

      // Throttle to ~30 FPS
      const now = performance.now();
      if (now - lastRenderTimeRef.current < TARGET_FRAME_MS) return;
      lastRenderTimeRef.current = now;

      const delta = Math.min(clock.getDelta(), 0.05);
      const sr = sceneRef.current;
      if (!sr) return;
      sr.frameCount++;

      // ─── Cinematic intro sweep ─────────────────────────────
      if (introTime < introDuration && !fpControls.isLocked) {
        introTime += delta;
        const t = Math.min(introTime / introDuration, 1);
        const ease = 1 - Math.pow(1 - t, 4);
        camera.position.lerpVectors(introStartPos, introEndPos, ease);
        camera.lookAt(introTarget);
        orbitControls.target.copy(introTarget);
      }

      // ─── First-person movement (smooth acceleration) ────────
      if (fpControls.isLocked) {
        const friction = 1 - Math.min(1, 10 * delta);
        velocity.x *= friction;
        velocity.z *= friction;

        direction.z = Number(moveState.forward) - Number(moveState.backward);
        direction.x = Number(moveState.right) - Number(moveState.left);
        direction.normalize();

        const accel = fpMoveSpeed * delta;
        if (moveState.forward || moveState.backward) velocity.z -= direction.z * accel;
        if (moveState.left || moveState.right) velocity.x -= direction.x * accel;

        fpControls.moveRight(-velocity.x);
        fpControls.moveForward(-velocity.z);

        camera.position.y = 1.7;
      }

      // ─── Door animation (smooth spring) ─────────────────────
      for (const door of doors) {
        const diff = door.targetAngle - door.currentAngle;
        if (Math.abs(diff) > 0.005) {
          door.currentAngle += diff * Math.min(1, 6 * delta);
          door.pivot.rotation.y = door.currentAngle;
        }
      }

      // ─── Room labels visibility ──────────────────────────
      roomLabels.visible = showLabelsRef.current && !fpControls.isLocked;

      // ─── Exploded view animation (gap scales with floor count) ──
      const explodeGap = Math.max(0.8, 4.0 - (effectiveFloors - 2) * 0.15);
      const targetExplode = isExplodedRef.current ? explodeGap : 0;
      const explodeDiff = targetExplode - sr.explodedOffset;
      if (Math.abs(explodeDiff) > 0.01) {
        sr.explodedOffset += explodeDiff * Math.min(1, 4 * delta);
        buildingGroup.traverse((child) => {
          if (child.userData.floor !== undefined) {
            child.position.y = child.userData.originalY + child.userData.floor * sr.explodedOffset;
          }
        });
      }

      // ─── Section cut ─────────────────────────────────────
      if (isSectionRef.current !== sr.sectionEnabled) {
        sr.sectionEnabled = isSectionRef.current;
        renderer.clippingPlanes = sr.sectionEnabled ? [sectionPlane] : [];
      }

      // ─── X-ray wireframe mode (only toggle on change) ───
      if (isXrayRef.current !== sr.lastXrayState) {
        sr.lastXrayState = isXrayRef.current;
        const wireframe = isXrayRef.current;
        buildingGroup.traverse((child) => {
          if (child instanceof THREE.Mesh && child.material) {
            const mat = child.material as THREE.Material & { wireframe?: boolean };
            if ("wireframe" in mat) mat.wireframe = wireframe;
          }
        });
      }

      // ─── Orbit controls update ───────────────────────────
      if (!fpControls.isLocked) {
        orbitControls.update();
      }

      // ─── Render ──────────────────────────────────────────
      renderer.render(scene, camera);

      // ─── Minimap (render every 15th frame for perf) ────────
      if (sr.minimapRenderer && sr.minimapCamera && showMinimapRef.current && sr.frameCount % 15 === 0) {
        sr.minimapRenderer.render(scene, sr.minimapCamera);
      }
      if (sr.minimapRenderer) {
        sr.minimapRenderer.domElement.style.display = showMinimapRef.current ? "block" : "none";
      }
    }
    animate();

    // ─── Resize (debounced) ─────────────────────────────────────
    onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        if (!container) return;
        const nw = container.clientWidth;
        const nh = container.clientHeight;
        if (nw === 0 || nh === 0) return;
        camera.aspect = nw / nh;
        camera.updateProjectionMatrix();
        renderer.setSize(nw, nh);
      }, 100);
    };
    window.addEventListener("resize", onResize);

    } catch (err) {
      console.error("[ArchitecturalViewer] Scene build failed:", err);
    } finally {
      // ALWAYS clear loading state so the canvas becomes visible
      setIsLoading(false);
    }

    // ─── Cleanup ───────────────────────────────────────────────
    return () => {
      if (onKeyDown) document.removeEventListener("keydown", onKeyDown);
      if (onKeyUp) document.removeEventListener("keyup", onKeyUp);
      if (onMouseClick && rendererRef.current) rendererRef.current.domElement.removeEventListener("click", onMouseClick);
      if (onMouseMove && rendererRef.current) rendererRef.current.domElement.removeEventListener("mousemove", onMouseMove);
      if (onResize) window.removeEventListener("resize", onResize);
      clearTimeout(resizeTimer!);
      if (hoverThrottleId) clearTimeout(hoverThrottleId);
      cancelAnimationFrame(animFrameRef.current);
      try {
        fpControls?.dispose();
        orbitControls?.dispose();
        scene?.traverse((obj) => {
          if (obj instanceof THREE.Mesh) obj.geometry?.dispose();
        });
        renderer!?.dispose();
        minimapRenderer!?.dispose();
        if (mats!) disposeMaterials(mats!);
        scene?.clear();
      } catch { /* cleanup errors are non-critical */ }
      sceneRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floors, height, footprint, buildingType]);

  useEffect(() => {
    const cleanup = buildScene();
    return () => { cleanup?.(); };
  }, [buildScene]);

  // ─── Pause rendering when viewer is off-screen ─────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      ([entry]) => { isVisibleRef.current = entry.isIntersecting; },
      { threshold: 0.05 }
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // ─── Time of Day Update ──────────────────────────────────────────
  useEffect(() => {
    const sr = sceneRef.current;
    if (!sr) return;

    const { sunLight, ambientLight, hemiLight, skyMesh, scene } = sr;
    const fogNear = Math.max(60, sr.camDist * 2);
    const fogFar = Math.max(300, sr.camDist * 6);

    switch (timeOfDay) {
      case "day":
        sunLight.color.set(0xFFEECC);
        sunLight.intensity = 1.5;
        sunLight.position.set(25, Math.max(40, sr.bldgHeight * 0.8), 20);
        ambientLight.color.set(0x8899AA);
        ambientLight.intensity = 0.5;
        hemiLight.color.set(0x87CEEB);
        hemiLight.groundColor.set(0x556633);
        scene.fog = new THREE.Fog(0x87CEEB, fogNear, fogFar);
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
        scene.fog = new THREE.Fog(0xFF9966, fogNear, fogFar);
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
        scene.fog = new THREE.Fog(0x0A0A1A, Math.max(30, fogNear * 0.4), Math.max(100, fogFar * 0.4));
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
      sr.camera.position.set(0, 1.7, 2);
      sr.fpControls.lock();
      sr.orbitControls.autoRotate = false;
    } else {
      setViewMode("orbit");
      sr.fpControls.unlock();
      sr.camera.position.set(sr.camDist, sr.camHeight, sr.camDist);
      sr.orbitControls.target.set(0, sr.bldgHeight * 0.4, 0);
      sr.orbitControls.autoRotate = true;
    }
  }, [viewMode]);

  // ─── Fullscreen ──────────────────────────────────────────────────
  const toggleFullscreen = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    if (!isFullscreen) {
      container.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }, [isFullscreen]);

  useEffect(() => {
    const onFSChange = () => {
      const isFull = !!document.fullscreenElement;
      setIsFullscreen(isFull);
      // Debounced resize
      setTimeout(() => {
        const sr = sceneRef.current;
        const container = containerRef.current;
        if (sr && container && rendererRef.current) {
          const nw = container.clientWidth;
          const nh = container.clientHeight;
          if (nw > 0 && nh > 0) {
            sr.camera.aspect = nw / nh;
            sr.camera.updateProjectionMatrix();
            rendererRef.current.setSize(nw, nh);
          }
        }
      }, 150);
    };
    document.addEventListener("fullscreenchange", onFSChange);
    return () => document.removeEventListener("fullscreenchange", onFSChange);
  }, []);

  return (
    <div style={{ position: "relative", width: "100%", height: isFullscreen ? "100vh" : 420 }}>
      {/* Loading overlay */}
      {isLoading && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 20,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          background: "#0D0D1A",
          borderRadius: isFullscreen ? 0 : 12,
        }}>
          <div style={{
            width: 36, height: 36, border: "3px solid rgba(79,138,255,0.2)",
            borderTopColor: "#4F8AFF", borderRadius: "50%",
            animation: "viewer-spin 0.8s linear infinite",
          }} />
          <div style={{ marginTop: 12, fontSize: 11, color: "rgba(255,255,255,0.4)", letterSpacing: "0.05em" }}>
            Building 3D scene...
          </div>
        </div>
      )}

      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: isFullscreen ? "100vh" : 420,
          borderRadius: isFullscreen ? 0 : 12,
          overflow: "hidden",
          cursor: viewMode === "orbit" ? "grab" : "crosshair",
          background: "#0D0D1A",
          opacity: isLoading ? 0 : 1,
          transition: "opacity 0.4s ease",
        }}
      />

      {/* ─── UI Overlay ────────────────────────────────────── */}
      {!isLoading && (
        <div style={{
          position: "absolute", top: 10, left: 10,
          display: "flex", flexDirection: "column", gap: 6,
          pointerEvents: "none",
          animation: "viewer-fade-in 0.6s ease 0.3s both",
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
      )}

      {/* Right side controls */}
      {!isLoading && (
        <div style={{
          position: "absolute", top: 10, right: 10,
          display: "flex", flexDirection: "column", gap: 6,
          alignItems: "flex-end",
          pointerEvents: "none",
          animation: "viewer-fade-in 0.6s ease 0.5s both",
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
      )}

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
      {viewMode === "orbit" && !hoveredRoom && !isLoading && (
        <div style={{
          position: "absolute", bottom: 8, left: 10,
          fontSize: 9, color: "rgba(255,255,255,0.3)",
          pointerEvents: "none",
        }}>
          Drag to orbit · Scroll to zoom · Click doors to open
        </div>
      )}

      {/* Keyframe animations */}
      <style>{`
        @keyframes viewer-spin {
          to { transform: rotate(360deg); }
        }
        @keyframes viewer-fade-in {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
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

  if (time === "night") {
    for (let i = 0; i < 200; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 300;
      const size = 0.5 + Math.random() * 1.5;
      const brightness = 0.3 + Math.random() * 0.7;
      ctx.fillStyle = `rgba(255, 255, 255, ${brightness})`;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }
    const moonGrad = ctx.createRadialGradient(100, 80, 0, 100, 80, 20);
    moonGrad.addColorStop(0, "rgba(255, 255, 230, 0.9)");
    moonGrad.addColorStop(0.5, "rgba(255, 255, 220, 0.5)");
    moonGrad.addColorStop(1, "rgba(255, 255, 200, 0)");
    ctx.fillStyle = moonGrad;
    ctx.fillRect(80, 60, 40, 40);
  }

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
