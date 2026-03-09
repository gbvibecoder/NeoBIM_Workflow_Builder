import * as THREE from "three";
import type { RoomDef } from "./types";
import type { MaterialLibrary } from "./materials";

// ─── Furniture Placement ──────────────────────────────────────────────────────

export function addFurniture(
  rooms: RoomDef[],
  centerX: number,
  centerZ: number,
  floorHeight: number,
  mats: MaterialLibrary,
  parent: THREE.Group
) {
  for (const room of rooms) {
    const rx = room.x - centerX + room.width / 2;
    const rz = room.z - centerZ + room.depth / 2;
    const baseY = room.floor * floorHeight + 0.12;

    switch (room.type) {
      case "living":
      case "lounge":
        addLivingRoom(rx, baseY, rz, room.width, room.depth, mats, parent); break;
      case "kitchen": addKitchen(rx, baseY, rz, room.width, room.depth, mats, parent); break;
      case "dining": addDining(rx, baseY, rz, room.width, room.depth, mats, parent); break;
      case "bedroom": addBedroom(rx, baseY, rz, room.width, room.depth, mats, parent); break;
      case "bathroom": addBathroom(rx, baseY, rz, room.width, room.depth, mats, parent); break;
      case "office":
      case "openOffice":
        addOffice(rx, baseY, rz, room.width, room.depth, mats, parent); break;
      case "conference": addDining(rx, baseY, rz, room.width, room.depth, mats, parent); break;
      case "hallway":
      case "lobby":
        addHallway(rx, baseY, rz, mats, parent); break;
      case "reception":
        addReception(rx, baseY, rz, room.width, room.depth, mats, parent); break;
      case "classroom":
        addClassroom(rx, baseY, rz, room.width, room.depth, mats, parent); break;
      case "gallery":
        addGallery(rx, baseY, rz, room.width, room.depth, mats, parent); break;
      case "ward":
        addWard(rx, baseY, rz, room.width, room.depth, mats, parent); break;
      case "restaurant":
      case "spa":
        addRestaurant(rx, baseY, rz, room.width, room.depth, mats, parent); break;
      case "retail":
        addRetail(rx, baseY, rz, room.width, room.depth, mats, parent); break;
      case "gym":
        addGym(rx, baseY, rz, room.width, room.depth, mats, parent); break;
      case "storage":
      case "mechanical":
        break; // no furniture for utility rooms
    }

    // Recessed ceiling lights for interior rooms
    if (room.hasCeiling !== false && room.type !== "terrace") {
      addCeilingLights(rx, baseY + floorHeight - 0.16, rz, room.width, room.depth, mats, parent);
    }
  }
}

// ─── Living Room ──────────────────────────────────────────────────────────────

function addLivingRoom(cx: number, baseY: number, cz: number, w: number, d: number, mats: MaterialLibrary, parent: THREE.Group) {
  // L-shaped sofa
  const sofaGroup = new THREE.Group();
  const seatH = 0.42, seatD = 0.9, backH = 0.35;

  const mainW = Math.min(3.2, w * 0.4);
  const seatGeo = new THREE.BoxGeometry(mainW, seatH, seatD);
  const seat = new THREE.Mesh(seatGeo, mats.fabricDark);
  seat.position.set(0, seatH / 2, 0);
  sofaGroup.add(seat);

  const backGeo = new THREE.BoxGeometry(mainW, backH, 0.15);
  const back = new THREE.Mesh(backGeo, mats.fabricDark);
  back.position.set(0, seatH + backH / 2, -seatD / 2 + 0.08);
  sofaGroup.add(back);

  const lW = 1.6;
  const lGeo = new THREE.BoxGeometry(0.9, seatH, lW);
  const lSeat = new THREE.Mesh(lGeo, mats.fabricDark);
  lSeat.position.set(mainW / 2 - 0.45, seatH / 2, lW / 2 - seatD / 2);
  sofaGroup.add(lSeat);

  for (let i = 0; i < 3; i++) {
    const cushGeo = new THREE.BoxGeometry(0.5, 0.18, 0.45);
    const cush = new THREE.Mesh(cushGeo, mats.fabric);
    cush.position.set(-mainW / 2 + 0.45 + i * 0.65, seatH + 0.09, 0.1);
    cush.rotation.z = (Math.random() - 0.5) * 0.1;
    sofaGroup.add(cush);
  }

  sofaGroup.position.set(cx - w * 0.15, baseY, cz - d * 0.2);
  parent.add(sofaGroup);

  // Coffee table
  const tableGroup = new THREE.Group();
  const tableTop = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 0.04, 0.6),
    mats.wood
  );
  tableTop.position.y = 0.4;
  tableGroup.add(tableTop);

  for (const lx of [-0.5, 0.5]) {
    for (const lz of [-0.22, 0.22]) {
      const leg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.015, 0.015, 0.4, 8),
        mats.metal
      );
      leg.position.set(lx, 0.2, lz);
      tableGroup.add(leg);
    }
  }
  tableGroup.position.set(cx - w * 0.15, baseY, cz + d * 0.05);
  parent.add(tableGroup);

  // TV unit on far wall
  const tvUnit = new THREE.Group();
  const consoleGeo = new THREE.BoxGeometry(2, 0.5, 0.4);
  const consoleMesh = new THREE.Mesh(consoleGeo, mats.darkWood);
  consoleMesh.position.y = 0.25;
  tvUnit.add(consoleMesh);

  const tvGeo = new THREE.BoxGeometry(1.6, 0.9, 0.04);
  const tvMat = new THREE.MeshBasicMaterial({ color: 0x111111 });
  const tv = new THREE.Mesh(tvGeo, tvMat);
  tv.position.set(0, 0.95, 0);
  tvUnit.add(tv);

  const ledGeo = new THREE.BoxGeometry(0.01, 0.01, 0.01);
  const led = new THREE.Mesh(ledGeo, mats.emissiveCool);
  led.position.set(0.7, 0.55, 0.03);
  tvUnit.add(led);

  tvUnit.position.set(cx + w * 0.25, baseY, cz - d * 0.45);
  parent.add(tvUnit);

  // Floor lamp (geometry only, no PointLight)
  const lampGroup = createFloorLamp(mats);
  lampGroup.position.set(cx - w * 0.4, baseY, cz - d * 0.35);
  parent.add(lampGroup);

  // Area rug
  const rugGeo = new THREE.BoxGeometry(3, 0.01, 2);
  const rugMesh = new THREE.Mesh(rugGeo, mats.fabric);
  rugMesh.position.set(cx - w * 0.15, baseY + 0.005, cz + d * 0.05);
  parent.add(rugMesh);

  // Bookshelf on accent wall
  addBookshelf(cx - w * 0.4, baseY, cz + d * 0.3, mats, parent);

  // Indoor plants
  const plant1 = createPottedPlant(mats, 1.2);
  plant1.position.set(cx + w * 0.4, baseY, cz + d * 0.35);
  parent.add(plant1);

  const plant2 = createPottedPlant(mats, 0.6);
  plant2.position.set(cx - w * 0.15, baseY + 0.42, cz + d * 0.05 - 0.5);
  parent.add(plant2);

  // Wall art
  const artCanvas = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 0.7, 0.02),
    new THREE.MeshBasicMaterial({ color: 0x2C3E50 })
  );
  artCanvas.position.set(cx + w * 0.25, baseY + 1.8, cz + d * 0.46);
  parent.add(artCanvas);
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(1.08, 0.78, 0.015),
    mats.darkWood
  );
  frame.position.set(cx + w * 0.25, baseY + 1.8, cz + d * 0.46 - 0.005);
  parent.add(frame);

  // Side table
  const sideTable = new THREE.Group();
  const stTop = new THREE.Mesh(
    new THREE.CylinderGeometry(0.22, 0.22, 0.03, 16),
    mats.marbleFloor
  );
  stTop.position.y = 0.55;
  sideTable.add(stTop);
  const stLeg = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.025, 0.55, 8),
    mats.brushedMetal
  );
  stLeg.position.y = 0.275;
  sideTable.add(stLeg);
  sideTable.position.set(cx - w * 0.15 + 1.8, baseY, cz - d * 0.15);
  parent.add(sideTable);
}

