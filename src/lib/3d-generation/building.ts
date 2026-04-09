import * as THREE from "three";
import type { RoomDef, RoomType, DoorMesh, BuildingConfig, BuildingStyle } from "@/types/architectural-viewer";
import type { MaterialLibrary } from "@/lib/3d-generation/materials";

// ─── Default Style ───────────────────────────────────────────────────────────

const DEFAULT_STYLE: BuildingStyle = {
  glassHeavy: false,
  hasRiver: false,
  hasLake: false,
  isModern: true,
  isTower: false,
  exteriorMaterial: "mixed",
  environment: "suburban",
  usage: "mixed",
  promptText: "",
  typology: "generic",
  facadePattern: "none",
  maxFloorCap: 30,
};

// ─── Procedural Room Generation ──────────────────────────────────────────────

function generateFloorLayout(
  floorIdx: number,
  totalFloors: number,
  style: BuildingStyle,
  footprintW: number,
  footprintD: number
): RoomDef[] {
  const rooms: RoomDef[] = [];
  const isGround = floorIdx === 0;
  const isTop = floorIdx === totalFloors - 1;
  const usage = style.usage;

  // Stairs always present
  rooms.push({
    name: floorIdx === 0 ? "Lobby Stairs" : `Stairs F${floorIdx}`,
    x: footprintW - 3.5, z: footprintD - 4,
    width: 3.5, depth: 4,
    floor: floorIdx, type: "stairs",
  });

  // Elevator shaft (hallway visual)
  rooms.push({
    name: floorIdx === 0 ? "Elevator Lobby" : `Corridor F${floorIdx}`,
    x: footprintW - 3.5 - 3, z: footprintD - 4,
    width: 3, depth: 4,
    floor: floorIdx, type: "hallway",
  });

  if (isGround) {
    // Ground floor — lobby + retail/reception
    rooms.push({
      name: "Main Lobby",
      x: 0, z: 0,
      width: footprintW * 0.5, depth: footprintD * 0.45,
      floor: 0, type: "lobby",
    });

    if (usage === "mixed" || usage === "commercial") {
      rooms.push({
        name: "Retail Space",
        x: footprintW * 0.5, z: 0,
        width: footprintW * 0.5 - 3.5, depth: footprintD * 0.45,
        floor: 0, type: "retail",
      });
    } else {
      rooms.push({
        name: "Reception",
        x: footprintW * 0.5, z: 0,
        width: footprintW * 0.5 - 3.5, depth: footprintD * 0.45,
        floor: 0, type: "hallway",
      });
    }

    rooms.push({
      name: "Lounge",
      x: 0, z: footprintD * 0.45,
      width: footprintW * 0.4, depth: footprintD * 0.55 - 4,
      floor: 0, type: "lounge",
    });
    rooms.push({
      name: "Back Office",
      x: footprintW * 0.4, z: footprintD * 0.45,
      width: footprintW * 0.6 - 6.5, depth: footprintD * 0.55 - 4,
      floor: 0, type: "office",
    });
  } else if (usage === "office" || (usage === "mixed" && floorIdx < totalFloors * 0.6)) {
    // Office floors
    const officeW = footprintW - 6.5;
    const officeD = footprintD - 4;

    rooms.push({
      name: `Open Office F${floorIdx}`,
      x: 0, z: 0,
      width: officeW * 0.6, depth: officeD * 0.6,
      floor: floorIdx, type: "openOffice",
    });
    rooms.push({
      name: `Meeting Room F${floorIdx}`,
      x: officeW * 0.6, z: 0,
      width: officeW * 0.4, depth: officeD * 0.4,
      floor: floorIdx, type: "conference",
    });
    rooms.push({
      name: `Manager Office F${floorIdx}`,
      x: officeW * 0.6, z: officeD * 0.4,
      width: officeW * 0.4, depth: officeD * 0.3,
      floor: floorIdx, type: "office",
    });
    rooms.push({
      name: `Break Room F${floorIdx}`,
      x: 0, z: officeD * 0.6,
      width: officeW * 0.35, depth: officeD * 0.4,
      floor: floorIdx, type: "kitchen",
    });
    rooms.push({
      name: `Washroom F${floorIdx}`,
      x: officeW * 0.6, z: officeD * 0.7,
      width: officeW * 0.4, depth: officeD * 0.3,
      floor: floorIdx, type: "bathroom",
    });
    rooms.push({
      name: `Corridor F${floorIdx}`,
      x: officeW * 0.35, z: officeD * 0.6,
      width: officeW * 0.25, depth: officeD * 0.4,
      floor: floorIdx, type: "hallway",
    });
  } else if (usage === "residential" || usage === "mixed") {
    // Residential floors
    const unitW = footprintW - 6.5;
    const unitD = footprintD - 4;

    rooms.push({
      name: `Living Room F${floorIdx}`,
      x: 0, z: 0,
      width: unitW * 0.5, depth: unitD * 0.5,
      floor: floorIdx, type: "living",
    });
    rooms.push({
      name: `Kitchen F${floorIdx}`,
      x: unitW * 0.5, z: 0,
      width: unitW * 0.5, depth: unitD * 0.35,
      floor: floorIdx, type: "kitchen",
    });
    rooms.push({
      name: `Dining F${floorIdx}`,
      x: unitW * 0.5, z: unitD * 0.35,
      width: unitW * 0.5, depth: unitD * 0.25,
      floor: floorIdx, type: "dining",
    });
    rooms.push({
      name: `Master Bedroom F${floorIdx}`,
      x: 0, z: unitD * 0.5,
      width: unitW * 0.4, depth: unitD * 0.5,
      floor: floorIdx, type: "bedroom",
    });
    rooms.push({
      name: `Bedroom 2 F${floorIdx}`,
      x: unitW * 0.4, z: unitD * 0.6,
      width: unitW * 0.35, depth: unitD * 0.4,
      floor: floorIdx, type: "bedroom",
    });
    rooms.push({
      name: `Bathroom F${floorIdx}`,
      x: unitW * 0.75, z: unitD * 0.6,
      width: unitW * 0.25, depth: unitD * 0.4,
      floor: floorIdx, type: "bathroom",
    });
  } else if (usage === "educational") {
    // School / university floors — classrooms + corridor
    const unitW = footprintW - 6.5;
    const unitD = footprintD - 4;
    const numClassrooms = Math.max(2, Math.floor(unitW / 8));
    const classroomW = unitW / numClassrooms;

    for (let c = 0; c < numClassrooms; c++) {
      rooms.push({
        name: `Classroom ${floorIdx * 100 + c + 1}`,
        x: c * classroomW, z: 0,
        width: classroomW, depth: unitD * 0.7,
        floor: floorIdx, type: "classroom",
      });
    }
    rooms.push({
      name: `Corridor F${floorIdx}`,
      x: 0, z: unitD * 0.7,
      width: unitW, depth: unitD * 0.3,
      floor: floorIdx, type: "hallway",
    });
  } else if (usage === "healthcare") {
    // Hospital floors — wards + nurse station + corridor
    const unitW = footprintW - 6.5;
    const unitD = footprintD - 4;

    rooms.push({
      name: `Central Corridor F${floorIdx}`,
      x: 0, z: unitD * 0.4,
      width: unitW, depth: unitD * 0.2,
      floor: floorIdx, type: "hallway",
    });
    rooms.push({
      name: `Ward A F${floorIdx}`,
      x: 0, z: 0,
      width: unitW * 0.5, depth: unitD * 0.4,
      floor: floorIdx, type: "ward",
    });
    rooms.push({
      name: `Ward B F${floorIdx}`,
      x: unitW * 0.5, z: 0,
      width: unitW * 0.5, depth: unitD * 0.4,
      floor: floorIdx, type: "ward",
    });
    rooms.push({
      name: `Treatment F${floorIdx}`,
      x: 0, z: unitD * 0.6,
      width: unitW * 0.6, depth: unitD * 0.4,
      floor: floorIdx, type: "office",
    });
    rooms.push({
      name: `Nurse Station F${floorIdx}`,
      x: unitW * 0.6, z: unitD * 0.6,
      width: unitW * 0.4, depth: unitD * 0.4,
      floor: floorIdx, type: "office",
    });
  } else if (usage === "cultural") {
    // Museum / gallery floors — galleries + passage
    const unitW = footprintW - 6.5;
    const unitD = footprintD - 4;

    rooms.push({
      name: `Main Gallery F${floorIdx}`,
      x: 0, z: 0,
      width: unitW * 0.7, depth: unitD * 0.7,
      floor: floorIdx, type: "gallery",
    });
    rooms.push({
      name: `Side Gallery F${floorIdx}`,
      x: unitW * 0.7, z: 0,
      width: unitW * 0.3, depth: unitD * 0.5,
      floor: floorIdx, type: "gallery",
    });
    rooms.push({
      name: `Passage F${floorIdx}`,
      x: 0, z: unitD * 0.7,
      width: unitW, depth: unitD * 0.3,
      floor: floorIdx, type: "hallway",
    });
  } else if (usage === "industrial") {
    // Warehouse / factory — large open hall + office
    const unitW = footprintW - 6.5;
    const unitD = footprintD - 4;

    rooms.push({
      name: `Main Hall F${floorIdx}`,
      x: 0, z: 0,
      width: unitW, depth: unitD * 0.8,
      floor: floorIdx, type: "storage",
    });
    rooms.push({
      name: `Office F${floorIdx}`,
      x: 0, z: unitD * 0.8,
      width: unitW * 0.4, depth: unitD * 0.2,
      floor: floorIdx, type: "office",
    });
  } else {
    // Hotel / generic
    const unitW = footprintW - 6.5;
    const unitD = footprintD - 4;
    const numRooms = Math.max(2, Math.min(4, Math.floor(unitW / 5)));
    const roomW = unitW / numRooms;

    for (let r = 0; r < numRooms; r++) {
      rooms.push({
        name: `Suite ${floorIdx * 100 + r + 1}`,
        x: r * roomW, z: 0,
        width: roomW, depth: unitD * 0.65,
        floor: floorIdx, type: "bedroom",
      });
      rooms.push({
        name: `Bath ${floorIdx * 100 + r + 1}`,
        x: r * roomW, z: unitD * 0.65,
        width: roomW, depth: unitD * 0.35,
        floor: floorIdx, type: "bathroom",
      });
    }
  }

  // Top floor extras
  if (isTop && totalFloors > 2) {
    rooms.push({
      name: "Roof Terrace",
      x: 0, z: 0,
      width: footprintW * 0.4, depth: footprintD * 0.3,
      floor: floorIdx + 1, type: "terrace", hasCeiling: false,
    });
  }

  return rooms;
}

