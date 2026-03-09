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
      case "living": addLivingRoom(rx, baseY, rz, room.width, room.depth, mats, parent); break;
      case "kitchen": addKitchen(rx, baseY, rz, room.width, room.depth, mats, parent); break;
      case "dining": addDining(rx, baseY, rz, room.width, room.depth, mats, parent); break;
      case "bedroom": addBedroom(rx, baseY, rz, room.width, room.depth, mats, parent); break;
      case "bathroom": addBathroom(rx, baseY, rz, room.width, room.depth, mats, parent); break;
      case "office": addOffice(rx, baseY, rz, room.width, room.depth, mats, parent); break;
      case "hallway": addHallway(rx, baseY, rz, mats, parent); break;
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

  // Main section
  const mainW = Math.min(3.2, w * 0.4);
  const seatGeo = new THREE.BoxGeometry(mainW, seatH, seatD);
  const seat = new THREE.Mesh(seatGeo, mats.fabricDark);
  seat.position.set(0, seatH / 2, 0);
  seat.castShadow = true;
  sofaGroup.add(seat);

  // Back cushion
  const backGeo = new THREE.BoxGeometry(mainW, backH, 0.15);
  const back = new THREE.Mesh(backGeo, mats.fabricDark);
  back.position.set(0, seatH + backH / 2, -seatD / 2 + 0.08);
  sofaGroup.add(back);

  // L-section
  const lW = 1.6;
  const lGeo = new THREE.BoxGeometry(0.9, seatH, lW);
  const lSeat = new THREE.Mesh(lGeo, mats.fabricDark);
  lSeat.position.set(mainW / 2 - 0.45, seatH / 2, lW / 2 - seatD / 2);
  lSeat.castShadow = true;
  sofaGroup.add(lSeat);

  // Cushions
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
  tableTop.castShadow = true;
  tableTop.receiveShadow = true;
  tableGroup.add(tableTop);

  // Metal legs
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
  // Console
  const consoleGeo = new THREE.BoxGeometry(2, 0.5, 0.4);
  const consoleMesh = new THREE.Mesh(consoleGeo, mats.darkWood);
  consoleMesh.position.y = 0.25;
  consoleMesh.castShadow = true;
  tvUnit.add(consoleMesh);

  // TV screen
  const tvGeo = new THREE.BoxGeometry(1.6, 0.9, 0.04);
  const tvMat = new THREE.MeshStandardMaterial({
    color: 0x111111, roughness: 0.1, metalness: 0.3,
  });
  const tv = new THREE.Mesh(tvGeo, tvMat);
  tv.position.set(0, 0.95, 0);
  tvUnit.add(tv);

  // TV screen emissive (standby indicator)
  const ledGeo = new THREE.BoxGeometry(0.01, 0.01, 0.01);
  const led = new THREE.Mesh(ledGeo, mats.emissiveCool);
  led.position.set(0.7, 0.55, 0.03);
  tvUnit.add(led);

  tvUnit.position.set(cx + w * 0.25, baseY, cz - d * 0.45);
  parent.add(tvUnit);

  // Floor lamp
  const lampGroup = createFloorLamp(mats);
  lampGroup.position.set(cx - w * 0.4, baseY, cz - d * 0.35);
  parent.add(lampGroup);

  // Area rug
  const rugGeo = new THREE.BoxGeometry(3, 0.01, 2);
  const rugMesh = new THREE.Mesh(rugGeo, mats.fabric);
  rugMesh.position.set(cx - w * 0.15, baseY + 0.005, cz + d * 0.05);
  rugMesh.receiveShadow = true;
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

  // Wall art (abstract rectangle)
  const artCanvas = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 0.7, 0.02),
    new THREE.MeshStandardMaterial({ color: 0x2C3E50, roughness: 0.5, metalness: 0.1 })
  );
  artCanvas.position.set(cx + w * 0.25, baseY + 1.8, cz + d * 0.46);
  parent.add(artCanvas);
  // Frame
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
  stTop.castShadow = true;
  sideTable.add(stTop);
  const stLeg = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.025, 0.55, 8),
    mats.brushedMetal
  );
  stLeg.position.y = 0.275;
  sideTable.add(stLeg);
  sideTable.position.set(cx - w * 0.15 + 1.8, baseY, cz - d * 0.15);
  parent.add(sideTable);

  // Point light for living room ambiance
  const pointLight = new THREE.PointLight(0xFFE4B5, 0.8, 10);
  pointLight.position.set(cx - w * 0.15, baseY + 2.5, cz);
  pointLight.castShadow = true;
  pointLight.shadow.mapSize.setScalar(512);
  parent.add(pointLight);
}

