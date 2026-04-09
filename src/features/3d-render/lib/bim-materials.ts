/**
 * Ultra-Realistic BIM Material System v2
 *
 * Upgrades from v1:
 * - 1024×1024 texture resolution (was 512)
 * - Sobel-filter normal maps replacing bump maps (10× more realistic)
 * - Procedural roughness maps per material
 * - Procedural AO (ambient occlusion) maps for crevice darkening
 * - Higher-quality noise with 5-6 octaves
 * - Polished glass with proper specular + environment intensity
 * - Metal with anisotropic-style brushed appearance
 */

import * as THREE from "three";

// ─── Constants ────────────────────────────────────────────────────────────────

const TEX_SIZE = 512;        // Balanced quality/performance (was 1024)
const BUMP_SIZE = 256;       // Normal/roughness maps (was 512)
const DS = THREE.DoubleSide;

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

function fbm(x: number, y: number, seed: number, octaves = 5): number {
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
  w: number, h: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  repeat?: [number, number],
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  // Enable anisotropic filtering for crisp textures at angles
  t.anisotropy = 4;
  return t;
}

// ─── Sobel Normal Map from Height Canvas ──────────────────────────────────────

function heightToNormalMap(
  heightCanvas: HTMLCanvasElement,
  strength: number = 2.0,
  repeat?: [number, number],
): THREE.CanvasTexture {
  const w = heightCanvas.width, h = heightCanvas.height;
  const src = heightCanvas.getContext("2d")!.getImageData(0, 0, w, h).data;

  const normalCanvas = document.createElement("canvas");
  normalCanvas.width = w; normalCanvas.height = h;
  const ctx = normalCanvas.getContext("2d")!;
  const out = ctx.createImageData(w, h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      // Sobel filter — sample 8 neighbors (wrapping)
      const tl = src[((((y - 1) + h) % h) * w + ((x - 1) + w) % w) * 4] / 255;
      const t = src[((((y - 1) + h) % h) * w + x) * 4] / 255;
      const tr = src[((((y - 1) + h) % h) * w + (x + 1) % w) * 4] / 255;
      const l = src[(y * w + ((x - 1) + w) % w) * 4] / 255;
      const r = src[(y * w + (x + 1) % w) * 4] / 255;
      const bl = src[(((y + 1) % h) * w + ((x - 1) + w) % w) * 4] / 255;
      const b = src[(((y + 1) % h) * w + x) * 4] / 255;
      const br = src[(((y + 1) % h) * w + (x + 1) % w) * 4] / 255;

      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);

      const nx = -dx * strength;
      const ny = -dy * strength;
      const nz = 1.0;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);

      out.data[idx] = ((nx / len) * 0.5 + 0.5) * 255;
      out.data[idx + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      out.data[idx + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      out.data[idx + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);

  const t = new THREE.CanvasTexture(normalCanvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  return t;
}

// ─── Height Map from Noise (for normal map conversion) ───────────────────────

function noiseHeightCanvas(
  size: number, scale: number, seed: number, octaves = 5,
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, size, size);
  const d = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < d.data.length; i += 4) {
    const px = (i / 4) % size, py = Math.floor(i / 4 / size);
    const n = fbm(px * scale, py * scale, seed, octaves);
    const v = Math.floor(n * 255);
    d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
  }
  ctx.putImageData(d, 0, 0);
  return canvas;
}

// ─── Roughness Map from Noise ────────────────────────────────────────────────

function noiseRoughnessMap(
  baseRoughness: number, variation: number,
  scale: number, seed: number,
  repeat?: [number, number],
): THREE.CanvasTexture {
  return tex(BUMP_SIZE, BUMP_SIZE, (ctx, w, h) => {
    const base = Math.round(baseRoughness * 255);
    ctx.fillStyle = `rgb(${base},${base},${base})`;
    ctx.fillRect(0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h);
    for (let i = 0; i < d.data.length; i += 4) {
      const px = (i / 4) % w, py = Math.floor(i / 4 / w);
      const n = fbm(px * scale, py * scale, seed, 4);
      const v = Math.max(0, Math.min(255, base + (n - 0.5) * variation * 255));
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
    }
    ctx.putImageData(d, 0, 0);
  }, repeat);
}

// ─── Concrete Texture (1024px) ────────────────────────────────────────────────