// ─── Kitchen ──────────────────────────────────────────────────────────────────

function addKitchen(cx: number, baseY: number, cz: number, w: number, d: number, mats: MaterialLibrary, parent: THREE.Group) {
  const counterH = 0.9, counterD = 0.6, counterThick = 0.04;

  // Back counter
  const backW = w - 0.4;
  const backCounter = new THREE.Group();
  const cabinetGeo = new THREE.BoxGeometry(backW, counterH - counterThick, counterD);
  const cabinet = new THREE.Mesh(cabinetGeo, mats.whiteWall);
  cabinet.position.set(0, (counterH - counterThick) / 2, 0);
  backCounter.add(cabinet);
  const topGeo = new THREE.BoxGeometry(backW + 0.05, counterThick, counterD + 0.03);
  const top = new THREE.Mesh(topGeo, mats.marbleFloor);
  top.position.set(0, counterH - counterThick / 2, 0);
  backCounter.add(top);

  for (let i = 0; i < Math.floor(backW / 0.6); i++) {
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 0.1, 6),
      mats.brushedMetal
    );
    handle.rotation.x = Math.PI / 2;
    handle.position.set(-backW / 2 + 0.3 + i * 0.6, counterH * 0.4, counterD / 2 + 0.01);
    backCounter.add(handle);
  }

  backCounter.position.set(cx, baseY, cz + d / 2 - counterD / 2 - 0.1);
  parent.add(backCounter);

  // Kitchen island
  const islandW = Math.min(2.4, w * 0.5);
  const islandGroup = new THREE.Group();
  const islandBase = new THREE.Mesh(
    new THREE.BoxGeometry(islandW, counterH - counterThick, counterD + 0.1),
    mats.darkWood
  );
  islandBase.position.y = (counterH - counterThick) / 2;
  islandGroup.add(islandBase);
  const islandTop = new THREE.Mesh(
    new THREE.BoxGeometry(islandW + 0.15, counterThick, counterD + 0.25),
    mats.marbleFloor
  );
  islandTop.position.y = counterH - counterThick / 2;
  islandGroup.add(islandTop);

  islandGroup.position.set(cx, baseY, cz - d * 0.1);
  parent.add(islandGroup);

  // Bar stools around island
  for (let i = 0; i < 3; i++) {
    const stool = createBarStool(mats);
    stool.position.set(
      cx - islandW / 2 + 0.4 + i * (islandW - 0.8) / 2,
      baseY,
      cz - d * 0.1 - counterD / 2 - 0.4
    );
    parent.add(stool);
  }

  // Pendant lights over island (geometry only)
  for (let i = 0; i < 3; i++) {
    const pendant = createPendantLight(mats);
    pendant.position.set(
      cx - islandW / 3 + i * islandW / 3,
      baseY + 2.6,
      cz - d * 0.1
    );
    parent.add(pendant);
  }

  // Range hood
  const hoodGeo = new THREE.BoxGeometry(0.9, 0.3, 0.5);
  const hood = new THREE.Mesh(hoodGeo, mats.brushedMetal);
  hood.position.set(cx, baseY + 2.0, cz + d / 2 - 0.35);
  parent.add(hood);

  // Sink area
  const sinkGeo = new THREE.BoxGeometry(0.5, 0.08, 0.4);
  const sinkMat = new THREE.MeshBasicMaterial({ color: 0x666666 });
  const sink = new THREE.Mesh(sinkGeo, sinkMat);
  sink.position.set(cx + w * 0.2, baseY + counterH + 0.01, cz + d / 2 - counterD / 2 - 0.1);
  parent.add(sink);

  // Faucet
  const faucetGroup = new THREE.Group();
  const faucetBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.015, 0.3, 8),
    mats.brushedMetal
  );
  faucetBase.position.y = 0.15;
  faucetGroup.add(faucetBase);
  const faucetArm = new THREE.Mesh(
    new THREE.CylinderGeometry(0.01, 0.01, 0.15, 8),
    mats.brushedMetal
  );
  faucetArm.rotation.z = Math.PI / 2;
  faucetArm.position.set(0.075, 0.3, 0);
  faucetGroup.add(faucetArm);
  faucetGroup.position.set(cx + w * 0.2, baseY + counterH + 0.02, cz + d / 2 - counterD / 2 - 0.25);
  parent.add(faucetGroup);
}

// ─── Dining Room ──────────────────────────────────────────────────────────────

function addDining(cx: number, baseY: number, cz: number, w: number, d: number, mats: MaterialLibrary, parent: THREE.Group) {
  const tableW = Math.min(2.2, w * 0.5);
  const tableD = Math.min(1.0, d * 0.35);
  const tableH = 0.76;
  const tableGroup = new THREE.Group();

  const tabletop = new THREE.Mesh(
    new THREE.BoxGeometry(tableW, 0.04, tableD),
    mats.wood
  );
  tabletop.position.y = tableH;
  tableGroup.add(tabletop);

  for (const lx of [-tableW / 2 + 0.08, tableW / 2 - 0.08]) {
    for (const lz of [-tableD / 2 + 0.08, tableD / 2 - 0.08]) {
      const leg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.02, tableH, 8),
        mats.metal
      );
      leg.position.set(lx, tableH / 2, lz);
      tableGroup.add(leg);
    }
  }
  tableGroup.position.set(cx, baseY, cz);
  parent.add(tableGroup);

  const chairPositions = [
    { x: -tableW / 2 - 0.4, z: -tableD / 4, rot: Math.PI / 2 },
    { x: -tableW / 2 - 0.4, z: tableD / 4, rot: Math.PI / 2 },
    { x: tableW / 2 + 0.4, z: -tableD / 4, rot: -Math.PI / 2 },
    { x: tableW / 2 + 0.4, z: tableD / 4, rot: -Math.PI / 2 },
    { x: 0, z: -tableD / 2 - 0.4, rot: 0 },
    { x: 0, z: tableD / 2 + 0.4, rot: Math.PI },
  ];

  for (const cp of chairPositions) {
    const chair = createDiningChair(mats);
    chair.position.set(cx + cp.x, baseY, cz + cp.z);
    chair.rotation.y = cp.rot;
    parent.add(chair);
  }

  // Chandelier (geometry only)
  const chandelier = createChandelier(mats);
  chandelier.position.set(cx, baseY + 2.8, cz);
  parent.add(chandelier);
}

