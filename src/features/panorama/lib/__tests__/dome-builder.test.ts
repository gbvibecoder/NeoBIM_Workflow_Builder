import { describe, expect, it, vi } from "vitest";
import {
  BackSide,
  type Intersection,
  Material,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  Raycaster,
  SphereGeometry,
  Texture,
  Vector3,
} from "three";

import { buildDome, disposeDome } from "@/features/panorama/lib/dome-builder";

describe("buildDome", () => {
  it("V7: creates a SphereGeometry with thetaLength = π/2 + 0.1 (upper hemisphere + horizon overlap lip)", () => {
    const tex = new Texture();
    const mesh = buildDome(tex, new Vector3(), 100, 0.5);
    expect(mesh.geometry).toBeInstanceOf(SphereGeometry);
    const params = (mesh.geometry as SphereGeometry).parameters;
    expect(params.thetaLength).toBeCloseTo(Math.PI / 2 + 0.1, 5);
    expect(params.thetaStart).toBe(0);
    expect(params.phiLength).toBeCloseTo(Math.PI * 2, 5);
  });

  it("V7: uses BackSide MeshBasicMaterial with depthWrite=false and transparent=true", () => {
    const tex = new Texture();
    const mesh = buildDome(tex, new Vector3(1, 2, 3), 75, 0.5);
    const mat = mesh.material as MeshBasicMaterial;
    expect(mat).toBeInstanceOf(MeshBasicMaterial);
    expect(mat.side).toBe(BackSide);
    expect(mat.map).toBe(tex);
    expect(mat.depthWrite).toBe(false);
    expect(mat.transparent).toBe(true);
    expect(mat.toneMapped).toBe(false);
  });

  it("positions the mesh at the supplied centre", () => {
    const mesh = buildDome(new Texture(), new Vector3(1, 2, 3), 75, 0.5);
    expect(mesh.position.x).toBe(1);
    expect(mesh.position.y).toBe(2);
    expect(mesh.position.z).toBe(3);
  });

  it("names the mesh 'panorama-dome' and sets renderOrder = -2", () => {
    const mesh = buildDome(new Texture(), new Vector3(), 100, 0.5);
    expect(mesh.name).toBe("panorama-dome");
    expect(mesh.renderOrder).toBe(-2);
  });

  it("opts the mesh out of shadows + raycasting (purely a backdrop)", () => {
    const mesh = buildDome(new Texture(), new Vector3(), 100, 0.5);
    expect(mesh.castShadow).toBe(false);
    expect(mesh.receiveShadow).toBe(false);
    const intersects: Intersection<Object3D>[] = [];
    mesh.raycast(new Raycaster(), intersects);
    expect(intersects.length).toBe(0);
  });

  it("UV remap: dome-top vertex (uv.y_geom=1) samples top of texture (uv.y_tex=1)", () => {
    /* iy=0 → top pole. After Three.js's `1 - v` storage with v=0, uv.y_geom=1.
       Our remap: uv.y_tex = (1 - h) + uv.y_geom * h. With h=0.5: uv.y_tex = 0.5 + 1*0.5 = 1. */
    const mesh = buildDome(new Texture(), new Vector3(), 100, 0.5);
    const uv = mesh.geometry.attributes.uv;
    /* The first iy=0 vertices are the row-0 pole vertices. Three.js
       emits (widthSegments+1) UVs per row, so any of the first
       widthSegments+1 entries should have uv.y_tex ≈ 1. */
    expect(uv.getY(0)).toBeCloseTo(1, 5);
  });

  it("UV remap: dome-equator vertex (uv.y_geom=0) samples horizon row (uv.y_tex=1-h)", () => {
    const mesh = buildDome(new Texture(), new Vector3(), 100, 0.5);
    const uv = mesh.geometry.attributes.uv;
    /* The last vertex (iy=heightSegments) is on the equator → uv.y_geom=0 → uv.y_tex = 1-h = 0.5. */
    const last = uv.count - 1;
    expect(uv.getY(last)).toBeCloseTo(0.5, 5);
  });

  it("UV remap with horizonRow=0.6: equator samples uv.y_tex=0.4 (just below image centre, since horizon is low)", () => {
    const mesh = buildDome(new Texture(), new Vector3(), 100, 0.6);
    const uv = mesh.geometry.attributes.uv;
    const last = uv.count - 1;
    expect(uv.getY(last)).toBeCloseTo(1 - 0.6, 5);
    /* Top stays at 1. */
    expect(uv.getY(0)).toBeCloseTo(1, 5);
  });

  it("UV remap clamps horizonRow into [0.01, 0.99] to avoid degenerate UVs", () => {
    const meshLow = buildDome(new Texture(), new Vector3(), 100, 0);
    const uvLow = meshLow.geometry.attributes.uv;
    /* Effective h = 0.01: equator uv.y_tex = 1 - 0.01 = 0.99. */
    expect(uvLow.getY(uvLow.count - 1)).toBeCloseTo(0.99, 5);

    const meshHigh = buildDome(new Texture(), new Vector3(), 100, 1);
    const uvHigh = meshHigh.geometry.attributes.uv;
    /* Effective h = 0.99: equator uv.y_tex = 0.01. */
    expect(uvHigh.getY(uvHigh.count - 1)).toBeCloseTo(0.01, 5);
  });
});

describe("disposeDome", () => {
  it("disposes geometry + material but NOT the texture (loader-managed)", () => {
    const tex = new Texture();
    const mesh = buildDome(tex, new Vector3(), 100, 0.5);
    const geomDispose = vi.spyOn(mesh.geometry, "dispose");
    const matDispose = vi.spyOn(mesh.material as Material, "dispose");
    const texDispose = vi.spyOn(tex, "dispose");
    disposeDome(mesh as Mesh);
    expect(geomDispose).toHaveBeenCalled();
    expect(matDispose).toHaveBeenCalled();
    expect(texDispose).not.toHaveBeenCalled();
  });
});