// ─── Kitchen ──────────────────────────────────────────────────────────────────

function addKitchen(cx: number, baseY: number, cz: number, w: number, d: number, mats: MaterialLibrary, parent: THREE.Group) {
  // Counter along back wall (U-shape)
  const counterH = 0.9, counterD = 0.6, counterThick = 0.04;

  // Back counter
  const backW = w - 0.4;
  const backCounter = new THREE.Group();
  // Cabinet base
  const cabinetGeo = new THREE.BoxGeometry(backW, counterH - counterThick, counterD);
  const cabinet = new THREE.Mesh(cabinetGeo, mats.whiteWall);
  cabinet.position.set(0, (counterH - counterThick) / 2, 0);
  cabinet.castShadow = true;
  backCounter.add(cabinet);
  // Countertop (marble)
  const topGeo = new THREE.BoxGeometry(backW + 0.05, counterThick, counterD + 0.03);
  const top = new THREE.Mesh(topGeo, mats.marbleFloor);
  top.position.set(0, counterH - counterThick / 2, 0);
  top.castShadow = true;
  backCounter.add(top);

  // Cabinet handles
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
  islandBase.castShadow = true;
  islandGroup.add(islandBase);
  const islandTop = new THREE.Mesh(
    new THREE.BoxGeometry(islandW + 0.15, counterThick, counterD + 0.25),
    mats.marbleFloor
  );
  islandTop.position.y = counterH - counterThick / 2;
  islandTop.castShadow = true;
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

  // Pendant lights over island
  for (let i = 0; i < 3; i++) {
    const pendant = createPendantLight(mats);
    pendant.position.set(
      cx - islandW / 3 + i * islandW / 3,
      baseY + 2.6,
      cz - d * 0.1
    );
    parent.add(pendant);
  }

  // Appliances - range hood
  const hoodGeo = new THREE.BoxGeometry(0.9, 0.3, 0.5);
  const hood = new THREE.Mesh(hoodGeo, mats.brushedMetal);
  hood.position.set(cx, baseY + 2.0, cz + d / 2 - 0.35);
  hood.castShadow = true;
  parent.add(hood);

  // Sink area
  const sinkGeo = new THREE.BoxGeometry(0.5, 0.08, 0.4);
  const sinkMat = new THREE.MeshStandardMaterial({ color: 0x666666, roughness: 0.15, metalness: 0.95 });
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
  // Dining table
  const tableW = Math.min(2.2, w * 0.5);
  const tableD = Math.min(1.0, d * 0.35);
  const tableH = 0.76;
  const tableGroup = new THREE.Group();

  const tabletop = new THREE.Mesh(
    new THREE.BoxGeometry(tableW, 0.04, tableD),
    mats.wood
  );
  tabletop.position.y = tableH;
  tabletop.castShadow = true;
  tabletop.receiveShadow = true;
  tableGroup.add(tabletop);

  // Table legs - tapered
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

  // Dining chairs
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

  // Chandelier
  const chandelier = createChandelier(mats);
  chandelier.position.set(cx, baseY + 2.8, cz);
  parent.add(chandelier);
}

// ─── Bedroom ──────────────────────────────────────────────────────────────────

