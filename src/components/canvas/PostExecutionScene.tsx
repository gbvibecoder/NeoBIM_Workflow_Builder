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

// ─── Layout generator (bin-packing into footprint) ───────────────────────────

function generateLayout(rooms: Room[]): LayoutRoom[] {
  if (rooms.length === 0) return [];
  const sorted = [...rooms].sort((a, b) => b.area - a.area);
  const totalArea = sorted.reduce((s, r) => s + r.area, 0);
  const aspect = 1.4;
  const buildingWidth = Math.sqrt(totalArea * aspect);
  const padding = 0.15;

  const laid: LayoutRoom[] = [];
  let curX = 0, curY = 0, rowHeight = 0;

  for (const room of sorted) {
    const roomAspect = room.name.toLowerCase().includes("corridor") || room.name.toLowerCase().includes("hall")
      ? 4.0 : 1.3 + Math.random() * 0.4;
    let w = Math.sqrt(room.area * roomAspect);
    let d = room.area / w;
    if (room.name.toLowerCase().includes("corridor")) {
      w = buildingWidth;
      d = room.area / w;
    }
    if (curX + w > buildingWidth + 0.5 && curX > 0) {
      curX = 0;
      curY += rowHeight + padding;
      rowHeight = 0;
    }
    laid.push({ ...room, x: curX, y: curY, width: w, depth: d });
    curX += w + padding;
    rowHeight = Math.max(rowHeight, d);
  }

  const maxX = Math.max(...laid.map(r => r.x + r.width));
  const maxY = Math.max(...laid.map(r => r.y + r.depth));
  const offsetX = maxX / 2, offsetY = maxY / 2;
  return laid.map(r => ({ ...r, x: r.x - offsetX, y: r.y - offsetY }));
}

// ─── Wall segment builder ────────────────────────────────────────────────────

function buildWallSegments(
  x: number, z: number, length: number, wallHeight: number, thickness: number,
  axis: "x" | "z", isExterior: boolean,
  group: THREE.Group, wallArr: THREE.Mesh[], windowArr: THREE.Mesh[],
  extMat: THREE.MeshStandardMaterial, intMat: THREE.MeshStandardMaterial,
  glassMat: THREE.MeshPhysicalMaterial, frameMat: THREE.MeshStandardMaterial,
) {
  const mat = isExterior ? extMat : intMat;
  const hasDoor = isExterior || Math.random() > 0.5;
  const doorWidth = 0.9, doorHeight = 2.1, doorPos = length * 0.3;
  const hasWindow = isExterior && length > 2.5;
  const windowWidth = 1.2, windowHeight = 1.4, windowSillH = 0.8, windowPos = length * 0.7;

  if (!hasDoor && !hasWindow) {
    const geo = axis === "x"
      ? new THREE.BoxGeometry(length, wallHeight, thickness)
      : new THREE.BoxGeometry(thickness, wallHeight, length);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x + (axis === "x" ? length / 2 : 0), 0, z + (axis === "z" ? length / 2 : 0));
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.scale.y = 0;
    group.add(mesh); wallArr.push(mesh);
    return;
  }

  interface Opening { pos: number; width: number; height: number; sill: number; type: "door" | "window" }
  const openings: Opening[] = [];
  if (hasDoor && doorPos + doorWidth / 2 < length && doorPos - doorWidth / 2 > 0)
    openings.push({ pos: doorPos, width: doorWidth, height: doorHeight, sill: 0, type: "door" });
  if (hasWindow && windowPos + windowWidth / 2 < length && windowPos - windowWidth / 2 > 0)
    openings.push({ pos: windowPos, width: windowWidth, height: windowHeight, sill: windowSillH, type: "window" });
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
      const lintelY = o.sill + o.height + lintelH / 2;
      lintel.position.set(axis === "x" ? x + o.pos : x, lintelY, axis === "z" ? z + o.pos : z);
      lintel.castShadow = true; lintel.scale.y = 0;
      group.add(lintel); wallArr.push(lintel);
    }

    // Sill wall below window
    if (o.type === "window" && o.sill > 0.05) {
      const sillGeo = axis === "x"
        ? new THREE.BoxGeometry(o.width, o.sill, thickness)
        : new THREE.BoxGeometry(thickness, o.sill, o.width);
      const sillWall = new THREE.Mesh(sillGeo, mat);
      sillWall.position.set(axis === "x" ? x + o.pos : x, o.sill / 2, axis === "z" ? z + o.pos : z);
      sillWall.castShadow = true; sillWall.scale.y = 0;
      group.add(sillWall); wallArr.push(sillWall);
    }

    // Window glass
    if (o.type === "window") {
      const gGeo = axis === "x"
        ? new THREE.BoxGeometry(o.width - 0.06, o.height - 0.06, 0.03)
        : new THREE.BoxGeometry(0.03, o.height - 0.06, o.width - 0.06);
      const glass = new THREE.Mesh(gGeo, glassMat.clone());
      glass.position.set(axis === "x" ? x + o.pos : x, o.sill + o.height / 2, axis === "z" ? z + o.pos : z);
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
      door.position.set(axis === "x" ? x + o.pos : x + 0.04, o.height / 2, axis === "z" ? z + o.pos : z + 0.04);
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
    group.add(mesh); wallArr.push(mesh);
  }
}

