"use client";

import React, { useRef, useEffect, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { X, FileDown } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Room {
  name: string;
  area: number;
  type?: string;
}

interface LayoutRoom extends Room {
  x: number;
  y: number;
  width: number;
  depth: number;
}

export interface PostExecutionSceneProps {
  rooms?: Room[];
  buildingDescription?: string;
  kpis?: { floors?: number; gfa?: number; height?: number; footprint?: number };
  buildingName?: string;
  onClose: () => void;
  onGeneratePDF?: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const FLOOR_MATS: Record<string, { color: string; roughness: number }> = {
  living:   { color: "#c4a882", roughness: 0.4 },
  kitchen:  { color: "#e8e4dc", roughness: 0.3 },
  bathroom: { color: "#d4dce4", roughness: 0.2 },
  bedroom:  { color: "#b8a890", roughness: 0.9 },
  hallway:  { color: "#d0ccc4", roughness: 0.5 },
  office:   { color: "#c4a882", roughness: 0.4 },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp01(v: number) { return Math.max(0, Math.min(1, v)); }
function smoothstep(t: number) { return t * t * (3 - 2 * t); }
function easeOutCubic(t: number) { return 1 - Math.pow(1 - t, 3); }
function easeOutBack(t: number) {
  const c1 = 1.70158, c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function getRoomType(name: string, explicitType?: string): string {
  if (explicitType) {
    const l = explicitType.toLowerCase();
    if (FLOOR_MATS[l]) return l;
  }
  const l = name.toLowerCase();
  if (l.includes("living") || l.includes("lounge") || l.includes("balcony")) return "living";
  if (l.includes("bed") || l.includes("master")) return "bedroom";
  if (l.includes("kitchen") || l.includes("dining")) return "kitchen";
  if (l.includes("bath") || l.includes("wc") || l.includes("toilet")) return "bathroom";
  if (l.includes("hall") || l.includes("corridor") || l.includes("lobby") || l.includes("storage") || l.includes("utility") || l.includes("server")) return "hallway";
  if (l.includes("office") || l.includes("meeting") || l.includes("reception") || l.includes("study") || l.includes("work")) return "office";
  return "living";
}

// ─── Generate rooms from KPIs when no room data ──────────────────────────────

function generateRoomsFromKPIs(floors: number, gfa: number, buildingType: string = ""): Room[] {
  const floorArea = gfa / Math.max(floors, 1);
  const bt = buildingType.toLowerCase();

  if (bt.includes("residential") || bt.includes("apartment")) {
    return [
      { name: "Living Room", area: floorArea * 0.25, type: "living" },
      { name: "Kitchen", area: floorArea * 0.12, type: "kitchen" },
      { name: "Master Bedroom", area: floorArea * 0.18, type: "bedroom" },
      { name: "Bedroom 2", area: floorArea * 0.14, type: "bedroom" },
      { name: "Bathroom", area: floorArea * 0.08, type: "bathroom" },
      { name: "Hallway", area: floorArea * 0.10, type: "hallway" },
      { name: "Balcony", area: floorArea * 0.08, type: "living" },
      { name: "Storage", area: floorArea * 0.05, type: "hallway" },
    ];
  }
  if (bt.includes("office")) {
    return [
      { name: "Open Office", area: floorArea * 0.40, type: "office" },
      { name: "Meeting Room", area: floorArea * 0.15, type: "living" },
      { name: "Reception", area: floorArea * 0.12, type: "hallway" },
      { name: "Kitchen", area: floorArea * 0.08, type: "kitchen" },
      { name: "Bathroom", area: floorArea * 0.06, type: "bathroom" },
      { name: "Server Room", area: floorArea * 0.05, type: "hallway" },
      { name: "CEO Office", area: floorArea * 0.10, type: "office" },
      { name: "Corridor", area: floorArea * 0.04, type: "hallway" },
    ];
  }
  return [
    { name: "Main Hall", area: floorArea * 0.30, type: "living" },
    { name: "Room A", area: floorArea * 0.20, type: "bedroom" },
    { name: "Room B", area: floorArea * 0.15, type: "office" },
    { name: "Kitchen", area: floorArea * 0.10, type: "kitchen" },
    { name: "Bathroom", area: floorArea * 0.08, type: "bathroom" },
    { name: "Corridor", area: floorArea * 0.10, type: "hallway" },
    { name: "Utility", area: floorArea * 0.07, type: "hallway" },
  ];
}

// ─── Layout generator (rectangular grid — rooms tile a clean footprint) ──────

function generateLayout(rooms: Room[]): LayoutRoom[] {
  if (rooms.length === 0) return [];
  const totalArea = rooms.reduce((s, r) => s + r.area, 0);
  const aspect = 1.5; // width:depth ratio
  const buildingWidth = Math.sqrt(totalArea * aspect);
  const buildingDepth = totalArea / buildingWidth;

  const cols = Math.ceil(Math.sqrt(rooms.length * 1.5));
  const rows = Math.ceil(rooms.length / cols);
  const cellWidth = buildingWidth / cols;
  const cellDepth = buildingDepth / rows;

  const offsetX = buildingWidth / 2;
  const offsetY = buildingDepth / 2;

  return rooms.map((room, i) => ({
    ...room,
    x: (i % cols) * cellWidth - offsetX,
    y: Math.floor(i / cols) * cellDepth - offsetY,
    width: cellWidth,
    depth: cellDepth,
  }));
}

// ─── Wall segment builder (with yOffset for multi-floor) ─────────────────────

function buildWallSegments(
  x: number, z: number, length: number, wallHeight: number, thickness: number,
  axis: "x" | "z", isExterior: boolean,
  yOffset: number,
  group: THREE.Group, wallArr: THREE.Mesh[], windowArr: THREE.Mesh[],
  extMat: THREE.MeshStandardMaterial, intMat: THREE.MeshStandardMaterial,
  glassMat: THREE.MeshPhysicalMaterial, frameMat: THREE.MeshStandardMaterial,
) {
  const mat = isExterior ? extMat : intMat;
  const slabTop = yOffset + 0.15;
  const isGroundFloor = yOffset < 0.1;
  const hasDoor = isGroundFloor && (isExterior || Math.random() > 0.5);
  const doorWidth = 0.9, doorHeight = 2.1, doorPos = length * 0.3;
  const windowWidth = 1.2, windowHeight = 1.4, windowSillH = 0.8;

  // Evenly space windows along exterior walls
  const windowSpacing = 2.8;
  const hasWindow = isExterior && length > 2.5;

  if (!hasDoor && !hasWindow) {
    const geo = axis === "x"
      ? new THREE.BoxGeometry(length, wallHeight, thickness)
      : new THREE.BoxGeometry(thickness, wallHeight, length);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x + (axis === "x" ? length / 2 : 0), 0, z + (axis === "z" ? length / 2 : 0));
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.scale.y = 0;
    mesh.userData = { baseY: slabTop, wallH: wallHeight };
    group.add(mesh); wallArr.push(mesh);
    return;
  }

  interface Opening { pos: number; width: number; height: number; sill: number; type: "door" | "window" }
  const openings: Opening[] = [];
  if (hasDoor && doorPos + doorWidth / 2 < length && doorPos - doorWidth / 2 > 0)
    openings.push({ pos: doorPos, width: doorWidth, height: doorHeight, sill: 0, type: "door" });

  // Distribute windows evenly along wall
  if (hasWindow) {
    const numWindows = Math.max(1, Math.floor(length / windowSpacing));
    const step = length / (numWindows + 1);
    for (let wi = 0; wi < numWindows; wi++) {
      const wp = step * (wi + 1);
      if (wp - windowWidth / 2 > 0.3 && wp + windowWidth / 2 < length - 0.3) {
        // Avoid overlapping with door
        const overlapsDoor = openings.some(o => Math.abs(o.pos - wp) < (o.width / 2 + windowWidth / 2 + 0.2));
        if (!overlapsDoor) {
          openings.push({ pos: wp, width: windowWidth, height: windowHeight, sill: windowSillH, type: "window" });
        }
      }
    }
  }
  openings.sort((a, b) => a.pos - b.pos);

  const segments: Array<{ start: number; end: number }> = [];
  let segStart = 0;

  for (const o of openings) {
    const oStart = o.pos - o.width / 2, oEnd = o.pos + o.width / 2;
    if (oStart > segStart + 0.1) segments.push({ start: segStart, end: oStart });

    // Lintel above opening
    const lintelH = wallHeight - o.sill - o.height;
    if (lintelH > 0.05) {
      const lintelGeo = axis === "x"
        ? new THREE.BoxGeometry(o.width, lintelH, thickness)
        : new THREE.BoxGeometry(thickness, lintelH, o.width);
      const lintel = new THREE.Mesh(lintelGeo, mat);
      lintel.position.set(axis === "x" ? x + o.pos : x, 0, axis === "z" ? z + o.pos : z);
      lintel.castShadow = true; lintel.scale.y = 0;
      lintel.userData = { baseY: yOffset + o.sill + o.height, wallH: lintelH };
      group.add(lintel); wallArr.push(lintel);
    }

    // Sill wall below window
    if (o.type === "window" && o.sill > 0.05) {
      const sillGeo = axis === "x"
        ? new THREE.BoxGeometry(o.width, o.sill, thickness)
        : new THREE.BoxGeometry(thickness, o.sill, o.width);
      const sillWall = new THREE.Mesh(sillGeo, mat);
      sillWall.position.set(axis === "x" ? x + o.pos : x, 0, axis === "z" ? z + o.pos : z);
      sillWall.castShadow = true; sillWall.scale.y = 0;
      sillWall.userData = { baseY: slabTop, wallH: o.sill };
      group.add(sillWall); wallArr.push(sillWall);
    }

    // Window glass
    if (o.type === "window") {
      const gGeo = axis === "x"
        ? new THREE.BoxGeometry(o.width - 0.06, o.height - 0.06, 0.03)
        : new THREE.BoxGeometry(0.03, o.height - 0.06, o.width - 0.06);
      const glass = new THREE.Mesh(gGeo, glassMat.clone());
      glass.position.set(axis === "x" ? x + o.pos : x, yOffset + o.sill + o.height / 2, axis === "z" ? z + o.pos : z);
      (glass.material as THREE.MeshPhysicalMaterial).opacity = 0;
      group.add(glass); windowArr.push(glass);

      const fGeo = axis === "x"
        ? new THREE.BoxGeometry(o.width, o.height, 0.04)
        : new THREE.BoxGeometry(0.04, o.height, o.width);
      const frame = new THREE.Mesh(fGeo, frameMat.clone());
      frame.position.copy(glass.position);
      (frame.material as THREE.MeshStandardMaterial).opacity = 0;
      (frame.material as THREE.MeshStandardMaterial).transparent = true;
      group.add(frame); windowArr.push(frame);
    }

    // Door
    if (o.type === "door") {
      const dMat = new THREE.MeshStandardMaterial({ color: "#8B6914", roughness: 0.6, metalness: 0.1, transparent: true, opacity: 0 });
      const dGeo = axis === "x"
        ? new THREE.BoxGeometry(o.width - 0.1, o.height - 0.05, 0.05)
        : new THREE.BoxGeometry(0.05, o.height - 0.05, o.width - 0.1);
      const door = new THREE.Mesh(dGeo, dMat);
      door.position.set(axis === "x" ? x + o.pos : x + 0.04, yOffset + o.height / 2, axis === "z" ? z + o.pos : z + 0.04);
      group.add(door); windowArr.push(door);
    }

    segStart = oEnd;
  }

  if (segStart < length - 0.1) segments.push({ start: segStart, end: length });

  for (const seg of segments) {
    const segLen = seg.end - seg.start;
    if (segLen < 0.05) continue;
    const geo = axis === "x"
      ? new THREE.BoxGeometry(segLen, wallHeight, thickness)
      : new THREE.BoxGeometry(thickness, wallHeight, segLen);
    const mesh = new THREE.Mesh(geo, mat);
    const segMid = seg.start + segLen / 2;
    mesh.position.set(axis === "x" ? x + segMid : x, 0, axis === "z" ? z + segMid : z);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.scale.y = 0;
    mesh.userData = { baseY: slabTop, wallH: wallHeight };
    group.add(mesh); wallArr.push(mesh);
  }
}

// ─── Furniture builder ───────────────────────────────────────────────────────

function addFurniture(room: LayoutRoom, yOffset: number, group: THREE.Group, meshes: THREE.Mesh[]) {
  const rt = getRoomType(room.name, room.type);
  const rx = room.x, rz = room.y, rw = room.width, rd = room.depth;
  const floorY = yOffset + 0.16;

  const box = (w: number, h: number, d: number, px: number, py: number, pz: number) => {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshStandardMaterial({ color: "#333333", roughness: 0.7, metalness: 0.1, transparent: true, opacity: 0 });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(px, py, pz);
    m.castShadow = true;
    group.add(m);
    meshes.push(m);
  };

  switch (rt) {
    case "living":
      box(Math.min(rw * 0.5, 2), 0.6, 0.8, rx + rw * 0.3, floorY + 0.3, rz + rd * 0.8);
      box(0.8, 0.3, 0.5, rx + rw * 0.3, floorY + 0.15, rz + rd * 0.55);
      break;
    case "bedroom":
      box(Math.min(rw * 0.6, 1.4), 0.4, Math.min(rd * 0.6, 2.0), rx + rw * 0.5, floorY + 0.2, rz + rd * 0.4);
      box(0.4, 0.4, 0.4, rx + rw * 0.15, floorY + 0.2, rz + rd * 0.3);
      break;
    case "kitchen":
      box(Math.min(rw * 0.8, 2.5), 0.9, 0.6, rx + rw * 0.5, floorY + 0.45, rz + 0.5);
      break;
    case "bathroom":
      box(Math.min(rw * 0.4, 1.6), 0.5, Math.min(rd * 0.35, 0.7), rx + rw * 0.7, floorY + 0.25, rz + rd * 0.7);
      box(0.5, 0.4, 0.4, rx + rw * 0.3, floorY + 0.2, rz + 0.4);
      break;
    case "office":
      box(Math.min(rw * 0.5, 1.2), 0.75, 0.6, rx + rw * 0.5, floorY + 0.375, rz + rd * 0.5);
      box(0.4, 0.4, 0.4, rx + rw * 0.5, floorY + 0.2, rz + rd * 0.7);
      break;
  }
}

// ─── Tree builder ────────────────────────────────────────────────────────────

function createTree(x: number, z: number): THREE.Group {
  const tree = new THREE.Group();
  const trunkGeo = new THREE.CylinderGeometry(0.15, 0.2, 1.5, 8);
  const trunkMat = new THREE.MeshStandardMaterial({ color: "#5c4033", roughness: 0.8 });
  const trunk = new THREE.Mesh(trunkGeo, trunkMat);
  trunk.position.y = 0.75; trunk.castShadow = true;
  tree.add(trunk);

  const canopyGeo = new THREE.SphereGeometry(1.0, 12, 10);
  const canopyMat = new THREE.MeshStandardMaterial({ color: "#2d5a27", roughness: 0.8 });
  const canopy = new THREE.Mesh(canopyGeo, canopyMat);
  canopy.position.y = 2.2; canopy.scale.set(1, 0.7, 1); canopy.castShadow = true;
  tree.add(canopy);

  tree.position.set(x, 0, z);
  tree.scale.setScalar(0);
  return tree;
}

// ─── Floor timing for phased construction ────────────────────────────────────

function getFloorTiming(f: number): { start: number; duration: number } {
  if (f === 0) return { start: 2000, duration: 2500 };
  if (f === 1) return { start: 5000, duration: 2500 };
  return { start: 8000 + (f - 2) * 1500, duration: 1200 };
}

// ─── Module-level refs for Three.js (survive React re-renders) ───────────────
let globalCamera: THREE.PerspectiveCamera | null = null;
let globalControls: OrbitControls | null = null;

// ─── Main Component ──────────────────────────────────────────────────────────

export default function PostExecutionScene({
  rooms,
  buildingDescription,
  kpis,
  buildingName,
  onClose,
  onGeneratePDF,
}: PostExecutionSceneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const animFrameRef = useRef<number>(0);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const sceneDataRef = useRef<{ totalHeight: number; centerX: number; centerZ: number }>({ totalHeight: 10, centerX: 0, centerZ: 0 });

  const buildScene = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    if (rendererRef.current) {
      rendererRef.current.dispose();
      cancelAnimationFrame(animFrameRef.current);
      container.innerHTML = "";
    }

    const w = container.clientWidth, h = container.clientHeight;
    if (w === 0 || h === 0) return;

    // ── Process rooms ─────────────────────────────────────
    let processedRooms: Room[] = rooms ?? [];
    if (processedRooms.length === 0 && kpis) {
      processedRooms = generateRoomsFromKPIs(
        kpis.floors ?? 1,
        kpis.gfa ?? 500,
        buildingDescription ?? ""
      );
    }
    if (processedRooms.length === 0) {
      processedRooms = generateRoomsFromKPIs(3, 1200, "");
    }

    const laidRooms = generateLayout(processedRooms);

    // ── Multi-floor params ────────────────────────────────
    const numFloors = Math.max(kpis?.floors ?? 3, 1);
    const floorHeight = kpis?.height
      ? kpis.height / numFloors
      : 3.5;
    const totalHeight = numFloors * floorHeight;
    const wallThickness = 0.15;

    // Building bounds (footprint)
    const minX = Math.min(...laidRooms.map(r => r.x));
    const maxX = Math.max(...laidRooms.map(r => r.x + r.width));
    const minZ = Math.min(...laidRooms.map(r => r.y));
    const maxZ = Math.max(...laidRooms.map(r => r.y + r.depth));
    const buildingW = maxX - minX, buildingD = maxZ - minZ;
    const centerX = (minX + maxX) / 2, centerZ = (minZ + maxZ) / 2;
    const maxDim = Math.max(buildingW, buildingD, totalHeight);

    // ── Renderer ──────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setClearColor(0x070809, 1);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // ── Scene ─────────────────────────────────────────────
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#070809");
    scene.fog = new THREE.Fog("#070809", 60, 200);

    // ── Camera (zoomed out to show entire building) ────────
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 500);
    const topDownPos = new THREE.Vector3(centerX, 50, centerZ + 0.01);
    const perspectivePos = new THREE.Vector3(
      centerX + 40,
      30,
      centerZ + 40
    );
    camera.position.copy(topDownPos);
    camera.lookAt(new THREE.Vector3(centerX, totalHeight / 2, centerZ));
    cameraRef.current = camera;
    globalCamera = camera;
    sceneDataRef.current = { totalHeight, centerX, centerZ };

    // ── Controls (enabled from start — full orbit/zoom/pan) ─
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableRotate = true;
    controls.enableZoom = true;
    controls.enablePan = true;
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = Math.PI;
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(centerX, totalHeight / 2, centerZ);
    controls.minDistance = 10;
    controls.maxDistance = 150;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.5;
    controls.enabled = true;
    controlsRef.current = controls;
    globalControls = controls;

    // ── Lighting (starts dim) ─────────────────────────────
    const ambient = new THREE.AmbientLight("#f0f0ff", 0.2);
    scene.add(ambient);
    const hemi = new THREE.HemisphereLight("#7ec8e3", "#3d2b1f", 0);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight("#fff5e0", 0);
    sun.position.set(centerX + 15, totalHeight + 10, centerZ + 12);
    sun.castShadow = true;
    sun.shadow.mapSize.setScalar(2048);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 80;
    sun.shadow.radius = 4;
    const sExt = Math.max(maxDim, totalHeight) * 1.5;
    sun.shadow.camera.left = -sExt;
    sun.shadow.camera.right = sExt;
    sun.shadow.camera.top = sExt;
    sun.shadow.camera.bottom = -sExt;
    sun.shadow.bias = -0.001;
    scene.add(sun);

    const fillLight = new THREE.DirectionalLight("#aabbdd", 0);
    fillLight.position.set(centerX - 15, totalHeight * 0.5, centerZ - 10);
    scene.add(fillLight);

    // ── Ground (fades in) ─────────────────────────────────
    const groundGeo = new THREE.PlaneGeometry(80, 80);
    const groundMat = new THREE.MeshStandardMaterial({
      color: "#2a3a2a", roughness: 0.9, metalness: 0.05,
      transparent: true, opacity: 0,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(centerX, -0.02, centerZ);
    ground.receiveShadow = true;
    scene.add(ground);

    const grid = new THREE.GridHelper(80, 80, "#3a3a3a", "#2d2d2d");
    grid.position.set(centerX, 0.01, centerZ);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0;
    scene.add(grid);

    // ── Materials ─────────────────────────────────────────
    const groundFloorExtMat = new THREE.MeshStandardMaterial({ color: "#e8ddd0", roughness: 0.8, metalness: 0.02 });
    const upperFloorExtMat = new THREE.MeshStandardMaterial({ color: "#f0ece4", roughness: 0.8, metalness: 0.02 });
    const topFloorExtMat = new THREE.MeshStandardMaterial({ color: "#f4f0ea", roughness: 0.75, metalness: 0.02 });
    const intWallMat = new THREE.MeshStandardMaterial({ color: "#f8f6f0", roughness: 0.7, metalness: 0.02 });
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: "#88ccff", roughness: 0.05, metalness: 0.1,
      transparent: true, opacity: 0, transmission: 0.6, ior: 1.5,
    });
    const frameMat = new THREE.MeshStandardMaterial({
      color: "#2a2a2a", roughness: 0.3, metalness: 0.9,
      transparent: true, opacity: 0,
    });
    const slabMat = new THREE.MeshStandardMaterial({ color: "#d0ccc4", roughness: 0.9, metalness: 0.02 });

    // ── Shared geometries ─────────────────────────────────
    const slabGeo = new THREE.BoxGeometry(buildingW + 0.4, 0.15, buildingD + 0.4);

    // ── Per-floor mesh tracking ───────────────────────────
    const buildingGroup = new THREE.Group();
    const floorSlabs: THREE.Mesh[] = [];
    const floorRoomWalls: THREE.Mesh[][][] = []; // [floor][room][walls]
    const floorAllWindows: THREE.Mesh[][] = []; // [floor][windows]
    const floorRoomFloors: THREE.Mesh[][] = []; // [floor][room floor planes]
    const allFurnitureMeshes: THREE.Mesh[] = [];
    const labelSprites: THREE.Sprite[] = [];

    // ── Build each floor ──────────────────────────────────
    for (let f = 0; f < numFloors; f++) {
      const yOffset = f * floorHeight;
      const roomWallsThisFloor: THREE.Mesh[][] = [];
      const windowsThisFloor: THREE.Mesh[] = [];
      const roomFloorsThisFloor: THREE.Mesh[] = [];

      // Floor slab
      const slab = new THREE.Mesh(slabGeo, slabMat.clone());
      slab.position.set(centerX, yOffset + 0.075, centerZ);
      slab.castShadow = true; slab.receiveShadow = true;
      slab.scale.y = f === 0 ? 1 : 0; // ground slab visible from start
      buildingGroup.add(slab);
      floorSlabs.push(slab);

      // Choose exterior material based on floor
      const extMat = f === 0
        ? groundFloorExtMat
        : f === numFloors - 1
          ? topFloorExtMat
          : upperFloorExtMat;

      // Build rooms on this floor
      for (let ri = 0; ri < laidRooms.length; ri++) {
        const room = laidRooms[ri];
        const rx = room.x, rz = room.y, rw = room.width, rd = room.depth;

        // Colored room floor
        const roomType = getRoomType(room.name, room.type);
        const floorCfg = FLOOR_MATS[roomType] ?? FLOOR_MATS.living;
        const floorGeo = new THREE.PlaneGeometry(rw - 0.02, rd - 0.02);
        const floorMatInst = new THREE.MeshStandardMaterial({
          color: floorCfg.color, roughness: floorCfg.roughness,
          metalness: 0.02, side: THREE.DoubleSide,
          transparent: true, opacity: f === 0 ? 1 : 0,
        });
        const floorMesh = new THREE.Mesh(floorGeo, floorMatInst);
        floorMesh.rotation.x = -Math.PI / 2;
        floorMesh.position.set(rx + rw / 2, yOffset + 0.16, rz + rd / 2);
        floorMesh.receiveShadow = true;
        buildingGroup.add(floorMesh);
        roomFloorsThisFloor.push(floorMesh);

        // Walls for this room on this floor
        const thisRoomWalls: THREE.Mesh[] = [];
        const isTop = Math.abs(rz - minZ) < 0.3;
        const isBottom = Math.abs((rz + rd) - maxZ) < 0.3;
        const isLeft = Math.abs(rx - minX) < 0.3;
        const isRight = Math.abs((rx + rw) - maxX) < 0.3;

        buildWallSegments(rx, rz, rw, floorHeight, wallThickness, "x", isTop, yOffset,
          buildingGroup, thisRoomWalls, windowsThisFloor, extMat, intWallMat, glassMat, frameMat);
        buildWallSegments(rx, rz + rd, rw, floorHeight, wallThickness, "x", isBottom, yOffset,
          buildingGroup, thisRoomWalls, windowsThisFloor, extMat, intWallMat, glassMat, frameMat);
        buildWallSegments(rx, rz, rd, floorHeight, wallThickness, "z", isLeft, yOffset,
          buildingGroup, thisRoomWalls, windowsThisFloor, extMat, intWallMat, glassMat, frameMat);
        buildWallSegments(rx + rw, rz, rd, floorHeight, wallThickness, "z", isRight, yOffset,
          buildingGroup, thisRoomWalls, windowsThisFloor, extMat, intWallMat, glassMat, frameMat);

        roomWallsThisFloor.push(thisRoomWalls);

        // Furniture and labels only on ground floor
        if (f === 0) {
          addFurniture(room, yOffset, buildingGroup, allFurnitureMeshes);

          // Label sprite
          const labelCanvas = document.createElement("canvas");
          labelCanvas.width = 256; labelCanvas.height = 128;
          const ctx = labelCanvas.getContext("2d")!;
          ctx.clearRect(0, 0, 256, 128);
          ctx.fillStyle = "rgba(0,0,0,0.55)";
          const bw = 240, bh = 100, bx = 8, by = 14, br = 12;
          ctx.beginPath();
          ctx.moveTo(bx + br, by);
          ctx.lineTo(bx + bw - br, by);
          ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + br);
          ctx.lineTo(bx + bw, by + bh - br);
          ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - br, by + bh);
          ctx.lineTo(bx + br, by + bh);
          ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - br);
          ctx.lineTo(bx, by + br);
          ctx.quadraticCurveTo(bx, by, bx + br, by);
          ctx.closePath();
          ctx.fill();

          ctx.fillStyle = "#ffffff";
          ctx.font = "bold 22px -apple-system, sans-serif";
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          let displayName = room.name;
          if (displayName.length > 16) displayName = displayName.slice(0, 14) + "...";
          ctx.fillText(displayName, 128, 50);
          ctx.fillStyle = "rgba(255,255,255,0.7)";
          ctx.font = "18px -apple-system, sans-serif";
          ctx.fillText(`${Math.round(room.area)} m\u00B2`, 128, 82);

          const labelTex = new THREE.CanvasTexture(labelCanvas);
          const spriteMat = new THREE.SpriteMaterial({ map: labelTex, transparent: true, opacity: 0, depthTest: false });
          const sprite = new THREE.Sprite(spriteMat);
          const spriteScale = Math.max(rw, rd) * 0.5;
          sprite.scale.set(spriteScale, spriteScale * 0.5, 1);
          sprite.position.set(rx + rw / 2, 0.5, rz + rd / 2);
          buildingGroup.add(sprite);
          labelSprites.push(sprite);
        }
      }

      floorRoomWalls.push(roomWallsThisFloor);
      floorAllWindows.push(windowsThisFloor);
      floorRoomFloors.push(roomFloorsThisFloor);
    }

    // ── Roof ──────────────────────────────────────────────
    const roofGeo = new THREE.BoxGeometry(buildingW + 0.6, 0.12, buildingD + 0.6);
    const roofMat = new THREE.MeshStandardMaterial({
      color: "#d0ccc4", roughness: 0.8, metalness: 0.05, transparent: true, opacity: 0,
    });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.set(centerX, totalHeight + 0.06, centerZ);
    roof.castShadow = true;
    buildingGroup.add(roof);
    scene.add(buildingGroup);

    // ── Trees ─────────────────────────────────────────────
    const trees: THREE.Group[] = [];
    const treePositions: [number, number][] = [
      [centerX + buildingW * 0.8, centerZ + buildingD * 0.6],
      [centerX - buildingW * 0.7, centerZ + buildingD * 0.5],
      [centerX + buildingW * 0.5, centerZ - buildingD * 0.8],
      [centerX - buildingW * 0.6, centerZ - buildingD * 0.7],
    ];
    for (const [tx, tz] of treePositions) {
      const tree = createTree(tx, tz);
      scene.add(tree);
      trees.push(tree);
    }

    // ── Environment map ───────────────────────────────────
    const pmremGen = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color("#0E0E18");
    envScene.add(new THREE.AmbientLight("#4466aa", 0.5));
    const envDir = new THREE.DirectionalLight("#ffffff", 0.8);
    envDir.position.set(1, 1, 1);
    envScene.add(envDir);
    const envTex = pmremGen.fromScene(envScene, 0.04).texture;
    scene.environment = envTex;
    pmremGen.dispose();

    // ── Compute final timing ──────────────────────────────
    const lastFloorTiming = getFloorTiming(numFloors - 1);
    const allFloorsEnd = lastFloorTiming.start + lastFloorTiming.duration;
    const roofStartMs = allFloorsEnd + 500;
    const envStartMs = allFloorsEnd - 500;
    const settledMs = roofStartMs + 2500;

    // ── Animation loop ────────────────────────────────────
    const startTime = performance.now();
    let controlsEnabled = false;

    function animate() {
      animFrameRef.current = requestAnimationFrame(animate);
      const elapsed = performance.now() - startTime;

      // ─ Phase 1 (0-2s): Top-down view, ground floor room floors + labels fade in ─
      const phase1Progress = clamp01(elapsed / 2000);

      // ─ Camera transition: top-down → perspective ─
      const camTransEnd = Math.min(allFloorsEnd * 0.8, 10000);
      const camProgress = clamp01((elapsed - 1500) / (camTransEnd - 1500));
      const camEased = smoothstep(camProgress);

      // Only override camera while the intro animation is still playing.
      // Once camProgress reaches 1 the transition is done — stop overriding
      // so OrbitControls, zoom buttons, and rotation all work.
      if (camProgress > 0 && camProgress < 1) {
        camera.position.lerpVectors(topDownPos, perspectivePos, camEased);
        const lookAtY = THREE.MathUtils.lerp(0, totalHeight * 0.35, camEased);
        camera.lookAt(new THREE.Vector3(centerX, lookAtY, centerZ));
        controls.target.set(centerX, lookAtY, centerZ);
      }

      // ─ Per-floor construction animation ─
      for (let f = 0; f < numFloors; f++) {
        const { start, duration } = getFloorTiming(f);
        const floorProgress = clamp01((elapsed - start) / duration);
        const eased = easeOutCubic(floorProgress);
        const yOffset = f * floorHeight;

        // Slab (ground slab already visible; upper slabs animate in)
        if (f > 0) {
          floorSlabs[f].scale.y = eased;
        }

        // Room floor planes for upper floors fade in
        if (f > 0) {
          floorRoomFloors[f].forEach(mesh => {
            (mesh.material as THREE.MeshStandardMaterial).opacity = eased;
          });
        }

        // Walls per room, staggered — each piece uses its own baseY/wallH
        floorRoomWalls[f].forEach((roomWalls, ri) => {
          const stagger = ri * 80;
          const roomProg = clamp01((elapsed - start - stagger) / (duration * 0.8));
          const roomEased = easeOutCubic(roomProg);
          roomWalls.forEach(wall => {
            wall.scale.y = roomEased;
            const { baseY, wallH } = wall.userData;
            wall.position.y = baseY + (wallH * roomEased) / 2;
          });
        });

        // Windows fade in at end of floor build (70% progress)
        const winProg = clamp01((floorProgress - 0.7) / 0.3);
        floorAllWindows[f].forEach(w => {
          if (w.material instanceof THREE.MeshPhysicalMaterial) {
            w.material.opacity = winProg * 0.6;
          } else if (w.material instanceof THREE.MeshStandardMaterial) {
            w.material.opacity = winProg;
          }
        });
      }

      // ─ Labels (ground floor only) ─
      const labelOpacity = phase1Progress;
      const labelY = THREE.MathUtils.lerp(0.5, floorHeight + 0.8, camEased);
      labelSprites.forEach(s => {
        s.position.y = labelY;
        (s.material as THREE.SpriteMaterial).opacity = labelOpacity;
      });

      // ─ Furniture (ground floor, fade in during ground floor build) ─
      const furnitureProgress = clamp01((elapsed - 3500) / 1500);
      allFurnitureMeshes.forEach(m => {
        (m.material as THREE.MeshStandardMaterial).opacity = furnitureProgress * 0.6;
      });

      // ─ Roof (after all floors) ─
      const roofProgress = clamp01((elapsed - roofStartMs) / 2000);
      roofMat.opacity = roofProgress * 0.85;

      // ─ Environment (lighting, ground, trees) ─
      const envProgress = clamp01((elapsed - envStartMs) / 2500);
      sun.intensity = envProgress * 1.5;
      fillLight.intensity = envProgress * 0.3;
      ambient.intensity = 0.2 + envProgress * 0.3;
      hemi.intensity = envProgress * 0.4;
      groundMat.opacity = envProgress;
      (grid.material as THREE.Material).opacity = envProgress * 0.3;

      // Trees pop in after environment
      const treeStartMs = envStartMs + 1000;
      trees.forEach((tree, i) => {
        const tp = clamp01((elapsed - treeStartMs - i * 200) / 500);
        tree.scale.setScalar(tp > 0 ? easeOutBack(tp) : 0);
      });

      // ─ Settled: update orbit target to final building center ─
      if (elapsed >= settledMs && !controlsEnabled) {
        controlsEnabled = true;
        controls.target.set(centerX, totalHeight * 0.35, centerZ);
      }

      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    // ── Resize ────────────────────────────────────────────
    const onResize = () => {
      if (!container) return;
      const nw = container.clientWidth, nh = container.clientHeight;
      if (nw === 0 || nh === 0) return;
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
      envTex.dispose();
      scene.traverse(obj => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
          else obj.material.dispose();
        }
      });
      scene.clear();
    };
  }, [rooms, kpis, buildingDescription]);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    const timer = setTimeout(() => {
      cleanup = buildScene() ?? undefined;
    }, 100);
    return () => {
      clearTimeout(timer);
      cleanup?.();
    };
  }, [buildScene]);

  // KPI pills for overlay
  const kpiPills: Array<{ label: string; color: string }> = [];
  if (kpis?.floors) kpiPills.push({ label: `${kpis.floors} floors`, color: "#4F8AFF" });
  if (kpis?.gfa) kpiPills.push({ label: `${kpis.gfa.toLocaleString()} m\u00B2`, color: "#10B981" });
  if (kpis?.height) kpiPills.push({ label: `${kpis.height}m`, color: "#8B5CF6" });
  if (kpis?.footprint) kpiPills.push({ label: `${kpis.footprint} m\u00B2 footprint`, color: "#F59E0B" });

  // ── Zoom control handlers (use module-level refs) ─────
  const handleZoomIn = useCallback(() => {
    if (!globalCamera || !globalControls) return;
    const dir = new THREE.Vector3();
    dir.subVectors(globalCamera.position, globalControls.target).multiplyScalar(-0.2);
    globalCamera.position.add(dir);
    globalControls.update();
  }, []);

  const handleZoomOut = useCallback(() => {
    if (!globalCamera || !globalControls) return;
    const dir = new THREE.Vector3();
    dir.subVectors(globalCamera.position, globalControls.target).multiplyScalar(0.2);
    globalCamera.position.add(dir);
    globalControls.update();
  }, []);

  const handleFitView = useCallback(() => {
    if (!globalCamera || !globalControls) return;
    const { totalHeight: th, centerX: cx, centerZ: cz } = sceneDataRef.current;
    globalCamera.position.set(cx + 40, 30, cz + 40);
    globalControls.target.set(cx, th / 2, cz);
    globalControls.update();
  }, []);

  const zoomBtnStyle: React.CSSProperties = {
    width: 32,
    height: 32,
    borderRadius: 4,
    background: "rgba(10,12,14,0.8)",
    border: "1px solid rgba(184,115,51,0.3)",
    color: "#B87333",
    fontSize: 16,
    fontWeight: 600,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.15s ease",
    padding: 0,
    lineHeight: 1,
  };

  return (
    <div
      style={{ position: "relative", width: "100%", height: "100%", pointerEvents: "auto" }}
      onWheel={(e) => e.stopPropagation()}
    >
      {/* Three.js scene */}
      <div ref={containerRef} style={{ width: "100%", height: "100%", cursor: "grab", pointerEvents: "auto" }} />

      {/* Zoom controls — top right */}
      <div
        style={{
          position: "absolute",
          top: 12,
          right: 12,
          display: "flex",
          flexDirection: "column",
          gap: 4,
          zIndex: 50,
          pointerEvents: "auto" as const,
        }}
      >
        <button
          onClick={handleZoomIn}
          style={zoomBtnStyle}
          onMouseEnter={e => { e.currentTarget.style.background = "rgba(184,115,51,0.15)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "rgba(10,12,14,0.8)"; }}
          title="Zoom in"
        >+</button>
        <button
          onClick={handleZoomOut}
          style={zoomBtnStyle}
          onMouseEnter={e => { e.currentTarget.style.background = "rgba(184,115,51,0.15)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "rgba(10,12,14,0.8)"; }}
          title="Zoom out"
        >&minus;</button>
        <button
          onClick={handleFitView}
          style={{ ...zoomBtnStyle, fontSize: 11 }}
          onMouseEnter={e => { e.currentTarget.style.background = "rgba(184,115,51,0.15)"; }}
          onMouseLeave={e => { e.currentTarget.style.background = "rgba(10,12,14,0.8)"; }}
          title="Fit view"
        >&#8718;</button>
      </div>

      {/* Floating overlay at bottom */}
      <div
        style={{
          position: "absolute",
          bottom: 20,
          left: "50%",
          transform: "translateX(-50%)",
          background: "rgba(10,10,18,0.85)",
          backdropFilter: "blur(20px)",
          WebkitBackdropFilter: "blur(20px)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 16,
          padding: "16px 24px",
          display: "flex",
          alignItems: "center",
          gap: 24,
          zIndex: 10,
          whiteSpace: "nowrap",
        }}
      >
        {/* Building name */}
        <span style={{ fontWeight: 700, color: "#fff", fontSize: 16 }}>
          {buildingName || "Building Design"}
        </span>

        {/* KPI pills */}
        <div style={{ display: "flex", gap: 8 }}>
          {kpiPills.map((pill, i) => (
            <span
              key={i}
              style={{
                padding: "4px 12px",
                borderRadius: 20,
                background: `${pill.color}20`,
                border: `1px solid ${pill.color}40`,
                color: pill.color,
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              {pill.label}
            </span>
          ))}
        </div>

        {/* PDF Report */}
        {onGeneratePDF && (
          <button
            onClick={onGeneratePDF}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 14px",
              borderRadius: 8,
              background: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "#8888A0",
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = "rgba(255,255,255,0.1)";
              e.currentTarget.style.color = "#F0F0F5";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = "rgba(255,255,255,0.06)";
              e.currentTarget.style.color = "#8888A0";
            }}
          >
            <FileDown size={12} /> PDF Report
          </button>
        )}

        {/* Close */}
        <button
          onClick={onClose}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            padding: "6px 14px",
            borderRadius: 8,
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "#8888A0",
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = "rgba(255,255,255,0.1)";
            e.currentTarget.style.color = "#F0F0F5";
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = "rgba(255,255,255,0.06)";
            e.currentTarget.style.color = "#8888A0";
          }}
        >
          <X size={12} /> Close
        </button>
      </div>

      {/* Drag hint — below zoom buttons */}
      <div
        style={{
          position: "absolute",
          top: 120,
          right: 12,
          fontSize: 9,
          color: "rgba(255,255,255,0.2)",
          pointerEvents: "none",
          textAlign: "right",
        }}
      >
        Drag to orbit<br />Scroll to zoom
      </div>
    </div>
  );
}