function addBedroom(cx: number, baseY: number, cz: number, w: number, d: number, mats: MaterialLibrary, parent: THREE.Group) {
  // Bed
  const bedW = 1.8, bedD = 2.2, bedH = 0.55;
  const bedGroup = new THREE.Group();

  // Bed frame
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(bedW + 0.1, 0.15, bedD + 0.1),
    mats.darkWood
  );
  frame.position.y = 0.2;
  frame.castShadow = true;
  bedGroup.add(frame);

  // Mattress
  const mattress = new THREE.Mesh(
    new THREE.BoxGeometry(bedW, 0.22, bedD),
    new THREE.MeshStandardMaterial({ color: 0xFAF8F5, roughness: 0.9 })
  );
  mattress.position.y = bedH - 0.11;
  mattress.castShadow = true;
  bedGroup.add(mattress);

  // Pillows
  for (const px of [-0.4, 0.4]) {
    const pillow = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.12, 0.35),
      new THREE.MeshStandardMaterial({ color: 0xEEEBE5, roughness: 0.95 })
    );
    pillow.position.set(px, bedH + 0.06, -bedD / 2 + 0.25);
    pillow.rotation.z = (Math.random() - 0.5) * 0.05;
    bedGroup.add(pillow);
  }

  // Duvet
  const duvet = new THREE.Mesh(
    new THREE.BoxGeometry(bedW - 0.1, 0.08, bedD * 0.65),
    mats.fabric
  );
  duvet.position.set(0, bedH + 0.04, 0.2);
  bedGroup.add(duvet);

  // Headboard
  const headboard = new THREE.Mesh(
    new THREE.BoxGeometry(bedW + 0.2, 1.0, 0.08),
    mats.fabricDark
  );
  headboard.position.set(0, 0.8, -bedD / 2 - 0.04);
  headboard.castShadow = true;
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
    nsBody.castShadow = true;
    ns.add(nsBody);

    // Table lamp
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
  wardrobe.castShadow = true;
  parent.add(wardrobe);

  // Wardrobe handles
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
  // Vanity
  const vanityW = Math.min(1.2, w * 0.5);
  const vanity = new THREE.Group();
  const vanityBase = new THREE.Mesh(
    new THREE.BoxGeometry(vanityW, 0.8, 0.5),
    mats.darkWood
  );
  vanityBase.position.y = 0.4;
  vanityBase.castShadow = true;
  vanity.add(vanityBase);

  // Countertop
  const vanityTop = new THREE.Mesh(
    new THREE.BoxGeometry(vanityW + 0.05, 0.04, 0.55),
    mats.marbleFloor
  );
  vanityTop.position.y = 0.82;
  vanity.add(vanityTop);

  // Sink basin
  const basin = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.15, 0.08, 16),
    new THREE.MeshStandardMaterial({ color: 0xF8F8F8, roughness: 0.1, metalness: 0.1 })
  );
  basin.position.set(0, 0.86, 0);
  vanity.add(basin);

  // Mirror
  const mirror = new THREE.Mesh(
    new THREE.BoxGeometry(vanityW - 0.1, 0.8, 0.02),
    new THREE.MeshPhysicalMaterial({
      color: 0xDDDDDD, roughness: 0.02, metalness: 0.95,
      envMapIntensity: 2,
    })
  );
  mirror.position.set(0, 1.5, -0.25);
  vanity.add(mirror);

  vanity.position.set(cx - w * 0.2, baseY, cz + d * 0.35);
  parent.add(vanity);

  // Shower/tub
  const tubW = Math.min(1.6, w * 0.5);
  const tub = new THREE.Mesh(
    new THREE.BoxGeometry(tubW, 0.5, 0.7),
    new THREE.MeshStandardMaterial({ color: 0xFAFAFA, roughness: 0.1, metalness: 0.05 })
  );
  tub.position.set(cx + w * 0.2, baseY + 0.25, cz - d * 0.25);
  tub.castShadow = true;
  parent.add(tub);

  // Shower glass
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
    new THREE.MeshStandardMaterial({ color: 0xFAFAFA, roughness: 0.15, metalness: 0.02 })
  );
  toiletBase.position.y = 0.19;
  toilet.add(toiletBase);
  const tank = new THREE.Mesh(
    new THREE.BoxGeometry(0.35, 0.35, 0.18),
    new THREE.MeshStandardMaterial({ color: 0xF5F5F5, roughness: 0.15, metalness: 0.02 })
  );
  tank.position.set(0, 0.35, -0.35);
  toilet.add(tank);
  toilet.position.set(cx + w * 0.3, baseY, cz + d * 0.15);
  parent.add(toilet);
}

// ─── Office ───────────────────────────────────────────────────────────────────

function addOffice(cx: number, baseY: number, cz: number, w: number, d: number, mats: MaterialLibrary, parent: THREE.Group) {
  // Desk
  const deskW = Math.min(1.8, w * 0.5);
  const deskD = 0.75;
  const deskH = 0.74;
  const desk = new THREE.Group();

  const deskTop = new THREE.Mesh(
    new THREE.BoxGeometry(deskW, 0.03, deskD),
    mats.wood
  );
  deskTop.position.y = deskH;
  deskTop.castShadow = true;
  desk.add(deskTop);

  // Desk legs (trestle style)
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
    new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.1, metalness: 0.3 })
  );
  screen.position.y = 0.35;
  monitorGroup.add(screen);
  // Screen glow
  const screenGlow = new THREE.Mesh(
    new THREE.BoxGeometry(0.65, 0.35, 0.01),
    mats.emissiveCool
  );
  screenGlow.position.set(0, 0.35, 0.015);
  monitorGroup.add(screenGlow);
  // Stand
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

// ─── Hallway ──────────────────────────────────────────────────────────────────

