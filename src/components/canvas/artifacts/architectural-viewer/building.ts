import * as THREE from "three";
import type { RoomDef, RoomType, DoorMesh, BuildingConfig } from "./types";
import type { MaterialLibrary } from "./materials";

// ─── Default Building Layout ──────────────────────────────────────────────────

export function getDefaultRooms(): RoomDef[] {
  return [
    // ─── Ground Floor ──────────────
    // South wing - open plan living
    { name: "Living Room", x: 0, z: 0, width: 9, depth: 7, floor: 0, type: "living" },
    { name: "Kitchen", x: 9, z: 3.5, width: 7, depth: 3.5, floor: 0, type: "kitchen" },
    { name: "Dining", x: 9, z: 0, width: 7, depth: 3.5, floor: 0, type: "dining" },
    // North wing
    { name: "Entry Hall", x: 0, z: 7, width: 4, depth: 5, floor: 0, type: "hallway" },
    { name: "Office", x: 4, z: 7, width: 5, depth: 5, floor: 0, type: "office" },
    { name: "Guest WC", x: 9, z: 7, width: 3.5, depth: 2.5, floor: 0, type: "bathroom" },
    { name: "Stairs", x: 12.5, z: 7, width: 3.5, depth: 5, floor: 0, type: "stairs" },

    // ─── Upper Floor ───────────────
    { name: "Master Bedroom", x: 0, z: 0, width: 8, depth: 6, floor: 1, type: "bedroom" },
    { name: "Master Bath", x: 0, z: 6, width: 4, depth: 4, floor: 1, type: "bathroom" },
    { name: "Walk-in Closet", x: 4, z: 6, width: 3, depth: 4, floor: 1, type: "closet" },
    { name: "Landing", x: 7, z: 6, width: 5.5, depth: 4, floor: 1, type: "hallway" },
    { name: "Bedroom 2", x: 8, z: 0, width: 5, depth: 6, floor: 1, type: "bedroom" },
    { name: "Bathroom 2", x: 12.5, z: 6, width: 3.5, depth: 4, floor: 1, type: "bathroom" },
    { name: "Terrace", x: 13, z: 0, width: 3, depth: 6, floor: 1, type: "terrace", hasCeiling: false },
  ];
}

export function getDefaultConfig(): BuildingConfig {
  return {
    floors: 2,
    floorHeight: 3.2,
    rooms: getDefaultRooms(),
    wallThickness: 0.15,
    exteriorWallThickness: 0.25,
  };
}

// ─── Room Floor Material Mapping ──────────────────────────────────────────────

function getFloorMaterial(type: RoomType, mats: MaterialLibrary): THREE.MeshStandardMaterial {
  switch (type) {
    case "living":
    case "dining":
    case "bedroom":
    case "office":
      return mats.herringboneFloor;
    case "kitchen":
      return mats.tileFloor;
    case "bathroom":
      return mats.marbleFloor;
    case "hallway":
    case "stairs":
    case "closet":
      return mats.concreteFloor;
    case "terrace":
      return mats.concreteFloor;
    case "retail":
      return mats.concreteFloor;
    default:
      return mats.herringboneFloor;
  }
}

// ─── Wall Material by Room Type ───────────────────────────────────────────────

function getWallMaterial(type: RoomType, mats: MaterialLibrary, isAccent = false): THREE.MeshStandardMaterial {
  if (isAccent) return mats.accentWall;
  switch (type) {
    case "bathroom": return mats.tileFloor; // tile walls
    case "kitchen": return mats.whiteWall;
    default: return mats.whiteWall;
  }
}

// ─── Build Full Scene ─────────────────────────────────────────────────────────

