/* ─── IFC Enhance — Tier 2 ground + sidewalk + road builders ─────────────
   All three return single-shot Object3D subtrees that the Tier 2 engine
   mounts via ViewportHandle.mountEnhancements(..., { tier: 2 }).

   Textures are loaded through Phase 2's `loadPBRTextures` cache so a
   re-apply is instant. */

import {
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Path,
  PlaneGeometry,
  Shape,
  type WebGLRenderer,
} from "three";
import { loadPBRTextures, type LoadedPBRTextures } from "../texture-loader";
import {
  GROUND_SIZE_MULTIPLIER,
  GROUND_TEXTURE_SPECS,
  ROAD,
  SIDEWALK,
} from "../constants";
import type { GroundType, MaterialQuality, RoadSide } from "../types";
import type { BuildingBoundsResult } from "./placement-utils";

/**
 * Resolve "auto" → grass if road enabled (streetscape), otherwise concrete.
 * Pure function; the engine picks the canonical ground type before calling
 * buildGround.
 */
export function resolveGroundType(type: GroundType, roadEnabled: boolean): Exclude<GroundType, "auto"> {
  if (type !== "auto") return type;
  return roadEnabled ? "grass" : "concrete";
}

async function loadGroundTextures(
  which: Exclude<GroundType, "auto">,
  quality: MaterialQuality,
  renderer: WebGLRenderer,
): Promise<LoadedPBRTextures> {
  const spec = GROUND_TEXTURE_SPECS[which];
  return loadPBRTextures(spec, quality, renderer);
}

/* ─── Ground plane ────────────────────────────────────────────────────── */

export interface BuildGroundParams {
  bounds: BuildingBoundsResult;
  groundType: Exclude<GroundType, "auto">;
  quality: MaterialQuality;
  renderer: WebGLRenderer;
}

export async function buildGround({ bounds, groundType, quality, renderer }: BuildGroundParams): Promise<Mesh> {
  const side = bounds.maxExtentM * GROUND_SIZE_MULTIPLIER;
  const textures = await loadGroundTextures(groundType, quality, renderer);
  const spec = GROUND_TEXTURE_SPECS[groundType];

  const geometry = new PlaneGeometry(side, side);
  geometry.rotateX(-Math.PI / 2); // lie flat on XZ

  /* Tile the texture across the ground. We clone the Phase 2 textures to
     preserve the shared cache while giving ground its own `repeat`. */
  const tileCount = side / spec.tilingMetres;
  const material = new MeshStandardMaterial({
    roughness: spec.roughness,
    metalness: spec.metalness,
    side: DoubleSide,
    envMapIntensity: 1.0,
    ...(textures.map && { map: cloneWithRepeat(textures.map, tileCount) }),
    ...(textures.normalMap && { normalMap: cloneWithRepeat(textures.normalMap, tileCount) }),
    ...(textures.roughnessMap && { roughnessMap: cloneWithRepeat(textures.roughnessMap, tileCount) }),
    ...(quality !== "low" && textures.aoMap && { aoMap: cloneWithRepeat(textures.aoMap, tileCount) }),
  });
  material.name = `enhance-ground-${groundType}`;

  const mesh = new Mesh(geometry, material);
  /* Slightly below Y=minY so it never Z-fights with slabs or the blueprint
     grid. renderOrder=-1 ensures it draws before sidewalk/road. */
  mesh.position.set(bounds.center.x, bounds.footprint.minY - 0.05, bounds.center.z);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.renderOrder = -1;
  mesh.name = "enhance-ground";
  return mesh;
}

/* Clone a texture just enough to override `repeat` without breaking the
   Phase 2 cache. The underlying image is shared; only the Texture handle
   is new. */
import { type Texture } from "three";
function cloneWithRepeat(source: Texture, repeat: number): Texture {
  const t = source.clone();
  t.needsUpdate = true;
  t.repeat.set(repeat, repeat);
  return t;
}

/* ─── Sidewalk ring ───────────────────────────────────────────────────── */

