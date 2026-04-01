/**
 * Server-side GLB Generator
 * Converts MassingGeometry into a binary GLB file using Three.js.
 * Each mesh is named by its element ID for client-side raycasting/metadata lookup.
 *
 * ALL Three.js usage is inside generateGLB() via dynamic import to avoid
 * polluting Next.js server globals with DOM polyfills at module load time.
 */

import type { MassingGeometry, GeometryElement } from "@/types/geometry";
import type * as THREEns from "three";
import { getMaterialForElement } from "@/services/material-mapping";
import type { PBRMaterialDef } from "@/services/material-mapping";

/**
 * Apply minimal DOM/window polyfill for Three.js server-side usage.
 * Must be called BEFORE importing Three.js.
 */
function ensureServerPolyfill() {
  if (typeof globalThis.window === "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).window = {
      location: { protocol: "https:", host: "localhost", hostname: "localhost" },
      addEventListener: () => {},
      removeEventListener: () => {},
      devicePixelRatio: 1,
      innerWidth: 800,
      innerHeight: 600,
    };
  } else if (!globalThis.window.location) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis.window as any).location = { protocol: "https:", host: "localhost", hostname: "localhost" };
  }
  if (typeof globalThis.document === "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).document = {
      createElement: () => ({ getContext: () => null, width: 0, height: 0, style: {} }),
      createElementNS: () => ({ getContext: () => null, width: 0, height: 0, style: {} }),
    };
  }
  // GLTFExporter binary mode uses FileReader to convert Blob → ArrayBuffer
  if (typeof globalThis.FileReader === "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).FileReader = class FileReader extends EventTarget {
      result: ArrayBuffer | null = null;
      error: Error | null = null;
      readyState = 0;
      onload: ((ev: Event) => void) | null = null;
      onerror: ((ev: Event) => void) | null = null;
      onloadend: ((ev: Event) => void) | null = null;
      readAsArrayBuffer(blob: Blob) {
        blob.arrayBuffer().then((buf) => {
          this.result = buf;
          this.readyState = 2;
          const evt = new Event("load");
          if (this.onload) this.onload(evt);
          if (this.onloadend) this.onloadend(evt);
        }).catch((err) => {
          this.error = err;
          this.readyState = 2;
          const evt = new Event("error");
          if (this.onerror) this.onerror(evt);
          if (this.onloadend) this.onloadend(evt);
        });
      }
      readAsDataURL() { /* unused by GLTFExporter binary mode */ }
      readAsText() { /* unused by GLTFExporter binary mode */ }
      abort() { /* noop */ }
    };
  }
}

/**
 * Generate a binary GLB buffer from MassingGeometry.
 * Each mesh is named by its element ID for click-to-inspect in the viewer.
 */