export function buildBuilding(
  config: BuildingConfig,
  mats: MaterialLibrary,
  scene: THREE.Scene
): { doors: DoorMesh[]; roomLabels: THREE.Group; buildingGroup: THREE.Group } {
  const { floorHeight, rooms, wallThickness } = config;
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

  // Helper to tag meshes with floor data for exploded view
  const tagFloor = (obj: THREE.Object3D, floor: number) => {
    obj.userData.floor = floor;
    obj.userData.originalY = obj.position.y;
  };

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
      floorMesh.position.set(
        rx + room.width / 2,
        baseY + 0.06,
        rz + room.depth / 2
      );
      floorMesh.receiveShadow = true;
      tagFloor(floorMesh, floorIdx);
      buildingGroup.add(floorMesh);

      // ─── Ceiling (if not terrace) ────────────────────────────
      if (room.hasCeiling !== false) {
        const ceilGeo = new THREE.BoxGeometry(room.width - 0.02, 0.08, room.depth - 0.02);
        const ceilMesh = new THREE.Mesh(ceilGeo, mats.ceiling);
        ceilMesh.position.set(
          rx + room.width / 2,
          baseY + floorHeight - 0.04,
          rz + room.depth / 2
        );
        ceilMesh.receiveShadow = true;
        tagFloor(ceilMesh, floorIdx);
        buildingGroup.add(ceilMesh);
      }

      // ─── Walls ───────────────────────────────────────────────
      // Generate 4 walls per room, check for adjacencies
      const wallDefs = [
        { dir: "south", x1: rx, z1: rz, x2: rx + room.width, z2: rz, nx: 0, nz: -1 },
        { dir: "north", x1: rx, z1: rz + room.depth, x2: rx + room.width, z2: rz + room.depth, nx: 0, nz: 1 },
        { dir: "west", x1: rx, z1: rz, x2: rx, z2: rz + room.depth, nx: -1, nz: 0 },
        { dir: "east", x1: rx + room.width, z1: rz, x2: rx + room.width, z2: rz + room.depth, nx: 1, nz: 0 },
      ];

      for (const wd of wallDefs) {
        const wallLen = Math.sqrt((wd.x2 - wd.x1) ** 2 + (wd.z2 - wd.z1) ** 2);
        if (wallLen < 0.1) continue;

        // Check if this is an exterior wall
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

        // Skip walls between living/kitchen/dining (open plan)
        const openPlanTypes: RoomType[] = ["living", "kitchen", "dining"];
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

        // Check if this wall should have windows (exterior walls on south/east)
        const hasWindows = isExterior && wallLen > 2 &&
          room.type !== "bathroom" && room.type !== "stairs" && room.type !== "closet";
        const isGlassWall = isExterior && (wd.dir === "south" || wd.dir === "east") &&
          (room.type === "living" || room.type === "dining" || room.type === "bedroom");

        if (isGlassWall) {
          // Floor-to-ceiling glass curtain wall
          createGlassCurtainWall(wallPos, wallLen, floorHeight, isHorizontal, mats, buildingGroup);
        } else if (hasWindows) {
          // Wall with window openings
          createWallWithWindows(wallPos, wallLen, floorHeight, wt, isHorizontal, mats, buildingGroup, isExterior);
        } else {
          // Solid wall
          const isAccent = !isExterior && (wd.dir === "north") && (room.type === "living" || room.type === "bedroom");
          const wallMat = isExterior ? mats.exteriorWall : getWallMaterial(room.type, mats, isAccent);
          const wallMesh = new THREE.Mesh(wallGeo, wallMat);
          wallMesh.position.copy(wallPos);
          wallMesh.castShadow = true;
          wallMesh.receiveShadow = true;
          buildingGroup.add(wallMesh);
        }

        // Add door between rooms (interior walls only)
        if (!isExterior && wallLen > 1.5 && room.type !== "stairs") {
          const doorWidth = 0.9;
          const doorHeight = 2.1;
          const door = createDoor(
            wallPos, wallLen, isHorizontal, doorWidth, doorHeight,
            baseY, wt, mats, room.name
          );
          if (door) {
            buildingGroup.add(door.pivot);
            doors.push(door);
          }
        }
      }

      // ─── Baseboards ─────────────────────────────────────────
      if (room.type !== "terrace" && room.type !== "stairs") {
        const bbH = 0.08, bbD = 0.015;
        const bbMat = mats.whiteWall;
        // All four baseboards
        const bbDefs = [
          { w: room.width, d: bbD, x: rx + room.width / 2, z: rz + bbD / 2, rot: 0 },
          { w: room.width, d: bbD, x: rx + room.width / 2, z: rz + room.depth - bbD / 2, rot: 0 },
          { w: bbD, d: room.depth, x: rx + bbD / 2, z: rz + room.depth / 2, rot: 0 },
          { w: bbD, d: room.depth, x: rx + room.width - bbD / 2, z: rz + room.depth / 2, rot: 0 },
        ];
        for (const bb of bbDefs) {
          const bbGeo = new THREE.BoxGeometry(bb.w, bbH, bb.d);
          const bbMesh = new THREE.Mesh(bbGeo, bbMat);
          bbMesh.position.set(bb.x, baseY + 0.12 + bbH / 2, bb.z);
          buildingGroup.add(bbMesh);
        }
      }

      // ─── Room label sprite ──────────────────────────────────
      const labelSprite = createRoomLabel(room.name, room.width * room.depth);
      labelSprite.position.set(
        rx + room.width / 2,
        baseY + 2.5,
        rz + room.depth / 2
      );
      roomLabels.add(labelSprite);
    }
  }

  // ─── Roof ────────────────────────────────────────────────────────
  const roofGeo = new THREE.BoxGeometry(buildingW + 0.5, 0.2, buildingD + 0.5);
  const roofMesh = new THREE.Mesh(roofGeo, mats.roofTop);
  roofMesh.position.set(0, config.floors * floorHeight + 0.1, 0);
  roofMesh.castShadow = true;
  roofMesh.receiveShadow = true;
  buildingGroup.add(roofMesh);

  // Roof parapet
  const parapetH = 0.6;
  const parapetT = 0.1;
  const parapetY = config.floors * floorHeight + 0.2 + parapetH / 2;
  // Four parapet walls
  [
    { w: buildingW + 0.5, d: parapetT, x: 0, z: -(buildingD + 0.5) / 2 },
    { w: buildingW + 0.5, d: parapetT, x: 0, z: (buildingD + 0.5) / 2 },
    { w: parapetT, d: buildingD + 0.5, x: -(buildingW + 0.5) / 2, z: 0 },
    { w: parapetT, d: buildingD + 0.5, x: (buildingW + 0.5) / 2, z: 0 },
  ].forEach(p => {
    const pGeo = new THREE.BoxGeometry(p.w, parapetH, p.d);
    const pMesh = new THREE.Mesh(pGeo, mats.concreteWall);
    pMesh.position.set(p.x, parapetY, p.z);
    pMesh.castShadow = true;
    buildingGroup.add(pMesh);
  });

  // ─── Stairs geometry ─────────────────────────────────────────────
  const stairsRooms = rooms.filter(r => r.type === "stairs");
  for (const sr of stairsRooms) {
    buildStairs(sr, centerX, centerZ, floorHeight, mats, buildingGroup);
  }

  // ─── Ground plane + landscaping ──────────────────────────────────
  const groundGeo = new THREE.PlaneGeometry(80, 80);
  const groundMesh = new THREE.Mesh(groundGeo, mats.grass);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.position.y = -0.01;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  // Concrete pathway
  const pathGeo = new THREE.BoxGeometry(3, 0.05, 15);
  const pathMesh = new THREE.Mesh(pathGeo, mats.concreteFloor);
  pathMesh.position.set(0, 0.025, -buildingD / 2 - 7.5);
  pathMesh.receiveShadow = true;
  scene.add(pathMesh);

  // Front entrance canopy
  const canopyW = 4, canopyD = 2.5;
  const canopyGeo = new THREE.BoxGeometry(canopyW, 0.12, canopyD);
  const canopyMesh = new THREE.Mesh(canopyGeo, mats.concreteWall);
  canopyMesh.position.set(0, config.floorHeight * 0.85, -buildingD / 2 - canopyD / 2);
  canopyMesh.castShadow = true;
  canopyMesh.receiveShadow = true;
  scene.add(canopyMesh);

  // Canopy supports (slim columns)
  for (const cx of [-canopyW / 2 + 0.15, canopyW / 2 - 0.15]) {
    const colGeo = new THREE.CylinderGeometry(0.06, 0.06, config.floorHeight * 0.85, 12);
    const colMesh = new THREE.Mesh(colGeo, mats.brushedMetal);
    colMesh.position.set(cx, config.floorHeight * 0.85 / 2, -buildingD / 2 - canopyD + 0.15);
    colMesh.castShadow = true;
    scene.add(colMesh);
  }

  // Entry steps
  const numSteps = 3;
  for (let s = 0; s < numSteps; s++) {
    const stepGeo = new THREE.BoxGeometry(canopyW, 0.08, 0.35);
    const stepMesh = new THREE.Mesh(stepGeo, mats.concreteFloor);
    stepMesh.position.set(0, s * 0.08 + 0.04, -buildingD / 2 - 0.2 - s * 0.35);
    stepMesh.receiveShadow = true;
    stepMesh.castShadow = true;
    scene.add(stepMesh);
  }

  // Front door (glass)
  const frontDoorGeo = new THREE.BoxGeometry(1.8, 2.4, 0.06);
  const frontDoor = new THREE.Mesh(frontDoorGeo, mats.darkGlass);
  frontDoor.position.set(0, 1.2, -buildingD / 2 - 0.03);
  scene.add(frontDoor);

  // Door frame
  const doorFrameMat = mats.brushedMetal;
  for (const fx of [-0.95, 0.95]) {
    const frameSide = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 2.5, 0.08),
      doorFrameMat
    );
    frameSide.position.set(fx, 1.25, -buildingD / 2 - 0.03);
    scene.add(frameSide);
  }
  const frameTop = new THREE.Mesh(
    new THREE.BoxGeometry(1.95, 0.05, 0.08),
    doorFrameMat
  );
  frameTop.position.set(0, 2.5, -buildingD / 2 - 0.03);
  scene.add(frameTop);

  // Entrance light
  const entranceLight = new THREE.PointLight(0xFFE4B5, 0.8, 8);
  entranceLight.position.set(0, config.floorHeight * 0.8, -buildingD / 2 - 1);
  entranceLight.castShadow = true;
  scene.add(entranceLight);

  // Swimming pool
  const poolW = 8, poolD = 3.5, poolDepth = 1.5;
  const poolX = 0, poolZ = buildingD / 2 + 3;
  const poolGroup = new THREE.Group();

  // Pool basin
  const poolBottomGeo = new THREE.BoxGeometry(poolW, 0.1, poolD);
  const poolBottom = new THREE.Mesh(poolBottomGeo, mats.tileFloor);
  poolBottom.position.set(poolX, -poolDepth, poolZ);
  poolGroup.add(poolBottom);

  // Pool walls (inside faces)
  [
    { w: poolW, d: 0.15, x: 0, z: -poolD / 2, h: poolDepth },
    { w: poolW, d: 0.15, x: 0, z: poolD / 2, h: poolDepth },
    { w: 0.15, d: poolD, x: -poolW / 2, z: 0, h: poolDepth },
    { w: 0.15, d: poolD, x: poolW / 2, z: 0, h: poolDepth },
  ].forEach(pw => {
    const pwGeo = new THREE.BoxGeometry(pw.w, pw.h, pw.d);
    const pwMesh = new THREE.Mesh(pwGeo, mats.tileFloor);
    pwMesh.position.set(poolX + pw.x, -pw.h / 2, poolZ + pw.z);
    poolGroup.add(pwMesh);
  });

  // Pool water surface
  const waterGeo = new THREE.BoxGeometry(poolW - 0.3, 0.05, poolD - 0.3);
  const waterMesh = new THREE.Mesh(waterGeo, mats.water);
  waterMesh.position.set(poolX, -0.15, poolZ);
  poolGroup.add(waterMesh);

  // Pool deck (concrete surround)
  const deckGeo = new THREE.BoxGeometry(poolW + 2, 0.08, poolD + 2);
  const deckMesh = new THREE.Mesh(deckGeo, mats.concreteFloor);
  deckMesh.position.set(poolX, 0.04, poolZ);
  deckMesh.receiveShadow = true;
  poolGroup.add(deckMesh);

  scene.add(poolGroup);

  // ─── Landscaping — Trees ─────────────────────────────────────
  const treePositions = [
    { x: -buildingW / 2 - 4, z: -buildingD / 2 - 3 },
    { x: -buildingW / 2 - 6, z: 2 },
    { x: -buildingW / 2 - 3, z: buildingD / 2 + 4 },
    { x: buildingW / 2 + 5, z: -buildingD / 2 - 2 },
    { x: buildingW / 2 + 4, z: buildingD / 2 + 5 },
    { x: -2, z: buildingD / 2 + 8 },
    { x: 6, z: buildingD / 2 + 7 },
    { x: buildingW / 2 + 7, z: 3 },
    { x: -buildingW / 2 - 8, z: -buildingD / 2 + 5 },
    { x: 0, z: -buildingD / 2 - 8 },
    { x: 8, z: -buildingD / 2 - 6 },
    { x: -8, z: -buildingD / 2 - 7 },
  ];

  for (const tp of treePositions) {
    const tree = createTree(mats, 2 + Math.random() * 3);
    tree.position.set(tp.x, 0, tp.z);
    tree.rotation.y = Math.random() * Math.PI * 2;
    scene.add(tree);
  }

  // ─── Exterior ground lights ──────────────────────────────────
  const groundLightPositions = [
    { x: -buildingW / 2 - 1, z: -buildingD / 2 - 1 },
    { x: buildingW / 2 + 1, z: -buildingD / 2 - 1 },
    { x: -buildingW / 2 - 1, z: buildingD / 2 + 1 },
    { x: buildingW / 2 + 1, z: buildingD / 2 + 1 },
    { x: -1.5, z: -buildingD / 2 - 3 },
    { x: 1.5, z: -buildingD / 2 - 3 },
  ];

  for (const lp of groundLightPositions) {
    // Bollard
    const bollard = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.06, 0.8, 8),
      mats.brushedMetal
    );
    bollard.position.set(lp.x, 0.4, lp.z);
    bollard.castShadow = true;
    scene.add(bollard);

    // Bollard light cap
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.07, 0.04, 8),
      mats.emissiveWarm
    );
    cap.position.set(lp.x, 0.82, lp.z);
    scene.add(cap);

    // Small point light
    const bl = new THREE.PointLight(0xFFE4B5, 0.3, 5);
    bl.position.set(lp.x, 0.9, lp.z);
    scene.add(bl);
  }

  // ─── Driveway ────────────────────────────────────────────────
  const driveGeo = new THREE.BoxGeometry(5, 0.04, 10);
  const driveMesh = new THREE.Mesh(driveGeo, mats.concreteFloor);
  driveMesh.position.set(buildingW / 2 + 2, 0.02, -buildingD / 2 - 5);
  driveMesh.receiveShadow = true;
  scene.add(driveMesh);

  // ─── Patio furniture by pool ─────────────────────────────────
  // Lounge chairs
  for (let i = 0; i < 3; i++) {
    const lounger = new THREE.Group();
    const lBase = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.08, 1.8),
      mats.wood
    );
    lBase.position.y = 0.35;
    lounger.add(lBase);
    // Legs
    for (const lx of [-0.3, 0.3]) {
      for (const lz of [-0.8, 0.8]) {
        const leg = new THREE.Mesh(
          new THREE.CylinderGeometry(0.015, 0.015, 0.35, 6),
          mats.metal
        );
        leg.position.set(lx, 0.175, lz);
        lounger.add(leg);
      }
    }
    // Cushion
    const cush = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.06, 1.6),
      new THREE.MeshStandardMaterial({ color: 0xF5F0E8, roughness: 0.9 })
    );
    cush.position.y = 0.42;
    lounger.add(cush);

    lounger.position.set(-poolW / 2 + 1 + i * 1.2, 0.08, poolZ + poolD / 2 + 1.5);
    scene.add(lounger);
  }

  scene.add(buildingGroup);
  scene.add(roomLabels);

  return { doors, roomLabels, buildingGroup };
}

