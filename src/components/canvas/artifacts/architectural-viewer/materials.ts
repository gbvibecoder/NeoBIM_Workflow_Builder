import * as THREE from "three";

// ─── Procedural Texture Generators ────────────────────────────────────────────

function createCanvasTexture(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void
): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  draw(ctx, width, height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Seeded simple noise
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

function fbmNoise(x: number, y: number, seed: number, octaves = 4): number {
  let val = 0, amp = 0.5, freq = 1;
  for (let i = 0; i < octaves; i++) {
    val += smoothNoise(x * freq, y * freq, seed + i * 100) * amp;
    amp *= 0.5;
    freq *= 2;
  }
  return val;
}

// ─── Wood Texture ─────────────────────────────────────────────────────────────

export function createWoodTexture(
  tint: string = "#8B6914",
  scale = 1
): THREE.CanvasTexture {
  return createCanvasTexture(512, 512, (ctx, w, h) => {
    // Base color
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, w, h);

    // Wood grain - horizontal wavy lines
    for (let i = 0; i < 120; i++) {
      const y = (i / 120) * h;
      const darkness = 0.08 + Math.random() * 0.12;
      ctx.strokeStyle = `rgba(40, 20, 0, ${darkness})`;
      ctx.lineWidth = 0.5 + Math.random() * 2.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x < w; x += 4) {
        const wave = Math.sin((x * 0.015 + i * 0.3) * scale) * 3;
        const jitter = (Math.random() - 0.5) * 1.5;
        ctx.lineTo(x, y + wave + jitter);
      }
      ctx.stroke();
    }

    // Occasional knots
    for (let k = 0; k < 3; k++) {
      const kx = Math.random() * w;
      const ky = Math.random() * h;
      const kr = 4 + Math.random() * 8;
      const grad = ctx.createRadialGradient(kx, ky, 0, kx, ky, kr);
      grad.addColorStop(0, "rgba(60, 30, 5, 0.3)");
      grad.addColorStop(0.5, "rgba(60, 30, 5, 0.15)");
      grad.addColorStop(1, "rgba(60, 30, 5, 0)");
      ctx.fillStyle = grad;
      ctx.fillRect(kx - kr, ky - kr, kr * 2, kr * 2);
    }
  });
}

// ─── Concrete Texture ─────────────────────────────────────────────────────────

export function createConcreteTexture(
  baseColor: string = "#B0AAA0"
): THREE.CanvasTexture {
  return createCanvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, w, h);

    // Noise grain
    const imgData = ctx.getImageData(0, 0, w, h);
    for (let i = 0; i < imgData.data.length; i += 4) {
      const px = (i / 4) % w;
      const py = Math.floor(i / 4 / w);
      const n = fbmNoise(px * 0.02, py * 0.02, 42, 5);
      const variation = (n - 0.5) * 40;
      imgData.data[i] = Math.max(0, Math.min(255, imgData.data[i] + variation));
      imgData.data[i + 1] = Math.max(0, Math.min(255, imgData.data[i + 1] + variation));
      imgData.data[i + 2] = Math.max(0, Math.min(255, imgData.data[i + 2] + variation));
    }
    ctx.putImageData(imgData, 0, 0);

    // Subtle form lines (formwork seams)
    for (let i = 0; i < 4; i++) {
      const y = (i + 1) * (h / 5) + (Math.random() - 0.5) * 10;
      ctx.strokeStyle = `rgba(100, 90, 80, ${0.1 + Math.random() * 0.1})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y + (Math.random() - 0.5) * 3);
      ctx.stroke();
    }
  });
}

// ─── Tile Texture ─────────────────────────────────────────────────────────────

export function createTileTexture(
  tileColor: string = "#E8E0D0",
  groutColor: string = "#C8C0B0",
  tileSize = 64
): THREE.CanvasTexture {
  return createCanvasTexture(512, 512, (ctx, w, h) => {
    // Grout background
    ctx.fillStyle = groutColor;
    ctx.fillRect(0, 0, w, h);

    // Tiles
    const grout = 3;
    for (let tx = 0; tx < w; tx += tileSize) {
      for (let ty = 0; ty < h; ty += tileSize) {
        const shade = 0.95 + Math.random() * 0.1;
        const c = new THREE.Color(tileColor);
        c.multiplyScalar(shade);
        ctx.fillStyle = `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
        ctx.fillRect(tx + grout, ty + grout, tileSize - grout * 2, tileSize - grout * 2);
      }
    }
  });
}