function addHallway(cx: number, baseY: number, cz: number, mats: MaterialLibrary, parent: THREE.Group) {
  // Console table
  const console = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 0.8, 0.3),
    mats.darkWood
  );
  console.position.set(cx, baseY + 0.4, cz);
  console.castShadow = true;
  parent.add(console);

  // Decorative vase
  const vase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.08, 0.25, 12),
    new THREE.MeshStandardMaterial({ color: 0x8B7355, roughness: 0.6, metalness: 0.1 })
  );
  vase.position.set(cx, baseY + 0.92, cz);
  parent.add(vase);
}

// ─── Helper: Floor Lamp ───────────────────────────────────────────────────────

function createFloorLamp(mats: MaterialLibrary): THREE.Group {
  const g = new THREE.Group();

  // Base
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.15, 0.02, 16),
    mats.brushedMetal
  );
  base.position.y = 0.01;
  g.add(base);

  // Pole
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.015, 1.6, 8),
    mats.brushedMetal
  );
  pole.position.y = 0.82;
  g.add(pole);

  // Shade
  const shade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.25, 0.3, 16),
    mats.emissiveWarm
  );
  shade.position.y = 1.65;
  g.add(shade);

  // Light
  const light = new THREE.PointLight(0xFFE4B5, 0.5, 5);
  light.position.y = 1.55;
  g.add(light);

  return g;
}

// ─── Helper: Bar Stool ────────────────────────────────────────────────────────

function createBarStool(mats: MaterialLibrary): THREE.Group {
  const g = new THREE.Group();
  const seatH = 0.72;

  // Seat
  const seat = new THREE.Mesh(
    new THREE.CylinderGeometry(0.17, 0.17, 0.04, 16),
    mats.leather
  );
  seat.position.y = seatH;
  seat.castShadow = true;
  g.add(seat);

  // Legs
  for (let i = 0; i < 4; i++) {
    const angle = (i / 4) * Math.PI * 2;
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, seatH, 6),
      mats.metal
    );
    leg.position.set(Math.cos(angle) * 0.12, seatH / 2, Math.sin(angle) * 0.12);
    g.add(leg);
  }

  // Footrest ring
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

  // Cord
  const cord = new THREE.Mesh(
    new THREE.CylinderGeometry(0.005, 0.005, 0.5, 4),
    mats.metal
  );
  cord.position.y = 0.25;
  g.add(cord);

  // Shade (cone)
  const shade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.15, 0.18, 16),
    mats.brushedMetal
  );
  shade.position.y = -0.09;
  g.add(shade);

  // Light
  const light = new THREE.PointLight(0xFFE0B0, 0.6, 4);
  light.position.y = -0.15;
  light.castShadow = true;
  light.shadow.mapSize.setScalar(256);
  g.add(light);

  return g;
}

// ─── Helper: Dining Chair ─────────────────────────────────────────────────────

function createDiningChair(mats: MaterialLibrary): THREE.Group {
  const g = new THREE.Group();
  const seatH = 0.46, seatW = 0.44, seatD = 0.42;

  // Seat
  const seat = new THREE.Mesh(
    new THREE.BoxGeometry(seatW, 0.04, seatD),
    mats.wood
  );
  seat.position.y = seatH;
  seat.castShadow = true;
  g.add(seat);

  // Back
  const back = new THREE.Mesh(
    new THREE.BoxGeometry(seatW, 0.45, 0.02),
    mats.wood
  );
  back.position.set(0, seatH + 0.25, -seatD / 2);
  g.add(back);

  // Legs
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

  // Central hub
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(0.05, 0.05, 0.08, 12),
    mats.brushedMetal
  );
  g.add(hub);

  // Arms with bulbs
  const numArms = 6;
  for (let i = 0; i < numArms; i++) {
    const angle = (i / numArms) * Math.PI * 2;
    const radius = 0.35;

    // Arm
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

    // Bulb
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

  // Light
  const light = new THREE.PointLight(0xFFE4B5, 1.0, 8);
  light.position.y = -0.1;
  light.castShadow = true;
  light.shadow.mapSize.setScalar(512);
  g.add(light);

  return g;
}

// ─── Helper: Office Chair ─────────────────────────────────────────────────────