// Simplified floor for LOD (buildings with 13+ floors — intermediate floors get minimal layout)
function generateSimplifiedFloor(
  floorIdx: number,
  totalFloors: number,
  style: BuildingStyle,
  footprintW: number,
  footprintD: number
): RoomDef[] {
  const rooms: RoomDef[] = [];
  const usage = style.usage;

  // Core
  rooms.push({
    name: `Stairs F${floorIdx}`,
    x: footprintW - 3.5, z: footprintD - 4,
    width: 3.5, depth: 4,
    floor: floorIdx, type: "stairs",
  });
  rooms.push({
    name: `Corridor F${floorIdx}`,
    x: footprintW - 3.5 - 3, z: footprintD - 4,
    width: 3, depth: 4,
    floor: floorIdx, type: "hallway",
  });

  // Single large zone based on usage
  const zoneW = footprintW - 6.5;
  const zoneD = footprintD - 4;
  const zoneInfo = (() => {
    switch (usage) {
      case "office": return { label: "Open Office", type: "openOffice" as RoomType };
      case "residential": return { label: "Apartment", type: "living" as RoomType };
      case "hotel": return { label: "Suite", type: "bedroom" as RoomType };
      case "educational": return { label: "Classroom", type: "classroom" as RoomType };
      case "healthcare": return { label: "Ward", type: "ward" as RoomType };
      case "cultural": return { label: "Gallery", type: "gallery" as RoomType };
      case "industrial": return { label: "Storage", type: "storage" as RoomType };
      default:
        // Mixed: lower 60% office, upper 40% residential
        if (floorIdx < totalFloors * 0.6) return { label: "Open Office", type: "openOffice" as RoomType };
        return { label: "Apartment", type: "living" as RoomType };
    }
  })();

  rooms.push({
    name: `${zoneInfo.label} F${floorIdx}`,
    x: 0, z: 0,
    width: zoneW, depth: zoneD,
    floor: floorIdx, type: zoneInfo.type,
  });

  return rooms;
}

export function generateRoomsForBuilding(
  floors: number,
  style: BuildingStyle,
  footprint: number
): RoomDef[] {
  const ratio = style.isTower ? 0.7 : (style.typology === "slab" ? 0.45 : 0.6);
  const footprintW = Math.sqrt(footprint / ratio);
  const footprintD = footprintW * ratio;

  // Podium-tower: wider base for first 2-3 floors, narrower tower above
  const isPodiumTower = style.typology === "podium-tower" && floors >= 5;
  const podiumFloors = isPodiumTower ? Math.min(3, Math.floor(floors * 0.2) + 1) : 0;
  const podiumScale = 1.3; // podium is 30% wider than tower
  const podiumW = isPodiumTower ? footprintW * podiumScale : footprintW;
  const podiumD = isPodiumTower ? footprintD * podiumScale : footprintD;

  const allRooms: RoomDef[] = [];
  const maxFloors = Math.max(1, Math.min(floors, style.maxFloorCap ?? 30));

  // LOD: For 13+ floors, only generate detailed rooms for key floors
  const detailedFloors = new Set<number>();
  detailedFloors.add(0); // always ground
  detailedFloors.add(maxFloors - 1); // always top
  if (maxFloors > 3) detailedFloors.add(1);
  if (maxFloors > 6) detailedFloors.add(Math.floor(maxFloors / 2));
  if (maxFloors > 12) detailedFloors.add(Math.floor(maxFloors * 0.75));

  for (let f = 0; f < maxFloors; f++) {
    // Podium floors use wider footprint and commercial usage
    const floorW = isPodiumTower && f < podiumFloors ? podiumW : footprintW;
    const floorD = isPodiumTower && f < podiumFloors ? podiumD : footprintD;
    const floorStyle = isPodiumTower && f < podiumFloors
      ? { ...style, usage: "commercial" as const }
      : style;

    if (maxFloors <= 12 || detailedFloors.has(f)) {
      allRooms.push(...generateFloorLayout(f, maxFloors, floorStyle, floorW, floorD));
    } else {
      allRooms.push(...generateSimplifiedFloor(f, maxFloors, floorStyle, floorW, floorD));
    }
  }

  return allRooms;
}

export function getDefaultConfig(style?: BuildingStyle): BuildingConfig {
  return {
    floors: 2,
    floorHeight: style?.floorHeightOverride ?? 3.6,
    rooms: [],
    wallThickness: 0.15,
    exteriorWallThickness: 0.25,
    style: style ?? DEFAULT_STYLE,
  };
}

// ─── Room Floor Material Mapping ──────────────────────────────────────────────

function getFloorMaterial(type: RoomType, mats: MaterialLibrary): THREE.Material {
  switch (type) {
    case "living":
    case "dining":
    case "bedroom":
    case "office":
      return mats.herringboneFloor;
    case "kitchen":
    case "conference":
      return mats.tileFloor;
    case "bathroom":
      return mats.marbleFloor;
    case "lobby":
    case "lounge":
      return mats.marbleFloor;
    case "openOffice":
      return mats.concreteFloor;
    case "hallway":
    case "stairs":
    case "closet":
    case "retail":
    case "gym":
      return mats.concreteFloor;
    case "terrace":
      return mats.concreteFloor;
    case "gallery":
    case "mechanical":
    case "storage":
      return mats.concreteFloor;
    case "classroom":
    case "ward":
      return mats.tileFloor;
    case "reception":
    case "restaurant":
    case "spa":
      return mats.marbleFloor;
    default:
      return mats.herringboneFloor;
  }
}

function getWallMaterial(type: RoomType, mats: MaterialLibrary, isAccent = false): THREE.Material {
  if (isAccent) return mats.accentWall;
  switch (type) {
    case "bathroom": return mats.tileFloor;
    case "kitchen": return mats.whiteWall;
    default: return mats.whiteWall;
  }
}

// ─── Brise-Soleil Facade ─────────────────────────────────────────────────────