export async function generateGLB(
  geometry: MassingGeometry,
  materialOverrides?: Record<string, Partial<PBRMaterialDef>>,
): Promise<Buffer> {
  // Polyfill BEFORE importing Three.js
  ensureServerPolyfill();

  // Dynamic import to avoid side effects at module load time
  const THREE = await import("three");
  const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");

  // ─── Material factory ──────────────────────────────────────────────────────

  function createMaterial(def: PBRMaterialDef): THREEns.Material {
    if (def.transmission && def.transmission > 0) {
      return new THREE.MeshPhysicalMaterial({
        color: def.color,
        roughness: def.roughness,
        metalness: def.metalness,
        transparent: true,
        opacity: def.opacity ?? 0.3,
        transmission: def.transmission,
        ior: def.ior ?? 1.5,
        reflectivity: def.reflectivity ?? 0.5,
        side: THREE.DoubleSide,
      });
    }
    return new THREE.MeshStandardMaterial({
      color: def.color,
      roughness: def.roughness,
      metalness: def.metalness,
      transparent: def.transparent ?? false,
      opacity: def.opacity ?? 1.0,
      emissive: def.emissive ?? 0x000000,
      emissiveIntensity: def.emissiveIntensity ?? 0,
      side: THREE.DoubleSide,
    });
  }

  // ─── Material cache ────────────────────────────────────────────────────────

  const materialCache = new Map<string, THREEns.Material>();

  function getCachedMaterial(elementType: string): THREEns.Material {
    let mat = materialCache.get(elementType);
    if (!mat) {
      const baseDef = getMaterialForElement(elementType);
      // Apply AI material overrides if available
      const override = materialOverrides?.[elementType];
      const finalDef = override ? { ...baseDef, ...override } : baseDef;
      mat = createMaterial(finalDef);
      materialCache.set(elementType, mat);
    }
    return mat;
  }

  // ─── Geometry builders ─────────────────────────────────────────────────────

  function buildGeometryFromElement(element: GeometryElement): THREEns.BufferGeometry | null {
    const { vertices, faces } = element;
    if (!vertices.length || !faces.length) return buildParametricGeometry(element);

    const positions: number[] = [];
    const indices: number[] = [];

    for (const v of vertices) {
      // MassingGeometry: x,y = plan, z = vertical → Three.js: x,z = plan, y = vertical
      positions.push(v.x, v.z, v.y);
    }

    for (const face of faces) {
      const vi = face.vertices;
      if (vi.length === 3) {
        indices.push(vi[0], vi[1], vi[2]);
      } else if (vi.length === 4) {
        indices.push(vi[0], vi[1], vi[2]);
        indices.push(vi[0], vi[2], vi[3]);
      } else if (vi.length > 4) {
        for (let i = 1; i < vi.length - 1; i++) {
          indices.push(vi[0], vi[i], vi[i + 1]);
        }
      }
    }

    if (indices.length === 0) return null;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  function buildParametricGeometry(element: GeometryElement): THREEns.BufferGeometry | null {
    const { type, vertices, properties } = element;
    const w = properties.width ?? 0.5;
    const h = properties.height ?? 0.5;
    const l = properties.length ?? 0.5;

    if (type === "pipe") {
      const d = properties.diameter ?? 0.05;
      return new THREE.CylinderGeometry(d / 2, d / 2, properties.height ?? 3.0, 8);
    }
    if (type === "column" && properties.radius) {
      return new THREE.CylinderGeometry(properties.radius, properties.radius, h, 12);
    }
    if (type === "duct" || type === "cable-tray" || type === "equipment") {
      return new THREE.BoxGeometry(w, h, l);
    }
    if (vertices.length === 1) {
      return new THREE.BoxGeometry(w || 0.5, h || 0.5, l || 0.5);
    }
    if (vertices.length === 2) {
      const v0 = vertices[0], v1 = vertices[1];
      const dx = v1.x - v0.x, dy = v1.y - v0.y, dz = v1.z - v0.z;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (len < 0.01) return null;
      return new THREE.BoxGeometry(w || 0.3, h || 0.3, len);
    }
    return null;
  }

  function getElementPosition(element: GeometryElement): THREEns.Vector3 {
    const { vertices, properties } = element;
    if (vertices.length === 0) return new THREE.Vector3(0, 0, 0);
    if (vertices.length === 1) {
      const v = vertices[0];
      return new THREE.Vector3(v.x, v.z + (properties.height ?? 0.5) / 2, v.y);
    }
    if (vertices.length === 2) {
      const v0 = vertices[0], v1 = vertices[1];
      return new THREE.Vector3((v0.x + v1.x) / 2, (v0.z + v1.z) / 2, (v0.y + v1.y) / 2);
    }
    let cx = 0, cy = 0, cz = 0;
    for (const v of vertices) { cx += v.x; cy += v.z; cz += v.y; }
    const n = vertices.length;
    return new THREE.Vector3(cx / n, cy / n, cz / n);
  }

  // ─── Build scene ───────────────────────────────────────────────────────────

  const scene = new THREE.Scene();
  scene.name = geometry.buildingType;

  const bb = geometry.boundingBox;
  const centerX = (bb.min.x + bb.max.x) / 2;
  const centerY = (bb.min.y + bb.max.y) / 2;

  for (const storey of geometry.storeys) {
    const storeyGroup = new THREE.Group();
    storeyGroup.name = `storey-${storey.index}-${storey.name.replace(/\s+/g, "_")}`;

    for (const element of storey.elements) {
      const material = getCachedMaterial(element.type);
      let mesh: THREEns.Mesh | null = null;
      const hasReal = element.vertices.length >= 3 && element.faces.length >= 1;

      if (hasReal) {
        const geo = buildGeometryFromElement(element);
        if (geo) {
          mesh = new THREE.Mesh(geo, material);
          mesh.position.x -= centerX;
          mesh.position.z -= centerY;
        }
      } else {
        const geo = buildParametricGeometry(element);
        if (geo) {
          const pos = getElementPosition(element);
          mesh = new THREE.Mesh(geo, material);
          mesh.position.set(pos.x - centerX, pos.y, pos.z - centerY);
        }
      }

      if (mesh) {
        mesh.name = element.id;
        mesh.userData = {
          ifcType: element.ifcType,
          elementType: element.type,
          storeyIndex: storey.index,
          discipline: element.properties.discipline ?? "unclassified",
        };
        storeyGroup.add(mesh);
      }
    }

    scene.add(storeyGroup);
  }

  // Ground plane
  const groundSize = Math.max((bb.max.x - bb.min.x) * 3, (bb.max.y - bb.min.y) * 3, 50);
  const groundMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(groundSize, groundSize),
    new THREE.MeshStandardMaterial({ color: 0x4A6B3A, roughness: 0.95, metalness: 0.0 })
  );
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.position.y = -0.01;
  groundMesh.name = "ground-plane";
  scene.add(groundMesh);

  // ─── Landscaping: Procedural Trees ──────────────────────────────────────────
  const bldgW = bb.max.x - bb.min.x;
  const bldgD = bb.max.y - bb.min.y;
  const bldgRadius = Math.max(bldgW, bldgD) / 2;
  const treeMaterial = new THREE.MeshStandardMaterial({ color: 0x2D6B1E, roughness: 0.85, metalness: 0.0 });
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x5C3A1E, roughness: 0.8, metalness: 0.0 });
  const treeGroup = new THREE.Group();
  treeGroup.name = "landscaping";

  // Place trees in a ring around the building
  const treeRingRadius = bldgRadius + 6 + Math.random() * 4;
  const numTrees = Math.max(8, Math.min(24, Math.floor(bldgRadius * 1.2)));
  for (let t = 0; t < numTrees; t++) {
    const angle = (t / numTrees) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
    const dist = treeRingRadius + (Math.random() - 0.5) * 4;
    const tx = Math.cos(angle) * dist;
    const tz = Math.sin(angle) * dist;
    const treeH = 4 + Math.random() * 5;
    const crownR = 1.5 + Math.random() * 2;
    const trunkH = treeH * 0.4;

    // Trunk (cylinder)
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.18, trunkH, 6),
      trunkMaterial
    );
    trunk.position.set(tx, trunkH / 2, tz);
    trunk.name = `tree-trunk-${t}`;
    trunk.userData = { elementType: "landscape", discipline: "landscape" };
    treeGroup.add(trunk);

    // Crown (layered cones for fuller look)
    for (let c = 0; c < 3; c++) {
      const coneH = crownR * (1.8 - c * 0.3);
      const coneR = crownR * (1.0 - c * 0.15);
      const crown = new THREE.Mesh(
        new THREE.ConeGeometry(coneR, coneH, 8),
        treeMaterial
      );
      crown.position.set(tx, trunkH + c * coneH * 0.35 + coneH / 2, tz);
      crown.name = `tree-crown-${t}-${c}`;
      crown.userData = { elementType: "landscape", discipline: "landscape" };
      treeGroup.add(crown);
    }
  }

  // Scatter a few trees further away
  for (let t = 0; t < 6; t++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = treeRingRadius + 8 + Math.random() * 10;
    const tx = Math.cos(angle) * dist;
    const tz = Math.sin(angle) * dist;
    const treeH = 3 + Math.random() * 4;
    const crownR = 1.2 + Math.random() * 1.5;

    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.1, 0.15, treeH * 0.35, 6),
      trunkMaterial
    );
    trunk.position.set(tx, treeH * 0.35 / 2, tz);
    trunk.name = `tree-far-trunk-${t}`;
    trunk.userData = { elementType: "landscape", discipline: "landscape" };
    treeGroup.add(trunk);

    const crown = new THREE.Mesh(
      new THREE.SphereGeometry(crownR, 8, 6),
      treeMaterial
    );
    crown.position.set(tx, treeH * 0.35 + crownR * 0.8, tz);
    crown.name = `tree-far-crown-${t}`;
    crown.userData = { elementType: "landscape", discipline: "landscape" };
    treeGroup.add(crown);
  }
  scene.add(treeGroup);

  // ─── Export to GLB ─────────────────────────────────────────────────────────

  const exporter = new GLTFExporter();
  const glb = await new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(
      scene,
      (result) => resolve(result as ArrayBuffer),
      (error) => reject(error),
      { binary: true }
    );
  });

  // Cleanup
  scene.traverse((obj) => {
    if (obj instanceof THREE.Mesh) obj.geometry?.dispose();
  });
  materialCache.clear();

  return Buffer.from(glb);
}
