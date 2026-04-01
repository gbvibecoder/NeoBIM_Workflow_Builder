/**
 * Ultra-Realistic BIM Material System
 * Procedural PBR materials with canvas-based textures for the BIMViewer.
 * Replaces flat GLB materials with rich, textured PBR materials after load.
 */

import * as THREE from "three";

// ─── Noise Utilities ──────────────────────────────────────────────────────────

function noise(x: number, y: number, seed: number): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 1731.3) * 43758.5453;
  return n - Math.floor(n);
}

function smoothNoise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const a = noise(ix, iy, seed);
  const b = noise(ix + 1, iy, seed);
  const c = noise(ix, iy + 1, seed);
  const d = noise(ix + 1, iy + 1, seed);
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let val = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < octaves; i++) {
    val += smoothNoise(x * freq, y * freq, seed + i * 100) * amp;
    amp *= 0.5;
    freq *= 2;
  }
  return val;
}

// ─── Canvas Texture Helper ────────────────────────────────────────────────────

function tex(
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  repeat?: [number, number]
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  return t;
}

// ─── Bump Map from Noise ──────────────────────────────────────────────────────

function noiseBump(scale: number, seed: number, repeat?: [number, number]): THREE.CanvasTexture {
  return tex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h);
    for (let i = 0; i < d.data.length; i += 4) {
      const px = (i / 4) % w, py = Math.floor(i / 4 / w);
      const n = fbm(px * scale, py * scale, seed, 4);
      const v = Math.floor(n * 255);
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
    }
    ctx.putImageData(d, 0, 0);
  }, repeat);
}

// ─── Concrete Texture ─────────────────────────────────────────────────────────

function concreteTex(base: string, repeat?: [number, number]): THREE.CanvasTexture {
  return tex(512, 512, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h);
    for (let i = 0; i < d.data.length; i += 4) {
      const px = (i / 4) % w, py = Math.floor(i / 4 / w);
      const n = fbm(px * 0.02, py * 0.02, 42, 5);
      const v = (n - 0.5) * 45;
      d.data[i] = Math.max(0, Math.min(255, d.data[i] + v));
      d.data[i + 1] = Math.max(0, Math.min(255, d.data[i + 1] + v));
      d.data[i + 2] = Math.max(0, Math.min(255, d.data[i + 2] + v));
    }
    ctx.putImageData(d, 0, 0);
    // Formwork seams
    for (let i = 0; i < 5; i++) {
      const y = (i + 1) * (h / 6) + (Math.random() - 0.5) * 10;
      ctx.strokeStyle = `rgba(80, 75, 65, ${0.08 + Math.random() * 0.08})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y + (Math.random() - 0.5) * 4);
      ctx.stroke();
    }
  }, repeat);
}

// ─── Plaster / Stucco Texture ─────────────────────────────────────────────────

function plasterTex(base: string, repeat?: [number, number]): THREE.CanvasTexture {
  return tex(512, 512, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h);
    for (let i = 0; i < d.data.length; i += 4) {
      const px = (i / 4) % w, py = Math.floor(i / 4 / w);
      // Stipple noise — stucco-like
      const n1 = fbm(px * 0.04, py * 0.04, 17, 4);
      const n2 = fbm(px * 0.12, py * 0.12, 29, 2);
      const v = (n1 - 0.5) * 25 + (n2 - 0.5) * 10;
      d.data[i] = Math.max(0, Math.min(255, d.data[i] + v));
      d.data[i + 1] = Math.max(0, Math.min(255, d.data[i + 1] + v));
      d.data[i + 2] = Math.max(0, Math.min(255, d.data[i + 2] + v - 3));
    }
    ctx.putImageData(d, 0, 0);
  }, repeat);
}

// ─── Wood Texture ─────────────────────────────────────────────────────────────

function woodTex(tint: string, repeat?: [number, number]): THREE.CanvasTexture {
  return tex(512, 512, (ctx, w, h) => {
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 120; i++) {
      const y = (i / 120) * h;
      const dark = 0.06 + Math.random() * 0.1;
      ctx.strokeStyle = `rgba(40, 20, 0, ${dark})`;
      ctx.lineWidth = 0.5 + Math.random() * 2.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x < w; x += 4) {
        const wave = Math.sin((x * 0.015 + i * 0.3)) * 3;
        ctx.lineTo(x, y + wave + (Math.random() - 0.5) * 1.2);
      }
      ctx.stroke();
    }
    // Knots
    for (let k = 0; k < 2; k++) {
      const kx = Math.random() * w, ky = Math.random() * h, kr = 4 + Math.random() * 7;
      const g = ctx.createRadialGradient(kx, ky, 0, kx, ky, kr);
      g.addColorStop(0, "rgba(50, 25, 5, 0.3)");
      g.addColorStop(1, "rgba(50, 25, 5, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(kx - kr, ky - kr, kr * 2, kr * 2);
    }
  }, repeat);
}

// ─── Brick Texture ────────────────────────────────────────────────────────────

function brickTex(repeat?: [number, number]): THREE.CanvasTexture {
  return tex(512, 256, (ctx, w, h) => {
    ctx.fillStyle = "#8A8078";
    ctx.fillRect(0, 0, w, h);
    const bW = 64, bH = 32, m = 3;
    const cols = ["#C47860", "#B86B55", "#D08870", "#CC7E68", "#D89880"];
    for (let row = 0; row < h / bH + 1; row++) {
      const off = row % 2 === 0 ? 0 : bW / 2;
      for (let col = -1; col < w / bW + 2; col++) {
        const x = col * bW + off, y = row * bH;
        const c = new THREE.Color(cols[Math.floor(Math.random() * cols.length)]);
        c.multiplyScalar(0.85 + Math.random() * 0.3);
        ctx.fillStyle = `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
        ctx.fillRect(x + m, y + m, bW - m * 2, bH - m * 2);
      }
    }
  }, repeat);
}