function createBriseSoleilFacade(
  pos: THREE.Vector3,
  length: number,
  height: number,
  isHorizontal: boolean,
  mats: MaterialLibrary,
  parent: THREE.Group,
  wallMat: THREE.Material
) {
  const frameHeight = height - 0.24;
  const finSpacing = 0.4;
  const finDepth = 0.25;
  const finThickness = 0.03;
  const numFins = Math.max(2, Math.floor(frameHeight / finSpacing));

  if (isHorizontal) {
    // Back wall (recessed glazing)
    const glassGeo = new THREE.BoxGeometry(length - 0.1, frameHeight, 0.02);
    const glassMesh = new THREE.Mesh(glassGeo, mats.glass);
    glassMesh.position.set(pos.x, pos.y, pos.z);
    parent.add(glassMesh);

    // Spandrel strip at slab level
    const spandrelGeo = new THREE.BoxGeometry(length - 0.1, 0.3, 0.04);
    const spandrelMesh = new THREE.Mesh(spandrelGeo, mats.spandrelPanel);
    spandrelMesh.position.set(pos.x, pos.y - frameHeight / 2 + 0.15, pos.z);
    parent.add(spandrelMesh);

    // Horizontal fins (louvers)
    for (let i = 0; i < numFins; i++) {
      const fy = pos.y - frameHeight / 2 + (i + 0.5) * (frameHeight / numFins);
      const finGeo = new THREE.BoxGeometry(length, finThickness, finDepth);
      const finMesh = new THREE.Mesh(finGeo, mats.briseSoleilFin);
      finMesh.position.set(pos.x, fy, pos.z + finDepth / 2 + 0.02);
      // Tilt fins 15 degrees for solar shading
      finMesh.rotation.x = -Math.PI / 12;
      parent.add(finMesh);
    }

    // Vertical support mullions (every 1.5m)
    const mullionCount = Math.max(2, Math.floor(length / 1.5));
    for (let i = 0; i <= mullionCount; i++) {
      const mx = pos.x - length / 2 + (i / mullionCount) * length;
      const mGeo = new THREE.BoxGeometry(0.04, frameHeight, finDepth + 0.04);
      const mMesh = new THREE.Mesh(mGeo, mats.metal);
      mMesh.position.set(mx, pos.y, pos.z + finDepth / 2);
      parent.add(mMesh);
    }
  } else {
    // Same for vertical walls
    const glassGeo = new THREE.BoxGeometry(0.02, frameHeight, length - 0.1);
    const glassMesh = new THREE.Mesh(glassGeo, mats.glass);
    glassMesh.position.set(pos.x, pos.y, pos.z);
    parent.add(glassMesh);

    const spandrelGeo = new THREE.BoxGeometry(0.04, 0.3, length - 0.1);
    const spandrelMesh = new THREE.Mesh(spandrelGeo, mats.spandrelPanel);
    spandrelMesh.position.set(pos.x, pos.y - frameHeight / 2 + 0.15, pos.z);
    parent.add(spandrelMesh);

    for (let i = 0; i < numFins; i++) {
      const fy = pos.y - frameHeight / 2 + (i + 0.5) * (frameHeight / numFins);
      const finGeo = new THREE.BoxGeometry(finDepth, finThickness, length);
      const finMesh = new THREE.Mesh(finGeo, mats.briseSoleilFin);
      finMesh.position.set(pos.x + finDepth / 2 + 0.02, fy, pos.z);
      finMesh.rotation.z = Math.PI / 12;
      parent.add(finMesh);
    }

    const mullionCount = Math.max(2, Math.floor(length / 1.5));
    for (let i = 0; i <= mullionCount; i++) {
      const mz = pos.z - length / 2 + (i / mullionCount) * length;
      const mGeo = new THREE.BoxGeometry(finDepth + 0.04, frameHeight, 0.04);
      const mMesh = new THREE.Mesh(mGeo, mats.metal);
      mMesh.position.set(pos.x + finDepth / 2, pos.y, mz);
      parent.add(mMesh);
    }
  }
}

// ─── Ribbon Window Facade ────────────────────────────────────────────────────

function createRibbonWindowFacade(
  pos: THREE.Vector3,
  length: number,
  height: number,
  thickness: number,
  isHorizontal: boolean,
  mats: MaterialLibrary,
  parent: THREE.Group,
  wallMat: THREE.Material
) {
  const frameHeight = height - 0.12;
  // Ribbon windows: continuous horizontal glass band with solid wall above and below
  const ribbonH = frameHeight * 0.4; // 40% of floor height is glass
  const sillH = frameHeight * 0.3;   // 30% solid below
  const headerH = frameHeight - ribbonH - sillH; // 30% solid above

  if (isHorizontal) {
    // Solid wall below (sill zone)
    if (sillH > 0.1) {
      const sillGeo = new THREE.BoxGeometry(length, sillH, thickness);
      const sillMesh = new THREE.Mesh(sillGeo, wallMat);
      sillMesh.position.set(pos.x, pos.y - frameHeight / 2 + sillH / 2 + 0.06, pos.z);
      parent.add(sillMesh);
    }

    // Continuous glass ribbon
    const glassGeo = new THREE.BoxGeometry(length - 0.05, ribbonH, 0.02);
    const glassMesh = new THREE.Mesh(glassGeo, mats.glass);
    glassMesh.position.set(pos.x, pos.y - frameHeight / 2 + sillH + ribbonH / 2 + 0.06, pos.z);
    parent.add(glassMesh);

    // Thin metal frame at top and bottom of ribbon
    for (const oy of [0, ribbonH]) {
      const frameMesh = new THREE.Mesh(
        new THREE.BoxGeometry(length, 0.03, 0.05),
        mats.metal
      );
      frameMesh.position.set(pos.x, pos.y - frameHeight / 2 + sillH + oy + 0.06, pos.z);
      parent.add(frameMesh);
    }

    // Solid wall above (header zone)
    if (headerH > 0.1) {
      const headerGeo = new THREE.BoxGeometry(length, headerH, thickness);
      const headerMesh = new THREE.Mesh(headerGeo, wallMat);
      headerMesh.position.set(pos.x, pos.y + frameHeight / 2 - headerH / 2 - 0.06, pos.z);
      parent.add(headerMesh);
    }

    // Subtle vertical mullion divisions every 2m
    const divCount = Math.max(1, Math.floor(length / 2));
    for (let i = 1; i < divCount; i++) {
      const dx = pos.x - length / 2 + (i / divCount) * length;
      const divMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.02, ribbonH, 0.04),
        mats.metal
      );
      divMesh.position.set(dx, pos.y - frameHeight / 2 + sillH + ribbonH / 2 + 0.06, pos.z);
      parent.add(divMesh);
    }
  } else {
    // Vertical wall version
    if (sillH > 0.1) {
      const sillGeo = new THREE.BoxGeometry(thickness, sillH, length);
      const sillMesh = new THREE.Mesh(sillGeo, wallMat);
      sillMesh.position.set(pos.x, pos.y - frameHeight / 2 + sillH / 2 + 0.06, pos.z);
      parent.add(sillMesh);
    }

    const glassGeo = new THREE.BoxGeometry(0.02, ribbonH, length - 0.05);
    const glassMesh = new THREE.Mesh(glassGeo, mats.glass);
    glassMesh.position.set(pos.x, pos.y - frameHeight / 2 + sillH + ribbonH / 2 + 0.06, pos.z);
    parent.add(glassMesh);

    for (const oy of [0, ribbonH]) {
      const frameMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.05, 0.03, length),
        mats.metal
      );
      frameMesh.position.set(pos.x, pos.y - frameHeight / 2 + sillH + oy + 0.06, pos.z);
      parent.add(frameMesh);
    }

    if (headerH > 0.1) {
      const headerGeo = new THREE.BoxGeometry(thickness, headerH, length);
      const headerMesh = new THREE.Mesh(headerGeo, wallMat);
      headerMesh.position.set(pos.x, pos.y + frameHeight / 2 - headerH / 2 - 0.06, pos.z);
      parent.add(headerMesh);
    }

    const divCount = Math.max(1, Math.floor(length / 2));
    for (let i = 1; i < divCount; i++) {
      const dz = pos.z - length / 2 + (i / divCount) * length;
      const divMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.04, ribbonH, 0.02),
        mats.metal
      );
      divMesh.position.set(pos.x, pos.y - frameHeight / 2 + sillH + ribbonH / 2 + 0.06, dz);
      parent.add(divMesh);
    }
  }
}

// ─── Build Full Scene ─────────────────────────────────────────────────────────