// ─── Bedroom ──────────────────────────────────────────────────────────────────

function addBedroom(cx: number, baseY: number, cz: number, w: number, d: number, mats: MaterialLibrary, parent: THREE.Group) {
  const bedW = 1.8, bedD = 2.2, bedH = 0.55;
  const bedGroup = new THREE.Group();

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(bedW + 0.1, 0.15, bedD + 0.1),
    mats.darkWood
  );
  frame.position.y = 0.2;
  bedGroup.add(frame);

  const mattress = new THREE.Mesh(
    new THREE.BoxGeometry(bedW, 0.22, bedD),
    new THREE.MeshBasicMaterial({ color: 0xFAF8F5 })
  );
  mattress.position.y = bedH - 0.11;
  bedGroup.add(mattress);

  for (const px of [-0.4, 0.4]) {
    const pillow = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.12, 0.35),
      new THREE.MeshBasicMaterial({ color: 0xEEEBE5 })
    );
    pillow.position.set(px, bedH + 0.06, -bedD / 2 + 0.25);
    pillow.rotation.z = (Math.random() - 0.5) * 0.05;
    bedGroup.add(pillow);
  }

  const duvet = new THREE.Mesh(
    new THREE.BoxGeometry(bedW - 0.1, 0.08, bedD * 0.65),
    mats.fabric
  );
  duvet.position.set(0, bedH + 0.04, 0.2);
  bedGroup.add(duvet);

  const headboard = new THREE.Mesh(
    new THREE.BoxGeometry(bedW + 0.2, 1.0, 0.08),
    mats.fabricDark
  );
  headboard.position.set(0, 0.8, -bedD / 2 - 0.04);
  bedGroup.add(headboard);

  bedGroup.position.set(cx, baseY, cz - d * 0.15);
  parent.add(bedGroup);

  // Nightstands
  for (const side of [-1, 1]) {
    const ns = new THREE.Group();
    const nsBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.5, 0.4),
      mats.darkWood
    );
    nsBody.position.y = 0.25;
    ns.add(nsBody);

    const lampBase = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.08, 0.04, 16),
      mats.brushedMetal
    );
    lampBase.position.y = 0.52;
    ns.add(lampBase);
    const lampShade = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.12, 0.2, 16),
      mats.emissiveWarm
    );
    lampShade.position.y = 0.66;
    ns.add(lampShade);

    ns.position.set(cx + side * (bedW / 2 + 0.35), baseY, cz - d * 0.15 - bedD / 2 + 0.2);
    parent.add(ns);
  }

  // Wardrobe
  const wardW = Math.min(1.8, w * 0.25);
  const wardH = 2.2;
  const wardrobe = new THREE.Mesh(
    new THREE.BoxGeometry(wardW, wardH, 0.6),
    mats.darkWood
  );
  wardrobe.position.set(cx + w * 0.35, baseY + wardH / 2, cz + d * 0.35);
  parent.add(wardrobe);

  for (const hx of [-wardW * 0.15, wardW * 0.15]) {
    const handle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 0.12, 6),
      mats.brushedMetal
    );
    handle.position.set(
      cx + w * 0.35 + hx,
      baseY + wardH * 0.5,
      cz + d * 0.35 + 0.31
    );
    parent.add(handle);
  }
}

// ─── Bathroom ─────────────────────────────────────────────────────────────────

function addBathroom(cx: number, baseY: number, cz: number, w: number, d: number, mats: MaterialLibrary, parent: THREE.Group) {
  const vanityW = Math.min(1.2, w * 0.5);
  const vanity = new THREE.Group();
  const vanityBase = new THREE.Mesh(
    new THREE.BoxGeometry(vanityW, 0.8, 0.5),
    mats.darkWood
  );
  vanityBase.position.y = 0.4;
  vanity.add(vanityBase);

  const vanityTop = new THREE.Mesh(
    new THREE.BoxGeometry(vanityW + 0.05, 0.04, 0.55),
    mats.marbleFloor
  );
  vanityTop.position.y = 0.82;
  vanity.add(vanityTop);

  const basin = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.15, 0.08, 16),
    new THREE.MeshBasicMaterial({ color: 0xF8F8F8 })
  );
  basin.position.set(0, 0.86, 0);
  vanity.add(basin);

  const mirror = new THREE.Mesh(
    new THREE.BoxGeometry(vanityW - 0.1, 0.8, 0.02),
    new THREE.MeshBasicMaterial({ color: 0xDDDDDD })
  );
  mirror.position.set(0, 1.5, -0.25);
  vanity.add(mirror);

  vanity.position.set(cx - w * 0.2, baseY, cz + d * 0.35);
  parent.add(vanity);

  // Shower/tub
  const tubW = Math.min(1.6, w * 0.5);
  const tub = new THREE.Mesh(
    new THREE.BoxGeometry(tubW, 0.5, 0.7),
    new THREE.MeshBasicMaterial({ color: 0xFAFAFA })
  );
  tub.position.set(cx + w * 0.2, baseY + 0.25, cz - d * 0.25);
  parent.add(tub);

  const showerGlass = new THREE.Mesh(
    new THREE.BoxGeometry(0.02, 2.0, 0.7),
    mats.glass
  );
  showerGlass.position.set(cx + w * 0.2 - tubW / 2, baseY + 1.0, cz - d * 0.25);
  parent.add(showerGlass);

  // Toilet
  const toilet = new THREE.Group();
  const toiletBase = new THREE.Mesh(
    new THREE.BoxGeometry(0.38, 0.38, 0.55),
    new THREE.MeshBasicMaterial({ color: 0xFAFAFA })
  );
  toiletBase.position.y = 0.19;
  toilet.add(toiletBase);
  const tank = new THREE.Mesh(
    new THREE.BoxGeometry(0.35, 0.35, 0.18),
    new THREE.MeshBasicMaterial({ color: 0xF5F5F5 })
  );
  tank.position.set(0, 0.35, -0.35);
  toilet.add(tank);
  toilet.position.set(cx + w * 0.3, baseY, cz + d * 0.15);
  parent.add(toilet);
}

// ─── Office ───────────────────────────────────────────────────────────────────

