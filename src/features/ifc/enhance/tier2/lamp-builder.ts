/* ─── IFC Enhance — Tier 2 lamp builder ───────────────────────────────────
   Procedural street-lamp geometry (post + arm + head) + PointLight that
   activates at the Night HDRI preset. All geometry is 100% Three.js
   primitives — no assets required. */

import {
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  SphereGeometry,
  Vector3,
} from "three";
import { LAMP } from "../constants";
import type { HDRIPreset } from "../types";

/** Shared materials — one instance across all lamp units. */
let postMatCache: MeshStandardMaterial | null = null;
let headMatCache: MeshStandardMaterial | null = null;

function getPostMaterial(): MeshStandardMaterial {
  if (postMatCache) return postMatCache;
  postMatCache = new MeshStandardMaterial({
    color: 0x222222,
    roughness: 0.5,
    metalness: 0.3,
    envMapIntensity: 1.0,
  });
  postMatCache.name = "enhance-lamp-post";
  return postMatCache;
}

function getHeadMaterial(): MeshStandardMaterial {
  if (headMatCache) return headMatCache;
  headMatCache = new MeshStandardMaterial({
    color: new Color(LAMP.nightColor),
    emissive: new Color(LAMP.nightColor),
    emissiveIntensity: 0.0, // tuned per preset by updateLampsForPreset
    roughness: 0.3,
    metalness: 0.0,
    envMapIntensity: 1.0,
  });
  headMatCache.name = "enhance-lamp-head";
  return headMatCache;
}

/**
 * Build ONE lamp unit (post + arm + head). Returns a Group so callers can
 * clone it cheaply — materials are shared; only the Group transform is
 * per-instance.
 *
 * The Group is anchored at its base (y=0 at the bottom of the post); the
 * caller translates the whole Group to the desired ground position.
 */
export function buildLampUnit(): Group {
  const group = new Group();
  group.name = "enhance-lamp-unit";

  const post = new Mesh(
    new CylinderGeometry(LAMP.postRadiusM, LAMP.postRadiusM, LAMP.postHeightM, 8),
    getPostMaterial(),
  );
  post.position.y = LAMP.postHeightM / 2;
  post.castShadow = true;
  post.receiveShadow = false;
  post.name = "post";
  group.add(post);

  const arm = new Mesh(
    new CylinderGeometry(0.05, 0.05, LAMP.armLengthM, 8),
    getPostMaterial(),
  );
  arm.rotation.z = Math.PI / 2;
  arm.position.set(LAMP.armLengthM / 2, LAMP.postHeightM - 0.1, 0);
  arm.castShadow = true;
  arm.receiveShadow = false;
  arm.name = "arm";
  group.add(arm);

  const head = new Mesh(
    new SphereGeometry(LAMP.headRadiusM, 12, 8),
    getHeadMaterial(),
  );
  head.position.set(LAMP.armLengthM, LAMP.postHeightM - 0.1, 0);
  head.castShadow = false;
  head.receiveShadow = false;
  head.name = "head";
  group.add(head);

  /* Reserve a lazily-added PointLight. We don't attach it yet — at day it
     would waste a shader slot. The engine attaches/detaches via
     updateLampsForPreset when preset changes. */
  group.userData.headLocalPos = new Vector3(LAMP.armLengthM, LAMP.postHeightM - 0.1, 0);
  return group;
}

export interface PlaceLampsParams {
  start: Vector3;
  end: Vector3;
  spacingM: number;
  lampTemplate: Group;
  hdriPreset: HDRIPreset;
  /** Jitter seed for natural yaw variation. */
  rng?: () => number;
}

/**
 * Clone `lampTemplate` at regular intervals along the segment from start →
 * end, with optional yaw jitter. Returns the array of positioned lamp
 * Groups; caller is expected to add them to a parent Group.
 */
export function placeLampsAlongLine({
  start,
  end,
  spacingM,
  lampTemplate,
  hdriPreset,
  rng,
}: PlaceLampsParams): Group[] {
  const dir = new Vector3().subVectors(end, start);
  const length = dir.length();
  if (length < 0.01) return [];
  dir.multiplyScalar(1 / length);

  const count = Math.max(1, Math.floor(length / spacingM));
  const step = length / count;
  const lamps: Group[] = [];

  /* Face arm inward — cross with +Y to find the perpendicular in XZ plane. */
  const yawRadians = Math.atan2(-dir.z, dir.x);

  for (let i = 0; i <= count; i++) {
    const along = step * i;
    const pos = new Vector3(
      start.x + dir.x * along,
      start.y,
      start.z + dir.z * along,
    );
    const lamp = lampTemplate.clone(true);
    lamp.position.copy(pos);
    const jitter = rng ? (rng() - 0.5) * 0.1 : 0; // ±2.8° yaw jitter
    lamp.rotation.y = yawRadians + jitter;
    lamps.push(lamp);
  }

  /* Apply preset-driven lighting AFTER placement so new PointLights are in
     scene-space. */
  updateLampsForPreset(lamps, hdriPreset);
  return lamps;
}

/**
 * Turn on/off the emissive + PointLight per preset. Called once after
 * placement and again if the panel's HDRI preset changes while applied.
 * Idempotent.
 */
export function updateLampsForPreset(lamps: Group[], preset: HDRIPreset): void {
  const isNight = preset === "night";
  const isSunset = preset === "sunset";

  /* Emissive head glow — visible even in the day as a hint of the lamp
     being on/off, but strongest at night. */
  const headMat = getHeadMaterial();
  headMat.emissiveIntensity = isNight ? 2.5 : isSunset ? 0.6 : 0.05;

  /* Attach/detach PointLights. Only first `maxShadowCasters` cast real
     shadows to keep GPU budget reasonable on budget hardware. */
  const maxShadowCasters = 3;
  let shadowCastersAttached = 0;

  for (const lamp of lamps) {
    const existing = lamp.getObjectByName("point-light") as PointLight | null;

    if (isNight) {
      if (!existing) {
        const light = new PointLight(LAMP.nightColor, LAMP.nightIntensity, LAMP.nightRange, 1.8);
        light.name = "point-light";
        const local = lamp.userData.headLocalPos as Vector3 | undefined;
        if (local) light.position.copy(local);
        else light.position.set(LAMP.armLengthM, LAMP.postHeightM - 0.1, 0);
        /* Shadow budget — only a handful cast shadows. */
        if (shadowCastersAttached < maxShadowCasters) {
          light.castShadow = true;
          light.shadow.mapSize.set(512, 512);
          light.shadow.bias = -0.0005;
          light.shadow.radius = 2;
          shadowCastersAttached++;
        }
        lamp.add(light);
      } else {
        existing.intensity = LAMP.nightIntensity;
      }
    } else if (existing) {
      lamp.remove(existing);
      existing.dispose();
    }
  }
}

/**
 * Release shared materials and helper caches — called by the engine on
 * full reset to keep GPU memory tight.
 */
export function disposeLampCaches(): void {
  if (postMatCache) {
    postMatCache.dispose();
    postMatCache = null;
  }
  if (headMatCache) {
    headMatCache.dispose();
    headMatCache = null;
  }
}