export function buildBuilding(
  config: BuildingConfig,
  mats: MaterialLibrary,
  scene: THREE.Scene
): { doors: DoorMesh[]; roomLabels: THREE.Group; buildingGroup: THREE.Group } {
  const { floorHeight, rooms, wallThickness, style } = config;
  const doors: DoorMesh[] = [];
  const buildingGroup = new THREE.Group();
  const roomLabels = new THREE.Group();

  // Find building bounds
  let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
  for (const room of rooms) {
    minX = Math.min(minX, room.x);
    minZ = Math.min(minZ, room.z);
    maxX = Math.max(maxX, room.x + room.width);
    maxZ = Math.max(maxZ, room.z + room.depth);
  }

  const buildingW = maxX - minX;
  const buildingD = maxZ - minZ;
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;

  const isGlassBuilding = style.glassHeavy || style.exteriorMaterial === "glass";

  const tagFloor = (obj: THREE.Object3D, floor: number) => {
    obj.userData.floor = floor;
    obj.userData.originalY = obj.position.y;
  };

  // Enable shadow casting/receiving on all added meshes
  const addShadowMesh = (mesh: THREE.Mesh, parent: THREE.Object3D, cast = true, receive = true) => {
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    parent.add(mesh);
  };

  // Choose exterior wall material based on style
  const extWallMat = (() => {
    switch (style.exteriorMaterial) {
      case "glass": return mats.concreteWall; // spandrel panels between glass
      case "concrete": return mats.concreteWall;
      case "brick": return mats.exteriorWall;
      case "wood": return mats.wood;
      case "steel": return mats.brushedMetal;
      case "stone": return mats.stoneWall;
      case "terracotta": return mats.terracottaWall;
      default: return style.isModern ? mats.concreteWall : mats.exteriorWall;
    }
  })();

  // ─── For each floor level ──────────────────────────────────────
  for (let floorIdx = 0; floorIdx < config.floors; floorIdx++) {
    const floorRooms = rooms.filter(r => r.floor === floorIdx);
    const baseY = floorIdx * floorHeight;

    for (const room of floorRooms) {
      const rx = room.x - centerX;
      const rz = room.z - centerZ;

      // ─── Floor slab ──────────────────────────────────────────
      const floorGeo = new THREE.BoxGeometry(room.width, 0.12, room.depth);
      const floorMesh = new THREE.Mesh(floorGeo, getFloorMaterial(room.type, mats));
      floorMesh.position.set(rx + room.width / 2, baseY + 0.06, rz + room.depth / 2);

      tagFloor(floorMesh, floorIdx);
      addShadowMesh(floorMesh, buildingGroup, false, true);

      // ─── Ceiling ────────────────────────────────────────────
      if (room.hasCeiling !== false) {
        const ceilGeo = new THREE.BoxGeometry(room.width - 0.02, 0.08, room.depth - 0.02);
        const ceilMesh = new THREE.Mesh(ceilGeo, mats.ceiling);
        ceilMesh.position.set(rx + room.width / 2, baseY + floorHeight - 0.04, rz + room.depth / 2);

        tagFloor(ceilMesh, floorIdx);
        buildingGroup.add(ceilMesh);
      }

      // ─── Walls ───────────────────────────────────────────────
      const wallDefs = [
        { dir: "south", x1: rx, z1: rz, x2: rx + room.width, z2: rz, nx: 0, nz: -1 },
        { dir: "north", x1: rx, z1: rz + room.depth, x2: rx + room.width, z2: rz + room.depth, nx: 0, nz: 1 },
        { dir: "west", x1: rx, z1: rz, x2: rx, z2: rz + room.depth, nx: -1, nz: 0 },
        { dir: "east", x1: rx + room.width, z1: rz, x2: rx + room.width, z2: rz + room.depth, nx: 1, nz: 0 },
      ];

      for (const wd of wallDefs) {
        const wallLen = Math.sqrt((wd.x2 - wd.x1) ** 2 + (wd.z2 - wd.z1) ** 2);
        if (wallLen < 0.1) continue;

        const midX = (wd.x1 + wd.x2) / 2 + wd.nx * 0.3;
        const midZ = (wd.z1 + wd.z2) / 2 + wd.nz * 0.3;
        const isExterior = !floorRooms.some(other => {
          if (other === room) return false;
          const ox = other.x - centerX;
          const oz = other.z - centerZ;
          return midX >= ox - 0.1 && midX <= ox + other.width + 0.1 &&
                 midZ >= oz - 0.1 && midZ <= oz + other.depth + 0.1;
        });

        const wt = isExterior ? config.exteriorWallThickness : wallThickness;
        const isHorizontal = Math.abs(wd.z1 - wd.z2) < 0.01;

        // Open plan between living/kitchen/dining and lobby/lounge
        const openPlanTypes: RoomType[] = ["living", "kitchen", "dining", "lobby", "lounge", "openOffice"];
        if (!isExterior && openPlanTypes.includes(room.type)) {
          const adjacentRoom = floorRooms.find(other => {
            if (other === room) return false;
            const ox = other.x - centerX;
            const oz = other.z - centerZ;
            return midX >= ox - 0.3 && midX <= ox + other.width + 0.3 &&
                   midZ >= oz - 0.3 && midZ <= oz + other.depth + 0.3;
          });
          if (adjacentRoom && openPlanTypes.includes(adjacentRoom.type)) continue;
        }

        // Wall geometry
        let wallGeo: THREE.BoxGeometry;
        let wallPos: THREE.Vector3;

        if (isHorizontal) {
          wallGeo = new THREE.BoxGeometry(wallLen, floorHeight - 0.12, wt);
          wallPos = new THREE.Vector3(
            (wd.x1 + wd.x2) / 2,
            baseY + floorHeight / 2,
            wd.z1 + (wd.nz * wt / 2)
          );
        } else {
          wallGeo = new THREE.BoxGeometry(wt, floorHeight - 0.12, wallLen);
          wallPos = new THREE.Vector3(
            wd.x1 + (wd.nx * wt / 2),
            baseY + floorHeight / 2,
            (wd.z1 + wd.z2) / 2
          );
        }

        const hasWindows = isExterior && wallLen > 2 &&
          room.type !== "bathroom" && room.type !== "stairs" && room.type !== "closet";

        // Glass building: all exterior walls become glass curtain walls
        const glassEligibleTypes: RoomType[] = [
          "living", "dining", "bedroom", "lobby", "openOffice", "lounge",
          "gallery", "reception", "restaurant", "spa",
        ];
        const isGlassWall = isExterior && (
          isGlassBuilding ||
          (!isGlassBuilding && (wd.dir === "south" || wd.dir === "east") &&
            glassEligibleTypes.includes(room.type))
        );

        // Facade pattern routing based on style
        const isBriseSoleil = isExterior && style.facadePattern === "brise-soleil" &&
          room.type !== "stairs" && room.type !== "closet" && room.type !== "bathroom";
        const isRibbonWindow = isExterior && style.facadePattern === "ribbon-window" &&
          room.type !== "stairs" && room.type !== "closet" && room.type !== "bathroom" && wallLen > 2;

        if (isGlassWall) {
          createGlassCurtainWall(wallPos, wallLen, floorHeight, isHorizontal, mats, buildingGroup, floorIdx);
        } else if (isBriseSoleil) {
          createBriseSoleilFacade(wallPos, wallLen, floorHeight, isHorizontal, mats, buildingGroup, extWallMat);
        } else if (isRibbonWindow) {
          createRibbonWindowFacade(wallPos, wallLen, floorHeight, wt, isHorizontal, mats, buildingGroup, extWallMat);
        } else if (hasWindows) {
          createWallWithWindows(wallPos, wallLen, floorHeight, wt, isHorizontal, mats, buildingGroup, extWallMat);
        } else {
          const isAccent = !isExterior && (wd.dir === "north") && (room.type === "living" || room.type === "bedroom");
          const wallMat = isExterior ? extWallMat : getWallMaterial(room.type, mats, isAccent);
          const wallMesh = new THREE.Mesh(wallGeo, wallMat);
          wallMesh.position.copy(wallPos);

          tagFloor(wallMesh, floorIdx);
          buildingGroup.add(wallMesh);
        }

        // Interior doors
        if (!isExterior && wallLen > 1.5 && room.type !== "stairs") {
          const door = createDoor(
            wallPos, wallLen, isHorizontal, 0.9, 2.1,
            baseY, wt, mats, room.name
          );
          if (door) {
            tagFloor(door.pivot, floorIdx);
            buildingGroup.add(door.pivot);
            doors.push(door);
          }
        }
      }

      // ─── Baseboards ─────────────────────────────────────────
      if (room.type !== "terrace" && room.type !== "stairs") {
        const bbH = 0.08, bbD = 0.015;
        const bbDefs = [
          { w: room.width, d: bbD, x: rx + room.width / 2, z: rz + bbD / 2 },
          { w: room.width, d: bbD, x: rx + room.width / 2, z: rz + room.depth - bbD / 2 },
          { w: bbD, d: room.depth, x: rx + bbD / 2, z: rz + room.depth / 2 },
          { w: bbD, d: room.depth, x: rx + room.width - bbD / 2, z: rz + room.depth / 2 },
        ];
        for (const bb of bbDefs) {
          const bbMesh = new THREE.Mesh(
            new THREE.BoxGeometry(bb.w, bbH, bb.d),
            mats.whiteWall
          );
          bbMesh.position.set(bb.x, baseY + 0.12 + bbH / 2, bb.z);
          tagFloor(bbMesh, floorIdx);
          buildingGroup.add(bbMesh);
        }
      }

      // ─── Room label sprite ──────────────────────────────────
      const labelSprite = createRoomLabel(room.name, room.width * room.depth);
      labelSprite.position.set(rx + room.width / 2, baseY + 2.5, rz + room.depth / 2);
      roomLabels.add(labelSprite);
    }
  }

  // ─── Corner Columns (structural articulation at building edges) ──
  const bldgHeightFull = config.floors * floorHeight;
  const cornerColSize = 0.35;
  const cornerMat = isGlassBuilding ? mats.brushedMetal : mats.concreteWall;
  const hw = buildingW / 2, hd = buildingD / 2;
  for (const corner of [
    { x: -hw - 0.05, z: -hd - 0.05 },
    { x: hw + 0.05, z: -hd - 0.05 },
    { x: -hw - 0.05, z: hd + 0.05 },
    { x: hw + 0.05, z: hd + 0.05 },
  ]) {
    const colMesh = new THREE.Mesh(
      new THREE.BoxGeometry(cornerColSize, bldgHeightFull, cornerColSize),
      cornerMat
    );
    colMesh.position.set(corner.x, bldgHeightFull / 2, corner.z);
    buildingGroup.add(colMesh);
  }

  // ─── Building Base / Plinth (ground floor differentiation) ──────
  const plinthH = 0.4;
  const plinthMesh = new THREE.Mesh(
    new THREE.BoxGeometry(buildingW + 0.6, plinthH, buildingD + 0.6),
    mats.concreteWall
  );
  plinthMesh.position.set(0, plinthH / 2, 0);
  buildingGroup.add(plinthMesh);

  // ─── Roof ────────────────────────────────────────────────────────
  const roofGeo = new THREE.BoxGeometry(buildingW + 0.5, 0.2, buildingD + 0.5);
  const roofMesh = new THREE.Mesh(roofGeo, mats.roofTop);
  roofMesh.position.set(0, config.floors * floorHeight + 0.1, 0);

  buildingGroup.add(roofMesh);

  // Roof parapet (scales with building height)
  const bldgHeight = config.floors * floorHeight;
  const parapetH = Math.max(0.6, Math.min(1.2, bldgHeight * 0.015 + 0.4));
  const parapetT = 0.1;
  const parapetY = config.floors * floorHeight + 0.2 + parapetH / 2;
  const parapetMat = isGlassBuilding ? mats.brushedMetal
    : style.exteriorMaterial === "stone" ? mats.stoneWall
    : style.exteriorMaterial === "terracotta" ? mats.terracottaWall
    : mats.concreteWall;
  [
    { w: buildingW + 0.5, d: parapetT, x: 0, z: -(buildingD + 0.5) / 2 },
    { w: buildingW + 0.5, d: parapetT, x: 0, z: (buildingD + 0.5) / 2 },
    { w: parapetT, d: buildingD + 0.5, x: -(buildingW + 0.5) / 2, z: 0 },
    { w: parapetT, d: buildingD + 0.5, x: (buildingW + 0.5) / 2, z: 0 },
  ].forEach(p => {
    const pGeo = new THREE.BoxGeometry(p.w, parapetH, p.d);
    const pMesh = new THREE.Mesh(pGeo, parapetMat);
    pMesh.position.set(p.x, parapetY, p.z);

    buildingGroup.add(pMesh);
  });

  // Rooftop mechanical room (for buildings 5+ floors)
  if (config.floors >= 5) {
    const mechW = buildingW * 0.3;
    const mechD = buildingD * 0.25;
    const mechH = 2.5;
    const mechY = config.floors * floorHeight + 0.2 + mechH / 2;

    // Mechanical room enclosure
    const mechGeo = new THREE.BoxGeometry(mechW, mechH, mechD);
    const mechMesh = new THREE.Mesh(mechGeo, mats.concreteWall);
    mechMesh.position.set(buildingW * 0.15, mechY, buildingD * 0.1);
    buildingGroup.add(mechMesh);

    // Mechanical room roof
    const mechRoofGeo = new THREE.BoxGeometry(mechW + 0.3, 0.1, mechD + 0.3);
    const mechRoofMesh = new THREE.Mesh(mechRoofGeo, mats.roofTop);
    mechRoofMesh.position.set(buildingW * 0.15, mechY + mechH / 2 + 0.05, buildingD * 0.1);
    buildingGroup.add(mechRoofMesh);

    // Louver vents on mechanical room
    const ventGeo = new THREE.BoxGeometry(mechW * 0.6, mechH * 0.6, 0.05);
    const ventMesh = new THREE.Mesh(ventGeo, mats.metal);
    ventMesh.position.set(buildingW * 0.15, mechY, buildingD * 0.1 - mechD / 2 - 0.03);
    buildingGroup.add(ventMesh);
  }

  // ─── Stairs geometry ─────────────────────────────────────────────
  const stairsRooms = rooms.filter(r => r.type === "stairs");
  for (const sr of stairsRooms) {
    buildStairs(sr, centerX, centerZ, floorHeight, mats, buildingGroup);
  }

  // ─── Ground plane (adapts to environment) ────────────────────────
  const groundSize = Math.max(120, buildingW * 4, buildingD * 4, bldgHeight * 2);
  const groundGeo = new THREE.PlaneGeometry(groundSize, groundSize);
  const groundMat = (() => {
    switch (style.environment) {
      case "urban": return mats.concreteFloor;
      case "desert": return new THREE.MeshBasicMaterial({
        color: 0xC4A55A, side: THREE.DoubleSide
      });
      case "coastal": return new THREE.MeshBasicMaterial({
        color: 0xD4C8A0, side: THREE.DoubleSide
      });
      default: return mats.grass;
    }
  })();
  const groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.position.y = -0.01;
  groundMesh.receiveShadow = true;

  scene.add(groundMesh);

  // ─── Environment based on style ──────────────────────────────────
  if (style.hasRiver || style.hasLake) {
    buildWaterFeature(style, buildingW, buildingD, mats, scene);
  }

  // Concrete pathway to entrance
  const pathGeo = new THREE.BoxGeometry(3, 0.05, 15);
  const pathMesh = new THREE.Mesh(pathGeo, mats.concreteFloor);
  pathMesh.position.set(0, 0.025, -buildingD / 2 - 7.5);

  scene.add(pathMesh);

  // Front entrance canopy (scales slightly with building height)
  const canopyW = Math.min(buildingW * 0.5, Math.max(4, 3 + bldgHeight * 0.08));
  const canopyD = Math.min(4, 2 + bldgHeight * 0.05);
  const canopyGeo = new THREE.BoxGeometry(canopyW, 0.12, canopyD);
  const canopyMat = isGlassBuilding ? mats.brushedMetal : mats.concreteWall;
  const canopyMesh = new THREE.Mesh(canopyGeo, canopyMat);
  canopyMesh.position.set(0, floorHeight * 0.85, -buildingD / 2 - canopyD / 2);

  scene.add(canopyMesh);

  // Canopy supports
  for (const cx of [-canopyW / 2 + 0.15, canopyW / 2 - 0.15]) {
    const colMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, floorHeight * 0.85, 12),
      mats.brushedMetal
    );
    colMesh.position.set(cx, floorHeight * 0.85 / 2, -buildingD / 2 - canopyD + 0.15);

    scene.add(colMesh);
  }

  // Entry steps
  for (let s = 0; s < 3; s++) {
    const stepMesh = new THREE.Mesh(
      new THREE.BoxGeometry(canopyW, 0.08, 0.35),
      mats.concreteFloor
    );
    stepMesh.position.set(0, s * 0.08 + 0.04, -buildingD / 2 - 0.2 - s * 0.35);

    scene.add(stepMesh);
  }

  // Front door (glass)
  const frontDoor = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 2.4, 0.06),
    mats.darkGlass
  );
  frontDoor.position.set(0, 1.2, -buildingD / 2 - 0.03);
  scene.add(frontDoor);

  // Door frame
  for (const fx of [-0.95, 0.95]) {
    const frameSide = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 2.5, 0.08),
      mats.brushedMetal
    );
    frameSide.position.set(fx, 1.25, -buildingD / 2 - 0.03);
    scene.add(frameSide);
  }
  const frameTop = new THREE.Mesh(
    new THREE.BoxGeometry(1.95, 0.05, 0.08),
    mats.brushedMetal
  );
  frameTop.position.set(0, 2.5, -buildingD / 2 - 0.03);
  scene.add(frameTop);

  // Entrance light (no shadow — only sunlight casts shadows to keep shader simple)
  const entranceLight = new THREE.PointLight(0xFFE4B5, 0.8, Math.max(8, bldgHeight * 0.3));
  entranceLight.position.set(0, floorHeight * 0.8, -buildingD / 2 - 1);
  scene.add(entranceLight);

  // ─── Landscaping — Trees ─────────────────────────────────────
  const treePositions = generateTreePositions(buildingW, buildingD, style);
  for (const tp of treePositions) {
    const tree = createTree(mats, 2 + Math.random() * 3);
    tree.position.set(tp.x, 0, tp.z);
    tree.rotation.y = Math.random() * Math.PI * 2;
    scene.add(tree);
  }

  // ─── Ground bollards (visual only — no PointLights to keep PBR shader light) ──
  const lightPositions = [
    { x: -buildingW / 2 - 1, z: -buildingD / 2 - 1 },
    { x: buildingW / 2 + 1, z: -buildingD / 2 - 1 },
    { x: -buildingW / 2 - 1, z: buildingD / 2 + 1 },
    { x: buildingW / 2 + 1, z: buildingD / 2 + 1 },
    { x: -1.5, z: -buildingD / 2 - 3 },
    { x: 1.5, z: -buildingD / 2 - 3 },
  ];

  for (const lp of lightPositions) {
    const bollard = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.06, 0.8, 8),
      mats.brushedMetal
    );
    bollard.position.set(lp.x, 0.4, lp.z);

    scene.add(bollard);

    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 0.04, 8),
      mats.emissiveWarm
    );
    cap.position.set(lp.x, 0.82, lp.z);
    scene.add(cap);
  }

  // ─── Plaza / Hardscape around building ───────────────────────
  if (style.environment === "urban" || style.environment === "campus") {
    // Urban plaza surrounding building
    const plazaMargin = 4;
    const plazaGeo = new THREE.BoxGeometry(buildingW + plazaMargin * 2, 0.06, buildingD + plazaMargin * 2);
    const plazaMesh = new THREE.Mesh(plazaGeo, mats.concreteFloor);
    plazaMesh.position.set(0, 0.03, 0);
    scene.add(plazaMesh);

    // Road in front of the building
    const roadGeo = new THREE.BoxGeometry(buildingW * 2 + 20, 0.04, 8);
    const roadMat = new THREE.MeshBasicMaterial({ color: 0x333333, side: THREE.DoubleSide });
    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    roadMesh.position.set(0, 0.02, -buildingD / 2 - plazaMargin - 6);
    scene.add(roadMesh);

    // Road markings
    const markingMat = new THREE.MeshBasicMaterial({ color: 0xFFFFFF, side: THREE.DoubleSide });
    const centerLineGeo = new THREE.BoxGeometry(buildingW * 2 + 20, 0.05, 0.12);
    const centerLine = new THREE.Mesh(centerLineGeo, markingMat);
    centerLine.position.set(0, 0.045, -buildingD / 2 - plazaMargin - 6);
    scene.add(centerLine);

    // Sidewalk curb
    const curbGeo = new THREE.BoxGeometry(buildingW * 2 + 20, 0.15, 0.2);
    const curbMesh = new THREE.Mesh(curbGeo, mats.concreteFloor);
    curbMesh.position.set(0, 0.075, -buildingD / 2 - plazaMargin - 2);
    scene.add(curbMesh);
  }

  // ─── Driveway ────────────────────────────────────────────────
  const driveGeo = new THREE.BoxGeometry(5, 0.04, 10);
  const driveMesh = new THREE.Mesh(driveGeo, mats.concreteFloor);
  driveMesh.position.set(buildingW / 2 + 2, 0.02, -buildingD / 2 - 5);

  scene.add(driveMesh);

  // Enable shadows on all building meshes in one pass
  buildingGroup.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }
  });

  scene.add(buildingGroup);
  scene.add(roomLabels);

  return { doors, roomLabels, buildingGroup };
}

