/* ─── Panorama feature — asset manifest ────────────────────────────────────
   Authoritative listing of 360° equirectangular panoramas shipped with the
   build. Every entry must have a matching JPG on disk under
   `public/panoramas/{bucket}/{fileName}`.

   Assets are CC0 from polyhaven.com, downsized to 4K (4096×2048)
   tonemapped JPG. Current total payload ≈ 5 MB across 5 buckets.

   Adding a panorama:
     1. Drop the JPG into `public/panoramas/{bucket}/`.
     2. Append a `PanoramaAsset` entry to `PANORAMA_MANIFEST[bucket]`.
     3. Set `fileSizeBytes` from the on-disk byte count. */

export const PANORAMA_BUCKETS = [
  "residential-apartment",
  "residential-villa",
  "office",
  "retail",
  "industrial",
] as const;

export type PanoramaBucket = (typeof PANORAMA_BUCKETS)[number];

export interface PanoramaAsset {
  /** Stable identifier — part of the asset URL and the dropdown key. */
  slug: string;
  bucket: PanoramaBucket;
  /** Human-readable label rendered in the UI. */
  displayName: string;
  /** File name on disk under `public/panoramas/{bucket}/`. */
  fileName: string;
  /** Byte count on disk — for budget tracking. */
  fileSizeBytes: number;
  /** Optional thumbnail path (small JPG/WebP) for the picker. */
  thumbnail?: string;
  source: "polyhaven";
  license: "CC0";
  /** Free-text attribution shown in the license tooltip. */
  attribution?: string;

  /**
   * Image row of the panorama's visible horizon, normalised to (0..1).
   * 0 = top of image, 0.5 = vertical centre, 1 = bottom. Splits the
   * panorama into two hemispheres for compositing: the dome (upper
   * hemisphere) samples texture rows [0..horizonRow]; the ground disc
   * samples rows [horizonRow..1]. The seam is pixel-perfect when both
   * meshes use the same value. Default 0.5 = camera-level capture.
   */
  horizonRow: number;

  /**
   * Normalised pixel coordinate (0..1, top-left origin) of the point in
   * the panorama where the BIM should appear to stand. `.x` drives the
   * disc UV polar projection's longitude offset; `.y` is reserved for
   * documentation. Default `(0.5, 0.85)` = image-bottom-centre.
   */
  groundAnchorPixelXY: { x: number; y: number };

  /**
   * Multiplier applied to the dome+disc base radius (50 m). Default 1.0
   * (= 50 m radius) suits residential/office BIMs ≤ 30 m diagonal.
   * Smaller for cramped interiors, larger for distant horizons.
   */
  panoramaScale?: number;

  /**
   * World-space XZ offset applied to the BIM model so it does NOT sit at
   * the disc centre (= the panorama photographer's standpoint). Lets
   * compositions like "BIM on a curb with road in front" emerge from
   * panoramas where the photographer was in the middle of a road or
   * paved area. Coordinates are world metres; defaults to `{ x: 0, z: 0 }`.
   */
  bimOffsetXZ?: { x: number; z: number };

  /**
   * @deprecated Vestigial since V7. Earlier versions translated the BIM
   *   `(0, 0, -groundAnchorDistance)` along the camera-forward axis;
   *   V7+ leaves the BIM at world origin and uses `bimOffsetXZ` instead.
   *   Kept optional on the type for backwards compatibility with
   *   pre-V7 fixtures and external manifest snapshots — no production
   *   code path reads it any more. Safe to omit on new entries.
   */
  groundAnchorDistance?: number;
}

/** Human-readable labels for buckets. */
export const PANORAMA_BUCKET_LABELS: Record<PanoramaBucket, string> = {
  "residential-apartment": "Residential apartment",
  "residential-villa": "Residential villa",
  office: "Office",
  retail: "Retail",
  industrial: "Industrial",
};

/** Build the public URL for an asset. Used by the loader. */
export function panoramaUrlFor(asset: PanoramaAsset): string {
  return `/panoramas/${asset.bucket}/${asset.fileName}`;
}

/* All entries are outdoor backdrops with an open foreground (where the
   BIM sits) and clear sky overhead. `horizonRow = 0.5` is correct for a
   level-camera capture; `panoramaScale = 1.0` keeps the dome+disc at
   the 50 m default radius. Per-asset notes call out anything unusual
   (e.g., the office offset that pulls the BIM off the road centre). */
export const PANORAMA_MANIFEST: Record<PanoramaBucket, PanoramaAsset[]> = {
  "residential-apartment": [
    {
      slug: "wide_street_01",
      bucket: "residential-apartment",
      displayName: "Wide Urban Street (Day)",
      fileName: "wide_street_01.jpg",
      fileSizeBytes: 723_766,
      source: "polyhaven",
      license: "CC0",
      attribution: "Sergej Majboroda — polyhaven.com/a/wide_street_01",
      horizonRow: 0.5,
      groundAnchorPixelXY: { x: 0.5, y: 0.85 },
      panoramaScale: 1.0,
    },
  ],
  "residential-villa": [
    {
      slug: "noon_grass",
      bucket: "residential-villa",
      displayName: "Open Meadow (Noon)",
      fileName: "noon_grass.jpg",
      fileSizeBytes: 1_460_524,
      source: "polyhaven",
      license: "CC0",
      attribution: "Sergej Majboroda — polyhaven.com/a/noon_grass",
      /* Trees in the panorama provide visual scale reference — fixes
         the "BIM looks tiny" feel of pure-sky panoramas. */
      horizonRow: 0.5,
      groundAnchorPixelXY: { x: 0.5, y: 0.85 },
      panoramaScale: 1.0,
    },
  ],
  office: [
    {
      slug: "wide_street_02",
      bucket: "office",
      displayName: "Wide Urban Street (Sunlit)",
      fileName: "wide_street_02.jpg",
      fileSizeBytes: 1_370_972,
      source: "polyhaven",
      license: "CC0",
      attribution: "Sergej Majboroda — polyhaven.com/a/wide_street_02",
      horizonRow: 0.5,
      groundAnchorPixelXY: { x: 0.5, y: 0.85 },
      panoramaScale: 1.0,
      /* +Z offset pushes the BIM along the camera's back axis. With
         orbit controls auto-targeting the BIM, the disc centre — the
         panorama photographer's standpoint, the middle of the road —
         ends up between camera and BIM, painted with road texture.
         Reads as "office on the curb with road running past in front". */
      bimOffsetXZ: { x: 0, z: 10 },
    },
  ],
  retail: [
    {
      slug: "mall_parking_lot",
      bucket: "retail",
      displayName: "Mall Parking Lot",
      fileName: "mall_parking_lot.jpg",
      fileSizeBytes: 732_412,
      source: "polyhaven",
      license: "CC0",
      attribution: "Sergej Majboroda — polyhaven.com/a/mall_parking_lot",
      horizonRow: 0.5,
      groundAnchorPixelXY: { x: 0.5, y: 0.85 },
      panoramaScale: 1.0,
    },
  ],
  industrial: [
    {
      slug: "construction_yard",
      bucket: "industrial",
      displayName: "Construction Yard",
      fileName: "construction_yard.jpg",
      fileSizeBytes: 1_100_746,
      source: "polyhaven",
      license: "CC0",
      attribution: "Sergej Majboroda — polyhaven.com/a/construction_yard",
      horizonRow: 0.5,
      groundAnchorPixelXY: { x: 0.5, y: 0.85 },
      panoramaScale: 1.0,
    },
  ],
};