function createOfficeChair(mats: MaterialLibrary): THREE.Group {
  const g = new THREE.Group();
  const seatH = 0.48;

  // Base star
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

    // Castor
    const castor = new THREE.Mesh(
      new THREE.SphereGeometry(0.02, 6, 6),
      mats.metal
    );
    castor.position.set(Math.cos(angle) * 0.28, 0.02, Math.sin(angle) * 0.28);
    g.add(castor);
  }

  // Stem
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.025, 0.025, seatH - 0.08, 8),
    mats.metal
  );
  stem.position.y = (seatH - 0.08) / 2 + 0.05;
  g.add(stem);

  // Seat
  const seat = new THREE.Mesh(
    new THREE.BoxGeometry(0.48, 0.06, 0.45),
    mats.fabricDark
  );
  seat.position.y = seatH;
  seat.castShadow = true;
  g.add(seat);

  // Back
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

  // Frame
  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(shelfW, shelfH, shelfD),
    mats.darkWood
  );
  frame.position.set(cx, baseY + shelfH / 2, cz);
  frame.castShadow = true;
  parent.add(frame);

  // Shelf boards
  for (let i = 0; i < shelves; i++) {
    const sy = baseY + (i + 1) * (shelfH / (shelves + 1));
    const shelf = new THREE.Mesh(
      new THREE.BoxGeometry(shelfW - 0.04, 0.02, shelfD - 0.02),
      mats.wood
    );
    shelf.position.set(cx, sy, cz);
    parent.add(shelf);

    // Books on some shelves
    if (i < shelves - 1) {
      const numBooks = 3 + Math.floor(Math.random() * 4);
      let bx = cx - shelfW / 2 + 0.1;
      for (let b = 0; b < numBooks && bx < cx + shelfW / 2 - 0.1; b++) {
        const bookW = 0.02 + Math.random() * 0.03;
        const bookH = 0.15 + Math.random() * 0.1;
        const bookColors = [0x8B0000, 0x00008B, 0x006400, 0x4A0080, 0x8B4513, 0x2F4F4F];
        const book = new THREE.Mesh(
          new THREE.BoxGeometry(bookW, bookH, shelfD * 0.8),
          new THREE.MeshStandardMaterial({
            color: bookColors[Math.floor(Math.random() * bookColors.length)],
            roughness: 0.8,
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

  // Pot
  const potH = height * 0.2;
  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(potH * 0.5, potH * 0.4, potH, 12),
    new THREE.MeshStandardMaterial({ color: 0x8B6914, roughness: 0.7, metalness: 0.05 })
  );
  pot.position.y = potH / 2;
  pot.castShadow = true;
  g.add(pot);

  // Soil
  const soil = new THREE.Mesh(
    new THREE.CylinderGeometry(potH * 0.48, potH * 0.48, 0.02, 12),
    new THREE.MeshStandardMaterial({ color: 0x3D2B1F, roughness: 0.95 })
  );
  soil.position.y = potH;
  g.add(soil);

  // Foliage (multiple layers for fullness)
  const foliageH = height * 0.7;
  const numClusters = 5 + Math.floor(Math.random() * 3);
  for (let i = 0; i < numClusters; i++) {
    const clusterR = 0.08 + Math.random() * 0.12;
    const clusterH = potH + Math.random() * foliageH;
    const angle = (i / numClusters) * Math.PI * 2 + Math.random() * 0.5;
    const dist = Math.random() * 0.15;

    const leaf = new THREE.Mesh(
      new THREE.SphereGeometry(clusterR, 6, 5),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(0x2D6B1E).multiplyScalar(0.8 + Math.random() * 0.4),
        roughness: 0.9,
      })
    );
    leaf.position.set(
      Math.cos(angle) * dist,
      clusterH,
      Math.sin(angle) * dist
    );
    leaf.scale.y = 0.7 + Math.random() * 0.3;
    leaf.castShadow = true;
    g.add(leaf);
  }

  return g;
}

// ─── Ceiling Lights ───────────────────────────────────────────────────────────

function addCeilingLights(cx: number, ceilY: number, cz: number, w: number, d: number, mats: MaterialLibrary, parent: THREE.Group) {
  const numX = Math.max(1, Math.floor(w / 3));
  const numZ = Math.max(1, Math.floor(d / 3));

  for (let ix = 0; ix < numX; ix++) {
    for (let iz = 0; iz < numZ; iz++) {
      const lx = cx - w / 2 + (ix + 0.5) * (w / numX);
      const lz = cz - d / 2 + (iz + 0.5) * (d / numZ);

      // Recessed light fixture
      const fixture = new THREE.Mesh(
        new THREE.CylinderGeometry(0.06, 0.06, 0.02, 12),
        mats.emissiveWarm
      );
      fixture.position.set(lx, ceilY, lz);
      parent.add(fixture);

      // Subtle point light
      const light = new THREE.PointLight(0xFFF0D0, 0.15, 4);
      light.position.set(lx, ceilY - 0.05, lz);
      parent.add(light);
    }
  }
}