// ─── Water Feature (River / Lake) ────────────────────────────────────────────

function buildWaterFeature(
  style: BuildingStyle,
  buildingW: number,
  buildingD: number,
  mats: MaterialLibrary,
  scene: THREE.Scene
) {
  if (style.hasRiver) {
    // Flowing river along one side (offset scales with building size)
    const waterOffset = Math.max(8, buildingD * 0.4 + 4);
    const riverW = Math.max(10, Math.min(20, buildingW * 0.4));
    const riverZ = buildingD / 2 + waterOffset;
    const riverLen = Math.max(80, buildingW * 4);

    // River bed (slightly recessed)
    const bedGeo = new THREE.BoxGeometry(riverLen, 0.3, riverW);
    const bedMesh = new THREE.Mesh(bedGeo, new THREE.MeshBasicMaterial({ color: 0x3D5C3A }));
    bedMesh.position.set(0, -0.4, riverZ);

    scene.add(bedMesh);

    // Water surface
    const waterGeo = new THREE.BoxGeometry(riverLen, 0.06, riverW - 0.5);
    const waterMesh = new THREE.Mesh(waterGeo, mats.water);
    waterMesh.position.set(0, -0.12, riverZ);
    scene.add(waterMesh);

    // River banks - dirt/stone edges
    for (const side of [-1, 1]) {
      const bankGeo = new THREE.BoxGeometry(riverLen, 0.4, 1.5);
      const bankMesh = new THREE.Mesh(bankGeo, new THREE.MeshBasicMaterial({ color: 0x6B5C3D }));
      bankMesh.position.set(0, -0.1, riverZ + side * (riverW / 2 + 0.5));

      scene.add(bankMesh);
    }

    // Riverbank promenade / walkway
    const promoGeo = new THREE.BoxGeometry(riverLen * 0.7, 0.06, 3);
    const promoMesh = new THREE.Mesh(promoGeo, mats.concreteFloor);
    promoMesh.position.set(0, 0.03, riverZ - riverW / 2 - 2.5);

    scene.add(promoMesh);

    // Railing along the promenade
    const railLen = riverLen * 0.65;
    const railMesh = new THREE.Mesh(
      new THREE.BoxGeometry(railLen, 0.04, 0.04),
      mats.brushedMetal
    );
    railMesh.position.set(0, 1.0, riverZ - riverW / 2 - 1);
    scene.add(railMesh);

    // Railing posts
    const postCount = Math.floor(railLen / 2);
    for (let i = 0; i < postCount; i++) {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.02, 0.02, 1.0, 6),
        mats.brushedMetal
      );
      post.position.set(
        -railLen / 2 + i * (railLen / postCount),
        0.5,
        riverZ - riverW / 2 - 1
      );
      scene.add(post);
    }

    // Benches along the promenade
    for (let b = 0; b < 4; b++) {
      const bench = createBench(mats);
      bench.position.set(
        -railLen / 3 + b * (railLen / 4),
        0.06,
        riverZ - riverW / 2 - 3
      );
      bench.rotation.y = Math.PI;
      scene.add(bench);
    }
  }

  if (style.hasLake) {
    // Lake on one side (scales with building)
    const lakeR = Math.max(12, Math.min(25, buildingW * 0.6));
    const lakeZ = buildingD / 2 + lakeR + Math.max(4, buildingD * 0.2);

    // Lake bed
    const lakeBedGeo = new THREE.CylinderGeometry(lakeR, lakeR, 0.3, 32);
    const lakeBedMesh = new THREE.Mesh(lakeBedGeo, new THREE.MeshBasicMaterial({ color: 0x3D5C3A }));
    lakeBedMesh.position.set(0, -0.45, lakeZ);
    scene.add(lakeBedMesh);

    // Water surface
    const lakeGeo = new THREE.CylinderGeometry(lakeR - 0.5, lakeR - 0.5, 0.06, 32);
    const lakeMesh = new THREE.Mesh(lakeGeo, mats.water);
    lakeMesh.position.set(0, -0.12, lakeZ);
    scene.add(lakeMesh);
  }
}