// ─── Furniture builder ───────────────────────────────────────────────────────

function addFurniture(room: LayoutRoom, group: THREE.Group, meshes: THREE.Mesh[]) {
  const rt = getRoomType(room.name, room.type);
  const rx = room.x, rz = room.y, rw = room.width, rd = room.depth;
  const floorY = 0.16;

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
    const wallHeight = kpis?.height
      ? kpis.height / Math.max(kpis.floors ?? 1, 1)
      : 3.0;
    const wallThickness = 0.15;

    // Building bounds
    const minX = Math.min(...laidRooms.map(r => r.x));
    const maxX = Math.max(...laidRooms.map(r => r.x + r.width));
    const minZ = Math.min(...laidRooms.map(r => r.y));
    const maxZ = Math.max(...laidRooms.map(r => r.y + r.depth));
    const buildingW = maxX - minX, buildingD = maxZ - minZ;
    const centerX = (minX + maxX) / 2, centerZ = (minZ + maxZ) / 2;
    const maxDim = Math.max(buildingW, buildingD, wallHeight);

    // ── Renderer ──────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // ── Scene ─────────────────────────────────────────────
    const scene = new THREE.Scene();
    const bgCanvas = document.createElement("canvas");
    bgCanvas.width = 2; bgCanvas.height = 256;
    const bgCtx = bgCanvas.getContext("2d")!;
    const grad = bgCtx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, "#0e0e1a");
    grad.addColorStop(0.5, "#0a0a14");
    grad.addColorStop(1, "#07070e");
    bgCtx.fillStyle = grad;
    bgCtx.fillRect(0, 0, 2, 256);
    const bgTex = new THREE.CanvasTexture(bgCanvas);
    scene.background = bgTex;
    scene.fog = new THREE.Fog("#0a0a14", 40, 80);

    // ── Camera ────────────────────────────────────────────
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 200);
    const topDownPos = new THREE.Vector3(centerX, 40, centerZ + 0.01);
    const perspectivePos = new THREE.Vector3(
      centerX + maxDim * 0.8,
      maxDim * 0.9,
      centerZ + maxDim * 0.8
    );
    camera.position.copy(topDownPos);
    camera.lookAt(new THREE.Vector3(centerX, 0, centerZ));

    // ── Controls (disabled until Phase E) ─────────────────
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(centerX, 0, centerZ);
    controls.maxPolarAngle = Math.PI / 2.2;
    controls.minPolarAngle = 0.1;
    controls.minDistance = 5;
    controls.maxDistance = 50;
    controls.enabled = false;

    // ── Lighting (starts dim) ─────────────────────────────
    const ambient = new THREE.AmbientLight("#f0f0ff", 0.2);
    scene.add(ambient);
    const hemi = new THREE.HemisphereLight("#7ec8e3", "#3d2b1f", 0);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight("#fff5e0", 0);
    sun.position.set(centerX + 10, 15, centerZ + 8);
    sun.castShadow = true;
    sun.shadow.mapSize.setScalar(2048);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 60;
    sun.shadow.radius = 4;
    const sExt = maxDim * 1.5;
    sun.shadow.camera.left = -sExt;
    sun.shadow.camera.right = sExt;
    sun.shadow.camera.top = sExt;
    sun.shadow.camera.bottom = -sExt;
    sun.shadow.bias = -0.001;
    scene.add(sun);

    const fillLight = new THREE.DirectionalLight("#aabbdd", 0);
    fillLight.position.set(centerX - 15, 10, centerZ - 10);
    scene.add(fillLight);

    // ── Ground (fades in Phase D) ─────────────────────────
    const groundGeo = new THREE.PlaneGeometry(60, 60);
    const groundMat = new THREE.MeshStandardMaterial({
      color: "#2a3a2a", roughness: 0.9, metalness: 0.05,
      transparent: true, opacity: 0,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(centerX, -0.02, centerZ);
    ground.receiveShadow = true;
    scene.add(ground);

    const grid = new THREE.GridHelper(60, 60, "#3a3a3a", "#2d2d2d");
    grid.position.set(centerX, 0.01, centerZ);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0;
    scene.add(grid);

    // ── Floor slab ────────────────────────────────────────
    const slabGeo = new THREE.BoxGeometry(buildingW + 0.4, 0.15, buildingD + 0.4);
    const slabMat = new THREE.MeshStandardMaterial({ color: "#e0ddd5", roughness: 0.85, metalness: 0.02 });
    const slab = new THREE.Mesh(slabGeo, slabMat);
    slab.position.set(centerX, 0.075, centerZ);
    slab.castShadow = true; slab.receiveShadow = true;
    scene.add(slab);

    // ── Materials ─────────────────────────────────────────
    const extWallMat = new THREE.MeshStandardMaterial({ color: "#f0ece4", roughness: 0.85, metalness: 0.02 });
    const intWallMat = new THREE.MeshStandardMaterial({ color: "#f8f6f0", roughness: 0.7, metalness: 0.02 });
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: "#b0d4f0", roughness: 0.05, metalness: 0.1,
      transparent: true, opacity: 0, transmission: 0.7, ior: 1.5,
    });
    const frameMat = new THREE.MeshStandardMaterial({
      color: "#2a2a2a", roughness: 0.3, metalness: 0.9,
      transparent: true, opacity: 0,
    });

    // ── Build rooms ───────────────────────────────────────
    const buildingGroup = new THREE.Group();
    const roomWallMeshes: THREE.Mesh[][] = [];
    const allWindowMeshes: THREE.Mesh[] = [];
    const allFurnitureMeshes: THREE.Mesh[] = [];
    const labelSprites: THREE.Sprite[] = [];

    for (let ri = 0; ri < laidRooms.length; ri++) {
      const room = laidRooms[ri];
      const rx = room.x, rz = room.y, rw = room.width, rd = room.depth;

      // Colored floor
      const roomType = getRoomType(room.name, room.type);
      const floorCfg = FLOOR_MATS[roomType] ?? FLOOR_MATS.living;
      const floorGeo = new THREE.PlaneGeometry(rw - 0.02, rd - 0.02);
      const floorMat = new THREE.MeshStandardMaterial({
        color: floorCfg.color, roughness: floorCfg.roughness,
        metalness: 0.02, side: THREE.DoubleSide,
      });
      const floor = new THREE.Mesh(floorGeo, floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(rx + rw / 2, 0.16, rz + rd / 2);
      floor.receiveShadow = true;
      buildingGroup.add(floor);

      // Walls for this room
      const thisWalls: THREE.Mesh[] = [];
      const isTop = Math.abs(rz - minZ) < 0.3;
      const isBottom = Math.abs((rz + rd) - maxZ) < 0.3;
      const isLeft = Math.abs(rx - minX) < 0.3;
      const isRight = Math.abs((rx + rw) - maxX) < 0.3;

      buildWallSegments(rx, rz, rw, wallHeight, wallThickness, "x", isTop,
        buildingGroup, thisWalls, allWindowMeshes, extWallMat, intWallMat, glassMat, frameMat);
      buildWallSegments(rx, rz + rd, rw, wallHeight, wallThickness, "x", isBottom,
        buildingGroup, thisWalls, allWindowMeshes, extWallMat, intWallMat, glassMat, frameMat);
      buildWallSegments(rx, rz, rd, wallHeight, wallThickness, "z", isLeft,
        buildingGroup, thisWalls, allWindowMeshes, extWallMat, intWallMat, glassMat, frameMat);
      buildWallSegments(rx + rw, rz, rd, wallHeight, wallThickness, "z", isRight,
        buildingGroup, thisWalls, allWindowMeshes, extWallMat, intWallMat, glassMat, frameMat);
      roomWallMeshes.push(thisWalls);

      // Furniture
      addFurniture(room, buildingGroup, allFurnitureMeshes);

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

    // Roof
    const roofGeo = new THREE.BoxGeometry(buildingW + 0.6, 0.12, buildingD + 0.6);
    const roofMat = new THREE.MeshStandardMaterial({
      color: "#d0ccc4", roughness: 0.8, metalness: 0.05, transparent: true, opacity: 0,
    });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.set(centerX, wallHeight + 0.06, centerZ);
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
      [centerX + buildingW * 0.9, centerZ - buildingD * 0.3],
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

    // ── Animation loop ────────────────────────────────────
    const startTime = performance.now();
    let controlsEnabled = false;

    function animate() {
      animFrameRef.current = requestAnimationFrame(animate);
      const elapsed = performance.now() - startTime;

      // ─ Phase A (0-2s): 2D top-down, labels fade in ─
      const labelFadeA = clamp01(elapsed / 1000);

      // ─ Phase B (2-4s): Camera + wall growth ─
      const camProgress = clamp01((elapsed - 2000) / 2500);
      const camEased = smoothstep(camProgress);

      if (camProgress > 0) {
        camera.position.lerpVectors(topDownPos, perspectivePos, camEased);
        const targetY = THREE.MathUtils.lerp(0, wallHeight * 0.4, camEased);
        camera.lookAt(new THREE.Vector3(centerX, targetY, centerZ));
        controls.target.set(centerX, targetY, centerZ);
      }

      // Walls grow per room, staggered
      roomWallMeshes.forEach((roomWalls, ri) => {
        const stagger = ri * 100;
        const roomProgress = clamp01((elapsed - 2000 - stagger) / 500);
        const eased = easeOutCubic(roomProgress);
        roomWalls.forEach(wall => {
          wall.scale.y = eased;
          wall.position.y = (wallHeight * eased) / 2 + 0.15;
        });
      });

      // Labels reposition
      const labelY = THREE.MathUtils.lerp(0.5, wallHeight + 0.8, camEased);
      const labelOpacity = elapsed < 2000 ? labelFadeA : 1;
      labelSprites.forEach(s => {
        s.position.y = labelY;
        (s.material as THREE.SpriteMaterial).opacity = labelOpacity;
      });

      // ─ Phase C (4-6s): Windows, furniture, roof ─
      const detailProgress = clamp01((elapsed - 4000) / 2000);
      allWindowMeshes.forEach(m => {
        if (m.material instanceof THREE.MeshPhysicalMaterial) {
          m.material.opacity = detailProgress * 0.4;
        } else if (m.material instanceof THREE.MeshStandardMaterial) {
          m.material.opacity = detailProgress;
        }
      });
      allFurnitureMeshes.forEach(m => {
        (m.material as THREE.MeshStandardMaterial).opacity = detailProgress * 0.6;
      });
      roofMat.opacity = detailProgress * 0.85;

      // ─ Phase D (5-7s): Environment ─
      const envProgress = clamp01((elapsed - 5000) / 2000);
      sun.intensity = envProgress * 1.5;
      fillLight.intensity = envProgress * 0.3;
      ambient.intensity = 0.2 + envProgress * 0.3;
      hemi.intensity = envProgress * 0.4;
      groundMat.opacity = envProgress;
      (grid.material as THREE.Material).opacity = envProgress * 0.3;

      // Trees pop in
      trees.forEach((tree, i) => {
        const tp = clamp01((elapsed - 5500 - i * 200) / 500);
        tree.scale.setScalar(tp > 0 ? easeOutBack(tp) : 0);
      });

      // ─ Phase E (7s+): OrbitControls ─
      if (elapsed >= 7000 && !controlsEnabled) {
        controlsEnabled = true;
        controls.enabled = true;
        controls.autoRotate = true;
        controls.autoRotateSpeed = 0.3;
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
      bgTex.dispose();
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
    const timer = setTimeout(() => {
      const cleanup = buildScene();
      return () => { cleanup?.(); };
    }, 100);
    return () => clearTimeout(timer);
  }, [buildScene]);

  // KPI pills for overlay
  const kpiPills: Array<{ label: string; color: string }> = [];
  if (kpis?.floors) kpiPills.push({ label: `${kpis.floors} floors`, color: "#4F8AFF" });
  if (kpis?.gfa) kpiPills.push({ label: `${kpis.gfa.toLocaleString()} m\u00B2`, color: "#10B981" });
  if (kpis?.height) kpiPills.push({ label: `${kpis.height}m`, color: "#8B5CF6" });
  if (kpis?.footprint) kpiPills.push({ label: `${kpis.footprint} m\u00B2 footprint`, color: "#F59E0B" });

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {/* Three.js scene */}
      <div ref={containerRef} style={{ width: "100%", height: "100%", cursor: "grab" }} />

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

      {/* Drag hint */}
      <div
        style={{
          position: "absolute",
          top: 12,
          right: 12,
          fontSize: 9,
          color: "rgba(255,255,255,0.2)",
          pointerEvents: "none",
        }}
      >
        Drag to orbit &middot; Scroll to zoom
      </div>
    </div>
  );
}