function addOffice(cx: number, baseY: number, cz: number, w: number, d: number, mats: MaterialLibrary, parent: THREE.Group) {
  const deskW = Math.min(1.8, w * 0.5);
  const deskD = 0.75;
  const deskH = 0.74;
  const desk = new THREE.Group();

  const deskTop = new THREE.Mesh(
    new THREE.BoxGeometry(deskW, 0.03, deskD),
    mats.wood
  );
  deskTop.position.y = deskH;
  desk.add(deskTop);

  for (const lx of [-deskW / 2 + 0.05, deskW / 2 - 0.05]) {
    const trestle = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, deskH, deskD - 0.1),
      mats.metal
    );
    trestle.position.set(lx, deskH / 2, 0);
    desk.add(trestle);
  }

  desk.position.set(cx, baseY, cz - d * 0.3);
  parent.add(desk);

  // Monitor
  const monitorGroup = new THREE.Group();
  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.4, 0.02),
    new THREE.MeshBasicMaterial({ color: 0x111111 })
  );
  screen.position.y = 0.35;
  monitorGroup.add(screen);
  const screenGlow = new THREE.Mesh(
    new THREE.BoxGeometry(0.65, 0.35, 0.01),
    mats.emissiveCool
  );
  screenGlow.position.set(0, 0.35, 0.015);
  monitorGroup.add(screenGlow);
  const stand = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 0.15, 8),
    mats.metal
  );
  stand.position.y = 0.075;
  monitorGroup.add(stand);
  const standBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.1, 0.1, 0.015, 16),
    mats.metal
  );
  standBase.position.y = 0.008;
  monitorGroup.add(standBase);

  monitorGroup.position.set(cx, baseY + deskH + 0.02, cz - d * 0.3 - deskD * 0.3);
  parent.add(monitorGroup);

  // Office chair
  const chair = createOfficeChair(mats);
  chair.position.set(cx, baseY, cz - d * 0.3 + deskD / 2 + 0.3);
  parent.add(chair);

  // Bookshelf
  addBookshelf(cx + w * 0.3, baseY, cz + d * 0.3, mats, parent);
}

// ─── Classroom ────────────────────────────────────────────────────────────────

function addClassroom(cx: number, baseY: number, cz: number, w: number, d: number, mats: MaterialLibrary, parent: THREE.Group) {
  // Whiteboard on front wall
  const boardW = Math.min(3.0, w * 0.6);
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(boardW, 1.2, 0.03),
    new THREE.MeshBasicMaterial({ color: 0xF5F5F0 })
  );
  board.position.set(cx, baseY + 1.5, cz - d * 0.47);
  parent.add(board);
  // Board frame
  const boardFrame = new THREE.Mesh(
    new THREE.BoxGeometry(boardW + 0.06, 1.26, 0.02),
    mats.metal
  );
  boardFrame.position.set(cx, baseY + 1.5, cz - d * 0.47 - 0.01);
  parent.add(boardFrame);

  // Marker tray
  const tray = new THREE.Mesh(
    new THREE.BoxGeometry(boardW * 0.4, 0.03, 0.08),
    mats.metal
  );
  tray.position.set(cx, baseY + 0.88, cz - d * 0.46);
  parent.add(tray);

  // Teacher desk at front
  const tDeskW = 1.4, tDeskD = 0.6, tDeskH = 0.74;
  const teacherDesk = new THREE.Mesh(
    new THREE.BoxGeometry(tDeskW, tDeskH, tDeskD),
    mats.darkWood
  );
  teacherDesk.position.set(cx - w * 0.3, baseY + tDeskH / 2, cz - d * 0.35);
  parent.add(teacherDesk);

  // Teacher chair
  const tChair = createOfficeChair(mats);
  tChair.position.set(cx - w * 0.3, baseY, cz - d * 0.35 + tDeskD / 2 + 0.3);
  parent.add(tChair);

  // Student desks in grid (3 columns x 2 rows)
  const cols = Math.min(3, Math.floor(w / 2));
  const rows = Math.min(2, Math.floor(d / 3));
  const deskW = 1.0, deskD2 = 0.5, deskH2 = 0.72;
  const spacingX = w / (cols + 1);
  const spacingZ = (d * 0.5) / (rows + 1);

  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      const dx = cx - w / 2 + (col + 1) * spacingX;
      const dz = cz - d * 0.05 + (row + 1) * spacingZ;

      // Desk
      const studentDesk = new THREE.Group();
      const sTop = new THREE.Mesh(
        new THREE.BoxGeometry(deskW, 0.03, deskD2),
        mats.wood
      );
      sTop.position.y = deskH2;
      studentDesk.add(sTop);
      // Legs
      for (const lx2 of [-deskW / 2 + 0.05, deskW / 2 - 0.05]) {
        for (const lz2 of [-deskD2 / 2 + 0.05, deskD2 / 2 - 0.05]) {
          const sLeg = new THREE.Mesh(
            new THREE.CylinderGeometry(0.012, 0.012, deskH2, 6),
            mats.metal
          );
          sLeg.position.set(lx2, deskH2 / 2, lz2);
          studentDesk.add(sLeg);
        }
      }
      studentDesk.position.set(dx, baseY, dz);
      parent.add(studentDesk);

      // Chair facing whiteboard
      const sChair = createDiningChair(mats);
      sChair.position.set(dx, baseY, dz + deskD2 / 2 + 0.3);
      parent.add(sChair);
    }
  }

  // Ceiling projector
  const projector = new THREE.Mesh(
    new THREE.BoxGeometry(0.35, 0.12, 0.25),
    new THREE.MeshBasicMaterial({ color: 0x333333 })
  );
  projector.position.set(cx, baseY + 3.2, cz);
  parent.add(projector);
}

// ─── Gallery ──────────────────────────────────────────────────────────────────