// ─── Bench ───────────────────────────────────────────────────────────────────

function createBench(mats: MaterialLibrary): THREE.Group {
  const g = new THREE.Group();
  const seatGeo = new THREE.BoxGeometry(1.5, 0.06, 0.4);
  const seat = new THREE.Mesh(seatGeo, mats.wood);
  seat.position.y = 0.45;

  g.add(seat);

  for (const lx of [-0.6, 0.6]) {
    const leg = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.45, 0.35),
      mats.brushedMetal
    );
    leg.position.set(lx, 0.225, 0);
    g.add(leg);
  }

  // Backrest
  const back = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.35, 0.04),
    mats.wood
  );
  back.position.set(0, 0.65, -0.18);
  g.add(back);

  return g;
}

// ─── Tree Position Generator ─────────────────────────────────────────────────

function generateTreePositions(
  buildingW: number,
  buildingD: number,
  style: BuildingStyle
): Array<{ x: number; z: number }> {
  const positions: Array<{ x: number; z: number }> = [];
  // Scale tree count with building perimeter
  const perimeter = 2 * (buildingW + buildingD);
  const baseCount = Math.max(8, Math.min(30, Math.round(perimeter / 5)));
  const count = style.hasRiver || style.hasLake ? Math.round(baseCount * 1.4) : baseCount;

  // Around the building
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const minRadius = Math.max(buildingW, buildingD) * 0.6 + 3;
    const radius = minRadius + Math.random() * Math.max(8, minRadius * 0.5);
    const x = Math.cos(angle) * radius + (Math.random() - 0.5) * 4;
    const z = Math.sin(angle) * radius + (Math.random() - 0.5) * 4;

    // Skip positions that would overlap with river
    if (style.hasRiver && z > buildingD / 2 + 3 && z < buildingD / 2 + 18) continue;

    positions.push({ x, z });
  }

  // Extra trees along waterfront if applicable
  if (style.hasRiver) {
    const riverZ = buildingD / 2 + 8;
    for (let i = 0; i < 8; i++) {
      positions.push({
        x: -30 + i * 8 + (Math.random() - 0.5) * 3,
        z: riverZ - 8 + (Math.random() - 0.5) * 2,
      });
    }
    // Trees on far bank
    for (let i = 0; i < 6; i++) {
      positions.push({
        x: -25 + i * 10 + (Math.random() - 0.5) * 4,
        z: riverZ + 10 + Math.random() * 5,
      });
    }
  }

  return positions;
}

// ─── Procedural Tree ──────────────────────────────────────────────────────────

function createTree(mats: MaterialLibrary, height: number): THREE.Group {
  const g = new THREE.Group();

  const trunkH = height * 0.4;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.15, trunkH, 8),
    new THREE.MeshBasicMaterial({ color: 0x5C3D1E })
  );
  trunk.position.y = trunkH / 2;

  g.add(trunk);

  const foliageColor = 0x2D6B1E;
  const layers = [
    { y: height * 0.55, r: height * 0.25, scale: 1.0 },
    { y: height * 0.7, r: height * 0.22, scale: 0.85 },
    { y: height * 0.85, r: height * 0.16, scale: 0.65 },
  ];

  for (const layer of layers) {
    const shade = 0.85 + Math.random() * 0.3;
    const c = new THREE.Color(foliageColor).multiplyScalar(shade);
    const foliage = new THREE.Mesh(
      new THREE.SphereGeometry(layer.r, 8, 6),
      new THREE.MeshBasicMaterial({ color: c })
    );
    foliage.position.set(
      (Math.random() - 0.5) * 0.3,
      layer.y,
      (Math.random() - 0.5) * 0.3
    );
    foliage.scale.set(layer.scale, layer.scale * 0.8, layer.scale);

    g.add(foliage);
  }

  return g;
}