// ─── Procedural Tree ──────────────────────────────────────────────────────────

function createTree(mats: MaterialLibrary, height: number): THREE.Group {
  const g = new THREE.Group();

  // Trunk
  const trunkH = height * 0.4;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.15, trunkH, 8),
    new THREE.MeshStandardMaterial({ color: 0x5C3D1E, roughness: 0.9 })
  );
  trunk.position.y = trunkH / 2;
  trunk.castShadow = true;
  g.add(trunk);

  // Foliage layers (3 spheres for natural look)
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
      new THREE.MeshStandardMaterial({ color: c, roughness: 0.95 })
    );
    foliage.position.set(
      (Math.random() - 0.5) * 0.3,
      layer.y,
      (Math.random() - 0.5) * 0.3
    );
    foliage.scale.set(layer.scale, layer.scale * 0.8, layer.scale);
    foliage.castShadow = true;
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
  parent: THREE.Group
) {
  const mullionSpacing = 1.5;
  const mullionWidth = 0.04;
  const numMullions = Math.floor(length / mullionSpacing);
  const frameHeight = height - 0.24; // leave sill and head

  // Glass panes
  if (isHorizontal) {
    const glassGeo = new THREE.BoxGeometry(length - 0.1, frameHeight, 0.02);
    const glassMesh = new THREE.Mesh(glassGeo, mats.glass);
    glassMesh.position.copy(pos);
    parent.add(glassMesh);

    // Vertical mullions
    for (let i = 0; i <= numMullions; i++) {
      const mx = pos.x - length / 2 + (i / numMullions) * length;
      const mGeo = new THREE.BoxGeometry(mullionWidth, frameHeight, 0.05);
      const mMesh = new THREE.Mesh(mGeo, mats.metal);
      mMesh.position.set(mx, pos.y, pos.z);
      mMesh.castShadow = true;
      parent.add(mMesh);
    }

    // Horizontal transom
    const tGeo = new THREE.BoxGeometry(length, mullionWidth, 0.05);
    const tMesh = new THREE.Mesh(tGeo, mats.metal);
    tMesh.position.set(pos.x, pos.y, pos.z);
    parent.add(tMesh);
  } else {
    const glassGeo = new THREE.BoxGeometry(0.02, frameHeight, length - 0.1);
    const glassMesh = new THREE.Mesh(glassGeo, mats.glass);
    glassMesh.position.copy(pos);
    parent.add(glassMesh);

    for (let i = 0; i <= numMullions; i++) {
      const mz = pos.z - length / 2 + (i / numMullions) * length;
      const mGeo = new THREE.BoxGeometry(0.05, frameHeight, mullionWidth);
      const mMesh = new THREE.Mesh(mGeo, mats.metal);
      mMesh.position.set(pos.x, pos.y, mz);
      mMesh.castShadow = true;
      parent.add(mMesh);
    }

    const tGeo = new THREE.BoxGeometry(0.05, mullionWidth, length);
    const tMesh = new THREE.Mesh(tGeo, mats.metal);
    tMesh.position.set(pos.x, pos.y, pos.z);
    parent.add(tMesh);
  }

  // Sill
  const sillMat = mats.brushedMetal;
  if (isHorizontal) {
    const sGeo = new THREE.BoxGeometry(length + 0.1, 0.03, 0.15);
    const sMesh = new THREE.Mesh(sGeo, sillMat);
    sMesh.position.set(pos.x, pos.y - frameHeight / 2 - 0.02, pos.z);
    parent.add(sMesh);
  } else {
    const sGeo = new THREE.BoxGeometry(0.15, 0.03, length + 0.1);
    const sMesh = new THREE.Mesh(sGeo, sillMat);
    sMesh.position.set(pos.x, pos.y - frameHeight / 2 - 0.02, pos.z);
    parent.add(sMesh);
  }
}