function addGallery(cx: number, baseY: number, cz: number, w: number, d: number, mats: MaterialLibrary, parent: THREE.Group) {
  // Paintings on walls
  const artColors = [0x8B0000, 0x00008B, 0x2C3E50, 0x1A4731, 0x4A0080];
  const numPaintings = Math.min(3, Math.floor(w / 2.5));
  for (let i = 0; i < numPaintings; i++) {
    const artW = 0.8 + Math.random() * 0.4;
    const artH = 0.6 + Math.random() * 0.3;
    const px = cx - w * 0.35 + i * (w * 0.7 / Math.max(1, numPaintings - 1));

    // Painting canvas
    const painting = new THREE.Mesh(
      new THREE.BoxGeometry(artW, artH, 0.02),
      new THREE.MeshBasicMaterial({ color: artColors[i % artColors.length] })
    );
    painting.position.set(px, baseY + 1.6, cz - d * 0.47);
    parent.add(painting);
    // Frame
    const pFrame = new THREE.Mesh(
      new THREE.BoxGeometry(artW + 0.06, artH + 0.06, 0.015),
      mats.darkWood
    );
    pFrame.position.set(px, baseY + 1.6, cz - d * 0.47 - 0.005);
    parent.add(pFrame);
  }

  // Display pedestals
  const numPedestals = Math.min(2, Math.floor(w / 4));
  for (let i = 0; i < numPedestals; i++) {
    const pedX = cx - w * 0.2 + i * w * 0.4;
    // Pedestal base
    const pedestal = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 1.0, 0.5),
      mats.whiteWall
    );
    pedestal.position.set(pedX, baseY + 0.5, cz);
    parent.add(pedestal);
    // Display object (sphere sculpture)
    const sculpture = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 12, 12),
      mats.brushedMetal
    );
    sculpture.position.set(pedX, baseY + 1.15, cz);
    parent.add(sculpture);
  }

  // Central bench
  const benchW = Math.min(2.0, w * 0.35);
  const bench = new THREE.Mesh(
    new THREE.BoxGeometry(benchW, 0.45, 0.5),
    mats.leather
  );
  bench.position.set(cx, baseY + 0.225, cz + d * 0.2);
  parent.add(bench);

  // Track lighting bar
  const trackW = w * 0.7;
  const trackBar = new THREE.Mesh(
    new THREE.BoxGeometry(trackW, 0.04, 0.04),
    mats.metal
  );
  trackBar.position.set(cx, baseY + 3.0, cz - d * 0.3);
  parent.add(trackBar);
  // Spot fixtures along track
  const numSpots = Math.floor(trackW / 0.8);
  for (let i = 0; i < numSpots; i++) {
    const spotX = cx - trackW / 2 + (i + 0.5) * (trackW / numSpots);
    const spot = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.06, 0.1, 8),
      mats.metal
    );
    spot.position.set(spotX, baseY + 2.93, cz - d * 0.3);
    parent.add(spot);
  }
}

// ─── Hospital Ward ────────────────────────────────────────────────────────────

function addWard(cx: number, baseY: number, cz: number, w: number, d: number, mats: MaterialLibrary, parent: THREE.Group) {
  const numBeds = Math.min(2, Math.floor(w / 3));
  const bedSpacing = w / (numBeds + 1);

  for (let i = 0; i < numBeds; i++) {
    const bx = cx - w / 2 + (i + 1) * bedSpacing;

    // Hospital bed frame
    const bedFrame = new THREE.Mesh(
      new THREE.BoxGeometry(1.0, 0.5, 2.0),
      mats.metal
    );
    bedFrame.position.set(bx, baseY + 0.25, cz - d * 0.1);
    parent.add(bedFrame);

    // Mattress
    const mattress = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.12, 1.9),
      new THREE.MeshBasicMaterial({ color: 0xF0F0F0 })
    );
    mattress.position.set(bx, baseY + 0.56, cz - d * 0.1);
    parent.add(mattress);

    // Pillow
    const pillow = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.08, 0.3),
      new THREE.MeshBasicMaterial({ color: 0xEEEEEE })
    );
    pillow.position.set(bx, baseY + 0.66, cz - d * 0.1 - 0.75);
    parent.add(pillow);

    // Blanket
    const blanket = new THREE.Mesh(
      new THREE.BoxGeometry(0.85, 0.04, 1.2),
      new THREE.MeshBasicMaterial({ color: 0x7BA7C9 })
    );
    blanket.position.set(bx, baseY + 0.64, cz - d * 0.1 + 0.2);
    parent.add(blanket);

    // Side cabinet
    const cabinet = new THREE.Mesh(
      new THREE.BoxGeometry(0.45, 0.7, 0.4),
      mats.whiteWall
    );
    cabinet.position.set(bx + 0.7, baseY + 0.35, cz - d * 0.1 - 0.6);
    parent.add(cabinet);

    // IV stand
    const ivPole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 1.8, 6),
      mats.metal
    );
    ivPole.position.set(bx - 0.6, baseY + 0.9, cz - d * 0.1 - 0.5);
    parent.add(ivPole);
    const ivBag = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.15, 0.04),
      new THREE.MeshBasicMaterial({ color: 0xCCDDEE, transparent: true, opacity: 0.7 })
    );
    ivBag.position.set(bx - 0.6, baseY + 1.7, cz - d * 0.1 - 0.5);
    parent.add(ivBag);

    // Curtain divider (between beds)
    if (i < numBeds - 1) {
      const curtainX = bx + bedSpacing / 2;
      const curtain = new THREE.Mesh(
        new THREE.BoxGeometry(0.02, 2.2, d * 0.6),
        new THREE.MeshBasicMaterial({ color: 0xB8C9D8, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
      );
      curtain.position.set(curtainX, baseY + 1.1, cz);
      parent.add(curtain);
      // Curtain rail
      const rail = new THREE.Mesh(
        new THREE.CylinderGeometry(0.01, 0.01, d * 0.6, 4),
        mats.metal
      );
      rail.rotation.x = Math.PI / 2;
      rail.position.set(curtainX, baseY + 2.2, cz);
      parent.add(rail);
    }
  }

  // Nurse call panel on wall
  const callPanel = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 0.2, 0.03),
    new THREE.MeshBasicMaterial({ color: 0xDD4444 })
  );
  callPanel.position.set(cx + w * 0.45, baseY + 1.2, cz - d * 0.47);
  parent.add(callPanel);
}

// ─── Restaurant ───────────────────────────────────────────────────────────────

function addRestaurant(cx: number, baseY: number, cz: number, w: number, d: number, mats: MaterialLibrary, parent: THREE.Group) {
  // Small round tables with chairs
  const numTables = Math.min(4, Math.floor((w * d) / 8));
  const cols = Math.min(2, numTables);
  const rows = Math.ceil(numTables / cols);
  const spacingX = w / (cols + 1);
  const spacingZ = (d * 0.6) / (rows + 1);

  let tableCount = 0;
  for (let col = 0; col < cols && tableCount < numTables; col++) {
    for (let row = 0; row < rows && tableCount < numTables; row++) {
      const tx = cx - w / 2 + (col + 1) * spacingX;
      const tz = cz - d * 0.1 + (row + 1) * spacingZ;

      // Round table
      const tableTop = new THREE.Mesh(
        new THREE.CylinderGeometry(0.4, 0.4, 0.03, 16),
        mats.wood
      );
      tableTop.position.set(tx, baseY + 0.74, tz);
      parent.add(tableTop);
      const tableLeg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.04, 0.72, 8),
        mats.metal
      );
      tableLeg.position.set(tx, baseY + 0.36, tz);
      parent.add(tableLeg);
      const tableBase = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.18, 0.02, 12),
        mats.metal
      );
      tableBase.position.set(tx, baseY + 0.01, tz);
      parent.add(tableBase);

      // 2 chairs per table
      for (const side of [-1, 1]) {
        const chair = createDiningChair(mats);
        chair.position.set(tx + side * 0.55, baseY, tz);
        chair.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
        parent.add(chair);
      }
      tableCount++;
    }
  }

  // Bar counter along one wall
  const barW = Math.min(w * 0.7, 4);
  const barCounter = new THREE.Mesh(
    new THREE.BoxGeometry(barW, 1.1, 0.5),
    mats.darkWood
  );
  barCounter.position.set(cx, baseY + 0.55, cz - d * 0.42);
  parent.add(barCounter);
  // Bar countertop
  const barTop = new THREE.Mesh(
    new THREE.BoxGeometry(barW + 0.06, 0.04, 0.56),
    mats.marbleFloor
  );
  barTop.position.set(cx, baseY + 1.12, cz - d * 0.42);
  parent.add(barTop);

  // Menu board on wall
  const menuBoard = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 0.8, 0.03),
    new THREE.MeshBasicMaterial({ color: 0x1A1A2E })
  );
  menuBoard.position.set(cx, baseY + 2.0, cz - d * 0.48);
  parent.add(menuBoard);
  // Board frame
  const menuFrame = new THREE.Mesh(
    new THREE.BoxGeometry(1.26, 0.86, 0.02),
    mats.darkWood
  );
  menuFrame.position.set(cx, baseY + 2.0, cz - d * 0.48 - 0.01);
  parent.add(menuFrame);
}

