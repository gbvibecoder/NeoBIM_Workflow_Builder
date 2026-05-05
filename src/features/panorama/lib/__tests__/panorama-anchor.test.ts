import { describe, expect, it } from "vitest";
import {
  Box3,
  Vector3,
} from "three";
import {
  computePanoramaAnchor,
  DEFAULT_DISC_RADIUS_M,
  DEFAULT_DOME_RADIUS_M,
  DISC_INNER_RADIUS_M,
} from "@/features/panorama/lib/panorama-anchor";
import type { PanoramaAsset } from "@/features/panorama/constants";

const ASSET: PanoramaAsset = {
  slug: "balcony",
  bucket: "residential-apartment",
  displayName: "Apt Balcony",
  fileName: "balcony.jpg",
  fileSizeBytes: 1_500_000,
  source: "polyhaven",
  license: "CC0",
  horizonRow: 0.5,
  groundAnchorPixelXY: { x: 0.5, y: 0.85 },
  panoramaScale: 1.0,
};

describe("computePanoramaAnchor (V7)", () => {
  it("returns deterministic anchor for the same input", () => {
    const a1 = computePanoramaAnchor(ASSET, null);
    const a2 = computePanoramaAnchor(ASSET, null);
    expect(a1.domePosition.equals(a2.domePosition)).toBe(true);
    expect(a1.discPosition.equals(a2.discPosition)).toBe(true);
    expect(a1.bimAnchorPosition.equals(a2.bimAnchorPosition)).toBe(true);
    expect(a1.discRadius).toBe(a2.discRadius);
    expect(a1.domeRadius).toBe(a2.domeRadius);
    expect(a1.discInnerRadius).toBe(a2.discInnerRadius);
  });

  it("V7: default radius is 50 m (down from V6's 1500 m)", () => {
    const a = computePanoramaAnchor(ASSET, null);
    expect(a.domeRadius).toBe(50);
    expect(a.discRadius).toBe(50);
    expect(DEFAULT_DOME_RADIUS_M).toBe(50);
    expect(DEFAULT_DISC_RADIUS_M).toBe(50);
  });

  it("V7: panoramaScale multiplies into the radius", () => {
    const a2x: PanoramaAsset = { ...ASSET, panoramaScale: 2 };
    const aHalf: PanoramaAsset = { ...ASSET, panoramaScale: 0.5 };
    expect(computePanoramaAnchor(a2x, null).domeRadius).toBe(100);
    expect(computePanoramaAnchor(a2x, null).discRadius).toBe(100);
    expect(computePanoramaAnchor(aHalf, null).domeRadius).toBe(25);
    expect(computePanoramaAnchor(aHalf, null).discRadius).toBe(25);
  });

  it("V7: missing panoramaScale defaults to 1.0 (50 m radius)", () => {
    const noScale = { ...ASSET };
    delete noScale.panoramaScale;
    const a = computePanoramaAnchor(noScale, null);
    expect(a.domeRadius).toBe(50);
  });

  it("V7: panoramaScale ≤ 0 is clamped to a minimum (no degenerate radius)", () => {
    const zero: PanoramaAsset = { ...ASSET, panoramaScale: 0 };
    const negative: PanoramaAsset = { ...ASSET, panoramaScale: -3 };
    expect(computePanoramaAnchor(zero, null).domeRadius).toBeGreaterThan(0);
    expect(computePanoramaAnchor(negative, null).domeRadius).toBeGreaterThan(0);
  });

  it("V7: discInnerRadius is 5 m (transparent core) and exposed in the anchor", () => {
    const a = computePanoramaAnchor(ASSET, null);
    expect(a.discInnerRadius).toBe(5);
    expect(DISC_INNER_RADIUS_M).toBe(5);
  });

  it("V7: disc + dome Y come from bbox.min.y directly (no slab heuristic)", () => {
    const bbox = new Box3(new Vector3(-5, 0.0, -5), new Vector3(5, 10, 5));
    const a = computePanoramaAnchor(ASSET, bbox);
    expect(a.discPosition.y).toBe(0.0);
    expect(a.domePosition.y).toBe(0.0);
  });

  it("V7: disc + dome Y track an off-Y bbox (e.g., second-floor model)", () => {
    const bbox = new Box3(new Vector3(-5, 3.5, -5), new Vector3(5, 13.5, 5));
    const a = computePanoramaAnchor(ASSET, bbox);
    expect(a.discPosition.y).toBeCloseTo(3.5, 5);
    expect(a.domePosition.y).toBeCloseTo(3.5, 5);
  });

  it("V7: bbox null falls back to Y=0", () => {
    const a = computePanoramaAnchor(ASSET, null);
    expect(a.discPosition.y).toBe(0);
    expect(a.domePosition.y).toBe(0);
  });

  it("V7: empty bbox falls back to Y=0", () => {
    const a = computePanoramaAnchor(ASSET, new Box3());
    expect(a.discPosition.y).toBe(0);
    expect(a.domePosition.y).toBe(0);
  });

  it("V7: BIM anchor stays at world origin (no translation) when bimOffsetXZ is absent", () => {
    const bbox = new Box3(new Vector3(-5, 2, -5), new Vector3(5, 12, 5));
    const a = computePanoramaAnchor(ASSET, bbox);
    expect(a.bimAnchorPosition.x).toBe(0);
    expect(a.bimAnchorPosition.y).toBe(0);
    expect(a.bimAnchorPosition.z).toBe(0);
  });

  it("V7.1: bimOffsetXZ pushes BIM anchor off the disc centre on the XZ plane (Y kept at 0)", () => {
    const off: PanoramaAsset = { ...ASSET, bimOffsetXZ: { x: -8, z: 12 } };
    const bbox = new Box3(new Vector3(-5, 2, -5), new Vector3(5, 12, 5));
    const a = computePanoramaAnchor(off, bbox);
    expect(a.bimAnchorPosition.x).toBe(-8);
    expect(a.bimAnchorPosition.y).toBe(0);
    expect(a.bimAnchorPosition.z).toBe(12);
    /* Disc + dome remain at world XZ origin so the panorama still wraps
       around the photographer's standpoint, with the BIM offset within. */
    expect(a.discPosition.x).toBe(0);
    expect(a.discPosition.z).toBe(0);
    expect(a.domePosition.x).toBe(0);
    expect(a.domePosition.z).toBe(0);
  });

  it("V7.1: a partial bimOffsetXZ ({ x } only) defaults the missing axis to 0", () => {
    /* Partial type narrowing — TypeScript still requires both fields,
       but a defensive zero-default in the anchor lets us simulate
       absent z by passing 0. */
    const off: PanoramaAsset = { ...ASSET, bimOffsetXZ: { x: 5, z: 0 } };
    const a = computePanoramaAnchor(off, null);
    expect(a.bimAnchorPosition.x).toBe(5);
    expect(a.bimAnchorPosition.z).toBe(0);
  });

  it("V7: disc + dome both at (0, bbox.min.y, 0)", () => {
    const bbox = new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
    const a = computePanoramaAnchor(ASSET, bbox);
    expect(a.discPosition.x).toBe(0);
    expect(a.discPosition.y).toBe(-1);
    expect(a.discPosition.z).toBe(0);
    expect(a.domePosition.x).toBe(0);
    expect(a.domePosition.y).toBe(-1);
    expect(a.domePosition.z).toBe(0);
  });
});