// ─── Marble Texture ───────────────────────────────────────────────────────────

export function createMarbleTexture(): THREE.CanvasTexture {
  return createCanvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = "#F0EDE8";
    ctx.fillRect(0, 0, w, h);

    // Veining
    for (let v = 0; v < 8; v++) {
      const startY = Math.random() * h;
      ctx.strokeStyle = `rgba(160, 150, 140, ${0.15 + Math.random() * 0.2})`;
      ctx.lineWidth = 0.5 + Math.random() * 2;
      ctx.beginPath();
      let y = startY;
      for (let x = 0; x < w; x += 3) {
        y += (Math.random() - 0.5) * 4 + Math.sin(x * 0.01 + v) * 2;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Subtle color variation
    const imgData = ctx.getImageData(0, 0, w, h);
    for (let i = 0; i < imgData.data.length; i += 4) {
      const px = (i / 4) % w;
      const py = Math.floor(i / 4 / w);
      const n = fbmNoise(px * 0.01, py * 0.01, 77, 3);
      const tint = (n - 0.5) * 15;
      imgData.data[i] = Math.max(0, Math.min(255, imgData.data[i] + tint));
      imgData.data[i + 1] = Math.max(0, Math.min(255, imgData.data[i + 1] + tint - 2));
      imgData.data[i + 2] = Math.max(0, Math.min(255, imgData.data[i + 2] + tint - 4));
    }
    ctx.putImageData(imgData, 0, 0);
  });
}

// ─── Herringbone Wood Floor ───────────────────────────────────────────────────