export interface BuildSidewalkParams {
  bounds: BuildingBoundsResult;
  quality: MaterialQuality;
  renderer: WebGLRenderer;
}

export async function buildSidewalkRing({ bounds, quality, renderer }: BuildSidewalkParams): Promise<Mesh> {
  const fp = bounds.footprint;
  const w = SIDEWALK.widthM;

  /* Outer rectangle = footprint + sidewalk width on all sides. Inner
     rectangle = footprint itself. ExtrudeGeometry with a hole gives the
     ring shape in one mesh — fewer draw calls than 4 separate strips. */
  const shape = new Shape();
  shape.moveTo(fp.minX - w, fp.minZ - w);
  shape.lineTo(fp.maxX + w, fp.minZ - w);
  shape.lineTo(fp.maxX + w, fp.maxZ + w);
  shape.lineTo(fp.minX - w, fp.maxZ + w);
  shape.lineTo(fp.minX - w, fp.minZ - w);

  const hole = new Path();
  hole.moveTo(fp.minX, fp.minZ);
  hole.lineTo(fp.minX, fp.maxZ);
  hole.lineTo(fp.maxX, fp.maxZ);
  hole.lineTo(fp.maxX, fp.minZ);
  hole.lineTo(fp.minX, fp.minZ);
  shape.holes.push(hole);

  const geometry = new ExtrudeGeometry(shape, {
    depth: SIDEWALK.heightM,
    bevelEnabled: false,
    curveSegments: 1,
  });
  /* ExtrudeGeometry's shape is on the XY plane by default; rotate so the
     extrude axis becomes vertical (Y). */
  geometry.rotateX(-Math.PI / 2);

  const textures = await loadPBRTextures(GROUND_TEXTURE_SPECS.concrete, quality, renderer);
  const repeat = Math.max(fp.maxX - fp.minX + 2 * w, fp.maxZ - fp.minZ + 2 * w) / GROUND_TEXTURE_SPECS.concrete.tilingMetres;
  const material = new MeshStandardMaterial({
    roughness: GROUND_TEXTURE_SPECS.concrete.roughness,
    metalness: 0,
    side: DoubleSide,
    envMapIntensity: 1.0,
    ...(textures.map && { map: cloneWithRepeat(textures.map, repeat) }),
    ...(textures.normalMap && { normalMap: cloneWithRepeat(textures.normalMap, repeat) }),
    ...(textures.roughnessMap && { roughnessMap: cloneWithRepeat(textures.roughnessMap, repeat) }),
    ...(quality !== "low" && textures.aoMap && { aoMap: cloneWithRepeat(textures.aoMap, repeat) }),
  });
  material.name = "enhance-sidewalk";

  const mesh = new Mesh(geometry, material);
  mesh.position.y = bounds.footprint.minY - 0.05 + 0.001; // kiss of separation above ground
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.name = "enhance-sidewalk-ring";
  return mesh;
}

/* ─── Road ────────────────────────────────────────────────────────────── */

export interface BuildRoadParams {
  bounds: BuildingBoundsResult;
  side: RoadSide;
  quality: MaterialQuality;
  renderer: WebGLRenderer;
}

