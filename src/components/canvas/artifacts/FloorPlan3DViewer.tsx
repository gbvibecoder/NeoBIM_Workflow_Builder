"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface FloorPlanRoom {
  name: string;
  area: number;
  x?: number;
  y?: number;
  width?: number;
  depth?: number;
  type?: string; // 'living', 'bedroom', 'kitchen', 'bathroom', 'hallway', 'retail', 'office'
}

export interface FloorPlan3DViewerProps {
  rooms: FloorPlanRoom[];
  buildingHeight?: number;
  floors?: number;
  style?: string;
  onReady?: () => void;
}

// ─── Room type → color mapping ───────────────────────────────────────────────

const ROOM_COLORS: Record<string, string> = {
  living:   "#d4e4f7",
  common:   "#d4e4f7",
  bedroom:  "#d4f0d4",
  kitchen:  "#f7e8c4",
  bathroom: "#e4d4f0",
  bath:     "#e4d4f0",
  hallway:  "#e8e8e8",
  corridor: "#e8e8e8",
  hall:     "#e8e8e8",
  retail:   "#f0e0d0",
  office:   "#d4e8f0",
};

function getRoomType(name: string, explicitType?: string): string {
  if (explicitType && ROOM_COLORS[explicitType.toLowerCase()]) return explicitType.toLowerCase();
  const lower = name.toLowerCase();
  if (lower.includes("living") || lower.includes("lounge")) return "living";
  if (lower.includes("bed")) return "bedroom";
  if (lower.includes("kitchen") || lower.includes("dining")) return "kitchen";
  if (lower.includes("bath") || lower.includes("wc") || lower.includes("toilet")) return "bathroom";
  if (lower.includes("hall") || lower.includes("corridor") || lower.includes("entry") || lower.includes("lobby")) return "hallway";
  if (lower.includes("retail") || lower.includes("shop") || lower.includes("commercial")) return "retail";
  if (lower.includes("office") || lower.includes("study") || lower.includes("work")) return "office";
  return "living";
}

function getRoomColor(name: string, explicitType?: string): string {
  const type = getRoomType(name, explicitType);
  return ROOM_COLORS[type] ?? "#d4e4f7";
}

// ─── Layout generator (when rooms lack x/y/width/depth) ─────────────────────

function generateLayout(rooms: FloorPlanRoom[]): FloorPlanRoom[] {
  if (rooms.length === 0) return [];

  // Sort: large rooms first for better packing
  const sorted = [...rooms].sort((a, b) => b.area - a.area);

  // Calculate building dimensions from total area
  const totalArea = sorted.reduce((s, r) => s + r.area, 0);
  const aspect = 1.4;
  const buildingWidth = Math.sqrt(totalArea * aspect);
  const buildingDepth = totalArea / buildingWidth;

  // Simple row-based packing
  const laid: FloorPlanRoom[] = [];
  let curX = 0;
  let curY = 0;
  let rowHeight = 0;
  const padding = 0.15; // wall thickness

  for (const room of sorted) {
    // Determine room dimensions from area
    const roomAspect = room.name.toLowerCase().includes("corridor") || room.name.toLowerCase().includes("hall")
      ? 4.0 : 1.3 + Math.random() * 0.4;
    let w = Math.sqrt(room.area * roomAspect);
    let d = room.area / w;

    // Corridors should be long and thin
    if (room.name.toLowerCase().includes("corridor")) {
      w = buildingWidth;
      d = room.area / w;
    }

    // Check if room fits in current row
    if (curX + w > buildingWidth + 0.5 && curX > 0) {
      curX = 0;
      curY += rowHeight + padding;
      rowHeight = 0;
    }

    laid.push({
      ...room,
      x: curX,
      y: curY,
      width: w,
      depth: d,
    });

    curX += w + padding;
    rowHeight = Math.max(rowHeight, d);
  }

  // Center the layout around origin
  const maxX = Math.max(...laid.map(r => (r.x ?? 0) + (r.width ?? 0)));
  const maxY = Math.max(...laid.map(r => (r.y ?? 0) + (r.depth ?? 0)));
  const offsetX = maxX / 2;
  const offsetY = maxY / 2;

  return laid.map(r => ({
    ...r,
    x: (r.x ?? 0) - offsetX,
    y: (r.y ?? 0) - offsetY,
  }));
}