// ─── Metal Brushed Texture ────────────────────────────────────────────────────

function brushedMetalTex(repeat?: [number, number]): THREE.CanvasTexture {
  return tex(256, 256, (ctx, w, h) => {
    ctx.fillStyle = "#A0A0A0";
    ctx.fillRect(0, 0, w, h);
    // Horizontal brushing lines
    for (let i = 0; i < 300; i++) {
      const y = Math.random() * h;
      ctx.strokeStyle = `rgba(${140 + Math.random() * 80}, ${140 + Math.random() * 80}, ${140 + Math.random() * 80}, ${0.06 + Math.random() * 0.06})`;
      ctx.lineWidth = 0.5 + Math.random();
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y + (Math.random() - 0.5) * 2);
      ctx.stroke();
    }
  }, repeat);
}

// ─── Grass Texture ────────────────────────────────────────────────────────────

function grassTex(repeat?: [number, number]): THREE.CanvasTexture {
  return tex(512, 512, (ctx, w, h) => {
    // Rich green base
    ctx.fillStyle = "#2D5A16";
    ctx.fillRect(0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h);
    for (let i = 0; i < d.data.length; i += 4) {
      const px = (i / 4) % w, py = Math.floor(i / 4 / w);
      const n1 = fbm(px * 0.04, py * 0.04, 33, 5);
      const n2 = fbm(px * 0.15, py * 0.15, 77, 3);
      d.data[i] = Math.max(0, Math.min(255, d.data[i] + (n1 - 0.5) * 35 + (n2 - 0.5) * 15));
      d.data[i + 1] = Math.max(0, Math.min(255, d.data[i + 1] + (n1 - 0.5) * 55 + (n2 - 0.5) * 25));
      d.data[i + 2] = Math.max(0, Math.min(255, d.data[i + 2] + (n1 - 0.5) * 15));
    }
    ctx.putImageData(d, 0, 0);
    // Grass blade highlights
    for (let i = 0; i < 600; i++) {
      const gx = Math.random() * w, gy = Math.random() * h;
      ctx.strokeStyle = `rgba(80, ${140 + Math.random() * 60}, 30, ${0.1 + Math.random() * 0.15})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx + (Math.random() - 0.5) * 3, gy - 2 - Math.random() * 6);
      ctx.stroke();
    }
  }, repeat);
}

// ─── Roof Texture ─────────────────────────────────────────────────────────────

function roofTex(repeat?: [number, number]): THREE.CanvasTexture {
  return tex(512, 512, (ctx, w, h) => {
    ctx.fillStyle = "#3A3A3C";
    ctx.fillRect(0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h);
    for (let i = 0; i < d.data.length; i += 4) {
      const px = (i / 4) % w, py = Math.floor(i / 4 / w);
      const n = fbm(px * 0.03, py * 0.03, 88, 4);
      const v = (n - 0.5) * 30;
      d.data[i] = Math.max(0, Math.min(255, d.data[i] + v));
      d.data[i + 1] = Math.max(0, Math.min(255, d.data[i + 1] + v));
      d.data[i + 2] = Math.max(0, Math.min(255, d.data[i + 2] + v));
    }
    ctx.putImageData(d, 0, 0);
    // Membrane seams
    for (let i = 0; i < 3; i++) {
      const x = (i + 1) * (w / 4);
      ctx.strokeStyle = "rgba(60, 60, 62, 0.5)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + (Math.random() - 0.5) * 5, h);
      ctx.stroke();
    }
  }, repeat);
}

// ─── Sky Environment Texture ──────────────────────────────────────────────────

export function createSkyTexture(): THREE.CanvasTexture {
  return tex(1024, 512, (ctx, w, h) => {
    // Sky gradient — warm horizon, blue zenith
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#3A6BC5");     // Zenith — rich blue
    grad.addColorStop(0.3, "#6BA3D6");   // Upper sky
    grad.addColorStop(0.6, "#A8CCE8");   // Mid sky
    grad.addColorStop(0.78, "#D4E4F0");  // Near horizon haze
    grad.addColorStop(0.85, "#F0E8D8");  // Warm horizon glow
    grad.addColorStop(0.92, "#E8D8C0");  // Ground haze
    grad.addColorStop(1.0, "#8A9A6A");   // Ground
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Sun disc with glow
    const sunX = w * 0.7, sunY = h * 0.38;
    // Outer glow
    const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 120);
    glow.addColorStop(0, "rgba(255, 248, 220, 0.6)");
    glow.addColorStop(0.3, "rgba(255, 240, 200, 0.2)");
    glow.addColorStop(0.7, "rgba(255, 230, 180, 0.05)");
    glow.addColorStop(1, "rgba(255, 220, 160, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(sunX - 120, sunY - 120, 240, 240);
    // Sun core
    const core = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 20);
    core.addColorStop(0, "rgba(255, 255, 245, 0.95)");
    core.addColorStop(0.5, "rgba(255, 250, 220, 0.6)");
    core.addColorStop(1, "rgba(255, 245, 200, 0)");
    ctx.fillStyle = core;
    ctx.fillRect(sunX - 30, sunY - 30, 60, 60);

    // Wispy clouds
    for (let i = 0; i < 8; i++) {
      const cx = Math.random() * w;
      const cy = h * 0.15 + Math.random() * h * 0.35;
      const cw = 60 + Math.random() * 140;
      const ch = 8 + Math.random() * 20;
      ctx.fillStyle = `rgba(255, 255, 255, ${0.04 + Math.random() * 0.08})`;
      ctx.beginPath();
      ctx.ellipse(cx, cy, cw, ch, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Material Library — maps BIM element types to ultra-realistic PBR materials
// ═══════════════════════════════════════════════════════════════════════════════

export interface BIMMaterialLib {
  wall: THREE.Material;
  wallInterior: THREE.Material;
  wallExterior: THREE.Material;
  slab: THREE.Material;
  roof: THREE.Material;
  window: THREE.Material;
  door: THREE.Material;
  column: THREE.Material;
  beam: THREE.Material;
  stair: THREE.Material;
  space: THREE.Material;
  parapet: THREE.Material;
  canopy: THREE.Material;
  balcony: THREE.Material;
  duct: THREE.Material;
  pipe: THREE.Material;
  cableTray: THREE.Material;
  equipment: THREE.Material;
  ground: THREE.Material;
  mullion: THREE.Material;
  spandrel: THREE.Material;
  treeCrown: THREE.Material;
  treeTrunk: THREE.Material;
}

export function createBIMMaterials(): BIMMaterialLib {
  const DS = THREE.DoubleSide;

  // ── Textures ──
  const wallPlaster = plasterTex("#E8E0D4", [2, 2]);
  const wallBrick = brickTex([3, 3]);
  const concSlab = concreteTex("#D0CCC4", [2, 2]);
  const concBump = noiseBump(0.04, 55, [2, 2]);
  const roofMap = roofTex([2, 2]);
  const roofBump = noiseBump(0.03, 71, [2, 2]);
  const doorWood = woodTex("#6B4E10", [1, 2]);
  const metalBrushed = brushedMetalTex([3, 3]);
  const metalBumpMap = noiseBump(0.08, 44, [3, 3]);
  const grassMap = grassTex([25, 25]);
  const grassBumpMap = noiseBump(0.06, 22, [25, 25]);

  return {
    // ── Walls ──
    wall: new THREE.MeshStandardMaterial({
      map: wallPlaster, side: DS, roughness: 0.85, metalness: 0.0,
      bumpMap: noiseBump(0.06, 12, [2, 2]), bumpScale: 0.15,
    }),
    wallInterior: new THREE.MeshStandardMaterial({
      color: 0xF5F0EB, side: DS, roughness: 0.92, metalness: 0.0,
    }),
    wallExterior: new THREE.MeshStandardMaterial({
      map: wallBrick, side: DS, roughness: 0.85, metalness: 0.0,
      bumpMap: noiseBump(0.05, 14, [3, 3]), bumpScale: 0.3,
    }),

    // ── Slabs / Floors ──
    slab: new THREE.MeshStandardMaterial({
      map: concSlab, side: DS, roughness: 0.78, metalness: 0.0,
      bumpMap: concBump, bumpScale: 0.25,
    }),

    // ── Roof ──
    roof: new THREE.MeshStandardMaterial({
      map: roofMap, side: DS, roughness: 0.7, metalness: 0.12,
      bumpMap: roofBump, bumpScale: 0.2,
    }),

    // ── Glass — physically-based transmission ──
    window: new THREE.MeshPhysicalMaterial({
      color: 0x88CCEE,
      transparent: true,
      opacity: 0.2,
      side: DS,
      roughness: 0.02,
      metalness: 0.05,
      transmission: 0.88,
      reflectivity: 0.95,
      ior: 1.52,
      thickness: 0.5,
      envMapIntensity: 1.5,
      clearcoat: 0.1,
      clearcoatRoughness: 0.05,
    }),

    // ── Door ──
    door: new THREE.MeshStandardMaterial({
      map: doorWood, side: DS, roughness: 0.5, metalness: 0.0,
      bumpMap: noiseBump(0.08, 31, [1, 2]), bumpScale: 0.15,
    }),

    // ── Structural — exposed concrete columns ──
    column: new THREE.MeshStandardMaterial({
      map: concreteTex("#C0C0C0", [1, 2]), side: DS, roughness: 0.55, metalness: 0.2,
      bumpMap: noiseBump(0.05, 66, [1, 2]), bumpScale: 0.2,
    }),

    beam: new THREE.MeshStandardMaterial({
      map: metalBrushed, side: DS, roughness: 0.4, metalness: 0.85,
      bumpMap: metalBumpMap, bumpScale: 0.1,
    }),

    stair: new THREE.MeshStandardMaterial({
      map: concreteTex("#D4D0C8", [2, 1]), side: DS, roughness: 0.65, metalness: 0.0,
      bumpMap: noiseBump(0.04, 50, [2, 1]), bumpScale: 0.15,
    }),

    // ── Space (transparent volume) ──
    space: new THREE.MeshStandardMaterial({
      color: 0xF0EDE8, side: DS, roughness: 0.95, metalness: 0.0,
      transparent: true, opacity: 0.03, depthWrite: false,
    }),

    // ── Parapet / Canopy / Balcony ──
    parapet: new THREE.MeshStandardMaterial({
      map: concreteTex("#C8C0B4", [2, 1]), side: DS, roughness: 0.75, metalness: 0.0,
    }),
    canopy: new THREE.MeshStandardMaterial({
      color: 0xB8B0A4, side: DS, roughness: 0.55, metalness: 0.15,
    }),
    balcony: new THREE.MeshStandardMaterial({
      color: 0xC0C0C0, side: DS, roughness: 0.65, metalness: 0.15,
    }),

    // ── MEP ──
    duct: new THREE.MeshStandardMaterial({
      map: metalBrushed, side: DS, roughness: 0.25, metalness: 0.85,
      bumpMap: metalBumpMap, bumpScale: 0.05,
      envMapIntensity: 1.2,
    }),
    pipe: new THREE.MeshStandardMaterial({
      color: 0x3A8A5A, side: DS, roughness: 0.3, metalness: 0.7,
      envMapIntensity: 1.2,
    }),
    cableTray: new THREE.MeshStandardMaterial({
      color: 0xCCA020, side: DS, roughness: 0.35, metalness: 0.6,
    }),
    equipment: new THREE.MeshStandardMaterial({
      color: 0x5080B0, side: DS, roughness: 0.3, metalness: 0.65,
      envMapIntensity: 1.0,
    }),

    // ── Ground ──
    ground: new THREE.MeshStandardMaterial({
      map: grassMap, side: DS, roughness: 0.92, metalness: 0.0,
      bumpMap: grassBumpMap, bumpScale: 0.3,
    }),

    // ── Facade Detail ──
    mullion: new THREE.MeshStandardMaterial({
      color: 0xC0C0C8, side: DS, roughness: 0.25, metalness: 0.9,
      envMapIntensity: 1.4,
    }),
    spandrel: new THREE.MeshStandardMaterial({
      color: 0x1A1A22, side: DS, roughness: 0.3, metalness: 0.8,
      envMapIntensity: 1.0,
    }),

    // ── Landscaping ──
    treeCrown: new THREE.MeshStandardMaterial({
      color: 0x2D6B1E, side: DS, roughness: 0.85, metalness: 0.0,
    }),
    treeTrunk: new THREE.MeshStandardMaterial({
      color: 0x5C3A1E, side: DS, roughness: 0.8, metalness: 0.0,
    }),
  };
}

/**
 * Get the appropriate material key for a BIM element type.
 */
export function getMaterialKey(elementType: string, isExterior?: boolean): keyof BIMMaterialLib {
  switch (elementType) {
    case "wall":
      return isExterior ? "wallExterior" : "wall";
    case "slab":       return "slab";
    case "roof":       return "roof";
    case "window":     return "window";
    case "door":       return "door";
    case "column":     return "column";
    case "beam":       return "beam";
    case "stair":      return "stair";
    case "space":      return "space";
    case "parapet":    return "parapet";
    case "canopy":     return "canopy";
    case "balcony":    return "balcony";
    case "duct":       return "duct";
    case "pipe":       return "pipe";
    case "cable-tray": return "cableTray";
    case "equipment":  return "equipment";
    case "mullion":    return "mullion";
    case "spandrel":   return "spandrel";
    case "landscape":  return "treeCrown";
    default:           return "wall";
  }
}

/**
 * Dispose all materials and their textures.
 */
export function disposeBIMMaterials(lib: BIMMaterialLib) {
  for (const mat of Object.values(lib)) {
    if (mat instanceof THREE.Material) {
      if ("map" in mat && mat.map) (mat.map as THREE.Texture).dispose();
      if ("bumpMap" in mat && mat.bumpMap) (mat.bumpMap as THREE.Texture).dispose();
      mat.dispose();
    }
  }
}
