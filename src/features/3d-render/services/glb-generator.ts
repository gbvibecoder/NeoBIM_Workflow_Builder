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

  // ─── Site Context: Paved Plaza + Road + Curbs ──────────────────────────────
  const bldgW = bb.max.x - bb.min.x;
  const bldgD = bb.max.y - bb.min.y;
  const bldgRadius = Math.max(bldgW, bldgD) / 2;
  const siteGroup = new THREE.Group();
  siteGroup.name = "site-context";

  // Paved plaza around building (concrete pavement)
  const plazaSize = bldgRadius * 3.5;
  const plazaMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(plazaSize, plazaSize),
    new THREE.MeshStandardMaterial({ color: 0xC8C0B8, roughness: 0.75, metalness: 0.0 })
  );
  plazaMesh.rotation.x = -Math.PI / 2;
  plazaMesh.position.y = 0.005;
  plazaMesh.name = "ground-plaza";
  plazaMesh.receiveShadow = true;
  plazaMesh.userData = { elementType: "landscape", discipline: "landscape" };
  siteGroup.add(plazaMesh);

  // Road ring around plaza
  const roadInner = plazaSize / 2 + 1;
  const roadOuter = roadInner + 7;
  const roadMesh = new THREE.Mesh(
    new THREE.RingGeometry(roadInner, roadOuter, 64),
    new THREE.MeshStandardMaterial({ color: 0x3A3A3A, roughness: 0.9, metalness: 0.0 })
  );
  roadMesh.rotation.x = -Math.PI / 2;
  roadMesh.position.y = 0.003;
  roadMesh.name = "ground-road";
  roadMesh.receiveShadow = true;
  roadMesh.userData = { elementType: "landscape", discipline: "landscape" };
  siteGroup.add(roadMesh);

  // Curb edges (inner + outer)
  const curbMat = new THREE.MeshStandardMaterial({ color: 0xD0CCC4, roughness: 0.7, metalness: 0.0 });
  for (const radius of [roadInner, roadOuter]) {
    const curbGeo = new THREE.TorusGeometry(radius, 0.08, 4, 64);
    const curb = new THREE.Mesh(curbGeo, curbMat);
    curb.rotation.x = -Math.PI / 2;
    curb.position.y = 0.08;
    curb.name = `curb-${radius === roadInner ? "inner" : "outer"}`;
    curb.userData = { elementType: "landscape", discipline: "landscape" };
    siteGroup.add(curb);
  }
  scene.add(siteGroup);

  // ─── Landscaping: Natural Trees (sphere crowns, not cones) ────────────────
  const treeMaterial = new THREE.MeshStandardMaterial({ color: 0x2D6B1E, roughness: 0.85, metalness: 0.0 });
  const treeDarkMat = new THREE.MeshStandardMaterial({ color: 0x1F5014, roughness: 0.88, metalness: 0.0 });
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x5C3A1E, roughness: 0.8, metalness: 0.0 });
  const treeGroup = new THREE.Group();
  treeGroup.name = "landscaping";

  const treeRingRadius = bldgRadius + 6 + Math.random() * 4;
  const numTrees = Math.max(8, Math.min(24, Math.floor(bldgRadius * 1.2)));

  function addTree(tx: number, tz: number, treeH: number, crownR: number, idx: string) {
    const trunkH = treeH * 0.4;
    // Trunk — tapered cylinder (thicker at base)
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.18, trunkH, 8),
      trunkMaterial
    );
    trunk.position.set(tx, trunkH / 2, tz);
    trunk.castShadow = true;
    trunk.name = `tree-trunk-${idx}`;
    trunk.userData = { elementType: "landscape", discipline: "landscape" };
    treeGroup.add(trunk);

    // Crown — 2-3 overlapping spheres for natural canopy shape
    const crownParts = 2 + Math.floor(Math.random() * 2);
    for (let c = 0; c < crownParts; c++) {
      const r = crownR * (0.7 + Math.random() * 0.4);
      const ox = (Math.random() - 0.5) * crownR * 0.4;
      const oz = (Math.random() - 0.5) * crownR * 0.4;
      const oy = c * crownR * 0.3;
      const crown = new THREE.Mesh(
        new THREE.SphereGeometry(r, 10, 8),
        c === 0 ? treeDarkMat : treeMaterial
      );
      crown.position.set(tx + ox, trunkH + crownR * 0.6 + oy, tz + oz);
      crown.castShadow = true;
      crown.name = `tree-crown-${idx}-${c}`;
      crown.userData = { elementType: "landscape", discipline: "landscape" };
      treeGroup.add(crown);
    }
  }

  // Ring of trees around building
  for (let t = 0; t < numTrees; t++) {
    const angle = (t / numTrees) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
    const dist = treeRingRadius + (Math.random() - 0.5) * 4;
    addTree(Math.cos(angle) * dist, Math.sin(angle) * dist, 5 + Math.random() * 5, 1.8 + Math.random() * 2, `r${t}`);
  }

  // Scattered trees beyond road
  for (let t = 0; t < 8; t++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = roadOuter + 3 + Math.random() * 12;
    addTree(Math.cos(angle) * dist, Math.sin(angle) * dist, 4 + Math.random() * 4, 1.5 + Math.random() * 1.5, `f${t}`);
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