// ─── Retail ───────────────────────────────────────────────────────────────────

function addRetail(cx: number, baseY: number, cz: number, w: number, d: number, mats: MaterialLibrary, parent: THREE.Group) {
  // Display shelving units
  const numShelves = Math.min(3, Math.floor(w / 2.5));
  const shelfSpacing = w / (numShelves + 1);

  for (let i = 0; i < numShelves; i++) {
    const sx = cx - w / 2 + (i + 1) * shelfSpacing;
    const shelfW = 1.5, shelfH = 1.8, shelfD = 0.4;

    // Shelf frame
    const shelfFrame = new THREE.Mesh(
      new THREE.BoxGeometry(shelfW, shelfH, shelfD),
      mats.metal
    );
    shelfFrame.position.set(sx, baseY + shelfH / 2, cz + d * 0.1);
    parent.add(shelfFrame);

    // Products on shelves (colored boxes)
    const productColors = [0xE74C3C, 0x3498DB, 0x2ECC71, 0xF39C12, 0x9B59B6];
    const rows2 = 4;
    for (let r = 0; r < rows2; r++) {
      const numProducts = 3 + Math.floor(Math.random() * 2);
      for (let p = 0; p < numProducts; p++) {
        const prodW = 0.12 + Math.random() * 0.08;
        const prodH = 0.15 + Math.random() * 0.1;
        const product = new THREE.Mesh(
          new THREE.BoxGeometry(prodW, prodH, shelfD * 0.6),
          new THREE.MeshBasicMaterial({ color: productColors[Math.floor(Math.random() * productColors.length)] })
        );
        product.position.set(
          sx - shelfW / 2 + 0.2 + p * 0.25,
          baseY + (r + 0.5) * (shelfH / rows2),
          cz + d * 0.1
        );
        parent.add(product);
      }
    }
  }

  // Checkout counter near entrance
  const checkoutW = Math.min(2.0, w * 0.35);
  const checkout = new THREE.Mesh(
    new THREE.BoxGeometry(checkoutW, 1.0, 0.6),
    mats.darkWood
  );
  checkout.position.set(cx + w * 0.3, baseY + 0.5, cz - d * 0.35);
  parent.add(checkout);
  // Register (small box)
  const register = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.15, 0.3),
    new THREE.MeshBasicMaterial({ color: 0x222222 })
  );
  register.position.set(cx + w * 0.3, baseY + 1.08, cz - d * 0.35);
  parent.add(register);

  // Mannequin (simplified)
  const mannequinX = cx - w * 0.35;
  const mannequinZ = cz - d * 0.3;
  // Body
  const mannBody = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.12, 1.2, 8),
    new THREE.MeshBasicMaterial({ color: 0xD4C5B0 })
  );
  mannBody.position.set(mannequinX, baseY + 0.8, mannequinZ);
  parent.add(mannBody);
  // Head
  const mannHead = new THREE.Mesh(
    new THREE.SphereGeometry(0.1, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xD4C5B0 })
  );
  mannHead.position.set(mannequinX, baseY + 1.5, mannequinZ);
  parent.add(mannHead);
}

// ─── Gym ──────────────────────────────────────────────────────────────────────

function addGym(cx: number, baseY: number, cz: number, w: number, d: number, mats: MaterialLibrary, parent: THREE.Group) {
  // Weight bench
  const benchGroup = new THREE.Group();
  // Bench pad
  const benchPad = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.08, 1.2),
    mats.leather
  );
  benchPad.position.y = 0.46;
  benchGroup.add(benchPad);
  // Bench frame
  const benchFrame = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.42, 0.06),
    mats.metal
  );
  benchFrame.position.set(0, 0.21, -0.5);
  benchGroup.add(benchFrame);
  const benchFrame2 = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.42, 0.06),
    mats.metal
  );
  benchFrame2.position.set(0, 0.21, 0.5);
  benchGroup.add(benchFrame2);
  // Barbell rack uprights
  for (const side of [-0.3, 0.3]) {
    const upright = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 1.2, 6),
      mats.metal
    );
    upright.position.set(side, 0.6, -0.5);
    benchGroup.add(upright);
  }
  // Barbell
  const barbell = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.015, 1.4, 6),
    mats.metal
  );
  barbell.rotation.z = Math.PI / 2;
  barbell.position.set(0, 1.1, -0.5);
  benchGroup.add(barbell);

  benchGroup.position.set(cx - w * 0.2, baseY, cz - d * 0.2);
  parent.add(benchGroup);

  // Dumbbell rack
  const rackGroup = new THREE.Group();
  const rackFrame = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 1.0, 0.4),
    mats.metal
  );
  rackFrame.position.y = 0.5;
  rackGroup.add(rackFrame);
  // Dumbbell pairs
  for (let i = 0; i < 4; i++) {
    for (const side of [-0.05, 0.05]) {
      const db = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 0.2, 6),
        new THREE.MeshBasicMaterial({ color: 0x333333 })
      );
      db.rotation.z = Math.PI / 2;
      db.position.set(-0.5 + i * 0.35, 0.3 + Math.floor(i / 2) * 0.35, side);
      rackGroup.add(db);
    }
  }
  rackGroup.position.set(cx + w * 0.25, baseY, cz + d * 0.35);
  parent.add(rackGroup);

  // Treadmill
  const treadmill = new THREE.Group();
  // Base/belt area
  const treadBase = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 0.15, 1.5),
    new THREE.MeshBasicMaterial({ color: 0x222222 })
  );
  treadBase.position.y = 0.12;
  treadmill.add(treadBase);
  // Belt surface
  const belt = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.02, 1.3),
    new THREE.MeshBasicMaterial({ color: 0x444444 })
  );
  belt.position.y = 0.2;
  treadmill.add(belt);
  // Console/handles
  const tConsole = new THREE.Mesh(
    new THREE.BoxGeometry(0.6, 0.3, 0.08),
    new THREE.MeshBasicMaterial({ color: 0x333333 })
  );
  tConsole.position.set(0, 1.1, -0.7);
  treadmill.add(tConsole);
  // Handle bars
  for (const side of [-0.3, 0.3]) {
    const handleBar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 0.9, 6),
      mats.metal
    );
    handleBar.position.set(side, 0.7, -0.7);
    treadmill.add(handleBar);
  }
  treadmill.position.set(cx + w * 0.2, baseY, cz - d * 0.15);
  parent.add(treadmill);

  // Floor mat area
  const floorMat = new THREE.Mesh(
    new THREE.BoxGeometry(2.0, 0.02, 1.2),
    new THREE.MeshBasicMaterial({ color: 0x4A6B3D })
  );
  floorMat.position.set(cx - w * 0.15, baseY + 0.01, cz + d * 0.2);
  parent.add(floorMat);
}