export function createHerringboneTexture(): THREE.CanvasTexture {
  return createCanvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = "#3A2810";
    ctx.fillRect(0, 0, w, h);

    const plankW = 20, plankH = 80;
    const colors = ["#8B6914", "#7A5C12", "#9B7924", "#6B4E10", "#A08530"];

    for (let row = -1; row < h / plankH + 1; row++) {
      for (let col = -1; col < w / plankW + 1; col++) {
        const isEven = (row + col) % 2 === 0;
        const x = col * plankW;
        const y = row * plankH;

        ctx.save();
        ctx.translate(x + plankW / 2, y + plankH / 2);
        if (!isEven) ctx.rotate(Math.PI / 2);

        const color = colors[Math.floor(Math.random() * colors.length)];
        const shade = 0.9 + Math.random() * 0.2;
        const c = new THREE.Color(color).multiplyScalar(shade);
        ctx.fillStyle = `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
        ctx.fillRect(-plankW / 2 + 1, -plankH / 2 + 1, plankW - 2, plankH - 2);

        // Grain lines
        for (let g = 0; g < 6; g++) {
          const gy = -plankH / 2 + Math.random() * plankH;
          ctx.strokeStyle = `rgba(30, 15, 0, ${0.08 + Math.random() * 0.08})`;
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(-plankW / 2 + 2, gy);
          ctx.lineTo(plankW / 2 - 2, gy + (Math.random() - 0.5) * 2);
          ctx.stroke();
        }

        ctx.restore();
      }
    }
  });
}

// ─── Brick Texture ────────────────────────────────────────────────────────────

export function createBrickTexture(): THREE.CanvasTexture {
  return createCanvasTexture(512, 256, (ctx, w, h) => {
    ctx.fillStyle = "#8A8078";
    ctx.fillRect(0, 0, w, h);

    const brickW = 64, brickH = 32, mortar = 3;
    const brickColors = ["#A0543C", "#964830", "#B86048", "#8C4028", "#C07050"];

    for (let row = 0; row < h / brickH + 1; row++) {
      const offset = row % 2 === 0 ? 0 : brickW / 2;
      for (let col = -1; col < w / brickW + 2; col++) {
        const x = col * brickW + offset;
        const y = row * brickH;
        const color = brickColors[Math.floor(Math.random() * brickColors.length)];
        const shade = 0.85 + Math.random() * 0.3;
        const c = new THREE.Color(color).multiplyScalar(shade);
        ctx.fillStyle = `rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`;
        ctx.fillRect(x + mortar, y + mortar, brickW - mortar * 2, brickH - mortar * 2);
      }
    }
  });
}

// ─── Fabric / Carpet Texture ──────────────────────────────────────────────────

export function createFabricTexture(color: string = "#4A5568"): THREE.CanvasTexture {
  return createCanvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);

    const imgData = ctx.getImageData(0, 0, w, h);
    for (let i = 0; i < imgData.data.length; i += 4) {
      const px = (i / 4) % w;
      const py = Math.floor(i / 4 / w);
      // Weave pattern
      const weave = ((px + py) % 4 < 2 ? 1 : -1) * 8;
      const grain = (Math.random() - 0.5) * 12;
      imgData.data[i] = Math.max(0, Math.min(255, imgData.data[i] + weave + grain));
      imgData.data[i + 1] = Math.max(0, Math.min(255, imgData.data[i + 1] + weave + grain));
      imgData.data[i + 2] = Math.max(0, Math.min(255, imgData.data[i + 2] + weave + grain));
    }
    ctx.putImageData(imgData, 0, 0);
  });
}

// ─── Material Library ─────────────────────────────────────────────────────────

export interface MaterialLibrary {
  [key: string]: THREE.Material;
  herringboneFloor: THREE.Material;
  concreteFloor: THREE.Material;
  tileFloor: THREE.Material;
  marbleFloor: THREE.Material;
  whiteWall: THREE.Material;
  concreteWall: THREE.Material;
  accentWall: THREE.Material;
  exteriorWall: THREE.Material;
  glass: THREE.Material;
  darkGlass: THREE.Material;
  metal: THREE.Material;
  brushedMetal: THREE.Material;
  wood: THREE.Material;
  darkWood: THREE.Material;
  fabric: THREE.Material;
  fabricDark: THREE.Material;
  leather: THREE.Material;
  ceiling: THREE.Material;
  roofTop: THREE.Material;
  grass: THREE.Material;
  water: THREE.Material;
  emissiveWarm: THREE.Material;
  emissiveCool: THREE.Material;
  stoneWall: THREE.Material;
  terracottaWall: THREE.Material;
}

function createBumpMap(scale = 0.03): THREE.CanvasTexture {
  return createCanvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = "#808080";
    ctx.fillRect(0, 0, w, h);
    const imgData = ctx.getImageData(0, 0, w, h);
    for (let i = 0; i < imgData.data.length; i += 4) {
      const px = (i / 4) % w;
      const py = Math.floor(i / 4 / w);
      const n = fbmNoise(px * scale, py * scale, 55, 4);
      const v = Math.floor(n * 255);
      imgData.data[i] = imgData.data[i + 1] = imgData.data[i + 2] = v;
    }
    ctx.putImageData(imgData, 0, 0);
  });
}

export function createMaterials(): MaterialLibrary {
  const herringboneTex = createHerringboneTexture();
  herringboneTex.repeat.set(3, 3);

  const concreteTex = createConcreteTexture();
  concreteTex.repeat.set(2, 2);

  const concreteBump = createBumpMap(0.04);
  concreteBump.repeat.set(2, 2);

  const tileTex = createTileTexture();
  tileTex.repeat.set(4, 4);

  const marbleTex = createMarbleTexture();
  marbleTex.repeat.set(2, 2);

  const woodTex = createWoodTexture("#8B6914");
  woodTex.repeat.set(2, 1);

  const darkWoodTex = createWoodTexture("#4A3210");
  darkWoodTex.repeat.set(2, 1);

  const brickTex = createBrickTexture();
  brickTex.repeat.set(4, 4);

  const wallConcreteTex = createConcreteTexture("#D8D4CC");
  wallConcreteTex.repeat.set(1, 1);

  const fabricTex = createFabricTexture("#6B7B8D");
  const fabricDarkTex = createFabricTexture("#2D3748");

  const grassTex = createCanvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = "#2D5016";
    ctx.fillRect(0, 0, w, h);
    const imgData = ctx.getImageData(0, 0, w, h);
    for (let i = 0; i < imgData.data.length; i += 4) {
      const px = (i / 4) % w;
      const py = Math.floor(i / 4 / w);
      const n = fbmNoise(px * 0.05, py * 0.05, 33, 4);
      imgData.data[i] = Math.max(0, Math.min(255, imgData.data[i] + (n - 0.5) * 30));
      imgData.data[i + 1] = Math.max(0, Math.min(255, imgData.data[i + 1] + (n - 0.5) * 50));
      imgData.data[i + 2] = Math.max(0, Math.min(255, imgData.data[i + 2] + (n - 0.5) * 20));
    }
    ctx.putImageData(imgData, 0, 0);
  });
  grassTex.repeat.set(20, 20);

  // MeshBasicMaterial — guaranteed to render on all GPUs (no PBR shader dependency)
  const DS = THREE.DoubleSide;

  return {
    herringboneFloor: new THREE.MeshBasicMaterial({ map: herringboneTex, side: DS }),
    concreteFloor: new THREE.MeshBasicMaterial({ map: concreteTex, side: DS }),
    tileFloor: new THREE.MeshBasicMaterial({ map: tileTex, side: DS }),
    marbleFloor: new THREE.MeshBasicMaterial({ map: marbleTex, side: DS }),
    whiteWall: new THREE.MeshBasicMaterial({ color: 0xF5F0EB, side: DS }),
    concreteWall: new THREE.MeshBasicMaterial({ map: wallConcreteTex, side: DS }),
    accentWall: new THREE.MeshBasicMaterial({ map: darkWoodTex, side: DS }),
    exteriorWall: new THREE.MeshBasicMaterial({ map: brickTex, side: DS }),
    glass: new THREE.MeshBasicMaterial({ color: 0x88BBDD, transparent: true, opacity: 0.3, side: DS }),
    darkGlass: new THREE.MeshBasicMaterial({ color: 0x334455, transparent: true, opacity: 0.4, side: DS }),
    metal: new THREE.MeshBasicMaterial({ color: 0x888888, side: DS }),
    brushedMetal: new THREE.MeshBasicMaterial({ color: 0xAAAAAA, side: DS }),
    wood: new THREE.MeshBasicMaterial({ map: woodTex, side: DS }),
    darkWood: new THREE.MeshBasicMaterial({ map: darkWoodTex, side: DS }),
    fabric: new THREE.MeshBasicMaterial({ map: fabricTex, side: DS }),
    fabricDark: new THREE.MeshBasicMaterial({ map: fabricDarkTex, side: DS }),
    leather: new THREE.MeshBasicMaterial({ color: 0x3A2820, side: DS }),
    ceiling: new THREE.MeshBasicMaterial({ color: 0xFAFAFA, side: DS }),
    roofTop: new THREE.MeshBasicMaterial({ color: 0x404040, side: DS }),
    grass: new THREE.MeshBasicMaterial({ map: grassTex, side: DS }),
    water: new THREE.MeshBasicMaterial({ color: 0x1A6B8A, transparent: true, opacity: 0.7, side: DS }),
    emissiveWarm: new THREE.MeshBasicMaterial({ color: 0xFFD080, side: DS }),
    emissiveCool: new THREE.MeshBasicMaterial({ color: 0xAABBDD, side: DS }),
    stoneWall: new THREE.MeshBasicMaterial({ color: 0xC8BCA8, side: DS }),
    terracottaWall: new THREE.MeshBasicMaterial({ color: 0xB86B4A, side: DS }),
  };
}

export function disposeMaterials(lib: MaterialLibrary) {
  for (const mat of Object.values(lib)) {
    if (mat instanceof THREE.Material) {
      if ("map" in mat && mat.map) (mat.map as THREE.Texture).dispose();
      mat.dispose();
    }
  }
}