// ─── Glass Curtain Wall ───────────────────────────────────────────────────────

function createGlassCurtainWall(
  pos: THREE.Vector3,
  length: number,
  height: number,
  isHorizontal: boolean,
  mats: MaterialLibrary,
  parent: THREE.Group,
  _floorIdx?: number
) {
  const mullionSpacing = 1.5;
  const mullionWidth = 0.04;
  const numMullions = Math.max(1, Math.floor(length / mullionSpacing));
  const frameHeight = height - 0.24;

  // Spandrel panel (opaque strip at floor slab level) for realistic banded look
  const spandrelH = 0.35;
  const glassH = frameHeight - spandrelH;

  if (isHorizontal) {
    // Glass panel (above spandrel)
    const glassGeo = new THREE.BoxGeometry(length - 0.1, glassH, 0.02);
    const glassMesh = new THREE.Mesh(glassGeo, mats.glass);
    glassMesh.position.set(pos.x, pos.y + spandrelH / 2, pos.z);
    parent.add(glassMesh);

    // Spandrel panel at floor slab line
    const spandrelGeo = new THREE.BoxGeometry(length - 0.1, spandrelH, 0.04);
    const spandrelMesh = new THREE.Mesh(spandrelGeo, mats.brushedMetal);
    spandrelMesh.position.set(pos.x, pos.y - frameHeight / 2 + spandrelH / 2, pos.z);
    parent.add(spandrelMesh);

    // Vertical mullions
    for (let i = 0; i <= numMullions; i++) {
      const mx = pos.x - length / 2 + (i / numMullions) * length;
      const mGeo = new THREE.BoxGeometry(mullionWidth, frameHeight, 0.05);
      const mMesh = new THREE.Mesh(mGeo, mats.metal);
      mMesh.position.set(mx, pos.y, pos.z);

      parent.add(mMesh);
    }

    // Horizontal transom at spandrel/glass boundary
    const tGeo = new THREE.BoxGeometry(length, mullionWidth, 0.05);
    const tMesh = new THREE.Mesh(tGeo, mats.metal);
    tMesh.position.set(pos.x, pos.y - frameHeight / 2 + spandrelH, pos.z);
    parent.add(tMesh);

    // Top transom
    const topGeo = new THREE.BoxGeometry(length, mullionWidth, 0.05);
    const topMesh = new THREE.Mesh(topGeo, mats.metal);
    topMesh.position.set(pos.x, pos.y + frameHeight / 2, pos.z);
    parent.add(topMesh);
  } else {
    // Glass panel (above spandrel)
    const glassGeo = new THREE.BoxGeometry(0.02, glassH, length - 0.1);
    const glassMesh = new THREE.Mesh(glassGeo, mats.glass);
    glassMesh.position.set(pos.x, pos.y + spandrelH / 2, pos.z);
    parent.add(glassMesh);

    // Spandrel panel at floor slab line
    const spandrelGeo = new THREE.BoxGeometry(0.04, spandrelH, length - 0.1);
    const spandrelMesh = new THREE.Mesh(spandrelGeo, mats.brushedMetal);
    spandrelMesh.position.set(pos.x, pos.y - frameHeight / 2 + spandrelH / 2, pos.z);
    parent.add(spandrelMesh);

    // Vertical mullions
    for (let i = 0; i <= numMullions; i++) {
      const mz = pos.z - length / 2 + (i / numMullions) * length;
      const mGeo = new THREE.BoxGeometry(0.05, frameHeight, mullionWidth);
      const mMesh = new THREE.Mesh(mGeo, mats.metal);
      mMesh.position.set(pos.x, pos.y, mz);

      parent.add(mMesh);
    }

    // Horizontal transom
    const tGeo = new THREE.BoxGeometry(0.05, mullionWidth, length);
    const tMesh = new THREE.Mesh(tGeo, mats.metal);
    tMesh.position.set(pos.x, pos.y - frameHeight / 2 + spandrelH, pos.z);
    parent.add(tMesh);

    // Top transom
    const topGeo = new THREE.BoxGeometry(0.05, mullionWidth, length);
    const topMesh = new THREE.Mesh(topGeo, mats.metal);
    topMesh.position.set(pos.x, pos.y + frameHeight / 2, pos.z);
    parent.add(topMesh);
  }

  // Sill
  if (isHorizontal) {
    const sMesh = new THREE.Mesh(
      new THREE.BoxGeometry(length + 0.1, 0.03, 0.15),
      mats.brushedMetal
    );
    sMesh.position.set(pos.x, pos.y - frameHeight / 2 - 0.02, pos.z);
    parent.add(sMesh);
  } else {
    const sMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.15, 0.03, length + 0.1),
      mats.brushedMetal
    );
    sMesh.position.set(pos.x, pos.y - frameHeight / 2 - 0.02, pos.z);
    parent.add(sMesh);
  }
}

// ─── Wall with Window Openings (AEC-quality) ─────────────────────────────────