// ─── Reception ────────────────────────────────────────────────────────────────

function addReception(cx: number, baseY: number, cz: number, w: number, d: number, mats: MaterialLibrary, parent: THREE.Group) {
  // Reception desk (curved front)
  const deskW = Math.min(2.5, w * 0.5);
  const deskH = 1.1;
  const rDesk = new THREE.Mesh(
    new THREE.BoxGeometry(deskW, deskH, 0.7),
    mats.darkWood
  );
  rDesk.position.set(cx, baseY + deskH / 2, cz - d * 0.2);
  parent.add(rDesk);
  // Desk top surface
  const rTop = new THREE.Mesh(
    new THREE.BoxGeometry(deskW + 0.06, 0.04, 0.76),
    mats.marbleFloor
  );
  rTop.position.set(cx, baseY + deskH + 0.02, cz - d * 0.2);
  parent.add(rTop);

  // Monitor on desk
  const monitorGroup = new THREE.Group();
  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.35, 0.02),
    new THREE.MeshBasicMaterial({ color: 0x111111 })
  );
  screen.position.y = 0.3;
  monitorGroup.add(screen);
  const screenGlow = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.3, 0.01),
    mats.emissiveCool
  );
  screenGlow.position.set(0, 0.3, 0.015);
  monitorGroup.add(screenGlow);
  const mStand = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, 0.12, 8),
    mats.metal
  );
  mStand.position.y = 0.06;
  monitorGroup.add(mStand);
  monitorGroup.position.set(cx - deskW * 0.2, baseY + deskH + 0.04, cz - d * 0.2);
  parent.add(monitorGroup);

  // Office chair behind desk
  const chair = createOfficeChair(mats);
  chair.position.set(cx, baseY, cz - d * 0.2 - 0.6);
  parent.add(chair);

  // Waiting area sofa
  const sofaW = Math.min(2.0, w * 0.4);
  const sofa = new THREE.Mesh(
    new THREE.BoxGeometry(sofaW, 0.42, 0.7),
    mats.fabricDark
  );
  sofa.position.set(cx, baseY + 0.21, cz + d * 0.3);
  parent.add(sofa);
  // Sofa back
  const sofaBack = new THREE.Mesh(
    new THREE.BoxGeometry(sofaW, 0.35, 0.1),
    mats.fabricDark
  );
  sofaBack.position.set(cx, baseY + 0.6, cz + d * 0.3 + 0.3);
  parent.add(sofaBack);

  // Indoor plant
  const plant = createPottedPlant(mats, 1.0);
  plant.position.set(cx + w * 0.35, baseY, cz + d * 0.35);
  parent.add(plant);
}

// ─── Hallway ──────────────────────────────────────────────────────────────────

function addHallway(cx: number, baseY: number, cz: number, mats: MaterialLibrary, parent: THREE.Group) {
  const consoleMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 0.8, 0.3),
    mats.darkWood
  );
  consoleMesh.position.set(cx, baseY + 0.4, cz);
  parent.add(consoleMesh);

  const vase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.08, 0.25, 12),
    new THREE.MeshBasicMaterial({ color: 0x8B7355 })
  );
  vase.position.set(cx, baseY + 0.92, cz);
  parent.add(vase);
}

// ─── Helper: Floor Lamp ───────────────────────────────────────────────────────

function createFloorLamp(mats: MaterialLibrary): THREE.Group {
  const g = new THREE.Group();

  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.15, 0.02, 16),
    mats.brushedMetal
  );
  base.position.y = 0.01;
  g.add(base);

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.015, 1.6, 8),
    mats.brushedMetal
  );
  pole.position.y = 0.82;
  g.add(pole);

  const shade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.25, 0.3, 16),
    mats.emissiveWarm
  );
  shade.position.y = 1.65;
  g.add(shade);

  return g;
}

// ─── Helper: Bar Stool ────────────────────────────────────────────────────────

function createBarStool(mats: MaterialLibrary): THREE.Group {
  const g = new THREE.Group();
  const seatH = 0.72;

  const seat = new THREE.Mesh(
    new THREE.CylinderGeometry(0.17, 0.17, 0.04, 16),
    mats.leather
  );
  seat.position.y = seatH;
  g.add(seat);

  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, seatH, 6),
      mats.metal
    );
    leg.position.set(Math.cos(angle) * 0.12, seatH / 2, Math.sin(angle) * 0.12);
    g.add(leg);
  }

  const footrest = new THREE.Mesh(
    new THREE.TorusGeometry(0.14, 0.008, 6, 16),
    mats.metal
  );
  footrest.rotation.x = Math.PI / 2;
  footrest.position.y = seatH * 0.4;
  g.add(footrest);

  return g;
}

// ─── Helper: Pendant Light ────────────────────────────────────────────────────

function createPendantLight(mats: MaterialLibrary): THREE.Group {
  const g = new THREE.Group();

  const cord = new THREE.Mesh(
    new THREE.CylinderGeometry(0.005, 0.005, 0.5, 4),
    mats.metal
  );
  cord.position.y = 0.25;
  g.add(cord);

  const shade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.15, 0.18, 16),
    mats.brushedMetal
  );
  shade.position.y = -0.09;
  g.add(shade);

  return g;
}

// ─── Helper: Dining Chair ─────────────────────────────────────────────────────

function createDiningChair(mats: MaterialLibrary): THREE.Group {
  const g = new THREE.Group();
  const seatH = 0.46, seatW = 0.44, seatD = 0.42;

  const seat = new THREE.Mesh(
    new THREE.BoxGeometry(seatW, 0.04, seatD),
    mats.wood
  );
  seat.position.y = seatH;
  g.add(seat);

  const back = new THREE.Mesh(
    new THREE.BoxGeometry(seatW, 0.45, 0.02),
    mats.wood
  );
  back.position.set(0, seatH + 0.25, -seatD / 2);
  g.add(back);

  for (const lx of [-seatW / 2 + 0.03, seatW / 2 - 0.03]) {
    for (const lz of [-seatD / 2 + 0.03, seatD / 2 - 0.03]) {
      const leg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.015, 0.015, seatH, 6),
        mats.metal
      );
      leg.position.set(lx, seatH / 2, lz);
      g.add(leg);
    }
  }

  return g;
}