// ─── Check if rooms have layout data ─────────────────────────────────────────

function roomsHaveLayout(rooms: FloorPlanRoom[]): boolean {
  return rooms.every(r => r.x != null && r.y != null && r.width != null && r.depth != null);
}

// ─── Wall segment (avoids door/window openings) ──────────────────────────────

function createWallSegments(
  x: number, z: number, length: number, wallHeight: number, thickness: number,
  axis: "x" | "z", isExterior: boolean,
  scene: THREE.Group, wallsMeshes: THREE.Mesh[], windowMeshes: THREE.Mesh[],
  wallMat: THREE.MeshStandardMaterial, interiorWallMat: THREE.MeshStandardMaterial,
  glassMat: THREE.MeshPhysicalMaterial, frameMat: THREE.MeshStandardMaterial,
) {
  const mat = isExterior ? wallMat : interiorWallMat;

  // Door opening (only on some walls)
  const hasDoor = isExterior || Math.random() > 0.5;
  const doorWidth = 0.9;
  const doorHeight = 2.1;
  const doorPos = length * 0.3; // 30% along the wall

  // Window opening (only on exterior walls)
  const hasWindow = isExterior && length > 2.5;
  const windowWidth = 1.2;
  const windowHeight = 1.4;
  const windowSillHeight = 0.8;
  const windowPos = length * 0.7;

  if (!hasDoor && !hasWindow) {
    // Full wall, no openings
    const geo = axis === "x"
      ? new THREE.BoxGeometry(length, wallHeight, thickness)
      : new THREE.BoxGeometry(thickness, wallHeight, length);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x + (axis === "x" ? length / 2 : 0), 0, z + (axis === "z" ? length / 2 : 0));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // Start with scaleY = 0 for animation
    mesh.scale.y = 0;
    scene.add(mesh);
    wallsMeshes.push(mesh);
    return;
  }

  // Build wall with openings using segments
  const segments: Array<{ start: number; end: number }> = [];
  const openings: Array<{ pos: number; width: number; height: number; sill: number; type: "door" | "window" }> = [];

  if (hasDoor && doorPos + doorWidth / 2 < length && doorPos - doorWidth / 2 > 0) {
    openings.push({ pos: doorPos, width: doorWidth, height: doorHeight, sill: 0, type: "door" });
  }
  if (hasWindow && windowPos + windowWidth / 2 < length && windowPos - windowWidth / 2 > 0) {
    openings.push({ pos: windowPos, width: windowWidth, height: windowHeight, sill: windowSillHeight, type: "window" });
  }

  // Sort openings by position
  openings.sort((a, b) => a.pos - b.pos);

  // Generate wall segments around openings
  let segStart = 0;
  for (const opening of openings) {
    const oStart = opening.pos - opening.width / 2;
    const oEnd = opening.pos + opening.width / 2;
    if (oStart > segStart + 0.1) {
      segments.push({ start: segStart, end: oStart });
    }

    // Wall above opening (lintel)
    const lintelHeight = wallHeight - opening.sill - opening.height;
    if (lintelHeight > 0.05) {
      const lintelGeo = axis === "x"
        ? new THREE.BoxGeometry(opening.width, lintelHeight, thickness)
        : new THREE.BoxGeometry(thickness, lintelHeight, opening.width);
      const lintel = new THREE.Mesh(lintelGeo, mat);
      const lintelY = opening.sill + opening.height + lintelHeight / 2;
      if (axis === "x") {
        lintel.position.set(x + opening.pos, lintelY, z);
      } else {
        lintel.position.set(x, lintelY, z + opening.pos);
      }
      lintel.castShadow = true;
      lintel.scale.y = 0;
      scene.add(lintel);
      wallsMeshes.push(lintel);
    }

    // Wall below window (sill wall)
    if (opening.type === "window" && opening.sill > 0.05) {
      const sillGeo = axis === "x"
        ? new THREE.BoxGeometry(opening.width, opening.sill, thickness)
        : new THREE.BoxGeometry(thickness, opening.sill, opening.width);
      const sillWall = new THREE.Mesh(sillGeo, mat);
      if (axis === "x") {
        sillWall.position.set(x + opening.pos, opening.sill / 2, z);
      } else {
        sillWall.position.set(x, opening.sill / 2, z + opening.pos);
      }
      sillWall.castShadow = true;
      sillWall.scale.y = 0;
      scene.add(sillWall);
      wallsMeshes.push(sillWall);
    }

    // Window glass
    if (opening.type === "window") {
      const glassGeo = axis === "x"
        ? new THREE.BoxGeometry(opening.width - 0.06, opening.height - 0.06, 0.03)
        : new THREE.BoxGeometry(0.03, opening.height - 0.06, opening.width - 0.06);
      const glass = new THREE.Mesh(glassGeo, glassMat);
      if (axis === "x") {
        glass.position.set(x + opening.pos, opening.sill + opening.height / 2, z);
      } else {
        glass.position.set(x, opening.sill + opening.height / 2, z + opening.pos);
      }
      glass.material = glassMat.clone();
      (glass.material as THREE.MeshPhysicalMaterial).opacity = 0;
      scene.add(glass);
      windowMeshes.push(glass);

      // Window frame
      const frameGeo = axis === "x"
        ? new THREE.BoxGeometry(opening.width, opening.height, 0.04)
        : new THREE.BoxGeometry(0.04, opening.height, opening.width);
      const frame = new THREE.Mesh(frameGeo, frameMat.clone());
      frame.position.copy(glass.position);
      (frame.material as THREE.MeshStandardMaterial).opacity = 0;
      (frame.material as THREE.MeshStandardMaterial).transparent = true;
      scene.add(frame);
      windowMeshes.push(frame);
    }

    // Door panel
    if (opening.type === "door") {
      const doorMat = new THREE.MeshStandardMaterial({
        color: "#8B6914",
        roughness: 0.6,
        metalness: 0.1,
        transparent: true,
        opacity: 0,
      });
      const doorGeo = axis === "x"
        ? new THREE.BoxGeometry(opening.width - 0.1, opening.height - 0.05, 0.05)
        : new THREE.BoxGeometry(0.05, opening.height - 0.05, opening.width - 0.1);
      const door = new THREE.Mesh(doorGeo, doorMat);
      const doorOffset = axis === "x" ? 0.04 : 0.04; // slightly recessed
      if (axis === "x") {
        door.position.set(x + opening.pos, opening.height / 2, z + doorOffset);
      } else {
        door.position.set(x + doorOffset, opening.height / 2, z + opening.pos);
      }
      scene.add(door);
      windowMeshes.push(door); // fade in with windows
    }

    segStart = oEnd;
  }

  // Final segment after last opening
  if (segStart < length - 0.1) {
    segments.push({ start: segStart, end: length });
  }

  // Build solid wall segments
  for (const seg of segments) {
    const segLen = seg.end - seg.start;
    if (segLen < 0.05) continue;
    const geo = axis === "x"
      ? new THREE.BoxGeometry(segLen, wallHeight, thickness)
      : new THREE.BoxGeometry(thickness, wallHeight, segLen);
    const mesh = new THREE.Mesh(geo, mat);
    const segMid = seg.start + segLen / 2;
    if (axis === "x") {
      mesh.position.set(x + segMid, 0, z);
    } else {
      mesh.position.set(x, 0, z + segMid);
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.scale.y = 0;
    scene.add(mesh);
    wallsMeshes.push(mesh);
  }
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function FloorPlan3DViewer({ rooms, buildingHeight, floors = 1, onReady }: FloorPlan3DViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const animFrameRef = useRef<number>(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

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
    if (w === 0 || h === 0) return;

    // ─── Process rooms ───────────────────────────────────────────
    const laidRooms = roomsHaveLayout(rooms) ? rooms : generateLayout(rooms);
    if (laidRooms.length === 0) return;

    const wallHeight = buildingHeight ? buildingHeight / Math.max(floors, 1) : 3.0;
    const wallThickness = 0.15;

    // Calculate building bounds
    const minX = Math.min(...laidRooms.map(r => r.x ?? 0));
    const maxX = Math.max(...laidRooms.map(r => (r.x ?? 0) + (r.width ?? 0)));
    const minZ = Math.min(...laidRooms.map(r => r.y ?? 0));
    const maxZ = Math.max(...laidRooms.map(r => (r.y ?? 0) + (r.depth ?? 0)));
    const buildingW = maxX - minX;
    const buildingD = maxZ - minZ;
    const centerX = (minX + maxX) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const maxDim = Math.max(buildingW, buildingD, wallHeight);

    // ─── Renderer ────────────────────────────────────────────────
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // ─── Scene ───────────────────────────────────────────────────
    const scene = new THREE.Scene();

    // Gradient background
    const bgCanvas = document.createElement("canvas");
    bgCanvas.width = 2;
    bgCanvas.height = 256;
    const bgCtx = bgCanvas.getContext("2d")!;
    const grad = bgCtx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, "#1a1a2e");
    grad.addColorStop(0.5, "#111122");
    grad.addColorStop(1, "#0a0a14");
    bgCtx.fillStyle = grad;
    bgCtx.fillRect(0, 0, 2, 256);
    const bgTex = new THREE.CanvasTexture(bgCanvas);
    scene.background = bgTex;

    scene.fog = new THREE.Fog("#0e0e1a", 30, 80);

    // ─── Camera ──────────────────────────────────────────────────
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 200);
    const topDownPos = new THREE.Vector3(centerX, 30, centerZ);
    const isometricPos = new THREE.Vector3(
      centerX + maxDim * 0.9,
      maxDim * 1.1,
      centerZ + maxDim * 0.9
    );
    const buildingCenter = new THREE.Vector3(centerX, wallHeight * 0.4, centerZ);

    // Start top-down
    camera.position.copy(topDownPos);
    camera.lookAt(new THREE.Vector3(centerX, 0, centerZ));

    // ─── Controls ────────────────────────────────────────────────
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.target.set(centerX, 0, centerZ);
    controls.maxPolarAngle = Math.PI / 2.2;
    controls.minPolarAngle = 0.1;
    controls.minDistance = 5;
    controls.maxDistance = 50;
    controls.enabled = false; // disabled during animation

    // ─── Lighting ────────────────────────────────────────────────
    const ambient = new THREE.AmbientLight("#f0f0ff", 0.4);
    scene.add(ambient);

    const hemi = new THREE.HemisphereLight("#87ceeb", "#362907", 0.3);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight("#fff8e8", 1.2);
    sun.position.set(centerX + 10, 15, centerZ + 8);
    sun.castShadow = true;
    sun.shadow.mapSize.setScalar(2048);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 60;
    const shadowExtent = maxDim * 1.5;
    sun.shadow.camera.left = -shadowExtent;
    sun.shadow.camera.right = shadowExtent;
    sun.shadow.camera.top = shadowExtent;
    sun.shadow.camera.bottom = -shadowExtent;
    sun.shadow.bias = -0.001;
    scene.add(sun);

    const fillLight = new THREE.DirectionalLight("#aabbdd", 0.3);
    fillLight.position.set(centerX - 15, 10, centerZ - 10);
    scene.add(fillLight);

    // ─── Ground plane ────────────────────────────────────────────
    const groundGeo = new THREE.PlaneGeometry(50, 50);
    const groundMat = new THREE.MeshStandardMaterial({
      color: "#2a2a2a",
      roughness: 0.9,
      metalness: 0.05,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(centerX, -0.01, centerZ);
    ground.receiveShadow = true;
    scene.add(ground);

    // Subtle grid
    const gridHelper = new THREE.GridHelper(50, 50, "#3a3a3a", "#2d2d2d");
    gridHelper.position.set(centerX, 0.01, centerZ);
    (gridHelper.material as THREE.Material).transparent = true;
    (gridHelper.material as THREE.Material).opacity = 0.3;
    scene.add(gridHelper);

    // ─── Floor slab ──────────────────────────────────────────────
    const slabGeo = new THREE.BoxGeometry(buildingW + 0.4, 0.15, buildingD + 0.4);
    const slabMat = new THREE.MeshStandardMaterial({
      color: "#e0ddd5",
      roughness: 0.85,
      metalness: 0.02,
    });
    const slab = new THREE.Mesh(slabGeo, slabMat);
    slab.position.set(centerX, 0.075, centerZ);
    slab.castShadow = true;
    slab.receiveShadow = true;
    scene.add(slab);

    // ─── Materials ───────────────────────────────────────────────
    const extWallMat = new THREE.MeshStandardMaterial({
      color: "#f5f0e8",
      roughness: 0.8,
      metalness: 0.02,
    });
    const intWallMat = new THREE.MeshStandardMaterial({
      color: "#faf8f4",
      roughness: 0.7,
      metalness: 0.02,
    });
    const glassMat = new THREE.MeshPhysicalMaterial({
      color: "#88ccff",
      roughness: 0.05,
      metalness: 0.1,
      transparent: true,
      opacity: 0.4,
      transmission: 0.6,
    });
    const frameMat = new THREE.MeshStandardMaterial({
      color: "#333333",
      roughness: 0.3,
      metalness: 0.8,
    });

    // ─── Build rooms ─────────────────────────────────────────────
    const buildingGroup = new THREE.Group();
    const wallMeshes: THREE.Mesh[] = [];
    const windowMeshes: THREE.Mesh[] = [];
    const labelSprites: THREE.Sprite[] = [];

    for (let ri = 0; ri < laidRooms.length; ri++) {
      const room = laidRooms[ri];
      const rx = room.x ?? 0;
      const rz = room.y ?? 0;
      const rw = room.width ?? Math.sqrt(room.area);
      const rd = room.depth ?? Math.sqrt(room.area);

      // Room floor (colored)
      const floorGeo = new THREE.PlaneGeometry(rw - 0.02, rd - 0.02);
      const floorColor = getRoomColor(room.name, room.type);
      const floorMat = new THREE.MeshStandardMaterial({
        color: floorColor,
        roughness: 0.5,
        metalness: 0.02,
        side: THREE.DoubleSide,
      });
      const floor = new THREE.Mesh(floorGeo, floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.position.set(rx + rw / 2, 0.16, rz + rd / 2);
      floor.receiveShadow = true;
      buildingGroup.add(floor);

      // Determine if walls are exterior
      const isTop = Math.abs(rz - minZ) < 0.3;
      const isBottom = Math.abs((rz + rd) - maxZ) < 0.3;
      const isLeft = Math.abs(rx - minX) < 0.3;
      const isRight = Math.abs((rx + rw) - maxX) < 0.3;

      // Top wall (along x-axis at z = rz)
      createWallSegments(
        rx, rz, rw, wallHeight, wallThickness, "x", isTop,
        buildingGroup, wallMeshes, windowMeshes,
        extWallMat, intWallMat, glassMat, frameMat,
      );

      // Bottom wall (along x-axis at z = rz + rd)
      createWallSegments(
        rx, rz + rd, rw, wallHeight, wallThickness, "x", isBottom,
        buildingGroup, wallMeshes, windowMeshes,
        extWallMat, intWallMat, glassMat, frameMat,
      );

      // Left wall (along z-axis at x = rx)
      createWallSegments(
        rx, rz, rd, wallHeight, wallThickness, "z", isLeft,
        buildingGroup, wallMeshes, windowMeshes,
        extWallMat, intWallMat, glassMat, frameMat,
      );

      // Right wall (along z-axis at x = rx + rw)
      createWallSegments(
        rx + rw, rz, rd, wallHeight, wallThickness, "z", isRight,
        buildingGroup, wallMeshes, windowMeshes,
        extWallMat, intWallMat, glassMat, frameMat,
      );

      // Room label sprite
      const labelCanvas = document.createElement("canvas");
      labelCanvas.width = 256;
      labelCanvas.height = 128;
      const ctx = labelCanvas.getContext("2d")!;
      ctx.clearRect(0, 0, 256, 128);

      // Background with rounded rect
      ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
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
      ctx.font = "bold 22px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // Truncate long names
      let displayName = room.name;
      if (displayName.length > 16) displayName = displayName.slice(0, 14) + "...";
      ctx.fillText(displayName, 128, 50);

      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.font = "18px -apple-system, BlinkMacSystemFont, sans-serif";
      ctx.fillText(`${room.area} m\u00B2`, 128, 82);

      const labelTex = new THREE.CanvasTexture(labelCanvas);
      labelTex.needsUpdate = true;
      const spriteMat = new THREE.SpriteMaterial({
        map: labelTex,
        transparent: true,
        opacity: 0,
        depthTest: false,
      });
      const sprite = new THREE.Sprite(spriteMat);
      const spriteScale = Math.max(rw, rd) * 0.5;
      sprite.scale.set(spriteScale, spriteScale * 0.5, 1);
      sprite.position.set(rx + rw / 2, wallHeight + 0.8, rz + rd / 2);
      buildingGroup.add(sprite);
      labelSprites.push(sprite);
    }

    // ─── Roof slab ───────────────────────────────────────────────
    const roofGeo = new THREE.BoxGeometry(buildingW + 0.6, 0.12, buildingD + 0.6);
    const roofMat = new THREE.MeshStandardMaterial({
      color: "#d0ccc4",
      roughness: 0.8,
      metalness: 0.05,
      transparent: true,
      opacity: 0,
    });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.set(centerX, wallHeight + 0.06, centerZ);
    roof.castShadow = true;
    buildingGroup.add(roof);

    scene.add(buildingGroup);

    // ─── Environment map ─────────────────────────────────────────
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

    // ─── Animation state ─────────────────────────────────────────
    let progress = 0;
    let animationDone = false;
    const ANIM_SPEED = 0.008; // ~4 seconds at 60fps

    function animate() {
      animFrameRef.current = requestAnimationFrame(animate);

      if (!animationDone) {
        progress = Math.min(progress + ANIM_SPEED, 1);

        // Phase 1: Walls grow (progress 0 → 0.6)
        const wallProgress = Math.min(progress / 0.6, 1);
        wallMeshes.forEach((wall, i) => {
          const stagger = (i / wallMeshes.length) * 0.15;
          const localP = Math.max(0, Math.min((wallProgress - stagger) / (1 - stagger), 1));
          const eased = 1 - Math.pow(1 - localP, 3); // ease-out cubic
          wall.scale.y = eased;
          // Position walls so they grow upward from floor
          const originalY = wall.position.y; // This was set to 0 initially
          void originalY;
          wall.position.y = (wallHeight * eased) / 2 + 0.15;
        });

        // Phase 2: Camera orbit (progress 0.15 → 0.75)
        const camProgress = Math.max(0, Math.min((progress - 0.15) / 0.6, 1));
        const camEased = camProgress * camProgress * (3 - 2 * camProgress); // smoothstep
        camera.position.lerpVectors(topDownPos, isometricPos, camEased);
        const targetY = THREE.MathUtils.lerp(0, wallHeight * 0.4, camEased);
        camera.lookAt(new THREE.Vector3(centerX, targetY, centerZ));
        controls.target.set(centerX, targetY, centerZ);

        // Phase 3: Windows/doors fade in (progress 0.55 → 0.9)
        const winProgress = Math.max(0, Math.min((progress - 0.55) / 0.35, 1));
        windowMeshes.forEach(m => {
          if (m.material instanceof THREE.MeshPhysicalMaterial) {
            m.material.opacity = winProgress * 0.4;
          } else if (m.material instanceof THREE.MeshStandardMaterial) {
            m.material.opacity = winProgress;
          }
        });

        // Phase 4: Labels + roof fade in (progress 0.6 → 1.0)
        const labelProgress = Math.max(0, Math.min((progress - 0.6) / 0.4, 1));
        labelSprites.forEach(s => {
          (s.material as THREE.SpriteMaterial).opacity = labelProgress;
        });
        roofMat.opacity = labelProgress * 0.85;

        if (progress >= 1) {
          animationDone = true;
          controls.enabled = true;
          controls.autoRotate = true;
          controls.autoRotateSpeed = 0.8;
          onReady?.();
        }
      }

      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    // ─── Resize handler ──────────────────────────────────────────
    const onResize = () => {
      if (!container) return;
      const nw = container.clientWidth;
      const nh = container.clientHeight;
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
      // Dispose geometries and materials
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach(m => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
      });
      scene.clear();
    };
  }, [rooms, buildingHeight, floors, onReady]);

  useEffect(() => {
    const cleanup = buildScene();
    return () => { cleanup?.(); };
  }, [buildScene]);

  // ─── Fullscreen toggle ─────────────────────────────────────────

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(prev => !prev);
  }, []);

  // Rebuild scene when fullscreen changes (container size changes)
  useEffect(() => {
    // Small delay to let DOM update
    const timer = setTimeout(() => {
      const cleanup = buildScene();
      return () => { cleanup?.(); };
    }, 50);
    return () => clearTimeout(timer);
  }, [isFullscreen, buildScene]);

  // ─── Stats ─────────────────────────────────────────────────────
  const totalArea = rooms.reduce((s, r) => s + r.area, 0);
  const roomCount = rooms.length;

  // ─── Render ────────────────────────────────────────────────────

  const viewer = (
    <div style={{
      position: "relative",
      background: "#07070e",
      borderRadius: isFullscreen ? 0 : 14,
      overflow: "hidden",
      border: isFullscreen ? "none" : "1px solid rgba(255,255,255,0.08)",
    }}>
      <div
        ref={containerRef}
        style={{
          width: "100%",
          height: isFullscreen ? "100vh" : 400,
          minHeight: 400,
          cursor: "grab",
        }}
      />

      {/* Bottom bar */}
      <div style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        padding: "10px 16px",
        background: "linear-gradient(transparent, rgba(0,0,0,0.7))",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        pointerEvents: "none",
      }}>
        {/* Stats */}
        <div style={{
          display: "flex",
          gap: 16,
          fontSize: 10,
          color: "rgba(255,255,255,0.5)",
          letterSpacing: "0.03em",
        }}>
          <span>{roomCount} rooms</span>
          <span>{totalArea} m\u00B2</span>
          {floors > 1 && <span>{floors} floors</span>}
          {buildingHeight && <span>{buildingHeight}m height</span>}
        </div>

        {/* Controls */}
        <div style={{
          display: "flex",
          gap: 6,
          pointerEvents: "auto",
        }}>
          <button
            onClick={toggleFullscreen}
            style={{
              padding: "5px 12px",
              borderRadius: 6,
              background: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.15)",
              color: "#e0e0ea",
              fontSize: 10,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = "rgba(255,255,255,0.18)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = "rgba(255,255,255,0.1)";
            }}
          >
            {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
          </button>
        </div>
      </div>

      {/* Hint overlay */}
      <div style={{
        position: "absolute",
        top: 12,
        right: 12,
        fontSize: 9,
        color: "rgba(255,255,255,0.2)",
        pointerEvents: "none",
      }}>
        Drag to orbit &middot; Scroll to zoom
      </div>
    </div>
  );

  if (isFullscreen) {
    return (
      <div style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 9999,
        background: "#07070e",
      }}>
        {viewer}
      </div>
    );
  }

  return viewer;
}