export async function buildRoad({ bounds, side, quality, renderer }: BuildRoadParams): Promise<Group> {
  if (side === "none") return new Group();

  const fp = bounds.footprint;
  const groundSide = bounds.maxExtentM * GROUND_SIZE_MULTIPLIER;

  const width = ROAD.widthM;
  /* Length spans the ground; the road stretches across the site. */
  const length = groundSide * 0.95;

  /* Compute road center + orientation. Road runs PARALLEL to the chosen
     edge — on east/west sides it runs N-S (along Z); on north/south, E-W
     (along X). */
  let cx = 0, cz = 0, roadExtendsZ = true;
  const offset = ROAD.offsetFromBuildingM + width / 2;
  switch (side) {
    case "east":
      cx = fp.maxX + offset;
      cz = bounds.center.z;
      roadExtendsZ = true;
      break;
    case "west":
      cx = fp.minX - offset;
      cz = bounds.center.z;
      roadExtendsZ = true;
      break;
    case "north":
      cx = bounds.center.x;
      cz = fp.minZ - offset;
      roadExtendsZ = false;
      break;
    case "south":
      cx = bounds.center.x;
      cz = fp.maxZ + offset;
      roadExtendsZ = false;
      break;
  }

  const textures = await loadPBRTextures(GROUND_TEXTURE_SPECS.asphalt, quality, renderer);
  const tilingM = GROUND_TEXTURE_SPECS.asphalt.tilingMetres;
  const repeatU = (roadExtendsZ ? width : length) / tilingM;
  const repeatV = (roadExtendsZ ? length : width) / tilingM;
  const asphaltMat = new MeshStandardMaterial({
    roughness: GROUND_TEXTURE_SPECS.asphalt.roughness,
    metalness: 0,
    side: DoubleSide,
    envMapIntensity: 1.0,
    ...(textures.map && { map: cloneWithRepeatXY(textures.map, repeatU, repeatV) }),
    ...(textures.normalMap && { normalMap: cloneWithRepeatXY(textures.normalMap, repeatU, repeatV) }),
    ...(textures.roughnessMap && { roughnessMap: cloneWithRepeatXY(textures.roughnessMap, repeatU, repeatV) }),
    ...(quality !== "low" && textures.aoMap && { aoMap: cloneWithRepeatXY(textures.aoMap, repeatU, repeatV) }),
  });
  asphaltMat.name = "enhance-road-asphalt";

  const roadGeo = new PlaneGeometry(roadExtendsZ ? width : length, roadExtendsZ ? length : width);
  roadGeo.rotateX(-Math.PI / 2);
  const roadMesh = new Mesh(roadGeo, asphaltMat);
  /* Road surface sits 0.01 m above ground to avoid Z-fighting. */
  roadMesh.position.set(cx, bounds.footprint.minY - 0.04, cz);
  roadMesh.receiveShadow = true;
  roadMesh.castShadow = false;
  roadMesh.name = "enhance-road-surface";

  /* Dashed lane markers — bright white, unlit. */
  const markerGroup = new Group();
  markerGroup.name = "enhance-road-markers";
  const markerMat = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const markerLen = ROAD.laneMarkerLengthM;
  const markerGap = ROAD.laneMarkerGapM;
  const markerStride = markerLen + markerGap;
  const markerCount = Math.max(1, Math.floor(length / markerStride));
  const totalMarked = markerCount * markerStride - markerGap;
  const startOffset = -totalMarked / 2 + markerLen / 2;

  for (let i = 0; i < markerCount; i++) {
    const along = startOffset + i * markerStride;
    const geo = new PlaneGeometry(
      roadExtendsZ ? ROAD.laneMarkerWidthM : markerLen,
      roadExtendsZ ? markerLen : ROAD.laneMarkerWidthM,
    );
    geo.rotateX(-Math.PI / 2);
    const marker = new Mesh(geo, markerMat);
    if (roadExtendsZ) {
      marker.position.set(cx, bounds.footprint.minY - 0.04 + 0.005, cz + along);
    } else {
      marker.position.set(cx + along, bounds.footprint.minY - 0.04 + 0.005, cz);
    }
    marker.name = `enhance-road-marker-${i}`;
    markerGroup.add(marker);
  }

  const group = new Group();
  group.name = "enhance-road";
  group.add(roadMesh);
  group.add(markerGroup);
  /* Stash centerline + extents for lamp placement. */
  group.userData.roadCenter = { x: cx, z: cz };
  group.userData.roadAxis = roadExtendsZ ? "z" : "x";
  group.userData.roadLength = length;
  group.userData.roadWidth = width;
  group.userData.roadSide = side;
  return group;
}

function cloneWithRepeatXY(source: Texture, u: number, v: number): Texture {
  const t = source.clone();
  t.needsUpdate = true;
  t.repeat.set(u, v);
  return t;
}