// ─── Wall with Window Openings ────────────────────────────────────────────────

function createWallWithWindows(
  pos: THREE.Vector3,
  length: number,
  height: number,
  thickness: number,
  isHorizontal: boolean,
  mats: MaterialLibrary,
  parent: THREE.Group,
  isExterior: boolean
) {
  const winW = 1.2, winH = 1.4, sillH = 0.9;
  const numWindows = Math.max(1, Math.floor(length / 2.5));
  const wallMat = isExterior ? mats.exteriorWall : mats.whiteWall;

  // Wall below windows
  if (isHorizontal) {
    const belowGeo = new THREE.BoxGeometry(length, sillH, thickness);
    const belowMesh = new THREE.Mesh(belowGeo, wallMat);
    belowMesh.position.set(pos.x, pos.y - height / 2 + sillH / 2 + 0.06, pos.z);
    belowMesh.castShadow = true;
    belowMesh.receiveShadow = true;
    parent.add(belowMesh);

    // Wall above windows
    const aboveH = height - sillH - winH - 0.12;
    if (aboveH > 0.1) {
      const aboveGeo = new THREE.BoxGeometry(length, aboveH, thickness);
      const aboveMesh = new THREE.Mesh(aboveGeo, wallMat);
      aboveMesh.position.set(pos.x, pos.y + height / 2 - aboveH / 2 - 0.06, pos.z);
      aboveMesh.castShadow = true;
      aboveMesh.receiveShadow = true;
      parent.add(aboveMesh);
    }

    // Window piers (between windows)
    const spacing = length / (numWindows + 1);
    for (let i = 0; i <= numWindows; i++) {
      const pierX = pos.x - length / 2 + i * spacing;
      const pierW = spacing - winW;
      if (pierW > 0.1) {
        const pierGeo = new THREE.BoxGeometry(pierW, winH, thickness);
        const pierMesh = new THREE.Mesh(pierGeo, wallMat);
        pierMesh.position.set(pierX + pierW / 2, pos.y - height / 2 + sillH + winH / 2 + 0.06, pos.z);
        pierMesh.castShadow = true;
        parent.add(pierMesh);
      }
    }

    // Glass panes
    for (let i = 1; i <= numWindows; i++) {
      const wx = pos.x - length / 2 + i * spacing - winW / 2;
      const glassGeo = new THREE.BoxGeometry(winW, winH, 0.02);
      const glassMesh = new THREE.Mesh(glassGeo, mats.glass);
      glassMesh.position.set(wx + winW / 2, pos.y - height / 2 + sillH + winH / 2 + 0.06, pos.z);
      parent.add(glassMesh);

      // Window frame
      const frameMat = mats.metal;
      // Top and bottom
      for (const fy of [-winH / 2, winH / 2]) {
        const fGeo = new THREE.BoxGeometry(winW + 0.06, 0.03, 0.06);
        const fMesh = new THREE.Mesh(fGeo, frameMat);
        fMesh.position.set(wx + winW / 2, pos.y - height / 2 + sillH + winH / 2 + 0.06 + fy, pos.z);
        parent.add(fMesh);
      }
      // Sides
      for (const fx of [-winW / 2, winW / 2]) {
        const fGeo = new THREE.BoxGeometry(0.03, winH + 0.06, 0.06);
        const fMesh = new THREE.Mesh(fGeo, frameMat);
        fMesh.position.set(wx + winW / 2 + fx, pos.y - height / 2 + sillH + winH / 2 + 0.06, pos.z);
        parent.add(fMesh);
      }
    }
  } else {
    // Vertical wall - same logic rotated
    const belowGeo = new THREE.BoxGeometry(thickness, sillH, length);
    const belowMesh = new THREE.Mesh(belowGeo, wallMat);
    belowMesh.position.set(pos.x, pos.y - height / 2 + sillH / 2 + 0.06, pos.z);
    belowMesh.castShadow = true;
    parent.add(belowMesh);

    const aboveH = height - sillH - winH - 0.12;
    if (aboveH > 0.1) {
      const aboveGeo = new THREE.BoxGeometry(thickness, aboveH, length);
      const aboveMesh = new THREE.Mesh(aboveGeo, wallMat);
      aboveMesh.position.set(pos.x, pos.y + height / 2 - aboveH / 2 - 0.06, pos.z);
      aboveMesh.castShadow = true;
      parent.add(aboveMesh);
    }

    const spacing = length / (numWindows + 1);
    for (let i = 1; i <= numWindows; i++) {
      const wz = pos.z - length / 2 + i * spacing;
      const glassGeo = new THREE.BoxGeometry(0.02, winH, winW);
      const glassMesh = new THREE.Mesh(glassGeo, mats.glass);
      glassMesh.position.set(pos.x, pos.y - height / 2 + sillH + winH / 2 + 0.06, wz);
      parent.add(glassMesh);
    }
  }
}