function concreteTex(base: string, repeat?: [number, number]): THREE.CanvasTexture {
  return tex(TEX_SIZE, TEX_SIZE, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h);
    for (let i = 0; i < d.data.length; i += 4) {
      const px = (i / 4) % w, py = Math.floor(i / 4 / w);
      const n = fbm(px * 0.015, py * 0.015, 42, 6);
      const v = (n - 0.5) * 50;
      d.data[i] = Math.max(0, Math.min(255, d.data[i] + v));
      d.data[i + 1] = Math.max(0, Math.min(255, d.data[i + 1] + v));
      d.data[i + 2] = Math.max(0, Math.min(255, d.data[i + 2] + v));
    }
    ctx.putImageData(d, 0, 0);
    // Formwork seams + tie holes
    for (let i = 0; i < 6; i++) {
      const y = (i + 1) * (h / 7) + (Math.random() - 0.5) * 12;
      ctx.strokeStyle = `rgba(80, 75, 65, ${0.06 + Math.random() * 0.08})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y + (Math.random() - 0.5) * 4); ctx.stroke();
    }
    // Aggregate specks
    for (let i = 0; i < 200; i++) {
      const sx = Math.random() * w, sy = Math.random() * h;
      ctx.fillStyle = `rgba(${100 + Math.random() * 60}, ${90 + Math.random() * 50}, ${80 + Math.random() * 40}, ${0.1 + Math.random() * 0.1})`;
      ctx.fillRect(sx, sy, 1 + Math.random() * 3, 1 + Math.random() * 3);
    }
  }, repeat);
}

// ─── Plaster / Stucco Texture (1024px) ────────────────────────────────────────

function plasterTex(base: string, repeat?: [number, number]): THREE.CanvasTexture {
  return tex(TEX_SIZE, TEX_SIZE, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h);
    for (let i = 0; i < d.data.length; i += 4) {
      const px = (i / 4) % w, py = Math.floor(i / 4 / w);
      const n1 = fbm(px * 0.03, py * 0.03, 17, 5);
      const n2 = fbm(px * 0.1, py * 0.1, 29, 3);
      const v = (n1 - 0.5) * 30 + (n2 - 0.5) * 12;
      d.data[i] = Math.max(0, Math.min(255, d.data[i] + v));
      d.data[i + 1] = Math.max(0, Math.min(255, d.data[i + 1] + v));
      d.data[i + 2] = Math.max(0, Math.min(255, d.data[i + 2] + v - 3));
    }
    ctx.putImageData(d, 0, 0);
  }, repeat);
}

// ─── Wood Texture (1024px) ────────────────────────────────────────────────────

function woodTex(tint: string, repeat?: [number, number]): THREE.CanvasTexture {
  return tex(TEX_SIZE, TEX_SIZE, (ctx, w, h) => {
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 160; i++) {
      const y = (i / 160) * h;
      ctx.strokeStyle = `rgba(40, 20, 0, ${0.05 + Math.random() * 0.1})`;
      ctx.lineWidth = 0.5 + Math.random() * 3;
      ctx.beginPath(); ctx.moveTo(0, y);
      for (let x = 0; x < w; x += 3) {
        ctx.lineTo(x, y + Math.sin((x * 0.012 + i * 0.25)) * 3 + (Math.random() - 0.5) * 1);
      }
      ctx.stroke();
    }
    for (let k = 0; k < 3; k++) {
      const kx = Math.random() * w, ky = Math.random() * h, kr = 4 + Math.random() * 8;
      const g = ctx.createRadialGradient(kx, ky, 0, kx, ky, kr);
      g.addColorStop(0, "rgba(50, 25, 5, 0.35)");
      g.addColorStop(1, "rgba(50, 25, 5, 0)");
      ctx.fillStyle = g;
      ctx.fillRect(kx - kr, ky - kr, kr * 2, kr * 2);
    }
  }, repeat);
}

// ─── Brick Texture (1024px) ───────────────────────────────────────────────────

function brickTex(repeat?: [number, number]): THREE.CanvasTexture {
  return tex(TEX_SIZE, TEX_SIZE / 2, (ctx, w, h) => {
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

// ─── Brushed Metal Texture (1024px) ───────────────────────────────────────────

function brushedMetalTex(repeat?: [number, number]): THREE.CanvasTexture {
  return tex(TEX_SIZE / 2, TEX_SIZE / 2, (ctx, w, h) => {
    ctx.fillStyle = "#A8A8A8";
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 500; i++) {
      const y = Math.random() * h;
      ctx.strokeStyle = `rgba(${140 + Math.random() * 80}, ${140 + Math.random() * 80}, ${140 + Math.random() * 80}, ${0.04 + Math.random() * 0.06})`;
      ctx.lineWidth = 0.3 + Math.random();
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y + (Math.random() - 0.5) * 1.5); ctx.stroke();
    }
  }, repeat);
}

// ─── Grass Texture (1024px) ───────────────────────────────────────────────────

function grassTex(repeat?: [number, number]): THREE.CanvasTexture {
  return tex(TEX_SIZE, TEX_SIZE, (ctx, w, h) => {
    ctx.fillStyle = "#2D5A16";
    ctx.fillRect(0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h);
    for (let i = 0; i < d.data.length; i += 4) {
      const px = (i / 4) % w, py = Math.floor(i / 4 / w);
      const n1 = fbm(px * 0.03, py * 0.03, 33, 6);
      const n2 = fbm(px * 0.12, py * 0.12, 77, 3);
      d.data[i] = Math.max(0, Math.min(255, d.data[i] + (n1 - 0.5) * 40 + (n2 - 0.5) * 15));
      d.data[i + 1] = Math.max(0, Math.min(255, d.data[i + 1] + (n1 - 0.5) * 60 + (n2 - 0.5) * 25));
      d.data[i + 2] = Math.max(0, Math.min(255, d.data[i + 2] + (n1 - 0.5) * 15));
    }
    ctx.putImageData(d, 0, 0);
    for (let i = 0; i < 800; i++) {
      const gx = Math.random() * w, gy = Math.random() * h;
      ctx.strokeStyle = `rgba(80, ${140 + Math.random() * 60}, 30, ${0.1 + Math.random() * 0.15})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx + (Math.random() - 0.5) * 3, gy - 2 - Math.random() * 7); ctx.stroke();
    }
  }, repeat);
}