function createWallWithWindows(
  pos: THREE.Vector3,
  length: number,
  height: number,
  thickness: number,
  isHorizontal: boolean,
  mats: MaterialLibrary,
  parent: THREE.Group,
  wallMat: THREE.Material
) {
  // AEC-standard window proportions
  const winW = 1.6, winH = 1.8, sillH = 0.85;
  const numWindows = Math.max(1, Math.floor(length / 2.8));
  const recessDepth = 0.12; // Windows recessed into wall for shadow depth
  const frameT = 0.04;     // Frame profile thickness
  const frameD = 0.08;     // Frame profile depth
  const frameHeight = height - 0.12;

  // ── Floor slab edge band (the horizontal line that makes it look real) ──
  const slabEdgeH = 0.18;
  if (isHorizontal) {
    const slabEdge = new THREE.Mesh(
      new THREE.BoxGeometry(length + 0.04, slabEdgeH, thickness + 0.03),
      mats.concreteWall
    );
    slabEdge.position.set(pos.x, pos.y - frameHeight / 2 + slabEdgeH / 2, pos.z);
    parent.add(slabEdge);
  } else {
    const slabEdge = new THREE.Mesh(
      new THREE.BoxGeometry(thickness + 0.03, slabEdgeH, length + 0.04),
      mats.concreteWall
    );
    slabEdge.position.set(pos.x, pos.y - frameHeight / 2 + slabEdgeH / 2, pos.z);
    parent.add(slabEdge);
  }

  // ── Solid wall below windows (sill zone) ──
  const sillWallH = sillH - slabEdgeH;
  if (sillWallH > 0.05) {
    if (isHorizontal) {
      const sillGeo = new THREE.BoxGeometry(length, sillWallH, thickness);
      const sillMesh = new THREE.Mesh(sillGeo, wallMat);
      sillMesh.position.set(pos.x, pos.y - frameHeight / 2 + slabEdgeH + sillWallH / 2, pos.z);
      parent.add(sillMesh);
    } else {
      const sillGeo = new THREE.BoxGeometry(thickness, sillWallH, length);
      const sillMesh = new THREE.Mesh(sillGeo, wallMat);
      sillMesh.position.set(pos.x, pos.y - frameHeight / 2 + slabEdgeH + sillWallH / 2, pos.z);
      parent.add(sillMesh);
    }
  }

  // ── Solid wall above windows (lintel/header zone) ──
  const aboveH = frameHeight - sillH - winH;
  if (aboveH > 0.05) {
    if (isHorizontal) {
      const aboveGeo = new THREE.BoxGeometry(length, aboveH, thickness);
      const aboveMesh = new THREE.Mesh(aboveGeo, wallMat);
      aboveMesh.position.set(pos.x, pos.y + frameHeight / 2 - aboveH / 2, pos.z);
      parent.add(aboveMesh);
    } else {
      const aboveGeo = new THREE.BoxGeometry(thickness, aboveH, length);
      const aboveMesh = new THREE.Mesh(aboveGeo, wallMat);
      aboveMesh.position.set(pos.x, pos.y + frameHeight / 2 - aboveH / 2, pos.z);
      parent.add(aboveMesh);
    }
  }

  // ── Window piers (vertical wall strips between windows) + windows ──
  const spacing = length / (numWindows + 1);
  const winCenterY = pos.y - frameHeight / 2 + sillH + winH / 2;
  const nDir = isHorizontal ? pos.z : pos.x; // normal direction coordinate

  for (let i = 0; i <= numWindows; i++) {
    const pierW = spacing - winW;
    if (pierW > 0.08) {
      if (isHorizontal) {
        const pierX = pos.x - length / 2 + i * spacing;
        const pierGeo = new THREE.BoxGeometry(pierW, winH, thickness);
        const pierMesh = new THREE.Mesh(pierGeo, wallMat);
        pierMesh.position.set(pierX + pierW / 2, winCenterY, pos.z);
        parent.add(pierMesh);
      } else {
        const pierZ = pos.z - length / 2 + i * spacing;
        const pierGeo = new THREE.BoxGeometry(thickness, winH, pierW);
        const pierMesh = new THREE.Mesh(pierGeo, wallMat);
        pierMesh.position.set(pos.x, winCenterY, pierZ + pierW / 2);
        parent.add(pierMesh);
      }
    }
  }

  // ── Windows with recessed glass + proper frames ──
  for (let i = 1; i <= numWindows; i++) {
    if (isHorizontal) {
      const wx = pos.x - length / 2 + i * spacing;

      // Recessed glass pane (set back from wall face for shadow)
      const glassMesh = new THREE.Mesh(
        new THREE.BoxGeometry(winW - frameT * 2, winH - frameT * 2, 0.01),
        mats.glass
      );
      glassMesh.position.set(wx, winCenterY, pos.z - recessDepth * Math.sign(nDir || 1));
      parent.add(glassMesh);

      // Window reveal / recess walls (top, bottom, left, right) — creates depth shadow
      const revealMat = mats.concreteWall;
      // Top reveal
      parent.add(Object.assign(new THREE.Mesh(
        new THREE.BoxGeometry(winW, frameT, recessDepth), revealMat
      ), { position: new THREE.Vector3(wx, winCenterY + winH / 2 - frameT / 2, pos.z - recessDepth / 2) }));
      // Bottom reveal (sill projection)
      const sillMesh = new THREE.Mesh(
        new THREE.BoxGeometry(winW + 0.06, 0.04, recessDepth + 0.06), mats.brushedMetal
      );
      sillMesh.position.set(wx, winCenterY - winH / 2 + 0.02, pos.z - recessDepth / 2);
      parent.add(sillMesh);

      // Metal frame (4 sides) — visible profile around glass
      // Top frame
      parent.add(Object.assign(new THREE.Mesh(
        new THREE.BoxGeometry(winW, frameT, frameD), mats.metal
      ), { position: new THREE.Vector3(wx, winCenterY + winH / 2 - frameT / 2, pos.z - recessDepth) }));
      // Bottom frame
      parent.add(Object.assign(new THREE.Mesh(
        new THREE.BoxGeometry(winW, frameT, frameD), mats.metal
      ), { position: new THREE.Vector3(wx, winCenterY - winH / 2 + frameT / 2, pos.z - recessDepth) }));
      // Left frame
      parent.add(Object.assign(new THREE.Mesh(
        new THREE.BoxGeometry(frameT, winH, frameD), mats.metal
      ), { position: new THREE.Vector3(wx - winW / 2 + frameT / 2, winCenterY, pos.z - recessDepth) }));
      // Right frame
      parent.add(Object.assign(new THREE.Mesh(
        new THREE.BoxGeometry(frameT, winH, frameD), mats.metal
      ), { position: new THREE.Vector3(wx + winW / 2 - frameT / 2, winCenterY, pos.z - recessDepth) }));
      // Center mullion (horizontal)
      parent.add(Object.assign(new THREE.Mesh(
        new THREE.BoxGeometry(winW - frameT * 2, 0.03, frameD), mats.metal
      ), { position: new THREE.Vector3(wx, winCenterY + 0.1, pos.z - recessDepth) }));

    } else {
      const wz = pos.z - length / 2 + i * spacing;

      // Recessed glass
      const glassMesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.01, winH - frameT * 2, winW - frameT * 2),
        mats.glass
      );
      glassMesh.position.set(pos.x - recessDepth * Math.sign(nDir || 1), winCenterY, wz);
      parent.add(glassMesh);

      // Sill projection
      const sillMesh = new THREE.Mesh(
        new THREE.BoxGeometry(recessDepth + 0.06, 0.04, winW + 0.06), mats.brushedMetal
      );
      sillMesh.position.set(pos.x - recessDepth / 2, winCenterY - winH / 2 + 0.02, wz);
      parent.add(sillMesh);

      // Metal frames
      parent.add(Object.assign(new THREE.Mesh(
        new THREE.BoxGeometry(frameD, frameT, winW), mats.metal
      ), { position: new THREE.Vector3(pos.x - recessDepth, winCenterY + winH / 2 - frameT / 2, wz) }));
      parent.add(Object.assign(new THREE.Mesh(
        new THREE.BoxGeometry(frameD, frameT, winW), mats.metal
      ), { position: new THREE.Vector3(pos.x - recessDepth, winCenterY - winH / 2 + frameT / 2, wz) }));
      parent.add(Object.assign(new THREE.Mesh(
        new THREE.BoxGeometry(frameD, winH, frameT), mats.metal
      ), { position: new THREE.Vector3(pos.x - recessDepth, winCenterY, wz - winW / 2 + frameT / 2) }));
      parent.add(Object.assign(new THREE.Mesh(
        new THREE.BoxGeometry(frameD, winH, frameT), mats.metal
      ), { position: new THREE.Vector3(pos.x - recessDepth, winCenterY, wz + winW / 2 - frameT / 2) }));
      // Center mullion
      parent.add(Object.assign(new THREE.Mesh(
        new THREE.BoxGeometry(frameD, 0.03, winW - frameT * 2), mats.metal
      ), { position: new THREE.Vector3(pos.x - recessDepth, winCenterY + 0.1, wz) }));
    }
  }
}

// ─── Door Creation ────────────────────────────────────────────────────────────

function createDoor(
  wallPos: THREE.Vector3,
  _wallLen: number,
  isHorizontal: boolean,
  doorW: number,
  doorH: number,
  baseY: number,
  _wallT: number,
  mats: MaterialLibrary,
  roomName: string
): DoorMesh | null {
  const doorGeo = new THREE.BoxGeometry(doorW, doorH, 0.05);
  const doorMesh = new THREE.Mesh(doorGeo, mats.darkWood);


  const handleGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.12, 8);
  const handleMesh = new THREE.Mesh(handleGeo, mats.brushedMetal);
  handleMesh.rotation.x = Math.PI / 2;
  handleMesh.position.set(doorW / 2 - 0.08, 0, 0.04);
  doorMesh.add(handleMesh);

  const pivot = new THREE.Group();
  doorMesh.position.set(doorW / 2, 0, 0);
  pivot.add(doorMesh);

  if (isHorizontal) {
    pivot.position.set(wallPos.x - doorW / 2, baseY + 0.12 + doorH / 2, wallPos.z);
  } else {
    pivot.position.set(wallPos.x, baseY + 0.12 + doorH / 2, wallPos.z - doorW / 2);
    pivot.rotation.y = Math.PI / 2;
  }

  return {
    mesh: doorMesh,
    pivot,
    isOpen: false,
    targetAngle: 0,
    currentAngle: 0,
    roomName,
  };
}

// ─── Stairs ───────────────────────────────────────────────────────────────────

function buildStairs(
  room: RoomDef,
  centerX: number,
  centerZ: number,
  floorHeight: number,
  mats: MaterialLibrary,
  parent: THREE.Group
) {
  const rx = room.x - centerX;
  const rz = room.z - centerZ;
  const baseY = room.floor * floorHeight;

  const numSteps = 16;
  const stepH = floorHeight / numSteps;
  const stepD = room.depth / numSteps;
  const stepW = room.width - 0.3;

  for (let i = 0; i < numSteps; i++) {
    const stepMesh = new THREE.Mesh(
      new THREE.BoxGeometry(stepW, stepH, stepD),
      mats.wood
    );
    stepMesh.position.set(
      rx + room.width / 2,
      baseY + 0.12 + i * stepH + stepH / 2,
      rz + i * stepD + stepD / 2
    );

    parent.add(stepMesh);
  }

  // Railing
  const railMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, room.depth * 1.2, 8),
    mats.brushedMetal
  );
  railMesh.rotation.x = Math.atan2(floorHeight, room.depth);
  railMesh.position.set(
    rx + 0.15,
    baseY + floorHeight / 2 + 0.9,
    rz + room.depth / 2
  );
  parent.add(railMesh);
}

// ─── Room Label Sprite ────────────────────────────────────────────────────────

function createRoomLabel(name: string, area: number): THREE.Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
  const textWidth = Math.min(400, name.length * 22 + 60);
  const bgX = (512 - textWidth) / 2;
  ctx.beginPath();
  ctx.roundRect(bgX, 20, textWidth, 88, 12);
  ctx.fill();

  ctx.font = "bold 28px 'Inter', 'Segoe UI', sans-serif";
  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "center";
  ctx.fillText(name, 256, 60);

  ctx.font = "20px 'Inter', 'Segoe UI', sans-serif";
  ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
  ctx.fillText(`${Math.round(area)} m²`, 256, 90);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    sizeAttenuation: true,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(2.5, 0.65, 1);
  return sprite;
}
