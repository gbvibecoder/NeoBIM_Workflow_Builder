import { describe, expect, it, vi } from "vitest";
import {
  DoubleSide,
  type Intersection,
  Material,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  Raycaster,
  RingGeometry,
  Texture,
  Vector3,
} from "three";

import {
  buildGroundDisc,
  disposeGroundDisc,
} from "@/features/panorama/lib/ground-disc-builder";

describe("buildGroundDisc (V7)", () => {
  it("V7: creates a RingGeometry (inner=0) rotated to lie in the XZ plane", () => {
    const mesh = buildGroundDisc(
      new Texture(),
      new Vector3(),
      50,
      5,
      0.5,
      { x: 0.5, y: 0.85 },
    );
    expect(mesh.geometry).toBeInstanceOf(RingGeometry);
    const pos = mesh.geometry.attributes.position;
    let maxY = 0;
    for (let i = 0; i < pos.count; i++) {
      maxY = Math.max(maxY, Math.abs(pos.getY(i)));
    }
    expect(maxY).toBeLessThan(1e-5);
  });

  it("uses DoubleSide MeshBasicMaterial; V7 transparent=true; depthWrite relaxed", () => {
    const tex = new Texture();
    const mesh = buildGroundDisc(
      tex,
      new Vector3(),
      50,
      5,
      0.5,
      { x: 0.5, y: 0.85 },
    );
    const mat = mesh.material as MeshBasicMaterial;
    expect(mat).toBeInstanceOf(MeshBasicMaterial);
    expect(mat.side).toBe(DoubleSide);
    expect(mat.map).toBe(tex);
    expect(mat.transparent).toBe(true);
    expect(mat.depthWrite).toBe(false);
    expect(mat.toneMapped).toBe(false);
    expect(typeof mat.onBeforeCompile).toBe("function");
  });

  it("positions the mesh at the supplied centre", () => {
    const mesh = buildGroundDisc(
      new Texture(),
      new Vector3(1, 2, 3),
      50,
      5,
      0.5,
      { x: 0.5, y: 0.85 },
    );
    expect(mesh.position.x).toBe(1);
    expect(mesh.position.y).toBe(2);
    expect(mesh.position.z).toBe(3);
  });

  it("names the mesh 'panorama-disc' and sets renderOrder = -1", () => {
    const mesh = buildGroundDisc(
      new Texture(),
      new Vector3(),
      50,
      5,
      0.5,
      { x: 0.5, y: 0.85 },
    );
    expect(mesh.name).toBe("panorama-disc");
    expect(mesh.renderOrder).toBe(-1);
  });

  it("opts the mesh out of shadows + raycasting", () => {
    const mesh = buildGroundDisc(
      new Texture(),
      new Vector3(),
      50,
      5,
      0.5,
      { x: 0.5, y: 0.85 },
    );
    expect(mesh.castShadow).toBe(false);
    expect(mesh.receiveShadow).toBe(false);
    const intersects: Intersection<Object3D>[] = [];
    mesh.raycast(new Raycaster(), intersects);
    expect(intersects.length).toBe(0);
  });

  it("UV polar mapping V: disc edge samples uv.y_tex = 1 - horizonRow (horizon)", () => {
    const radius = 50;
    const horizonRow = 0.5;
    const mesh = buildGroundDisc(
      new Texture(),
      new Vector3(),
      radius,
      5,
      horizonRow,
      { x: 0.5, y: 0.85 },
    );
    const uv = mesh.geometry.attributes.uv;
    const pos = mesh.geometry.attributes.position;

    let maxV = 0;
    for (let i = 1; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const r = Math.sqrt(x * x + z * z);
      if (r > radius * 0.99) {
        maxV = Math.max(maxV, uv.getY(i));
      }
    }
    expect(maxV).toBeCloseTo(1 - horizonRow, 5);
  });

  it("UV polar mapping V: disc centre samples uv.y_tex = 0 (image bottom = nadir)", () => {
    const mesh = buildGroundDisc(
      new Texture(),
      new Vector3(),
      50,
      5,
      0.5,
      { x: 0.5, y: 0.85 },
    );
    const uv = mesh.geometry.attributes.uv;
    expect(uv.getY(0)).toBeCloseTo(0, 5);
  });

  it("UV U mapping always lies within [0, 1] (wraps correctly)", () => {
    const mesh = buildGroundDisc(
      new Texture(),
      new Vector3(),
      50,
      5,
      0.5,
      { x: 0.1, y: 0.85 },
    );
    const uv = mesh.geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1.000001);
    }
  });

  /* ── V7 alpha-ramp tests ──────────────────────────────────────────── */

  it("V7: builds a per-vertex 'alpha' BufferAttribute of itemSize 1", () => {
    const mesh = buildGroundDisc(
      new Texture(),
      new Vector3(),
      50,
      5,
      0.5,
      { x: 0.5, y: 0.85 },
    );
    const alphaAttr = mesh.geometry.getAttribute("alpha");
    expect(alphaAttr).toBeDefined();
    expect(alphaAttr.itemSize).toBe(1);
    expect(alphaAttr.count).toBe(mesh.geometry.attributes.position.count);
  });

  it("V7: vertices inside innerRadius have alpha = 0 (transparent core)", () => {
    const radius = 50;
    const innerRadius = 5;
    const mesh = buildGroundDisc(
      new Texture(),
      new Vector3(),
      radius,
      innerRadius,
      0.5,
      { x: 0.5, y: 0.85 },
    );
    const alphaAttr = mesh.geometry.getAttribute("alpha");
    const pos = mesh.geometry.attributes.position;
    /* Disc centre vertex (i=0) — at exactly r=0, less than innerRadius. */
    expect(pos.getX(0)).toBeCloseTo(0, 5);
    expect(pos.getZ(0)).toBeCloseTo(0, 5);
    expect(alphaAttr.getX(0)).toBe(0);
  });

  it("V7: vertices in the opaque band have alpha = 1", () => {
    const radius = 50;
    const innerRadius = 5;
    const mesh = buildGroundDisc(
      new Texture(),
      new Vector3(),
      radius,
      innerRadius,
      0.5,
      { x: 0.5, y: 0.85 },
    );
    const alphaAttr = mesh.geometry.getAttribute("alpha");
    const pos = mesh.geometry.attributes.position;
    /* Find a vertex in the opaque band (e.g., r ≈ 25 m) and confirm alpha=1. */
    let foundOpaque = false;
    for (let i = 0; i < pos.count; i++) {
      const r = Math.sqrt(pos.getX(i) ** 2 + pos.getZ(i) ** 2);
      if (r > innerRadius * 1.5 && r < radius * 0.85) {
        expect(alphaAttr.getX(i)).toBe(1);
        foundOpaque = true;
        break;
      }
    }
    expect(foundOpaque).toBe(true);
  });

  it("V7: outer 10% ring has alpha < 1 fading toward 0 at the edge", () => {
    const radius = 50;
    const mesh = buildGroundDisc(
      new Texture(),
      new Vector3(),
      radius,
      5,
      0.5,
      { x: 0.5, y: 0.85 },
    );
    const alphaAttr = mesh.geometry.getAttribute("alpha");
    const pos = mesh.geometry.attributes.position;
    /* Find a vertex at the geometric edge (r ≈ radius). Its alpha should be ≈ 0. */
    let edgeAlpha = -1;
    for (let i = 0; i < pos.count; i++) {
      const r = Math.sqrt(pos.getX(i) ** 2 + pos.getZ(i) ** 2);
      if (r > radius * 0.999) {
        edgeAlpha = alphaAttr.getX(i);
        break;
      }
    }
    expect(edgeAlpha).toBeCloseTo(0, 3);

    /* And a vertex anywhere inside the fade band (R*0.9 < r < R) but
       not at the edge should have a partial alpha. With RingGeometry
       phiSegments=16, the inner ring is at r = R*15/16 = R*0.9375. */
    let midFadeAlpha = -1;
    for (let i = 0; i < pos.count; i++) {
      const r = Math.sqrt(pos.getX(i) ** 2 + pos.getZ(i) ** 2);
      if (r > radius * 0.91 && r < radius * 0.99) {
        midFadeAlpha = alphaAttr.getX(i);
        break;
      }
    }
    expect(midFadeAlpha).toBeGreaterThan(0);
    expect(midFadeAlpha).toBeLessThan(1);
  });

  it("V7: innerRadius=0 disables the transparent core (centre alpha = 1)", () => {
    const mesh = buildGroundDisc(
      new Texture(),
      new Vector3(),
      50,
      0,
      0.5,
      { x: 0.5, y: 0.85 },
    );
    const alphaAttr = mesh.geometry.getAttribute("alpha");
    expect(alphaAttr.getX(0)).toBe(1);
  });

  it("V7: onBeforeCompile injects a vAlpha varying", () => {
    const mesh = buildGroundDisc(
      new Texture(),
      new Vector3(),
      50,
      5,
      0.5,
      { x: 0.5, y: 0.85 },
    );
    const mat = mesh.material as MeshBasicMaterial;
    /* Simulate three.js calling onBeforeCompile by passing a stub
       shader object — we only check that the injection adds the
       expected lines. */
    const shader = {
      vertexShader: "void main(){\n  #include <fog_vertex>\n}",
      fragmentShader: "void main(){\n  #include <opaque_fragment>\n}",
      uniforms: {},
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mat.onBeforeCompile?.(shader as never, undefined as any);
    expect(shader.vertexShader).toContain("attribute float alpha;");
    expect(shader.vertexShader).toContain("varying float vAlpha;");
    expect(shader.vertexShader).toContain("vAlpha = alpha;");
    expect(shader.fragmentShader).toContain("varying float vAlpha;");
    expect(shader.fragmentShader).toContain("gl_FragColor.a *= vAlpha;");
  });
});

describe("disposeGroundDisc", () => {
  it("disposes geometry + material but NOT the texture (loader-managed)", () => {
    const tex = new Texture();
    const mesh = buildGroundDisc(
      tex,
      new Vector3(),
      50,
      5,
      0.5,
      { x: 0.5, y: 0.85 },
    );
    const geomDispose = vi.spyOn(mesh.geometry, "dispose");
    const matDispose = vi.spyOn(mesh.material as Material, "dispose");
    const texDispose = vi.spyOn(tex, "dispose");
    disposeGroundDisc(mesh as Mesh);
    expect(geomDispose).toHaveBeenCalled();
    expect(matDispose).toHaveBeenCalled();
    expect(texDispose).not.toHaveBeenCalled();
  });
});