// ─── Roof Membrane Texture (1024px) ──────────────────────────────────────────

function roofTex(repeat?: [number, number]): THREE.CanvasTexture {
  return tex(TEX_SIZE, TEX_SIZE, (ctx, w, h) => {
    ctx.fillStyle = "#3A3A3C";
    ctx.fillRect(0, 0, w, h);
    const d = ctx.getImageData(0, 0, w, h);
    for (let i = 0; i < d.data.length; i += 4) {
      const px = (i / 4) % w, py = Math.floor(i / 4 / w);
      const n = fbm(px * 0.025, py * 0.025, 88, 5);
      const v = (n - 0.5) * 35;
      d.data[i] = Math.max(0, Math.min(255, d.data[i] + v));
      d.data[i + 1] = Math.max(0, Math.min(255, d.data[i + 1] + v));
      d.data[i + 2] = Math.max(0, Math.min(255, d.data[i + 2] + v));
    }
    ctx.putImageData(d, 0, 0);
    for (let i = 0; i < 4; i++) {
      const x = (i + 1) * (w / 5);
      ctx.strokeStyle = "rgba(55, 55, 58, 0.5)";
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + (Math.random() - 0.5) * 6, h); ctx.stroke();
    }
  }, repeat);
}

// ─── Sky Environment Texture (2048px for richer HDRI) ────────────────────────