// ─── Door Creation ────────────────────────────────────────────────────────────

function createDoor(
  wallPos: THREE.Vector3,
  wallLen: number,
  isHorizontal: boolean,
  doorW: number,
  doorH: number,
  baseY: number,
  wallT: number,
  mats: MaterialLibrary,
  roomName: string
): DoorMesh | null {
  const doorGeo = new THREE.BoxGeometry(doorW, doorH, 0.05);
  const doorMesh = new THREE.Mesh(doorGeo, mats.darkWood);
  doorMesh.castShadow = true;

  // Door handle
  const handleGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.12, 8);
  const handleMesh = new THREE.Mesh(handleGeo, mats.brushedMetal);
  handleMesh.rotation.x = Math.PI / 2;
  handleMesh.position.set(doorW / 2 - 0.08, 0, 0.04);
  doorMesh.add(handleMesh);

  // Position door in center of wall
  const pivot = new THREE.Group();
  doorMesh.position.set(doorW / 2, 0, 0);

  pivot.add(doorMesh);

  if (isHorizontal) {
    pivot.position.set(wallPos.x - doorW / 2, baseY + 0.12 + doorH / 2, wallPos.z);
  } else {
    pivot.position.set(wallPos.x, baseY + 0.12 + doorH / 2, wallPos.z - doorW / 2);
    pivot.rotation.y = Math.PI / 2;
  }

  // Door frame
  const frameMat = mats.wood;
  const frameW = 0.06;
  // Top
  const topGeo = new THREE.BoxGeometry(doorW + frameW * 2, frameW, wallT + 0.02);
  const topMesh = new THREE.Mesh(topGeo, frameMat);
  if (isHorizontal) {
    topMesh.position.set(wallPos.x, baseY + 0.12 + doorH + frameW / 2, wallPos.z);
  } else {
    topMesh.position.set(wallPos.x, baseY + 0.12 + doorH + frameW / 2, wallPos.z);
    topMesh.rotation.y = Math.PI / 2;
  }
  // Only add frame (skip for simplicity, door itself is the key visual)

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
    const stepGeo = new THREE.BoxGeometry(stepW, stepH, stepD);
    const stepMesh = new THREE.Mesh(stepGeo, mats.wood);
    stepMesh.position.set(
      rx + room.width / 2,
      baseY + 0.12 + i * stepH + stepH / 2,
      rz + i * stepD + stepD / 2
    );
    stepMesh.castShadow = true;
    stepMesh.receiveShadow = true;
    parent.add(stepMesh);
  }

  // Railing
  const railH = 0.9;
  const railGeo = new THREE.CylinderGeometry(0.02, 0.02, room.depth * 1.2, 8);
  const railMesh = new THREE.Mesh(railGeo, mats.brushedMetal);
  railMesh.rotation.x = Math.atan2(floorHeight, room.depth);
  railMesh.position.set(
    rx + 0.15,
    baseY + floorHeight / 2 + railH,
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

  // Semi-transparent background
  ctx.fillStyle = "rgba(0, 0, 0, 0.6)";
  const textWidth = Math.min(400, name.length * 22 + 60);
  const bgX = (512 - textWidth) / 2;
  ctx.beginPath();
  ctx.roundRect(bgX, 20, textWidth, 88, 12);
  ctx.fill();

  // Room name
  ctx.font = "bold 28px 'Inter', 'Segoe UI', sans-serif";
  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "center";
  ctx.fillText(name, 256, 60);

  // Area
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