// ─── Helper: Chandelier ───────────────────────────────────────────────────────

function createChandelier(mats: MaterialLibrary): THREE.Group {
  const g = new THREE.Group();

  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 0.08, 12),
    mats.brushedMetal
  );
  g.add(hub);

  const numArms = 6;
  for (let i = 0; i < numArms; i++) {
    const angle = (i / numArms) * Math.PI * 2;
    const radius = 0.35;

    const arm = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, radius, 4),
      mats.brushedMetal
    );
    arm.rotation.z = Math.PI / 2;
    arm.rotation.y = angle;
    arm.position.set(
      Math.cos(angle) * radius / 2,
      0,
      Math.sin(angle) * radius / 2
    );
    g.add(arm);

    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.03, 8, 8),
      mats.emissiveWarm
    );
    bulb.position.set(
      Math.cos(angle) * radius,
      -0.05,
      Math.sin(angle) * radius
    );
    g.add(bulb);
  }

  return g;
}

// ─── Helper: Office Chair ─────────────────────────────────────────────────────

function createOfficeChair(mats: MaterialLibrary): THREE.Group {
  const g = new THREE.Group();
  const seatH = 0.48;

  for (let i = 0; i < 5; i++) {
    const angle = (i / 5) * Math.PI * 2;
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.28, 6),
      mats.metal
    );
    leg.rotation.z = Math.PI / 2;
    leg.rotation.y = angle;
    leg.position.set(Math.cos(angle) * 0.14, 0.05, Math.sin(angle) * 0.14);
    g.add(leg);

    const castor = new THREE.Mesh(
      new THREE.SphereGeometry(0.02, 6, 6),
      mats.metal
    );
    castor.position.set(Math.cos(angle) * 0.28, 0.02, Math.sin(angle) * 0.28);
    g.add(castor);
  }

  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, seatH - 0.08, 8),
    mats.metal
  );
  stem.position.y = (seatH - 0.08) / 2 + 0.05;
  g.add(stem);

  const seat = new THREE.Mesh(
    new THREE.BoxGeometry(0.48, 0.06, 0.45),
    mats.fabricDark
  );
  seat.position.y = seatH;
  g.add(seat);

  const back = new THREE.Mesh(
    new THREE.BoxGeometry(0.46, 0.55, 0.04),
    mats.fabricDark
  );
  back.position.set(0, seatH + 0.3, -0.2);
  back.rotation.x = -0.1;
  g.add(back);

  return g;
}

// ─── Helper: Bookshelf ────────────────────────────────────────────────────────

function addBookshelf(cx: number, baseY: number, cz: number, mats: MaterialLibrary, parent: THREE.Group) {
  const shelfW = 1.2, shelfH = 2.0, shelfD = 0.35;
  const shelves = 5;

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(shelfW, shelfH, shelfD),
    mats.darkWood
  );
  frame.position.set(cx, baseY + shelfH / 2, cz);
  parent.add(frame);

  for (let i = 0; i < shelves; i++) {
    const sy = baseY + (i + 1) * (shelfH / (shelves + 1));
    const shelf = new THREE.Mesh(
      new THREE.BoxGeometry(shelfW - 0.04, 0.02, shelfD - 0.02),
      mats.wood
    );
    shelf.position.set(cx, sy, cz);
    parent.add(shelf);

    if (i < shelves - 1) {
      const numBooks = 3 + Math.floor(Math.random() * 4);
      let bx = cx - shelfW / 2 + 0.1;
      for (let b = 0; b < numBooks && bx < cx + shelfW / 2 - 0.1; b++) {
        const bookW = 0.02 + Math.random() * 0.03;
        const bookH = 0.15 + Math.random() * 0.1;
        const bookColors = [0x8B0000, 0x00008B, 0x006400, 0x4A0080, 0x8B4513, 0x2F4F4F];
        const book = new THREE.Mesh(
          new THREE.BoxGeometry(bookW, bookH, shelfD * 0.8),
          new THREE.MeshBasicMaterial({
            color: bookColors[Math.floor(Math.random() * bookColors.length)],
          })
        );
        book.position.set(bx + bookW / 2, sy + bookH / 2 + 0.01, cz);
        parent.add(book);
        bx += bookW + 0.002;
      }
    }
  }
}

// ─── Helper: Potted Plant ─────────────────────────────────────────────────────

function createPottedPlant(mats: MaterialLibrary, height: number): THREE.Group {
  const g = new THREE.Group();

  const potH = height * 0.2;
  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(potH * 0.5, potH * 0.4, potH, 12),
    new THREE.MeshBasicMaterial({ color: 0x8B6914 })
  );
  pot.position.y = potH / 2;
  g.add(pot);

  const soil = new THREE.Mesh(
    new THREE.CylinderGeometry(potH * 0.48, potH * 0.48, 0.02, 12),
    new THREE.MeshBasicMaterial({ color: 0x3D2B1F })
  );
  soil.position.y = potH;
  g.add(soil);

  const foliageH = height * 0.7;
  const numClusters = 5 + Math.floor(Math.random() * 3);
  for (let i = 0; i < numClusters; i++) {
    const clusterR = 0.08 + Math.random() * 0.12;
    const clusterH = potH + Math.random() * foliageH;
    const angle = (i / numClusters) * Math.PI * 2 + Math.random() * 0.5;
    const dist = Math.random() * 0.15;

    const leaf = new THREE.Mesh(
      new THREE.SphereGeometry(clusterR, 6, 5),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(0x2D6B1E).multiplyScalar(0.8 + Math.random() * 0.4),
      })
    );
    leaf.position.set(
      Math.cos(angle) * dist,
      clusterH,
      Math.sin(angle) * dist
    );
    leaf.scale.y = 0.7 + Math.random() * 0.3;
    g.add(leaf);
  }

  return g;
}

// ─── Ceiling Lights ───────────────────────────────────────────────────────────

function addCeilingLights(cx: number, ceilY: number, cz: number, w: number, d: number, mats: MaterialLibrary, parent: THREE.Group) {
  // Reduced grid density (w/4 instead of w/3) for better performance
  const numX = Math.max(1, Math.floor(w / 4));
  const numZ = Math.max(1, Math.floor(d / 4));

  for (let ix = 0; ix < numX; ix++) {
    for (let iz = 0; iz < numZ; iz++) {
      const lx = cx - w / 2 + (ix + 0.5) * (w / numX);
      const lz = cz - d / 2 + (iz + 0.5) * (d / numZ);

      // Recessed light fixture (geometry only, no PointLight)
      const fixture = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, 0.02, 12),
        mats.emissiveWarm
      );
      fixture.position.set(lx, ceilY, lz);
      parent.add(fixture);
    }
  }
}