export function createSkyTexture(): THREE.CanvasTexture {
  return tex(2048, 1024, (ctx, w, h) => {
    // Golden-hour sky gradient — rich warm tones
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "#1A3A8A");     // Zenith — deep blue
    grad.addColorStop(0.15, "#3868B8");
    grad.addColorStop(0.3, "#6A98CC");
    grad.addColorStop(0.45, "#A0C0D8");
    grad.addColorStop(0.55, "#C8D8E0");
    grad.addColorStop(0.65, "#E8D8C0");  // Warm transition
    grad.addColorStop(0.73, "#F5C880");  // Golden band
    grad.addColorStop(0.80, "#F0A850");  // Deep golden horizon
    grad.addColorStop(0.87, "#E08840");  // Orange horizon glow
    grad.addColorStop(0.93, "#C07040");  // Warm earth
    grad.addColorStop(1.0, "#5A6A3A");   // Ground
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Sun disc — lower position, larger, warmer for golden hour
    const sunX = w * 0.68, sunY = h * 0.52; // Lower sun = golden hour
    // Ultra-wide atmospheric scatter
    const scatter = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 350);
    scatter.addColorStop(0, "rgba(255, 220, 140, 0.3)");
    scatter.addColorStop(0.3, "rgba(255, 200, 120, 0.12)");
    scatter.addColorStop(0.6, "rgba(255, 180, 100, 0.04)");
    scatter.addColorStop(1, "rgba(255, 160, 80, 0)");
    ctx.fillStyle = scatter;
    ctx.fillRect(sunX - 350, sunY - 350, 700, 700);
    // Wide warm glow
    const atmo = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 160);
    atmo.addColorStop(0, "rgba(255, 240, 200, 0.7)");
    atmo.addColorStop(0.25, "rgba(255, 220, 160, 0.3)");
    atmo.addColorStop(0.6, "rgba(255, 200, 130, 0.08)");
    atmo.addColorStop(1, "rgba(255, 180, 100, 0)");
    ctx.fillStyle = atmo;
    ctx.fillRect(sunX - 160, sunY - 160, 320, 320);
    // Tight bright glow
    const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 50);
    glow.addColorStop(0, "rgba(255, 255, 240, 0.95)");
    glow.addColorStop(0.3, "rgba(255, 248, 220, 0.5)");
    glow.addColorStop(0.7, "rgba(255, 235, 190, 0.15)");
    glow.addColorStop(1, "rgba(255, 220, 160, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(sunX - 50, sunY - 50, 100, 100);
    // Core — intense white-gold
    const core = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 18);
    core.addColorStop(0, "rgba(255, 255, 250, 1.0)");
    core.addColorStop(0.5, "rgba(255, 250, 230, 0.7)");
    core.addColorStop(1, "rgba(255, 245, 210, 0)");
    ctx.fillStyle = core;
    ctx.fillRect(sunX - 20, sunY - 20, 40, 40);

    // Horizontal glow band across horizon (atmospheric scattering)
    const horizonBand = ctx.createLinearGradient(0, h * 0.7, 0, h * 0.88);
    horizonBand.addColorStop(0, "rgba(255, 200, 120, 0)");
    horizonBand.addColorStop(0.3, "rgba(255, 190, 100, 0.08)");
    horizonBand.addColorStop(0.5, "rgba(255, 180, 90, 0.12)");
    horizonBand.addColorStop(0.7, "rgba(255, 170, 80, 0.06)");
    horizonBand.addColorStop(1, "rgba(255, 160, 70, 0)");
    ctx.fillStyle = horizonBand;
    ctx.fillRect(0, h * 0.7, w, h * 0.18);

    // Volumetric clouds — golden-lit, more dramatic
    for (let i = 0; i < 20; i++) {
      const cx = Math.random() * w;
      const cy = h * 0.08 + Math.random() * h * 0.45;
      const cw = 100 + Math.random() * 280;
      const ch = 12 + Math.random() * 35;
      // Distance from sun affects cloud color (lit vs shadow side)
      const distFromSun = Math.sqrt((cx - sunX) ** 2 + (cy - sunY) ** 2) / w;
      const isLit = distFromSun < 0.3;
      // Multiple overlapping ellipses for volume
      for (let j = 0; j < 4; j++) {
        const ox = (Math.random() - 0.5) * cw * 0.5;
        const oy = (Math.random() - 0.5) * ch * 0.6;
        const alpha = isLit
          ? 0.04 + Math.random() * 0.1   // Brighter near sun
          : 0.02 + Math.random() * 0.05;
        const r = isLit ? 255 : 240;
        const g = isLit ? 240 + Math.random() * 15 : 240;
        const b = isLit ? 200 + Math.random() * 30 : 245;
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
        ctx.beginPath();
        ctx.ellipse(cx + ox, cy + oy, cw * (0.5 + Math.random() * 0.5), ch * (0.4 + Math.random() * 0.6), 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Material Library v3 — Real PBR Textures from /public/textures/ + Fallback
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

// ─── Real Texture Loader Helper ─────────────────────────────────────────────

const textureLoader = new THREE.TextureLoader();

function loadPBR(
  folder: string,
  repeat: [number, number] = [2, 2],
  opts?: { hasAO?: boolean; hasMetalness?: boolean },
): {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
  aoMap?: THREE.Texture;
  metalnessMap?: THREE.Texture;
} {
  const base = `/textures/${folder}`;

  function load(file: string): THREE.Texture {
    const t = textureLoader.load(`${base}/${file}`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
    t.anisotropy = 4;
    t.colorSpace = file === "albedo.jpg" ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
    return t;
  }

  const result: ReturnType<typeof loadPBR> = {
    map: load("albedo.jpg"),
    normalMap: load("normal.jpg"),
    roughnessMap: load("roughness.jpg"),
  };
  if (opts?.hasAO) result.aoMap = load("ao.jpg");
  if (opts?.hasMetalness) result.metalnessMap = load("metalness.jpg");
  return result;
}

export function createBIMMaterials(): BIMMaterialLib {
  // ── Load real PBR textures from /public/textures/ ──
  const plasterPBR = loadPBR("plaster", [2, 2]);
  const brickPBR = loadPBR("brick", [3, 3], { hasAO: true });
  const concretePBR = loadPBR("concrete", [2, 2]);
  const woodPBR = loadPBR("wood", [1, 2]);
  const metalPBR = loadPBR("metal-aluminum", [3, 3], { hasMetalness: true });
  const grassPBR = loadPBR("grass", [25, 25], { hasAO: true });
  const roofPBR = loadPBR("roof-membrane", [2, 2]);
  const stonePBR = loadPBR("stone", [2, 2], { hasAO: true });
  const pavementPBR = loadPBR("pavement", [4, 4], { hasAO: true });

  // Procedural fallbacks for materials without real textures
  const metalNormal = heightToNormalMap(noiseHeightCanvas(BUMP_SIZE, 0.1, 44, 3), 0.8, [3, 3]);
  const metalRoughness = noiseRoughnessMap(0.3, 0.15, 0.08, 66, [3, 3]);

  return {
    // ── Walls — real plaster PBR ──
    wall: new THREE.MeshStandardMaterial({
      ...plasterPBR, side: DS, roughness: 0.78, metalness: 0.0,
      normalScale: new THREE.Vector2(1.2, 1.2),
      envMapIntensity: 0.5,
    }),
    wallInterior: new THREE.MeshStandardMaterial({
      ...plasterPBR, side: DS, roughness: 0.88, metalness: 0.0,
      normalScale: new THREE.Vector2(0.5, 0.5),
      envMapIntensity: 0.3,
    }),
    wallExterior: new THREE.MeshStandardMaterial({
      ...brickPBR, side: DS, roughness: 0.82, metalness: 0.0,
      normalScale: new THREE.Vector2(1.8, 1.8),
      envMapIntensity: 0.4,
    }),

    // ── Slabs / Floors — real concrete PBR ──
    slab: new THREE.MeshStandardMaterial({
      ...concretePBR, side: DS, roughness: 0.68, metalness: 0.03,
      normalScale: new THREE.Vector2(1.4, 1.4),
      envMapIntensity: 0.5,
    }),

    // ── Roof — real roof membrane PBR ──
    roof: new THREE.MeshStandardMaterial({
      ...roofPBR, side: DS, roughness: 0.6, metalness: 0.15,
      normalScale: new THREE.Vector2(1.2, 1.2),
      envMapIntensity: 0.6,
    }),

    // ── Glass — dark reflective curtain-wall glass ──
    window: new THREE.MeshPhysicalMaterial({
      color: 0x3A6888,
      transparent: true,
      opacity: 0.65,
      side: DS,
      roughness: 0.03,
      metalness: 0.15,
      transmission: 0.25,
      reflectivity: 0.98,
      ior: 1.52,
      thickness: 0.8,
      envMapIntensity: 3.5,
      clearcoat: 1.0,
      clearcoatRoughness: 0.01,
      specularIntensity: 1.2,
      specularColor: new THREE.Color(0xFFEEDD),
      emissive: 0x102030,
      emissiveIntensity: 0.08,
    }),

    // ── Door — real wood PBR ──
    door: new THREE.MeshStandardMaterial({
      ...woodPBR, side: DS, roughness: 0.45, metalness: 0.0,
      normalScale: new THREE.Vector2(1.0, 1.0),
      envMapIntensity: 0.6,
    }),

    // ── Column — real concrete PBR (polished) ──
    column: new THREE.MeshStandardMaterial({
      ...concretePBR, side: DS, roughness: 0.5, metalness: 0.15,
      normalScale: new THREE.Vector2(1.0, 1.0),
      envMapIntensity: 0.8,
    }),

    // ── Beam — real brushed aluminum PBR ──
    beam: new THREE.MeshStandardMaterial({
      ...metalPBR, side: DS, roughness: 0.35, metalness: 0.88,
      normalScale: new THREE.Vector2(0.5, 0.5),
      envMapIntensity: 1.3,
    }),

    // ── Stair — real stone PBR ──
    stair: new THREE.MeshStandardMaterial({
      ...stonePBR, side: DS, roughness: 0.55, metalness: 0.02,
      normalScale: new THREE.Vector2(1.0, 1.0),
      envMapIntensity: 0.5,
    }),

    // ── Space (interior volume) ──
    space: new THREE.MeshStandardMaterial({
      color: 0xF0EDE8, side: DS, roughness: 0.95, metalness: 0.0,
      transparent: true, opacity: 0.15, depthWrite: false,
    }),

    // ── Parapet — real stone PBR ──
    parapet: new THREE.MeshStandardMaterial({
      ...stonePBR, side: DS, roughness: 0.65, metalness: 0.02,
      normalScale: new THREE.Vector2(0.8, 0.8),
      envMapIntensity: 0.5,
    }),
    // ── Canopy — real concrete ──
    canopy: new THREE.MeshStandardMaterial({
      ...concretePBR, side: DS, roughness: 0.5, metalness: 0.2,
      envMapIntensity: 0.8,
    }),
    // ── Balcony — real concrete with glass railing feel ──
    balcony: new THREE.MeshStandardMaterial({
      ...concretePBR, side: DS, roughness: 0.55, metalness: 0.15,
      envMapIntensity: 0.7,
    }),

    // ── MEP — real aluminum metal ──
    duct: new THREE.MeshStandardMaterial({
      ...metalPBR, side: DS, roughness: 0.2, metalness: 0.88,
      normalScale: new THREE.Vector2(0.3, 0.3),
      envMapIntensity: 1.5,
    }),
    pipe: new THREE.MeshStandardMaterial({
      color: 0x3A8A5A, side: DS, roughness: 0.25, metalness: 0.75,
      normalMap: metalNormal, normalScale: new THREE.Vector2(0.3, 0.3),
      roughnessMap: metalRoughness,
      envMapIntensity: 1.3,
    }),
    cableTray: new THREE.MeshStandardMaterial({
      color: 0xCCA020, side: DS, roughness: 0.3, metalness: 0.65,
      normalMap: metalNormal, normalScale: new THREE.Vector2(0.2, 0.2),
    }),
    equipment: new THREE.MeshStandardMaterial({
      color: 0x5080B0, side: DS, roughness: 0.3, metalness: 0.65,
      envMapIntensity: 1.0,
    }),

    // ── Ground — real grass PBR with AO ──
    ground: new THREE.MeshStandardMaterial({
      ...grassPBR, side: DS, roughness: 0.85, metalness: 0.0,
      normalScale: new THREE.Vector2(0.8, 0.8),
      envMapIntensity: 0.3,
    }),

    // ── Facade detail — polished aluminum mullion ──
    mullion: new THREE.MeshStandardMaterial({
      ...metalPBR, side: DS, roughness: 0.12, metalness: 0.95,
      envMapIntensity: 2.5,
      emissive: 0xFFDDCC,
      emissiveIntensity: 0.06,
      normalScale: new THREE.Vector2(0.2, 0.2),
    }),
    // ── Dark spandrel panel ──
    spandrel: new THREE.MeshStandardMaterial({
      color: 0x181820, side: DS, roughness: 0.18, metalness: 0.88,
      envMapIntensity: 1.8,
      emissive: 0x101018,
      emissiveIntensity: 0.04,
    }),

    // ── Landscaping ──
    treeCrown: new THREE.MeshStandardMaterial({
      color: 0x2D6B1E, side: DS, roughness: 0.82, metalness: 0.0,
      emissive: 0x1A3A0A,
      emissiveIntensity: 0.05,
      envMapIntensity: 0.4,
    }),
    treeTrunk: new THREE.MeshStandardMaterial({
      ...woodPBR, side: DS, roughness: 0.75, metalness: 0.0,
      envMapIntensity: 0.3,
    }),
  };
}

/**
 * Get the appropriate material key for a BIM element type.
 */
export function getMaterialKey(elementType: string, isExterior?: boolean): keyof BIMMaterialLib {
  switch (elementType) {
    case "wall":       return isExterior ? "wallExterior" : "wall";
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
      const m = mat as THREE.MeshStandardMaterial;
      if (m.map) m.map.dispose();
      if (m.normalMap) m.normalMap.dispose();
      if (m.roughnessMap) m.roughnessMap.dispose();
      if (m.aoMap) m.aoMap.dispose();
      if (m.metalnessMap) m.metalnessMap.dispose();
      mat.dispose();
    }
  }
}
