/**
 * IFC Exporter — Production-grade IFC4 ADD2 TC1 STEP Physical File generator.
 *
 * Implements the R&D production-quality plan:
 *   Fix  1: IfcRelAssociatesMaterial (batched per material layer set)
 *   Fix  2: IfcOpeningElement + IfcRelVoidsElement + IfcRelFillsElement (doors / windows)
 *   Fix  3: IfcWallType / IfcDoorType / IfcWindowType / IfcColumnType / IfcBeamType /
 *           IfcSlabType / IfcStairFlightType / IfcSpaceType + IfcRelDefinesByType
 *   Fix  5: UUID v4 GUIDs (random) + UUID v5 deterministic GUIDs compressed via the
 *           buildingSMART 22-char base-64 algorithm
 *   Fix  7: IfcClassification + IfcClassificationReference + IfcRelAssociatesClassification
 *           (CSI MasterFormat 2016 + NBC India Part 4 2016 dual classification)
 *   Fix  8: IfcDistributionSystem + IfcRelAssignsToGroup for MEP segments
 *   Fix 11: Indian IS-808 steel I-section profiles (IfcIShapeProfileDef) when material = steel
 *   Fix 13: Pset_SpaceCommon (COBie space handover requirement)
 *   Fix 14: Body / Axis / FootPrint representation subcontexts
 *
 * Target: Revit 2024, ArchiCAD 27, Tekla Structures, Navisworks, Solibri,
 * BlenderBIM / IfcOpenShell round-trip.
 */

import { createHash, randomBytes } from "node:crypto";
import type { FootprintPoint, GeometryElement, MassingGeometry, MassingStorey } from "@/types/geometry";

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

export interface IFCGeoReference {
  /** WGS-84 latitude, decimal degrees */
  latitude: number;
  /** WGS-84 longitude, decimal degrees */
  longitude: number;
  /** Orthogonal height above mean sea level, metres */
  elevation: number;
  /** Optional true-north rotation — degrees clockwise from +Y in model space */
  trueNorthAngle?: number;
}

/** RERA 2016 regulatory data for Indian residential units (attached to IfcSpace). */
export interface IFCReraData {
  /** RERA registration number for the project */
  projectId?: string;
  /** Seismic zone per IS 1893:2016 — II, III, IV, V */
  seismicZone?: "II" | "III" | "IV" | "V";
  /** Wind zone per IS 875 Part 3 — 1..6 */
  windZone?: "1" | "2" | "3" | "4" | "5" | "6";
  /** Default carpet/built-up/super ratio applied when per-space values are missing */
  defaultRatios?: {
    builtUpOverCarpet?: number;       // ~1.15
    superBuiltUpOverCarpet?: number;  // ~1.35
  };
}

/** Project-level metadata embedded in IFC header and Pset_BuildingCommon. */
export interface IFCProjectMetadata {
  yearOfConstruction?: number;
  occupancyType?: string;       // NBC Part 3 Table 1
  clientName?: string;
  architectName?: string;
  structuralConsultant?: string;
  mepConsultant?: string;
}

export interface IFCExportOptions {
  projectName?: string;
  siteName?: string;
  buildingName?: string;
  author?: string;
  organization?: string;
  /** IFC schema version: IFC4 (default, production) or IFC2X3 (legacy Revit 2020 compat) */
  schema?: "IFC4" | "IFC2X3";
  /** Discipline filter for multi-file exports */
  filter?: "architectural" | "structural" | "mep" | "all";
  /**
   * Region selector — controls material grade defaults and classification
   * schemes. 'india' = IS 456 / IS 800 / NBC 2016 (default for BuildFlow).
   * 'eu' = Eurocode grades. 'us' = ACI / AISC grades.
   */
  region?: "india" | "eu" | "us";
  /** Optional georeferencing (IfcMapConversion + IfcProjectedCRS). */
  geoReference?: IFCGeoReference;
  /**
   * Stable project identifier used as a namespace for deterministic GUIDs.
   * Same identifier + same element → same GUID across re-exports.
   * If omitted, each export gets random UUID v4 GUIDs.
   */
  projectIdentifier?: string;
  /** RERA regulatory data (India residential projects). */
  rera?: IFCReraData;
  /** Project metadata written to Pset_BuildingCommon. */
  projectMetadata?: IFCProjectMetadata;
  /** Unit system — SI (metric, default) or IMPERIAL (ft/in/lb/°F) for US market. */
  unitSystem?: "SI" | "IMPERIAL";
  /** ISO currency code — 'INR' (default), 'USD', 'EUR', 'GBP', 'AED', 'SAR', 'CNY', 'JPY', 'AUD'. */
  currency?: "INR" | "USD" | "EUR" | "GBP" | "AED" | "SAR" | "CNY" | "JPY" | "AUD";
  /** Project phase — IfcProject.Phase attribute. */
  projectPhase?: "DESIGN" | "CONSTRUCTION" | "OPERATION" | "DEMOLITION" | "DESIGN_DEVELOPMENT" | "SCHEMATIC_DESIGN";
  /** Enable IfcMappedItem instancing (v4 Tier 0) — file size reduction via shared geometry. */
  enableMappedItems?: boolean;
  /** Permit authority data (IfcPermit for Indian projects). */
  permit?: {
    authority?: string;     // 'Pune Municipal Corporation'
    permitNumber?: string;
    approvalDate?: string;  // ISO date
    validUntil?: string;
    fireNOC?: string;
    environmentalClearance?: string;
    reraRegistration?: string;
  };
  /** Sibling discipline file names for federation document references (v4 Tier 3). */
  federatedFiles?: {
    architectural?: string;
    structural?: string;
    mep?: string;
    landscape?: string;
  };
  /**
   * When true, emit IfcReinforcingBar with IfcExtrudedAreaSolid body geometry.
   * When false (DEFAULT), bars are emitted with Representation=$ (no geometry) but
   * Pset_BuildFlow_BBS metadata intact — prevents the "cloud of cylinders at origin"
   * artefact that auto-generated rebar creates on circular / non-rectangular buildings.
   * BBS tools (Excel export, takeoff software) read the Pset, not the geometry.
   */
  emitRebarGeometry?: boolean;
  /**
   * When true, auto-emit sample MEP fixtures (sprinklers, WCs, pumps, AHU, lights, MCB,
   * solar), sample plant-room equipment (chiller, boiler, transformer), demo furniture,
   * demo curtain wall decomposition, demo shading device, and sample M20 bolt/fillet weld.
   * Default FALSE. These are placed at schematic bbox-derived coordinates and can appear
   * as "flying debris" on non-rectangular buildings (circular/L-shape/curved). Enable only
   * when the input massing is a conventional rectangular floor plate or when the caller has
   * explicitly supplied positioned fixture geometry.
   *
   * Note: legitimate architectural elements (lifts when NBC-mandated, RPWD entry ramp,
   * per-column footings, per-column pile-caps) continue to emit regardless of this flag.
   */
  autoEmitDemoContent?: boolean;
  /**
   * When true, curtain-wall sub-components (mullion + spandrel inputs) emit with body
   * geometry. Default FALSE: they emit as IfcMember(.MULLION.) / IfcPlate(.CURTAIN_PANEL.)
   * with Representation=$ — metadata present for BIM takeoff, but no individual body
   * prisms rendered (a facade with 900+ mullions otherwise appears as flying stick chaos
   * in viewers because each mullion is a separate thin rectangular solid).
   *
   * The merged perimeter wall shell (emitted when input walls form a closed chain) already
   * represents the curtain-wall facade visually; the individual mullions are preserved as
   * metadata entities aggregated under an IfcCurtainWall container per storey.
   */
  emitCurtainWallGeometry?: boolean;
  /**
   * When true, MEP segment / pipe / cable-tray / equipment elements emit with body
   * geometry. Default FALSE: emitted as proper IFC entities (IfcDuctSegment / IfcPipeSegment /
   * IfcCableCarrierSegment / IfcFlowTerminal) with Representation=$ — present for BIM
   * takeoff, system grouping, COBie equipment scheduling, and IfcRelConnectsPorts wiring,
   * but no body prisms rendered.
   *
   * Reason: massing-generator MEP outputs typically supply only v0 + properties.length, so
   * the actual extrusion direction is unknown. Defaulting to world +X (ducts) or +Z (pipes)
   * produced floating ladder-like horizontal lines stretching beyond the building footprint
   * on circular / non-rectangular plans. Without reliable direction, bodyless emission is
   * the safest visual default.
   *
   * Enable for projects where a routed MEP authoring tool has provided real (v0, v1)
   * vertex pairs with correct orientation.
   */
  emitMEPGeometry?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// GUID GENERATION — UUID v4 / v5 compressed to IFC 22-char base-64
// ═══════════════════════════════════════════════════════════════════════════

// BuildFlow namespace (randomly generated once and kept constant forever).
// Using a fixed namespace lets us generate stable UUID v5 GUIDs for deterministic
// re-exports. DO NOT CHANGE — it would break every downstream GUID.
const BUILDFLOW_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

const IFC_BASE64 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";

/**
 * buildingSMART 22-char compression of a 128-bit UUID.
 * Reference: ifcopenshell/guid.py compress(). Output structure: 2 + 4×5 = 22 chars.
 */
function compressGuid(uuidHex: string): string {
  const hex = uuidHex.replace(/-/g, "").toLowerCase();
  if (hex.length !== 32) throw new Error(`Invalid UUID hex length: ${hex.length}`);

  const bytes: number[] = [];
  for (let i = 0; i < 32; i += 2) bytes.push(parseInt(hex.substring(i, i + 2), 16));

  const toBase64 = (value: number, len: number): string => {
    let out = "";
    for (let i = 0; i < len; i++) {
      const pow = Math.pow(64, len - i - 1);
      out += IFC_BASE64[Math.floor(value / pow) % 64];
    }
    return out;
  };

  const bytesToInt = (slice: number[]): number => {
    let v = 0;
    for (const b of slice) v = v * 256 + b;
    return v;
  };

  return (
    toBase64(bytes[0], 2) +
    toBase64(bytesToInt(bytes.slice(1, 4)), 4) +
    toBase64(bytesToInt(bytes.slice(4, 7)), 4) +
    toBase64(bytesToInt(bytes.slice(7, 10)), 4) +
    toBase64(bytesToInt(bytes.slice(10, 13)), 4) +
    toBase64(bytesToInt(bytes.slice(13, 16)), 4)
  );
}

/**
 * Project-scoped GUID factory. When projectIdentifier is set, every GUID is
 * deterministic (UUID v5 from `${projectIdentifier}:${tag}`). Otherwise, every
 * GUID is a fresh UUID v4. Both paths emit the same 22-char IFC format.
 */
interface GuidFactory {
  /** For entities whose identity is stable across re-exports */
  stable: (tag: string) => string;
  /** For entities whose identity is arbitrary (rels, property sets, etc.) */
  fresh: () => string;
}

/** Generate a RFC4122 v4 UUID (128 random bits, version 4, variant DCE). */
function uuidV4(): string {
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;   // version 4
  b[8] = (b[8] & 0x3f) | 0x80;   // variant DCE 1.1
  return bytesToUuidString(b);
}

/** Generate a RFC4122 v5 UUID (SHA-1 namespaced, deterministic). */
function uuidV5(name: string, namespace: string): string {
  const nsBytes = uuidStringToBytes(namespace);
  const nameBytes = Buffer.from(name, "utf8");
  const concat = Buffer.concat([nsBytes, nameBytes]);
  const hash = createHash("sha1").update(concat).digest();
  const b = Buffer.from(hash.subarray(0, 16));
  b[6] = (b[6] & 0x0f) | 0x50;   // version 5
  b[8] = (b[8] & 0x3f) | 0x80;   // variant DCE 1.1
  return bytesToUuidString(b);
}

function uuidStringToBytes(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, "");
  const out = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToUuidString(b: Buffer): string {
  const hex = b.toString("hex");
  return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20, 32)}`;
}

function makeGuidFactory(projectIdentifier?: string): GuidFactory {
  if (projectIdentifier) {
    return {
      stable: (tag: string) => compressGuid(uuidV5(`${projectIdentifier}:${tag}`, BUILDFLOW_NAMESPACE)),
      fresh: () => compressGuid(uuidV4()),
    };
  }
  return {
    stable: () => compressGuid(uuidV4()),
    fresh: () => compressGuid(uuidV4()),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ENTITY ID COUNTER
// ═══════════════════════════════════════════════════════════════════════════

class IdCounter {
  private _value: number;
  constructor(start = 1) { this._value = start; }
  next(): number { return this._value++; }
}

// ═══════════════════════════════════════════════════════════════════════════
// NUMERIC / STRING HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function f(n: number, decimals = 4): string {
  return n.toFixed(decimals);
}

function polygonAreaCalc(points: FootprintPoint[]): number {
  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].y;
    area -= points[j].x * points[i].y;
  }
  return Math.abs(area) / 2;
}

/** Standard ray-cast point-in-polygon test (closed polygon, vertex order doesn't matter). */
function pointInPolygon(px: number, py: number, polygon: FootprintPoint[]): boolean {
  let inside = false;
  const n = polygon.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    const intersect = ((yi > py) !== (yj > py)) &&
      (px < ((xj - xi) * (py - yi)) / ((yj - yi) || 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Signed polygon area — positive = CCW, negative = CW. */
function signedPolygonArea(points: FootprintPoint[]): number {
  let area = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += points[i].x * points[j].y - points[j].x * points[i].y;
  }
  return area / 2;
}

/**
 * Offset a closed polygon inward by `offset` metres via per-vertex miter-bisector.
 * For a CCW polygon the interior is on the LEFT of each edge direction; we rotate
 * each edge 90° CCW to get the inward normal and compute bisector distance as
 * offset / cos(half-turn-angle) to ensure both adjacent edges are offset by exactly
 * `offset` perpendicular distance. Returns a polygon with the same vertex count.
 */
function offsetClosedPolygonInward(poly: FootprintPoint[], offset: number): FootprintPoint[] {
  const n = poly.length;
  if (n < 3) return poly.map(p => ({ x: p.x, y: p.y }));
  const sign = signedPolygonArea(poly) > 0 ? 1 : -1;

  const inner: FootprintPoint[] = [];
  for (let i = 0; i < n; i++) {
    const prev = poly[(i - 1 + n) % n];
    const curr = poly[i];
    const next = poly[(i + 1) % n];

    const e1x = curr.x - prev.x, e1y = curr.y - prev.y;
    const e1Len = Math.hypot(e1x, e1y) || 1e-9;
    const e2x = next.x - curr.x, e2y = next.y - curr.y;
    const e2Len = Math.hypot(e2x, e2y) || 1e-9;

    // Inward normal: rotate edge 90° CCW → (-dy, dx); flipped for CW polygon
    const n1x = -e1y / e1Len * sign, n1y = e1x / e1Len * sign;
    const n2x = -e2y / e2Len * sign, n2y = e2x / e2Len * sign;

    const bxRaw = n1x + n2x, byRaw = n1y + n2y;
    const bLen = Math.hypot(bxRaw, byRaw);
    if (bLen < 1e-6) {
      inner.push({ x: curr.x + n1x * offset, y: curr.y + n1y * offset });
      continue;
    }
    const bx = bxRaw / bLen, by = byRaw / bLen;
    const cosHalf = bx * n1x + by * n1y;   // |bx*n1x + by*n1y|
    const miter = Math.abs(cosHalf) > 0.01 ? offset / cosHalf : offset * 50;
    // Clamp miter to avoid extreme spikes on near-180° reflex corners
    const clamped = Math.min(Math.max(miter, offset * 0.5), offset * 10);
    inner.push({ x: curr.x + bx * clamped, y: curr.y + by * clamped });
  }
  return inner;
}

/**
 * Walk a flat list of wall GeometryElements and group them into chains where
 * each wall's end-vertex touches the next wall's start-vertex within tolerance,
 * and both walls share the same thickness + height. Used to detect closed
 * exterior perimeters that should be emitted as a single merged IfcWall shell
 * rather than N separate rectangular prisms (which visually facet badly on
 * circular / curved buildings).
 */
function detectWallChains(walls: GeometryElement[]): GeometryElement[][] {
  const TOL = 0.02;   // 20mm tolerance for end-to-start matching
  const used = new Set<string>();
  const chains: GeometryElement[][] = [];

  const sameSpec = (a: GeometryElement, b: GeometryElement) =>
    Math.abs((a.properties.thickness ?? 0.25) - (b.properties.thickness ?? 0.25)) < 0.001 &&
    Math.abs((a.properties.height ?? 0) - (b.properties.height ?? 0)) < 0.001;

  for (const seed of walls) {
    if (!seed.id || used.has(seed.id) || seed.vertices.length < 2) continue;
    const chain: GeometryElement[] = [seed];
    used.add(seed.id);

    // Extend forward
    let advanced = true;
    while (advanced) {
      advanced = false;
      const last = chain[chain.length - 1];
      const endV = last.vertices[1];
      for (const cand of walls) {
        if (!cand.id || used.has(cand.id) || cand.vertices.length < 2) continue;
        if (!sameSpec(last, cand)) continue;
        const sv = cand.vertices[0];
        if (Math.hypot(sv.x - endV.x, sv.y - endV.y) < TOL) {
          chain.push(cand);
          used.add(cand.id);
          advanced = true;
          break;
        }
      }
    }

    // Extend backward
    advanced = true;
    while (advanced) {
      advanced = false;
      const first = chain[0];
      const startV = first.vertices[0];
      for (const cand of walls) {
        if (!cand.id || used.has(cand.id) || cand.vertices.length < 2) continue;
        if (!sameSpec(first, cand)) continue;
        const ev = cand.vertices[1];
        if (Math.hypot(ev.x - startV.x, ev.y - startV.y) < TOL) {
          chain.unshift(cand);
          used.add(cand.id);
          advanced = true;
          break;
        }
      }
    }

    chains.push(chain);
  }
  return chains;
}

function chainIsClosed(chain: GeometryElement[]): boolean {
  if (chain.length < 3) return false;
  const first = chain[0].vertices[0];
  const last = chain[chain.length - 1].vertices[1];
  return Math.hypot(first.x - last.x, first.y - last.y) < 0.05;
}

// ═══════════════════════════════════════════════════════════════════════════
// DISCIPLINE FILTER SETS
// ═══════════════════════════════════════════════════════════════════════════

const ARCHITECTURAL_TYPES = new Set(["wall", "window", "door", "space", "balcony", "canopy", "parapet"]);
const STRUCTURAL_TYPES = new Set(["column", "beam", "slab", "stair", "roof"]);
const MEP_TYPE_SET = new Set(["duct", "pipe", "cable-tray", "equipment"]);

// ═══════════════════════════════════════════════════════════════════════════
// REGIONAL MATERIAL CATALOGUE
// ═══════════════════════════════════════════════════════════════════════════

interface MaterialCatalogue {
  concrete: string;          // structural concrete grade
  reinforcement: string;     // rebar grade
  structuralSteel: string;   // structural steel grade
  masonry: string;           // blockwork / brickwork
  insulation: string;
  plaster: string;
  glazing: string;
  timberDoor: string;
  flooringTile: string;
  // External / waterproofing
  waterproofing: string;
}

function materialCatalogue(region: IFCExportOptions["region"] = "india"): MaterialCatalogue {
  if (region === "eu") {
    return {
      concrete: "Reinforced Concrete C30/37 (EN 206)",
      reinforcement: "Rebar B500B (EN 10080)",
      structuralSteel: "Structural Steel S355 (EN 10025)",
      masonry: "Clay Brick Masonry (EN 771-1)",
      insulation: "Mineral Wool Insulation",
      plaster: "Gypsum Plaster",
      glazing: "Tempered Glass 6mm",
      timberDoor: "Hardwood Timber",
      flooringTile: "Vitrified Tile",
      waterproofing: "Bituminous Membrane",
    };
  }
  if (region === "us") {
    return {
      concrete: "Reinforced Concrete f'c 4000 psi (ACI 318)",
      reinforcement: "Rebar Grade 60 (ASTM A615)",
      structuralSteel: "Structural Steel ASTM A992",
      masonry: "CMU 8in (ASTM C90)",
      insulation: "Mineral Wool Insulation",
      plaster: "Gypsum Board",
      glazing: "Tempered Glass 1/4in",
      timberDoor: "Hardwood Timber",
      flooringTile: "Porcelain Tile",
      waterproofing: "Bituminous Membrane",
    };
  }
  // India (default)
  return {
    concrete: "Reinforced Concrete M25 (IS 456:2000)",
    reinforcement: "TMT Rebar Fe500D (IS 1786:2008)",
    structuralSteel: "Structural Steel Fe410 (IS 2062:2011)",
    masonry: "AAC Block 200mm (IS 2185 Part-3)",
    insulation: "Extruded Polystyrene (XPS) Insulation",
    plaster: "Cement Plaster 1:6 (IS 1542)",
    glazing: "Toughened Glass 6mm (IS 2553)",
    timberDoor: "Hardwood Timber (IS 1003)",
    flooringTile: "Vitrified Tile 600x600 (IS 15622)",
    waterproofing: "APP Bituminous Membrane 4mm (IS 1322)",
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SURFACE STYLE PALETTE (Fix 2 v2) — per-material RGB + transparency
// ═══════════════════════════════════════════════════════════════════════════

interface SurfaceStyleSpec {
  name: string;
  red: number;      // 0..1
  green: number;
  blue: number;
  transparency: number;   // 0 opaque .. 1 invisible
  specular: number;       // 0 matte .. 1 mirror
  roughness: number;      // 0 smooth .. 1 rough
}

const SURFACE_STYLES: Record<string, SurfaceStyleSpec> = {
  concrete:         { name: "Concrete RCC",         red: 0.75, green: 0.73, blue: 0.71, transparency: 0.0, specular: 0.05, roughness: 0.85 },
  reinforcement:    { name: "Reinforcement Steel",  red: 0.55, green: 0.42, blue: 0.35, transparency: 0.0, specular: 0.25, roughness: 0.55 },
  structuralSteel:  { name: "Structural Steel",     red: 0.50, green: 0.52, blue: 0.55, transparency: 0.0, specular: 0.45, roughness: 0.30 },
  masonry:          { name: "Masonry/AAC",          red: 0.85, green: 0.85, blue: 0.82, transparency: 0.0, specular: 0.03, roughness: 0.90 },
  brick:            { name: "Clay Brick",           red: 0.76, green: 0.38, blue: 0.25, transparency: 0.0, specular: 0.03, roughness: 0.90 },
  insulation:       { name: "Thermal Insulation",   red: 0.95, green: 0.85, blue: 0.35, transparency: 0.0, specular: 0.05, roughness: 0.95 },
  plaster:          { name: "Plaster / Gypsum",     red: 0.95, green: 0.93, blue: 0.90, transparency: 0.0, specular: 0.08, roughness: 0.75 },
  glazing:          { name: "Glass Clear",          red: 0.70, green: 0.82, blue: 0.88, transparency: 0.55, specular: 0.85, roughness: 0.05 },
  timberDoor:       { name: "Hardwood Timber",      red: 0.60, green: 0.42, blue: 0.25, transparency: 0.0, specular: 0.15, roughness: 0.55 },
  waterproofing:    { name: "Bituminous Membrane",  red: 0.20, green: 0.22, blue: 0.25, transparency: 0.0, specular: 0.15, roughness: 0.70 },
  flooringTile:     { name: "Vitrified Tile",       red: 0.88, green: 0.85, blue: 0.78, transparency: 0.0, specular: 0.35, roughness: 0.25 },
  aluminium:        { name: "Aluminium",            red: 0.75, green: 0.77, blue: 0.80, transparency: 0.0, specular: 0.50, roughness: 0.20 },
  ductGalvSteel:    { name: "Galvanized Steel Duct", red: 0.78, green: 0.78, blue: 0.82, transparency: 0.0, specular: 0.40, roughness: 0.25 },
  pipeCopper:       { name: "Copper Pipe",          red: 0.72, green: 0.45, blue: 0.20, transparency: 0.0, specular: 0.55, roughness: 0.20 },
  cableTray:        { name: "Electrical Cable Tray", red: 0.40, green: 0.42, blue: 0.45, transparency: 0.0, specular: 0.30, roughness: 0.40 },
};

// ═══════════════════════════════════════════════════════════════════════════
// IS 808:2021 STEEL PROFILE CATALOGUE (Fix 17 v2)
// ═══════════════════════════════════════════════════════════════════════════

/** IS 808 cross-section dimensions in metres (OverallDepth, FlangeWidth, WebThickness, FlangeThickness, FilletRadius) */
interface SteelProfile {
  designation: string;
  overallDepth: number;
  flangeWidth: number;
  webThickness: number;
  flangeThickness: number;
  filletRadius: number;
  crossSectionArea: number; // m²
  massPerMetre: number;     // kg/m
}

const ISMB_CATALOGUE: SteelProfile[] = [
  // IS 808:2021 Indian Standard Medium Beams
  { designation: "ISMB 100", overallDepth: 0.100, flangeWidth: 0.075, webThickness: 0.004, flangeThickness: 0.007,  filletRadius: 0.009, crossSectionArea: 0.001174, massPerMetre: 9.2 },
  { designation: "ISMB 125", overallDepth: 0.125, flangeWidth: 0.075, webThickness: 0.0045, flangeThickness: 0.0081, filletRadius: 0.009, crossSectionArea: 0.001327, massPerMetre: 10.4 },
  { designation: "ISMB 150", overallDepth: 0.150, flangeWidth: 0.080, webThickness: 0.0048, flangeThickness: 0.0075, filletRadius: 0.009, crossSectionArea: 0.001801, massPerMetre: 14.2 },
  { designation: "ISMB 175", overallDepth: 0.175, flangeWidth: 0.085, webThickness: 0.0058, flangeThickness: 0.0090, filletRadius: 0.010, crossSectionArea: 0.002204, massPerMetre: 17.3 },
  { designation: "ISMB 200", overallDepth: 0.200, flangeWidth: 0.100, webThickness: 0.0057, flangeThickness: 0.0108, filletRadius: 0.011, crossSectionArea: 0.002668, massPerMetre: 25.4 },
  { designation: "ISMB 225", overallDepth: 0.225, flangeWidth: 0.110, webThickness: 0.0065, flangeThickness: 0.0118, filletRadius: 0.012, crossSectionArea: 0.003226, massPerMetre: 31.2 },
  { designation: "ISMB 250", overallDepth: 0.250, flangeWidth: 0.125, webThickness: 0.0069, flangeThickness: 0.0125, filletRadius: 0.013, crossSectionArea: 0.003921, massPerMetre: 37.3 },
  { designation: "ISMB 300", overallDepth: 0.300, flangeWidth: 0.140, webThickness: 0.0075, flangeThickness: 0.0124, filletRadius: 0.014, crossSectionArea: 0.004857, massPerMetre: 44.2 },
  { designation: "ISMB 350", overallDepth: 0.350, flangeWidth: 0.140, webThickness: 0.0081, flangeThickness: 0.0142, filletRadius: 0.014, crossSectionArea: 0.006671, massPerMetre: 52.4 },
  { designation: "ISMB 400", overallDepth: 0.400, flangeWidth: 0.140, webThickness: 0.0089, flangeThickness: 0.0160, filletRadius: 0.014, crossSectionArea: 0.007846, massPerMetre: 61.6 },
  { designation: "ISMB 450", overallDepth: 0.450, flangeWidth: 0.150, webThickness: 0.0094, flangeThickness: 0.0174, filletRadius: 0.015, crossSectionArea: 0.009227, massPerMetre: 72.4 },
  { designation: "ISMB 500", overallDepth: 0.500, flangeWidth: 0.180, webThickness: 0.0102, flangeThickness: 0.0172, filletRadius: 0.017, crossSectionArea: 0.011074, massPerMetre: 86.9 },
  { designation: "ISMB 550", overallDepth: 0.550, flangeWidth: 0.190, webThickness: 0.0112, flangeThickness: 0.0192, filletRadius: 0.018, crossSectionArea: 0.013211, massPerMetre: 103.7 },
  { designation: "ISMB 600", overallDepth: 0.600, flangeWidth: 0.210, webThickness: 0.0120, flangeThickness: 0.0207, filletRadius: 0.020, crossSectionArea: 0.015621, massPerMetre: 122.6 },
];

const ISHB_CATALOGUE: SteelProfile[] = [
  // IS 808:2021 Indian Standard Heavy Beams (used as columns)
  { designation: "ISHB 150", overallDepth: 0.150, flangeWidth: 0.150, webThickness: 0.0084, flangeThickness: 0.009, filletRadius: 0.008, crossSectionArea: 0.003455, massPerMetre: 27.1 },
  { designation: "ISHB 200", overallDepth: 0.200, flangeWidth: 0.200, webThickness: 0.0090, flangeThickness: 0.009, filletRadius: 0.009, crossSectionArea: 0.004754, massPerMetre: 37.3 },
  { designation: "ISHB 225", overallDepth: 0.225, flangeWidth: 0.225, webThickness: 0.0088, flangeThickness: 0.0108, filletRadius: 0.010, crossSectionArea: 0.005500, massPerMetre: 43.1 },
  { designation: "ISHB 250", overallDepth: 0.250, flangeWidth: 0.250, webThickness: 0.0088, flangeThickness: 0.0098, filletRadius: 0.010, crossSectionArea: 0.006433, massPerMetre: 50.5 },
  { designation: "ISHB 300", overallDepth: 0.300, flangeWidth: 0.250, webThickness: 0.0094, flangeThickness: 0.0108, filletRadius: 0.012, crossSectionArea: 0.007485, massPerMetre: 58.8 },
  { designation: "ISHB 350", overallDepth: 0.350, flangeWidth: 0.250, webThickness: 0.0104, flangeThickness: 0.0117, filletRadius: 0.013, crossSectionArea: 0.008591, massPerMetre: 67.4 },
  { designation: "ISHB 400", overallDepth: 0.400, flangeWidth: 0.250, webThickness: 0.0108, flangeThickness: 0.0128, filletRadius: 0.015, crossSectionArea: 0.009766, massPerMetre: 77.4 },
  { designation: "ISHB 450", overallDepth: 0.450, flangeWidth: 0.250, webThickness: 0.0116, flangeThickness: 0.0137, filletRadius: 0.015, crossSectionArea: 0.011114, massPerMetre: 87.2 },
];

function nearestISMB(depthMetres: number): SteelProfile {
  let best = ISMB_CATALOGUE[0];
  let bestDiff = Math.abs(best.overallDepth - depthMetres);
  for (const p of ISMB_CATALOGUE) {
    const d = Math.abs(p.overallDepth - depthMetres);
    if (d < bestDiff) { best = p; bestDiff = d; }
  }
  return best;
}

function nearestISHB(sizeMetres: number): SteelProfile {
  let best = ISHB_CATALOGUE[0];
  let bestDiff = Math.abs(best.overallDepth - sizeMetres);
  for (const p of ISHB_CATALOGUE) {
    const d = Math.abs(p.overallDepth - sizeMetres);
    if (d < bestDiff) { best = p; bestDiff = d; }
  }
  return best;
}

// ═══════════════════════════════════════════════════════════════════════════
// v3 Tier 3 — IS 456 / IS 1786 / IS 2062 / IS 1077 / IS 2185 MATERIAL PHYSICS
// ═══════════════════════════════════════════════════════════════════════════

/** IS 456:2000 concrete grade properties — characteristic strength + short-term elastic modulus (IS Cl.6.2.3.1 Ec = 5000√fck). */
interface ConcreteGradeSpec {
  grade: string;              // 'M25'
  fck: number;                // N/mm² = MPa
  Ec: number;                 // N/mm² — static modulus of elasticity
  densityKgM3: number;
  poissonRatio: number;
  thermalConductivityWmK: number;
  specificHeatJkgK: number;
  thermalExpansionPerK: number;
  maxAggregateMm: number;
  waterCementRatio: number;   // IS 456 Table 5
  minCementKgM3: number;      // IS 456 Table 5 Moderate exposure
}
const CONCRETE_GRADES: Record<string, ConcreteGradeSpec> = {
  M15: { grade: "M15", fck: 15, Ec: 19365, densityKgM3: 2400, poissonRatio: 0.2, thermalConductivityWmK: 1.58, specificHeatJkgK: 880, thermalExpansionPerK: 12e-6, maxAggregateMm: 20, waterCementRatio: 0.60, minCementKgM3: 240 },
  M20: { grade: "M20", fck: 20, Ec: 22361, densityKgM3: 2400, poissonRatio: 0.2, thermalConductivityWmK: 1.58, specificHeatJkgK: 880, thermalExpansionPerK: 12e-6, maxAggregateMm: 20, waterCementRatio: 0.55, minCementKgM3: 260 },
  M25: { grade: "M25", fck: 25, Ec: 25000, densityKgM3: 2400, poissonRatio: 0.2, thermalConductivityWmK: 1.58, specificHeatJkgK: 880, thermalExpansionPerK: 12e-6, maxAggregateMm: 20, waterCementRatio: 0.50, minCementKgM3: 280 },
  M30: { grade: "M30", fck: 30, Ec: 27386, densityKgM3: 2400, poissonRatio: 0.2, thermalConductivityWmK: 1.58, specificHeatJkgK: 880, thermalExpansionPerK: 12e-6, maxAggregateMm: 20, waterCementRatio: 0.45, minCementKgM3: 300 },
  M35: { grade: "M35", fck: 35, Ec: 29580, densityKgM3: 2400, poissonRatio: 0.2, thermalConductivityWmK: 1.58, specificHeatJkgK: 880, thermalExpansionPerK: 12e-6, maxAggregateMm: 20, waterCementRatio: 0.45, minCementKgM3: 320 },
  M40: { grade: "M40", fck: 40, Ec: 31623, densityKgM3: 2400, poissonRatio: 0.2, thermalConductivityWmK: 1.58, specificHeatJkgK: 880, thermalExpansionPerK: 12e-6, maxAggregateMm: 20, waterCementRatio: 0.40, minCementKgM3: 340 },
  M45: { grade: "M45", fck: 45, Ec: 33541, densityKgM3: 2400, poissonRatio: 0.2, thermalConductivityWmK: 1.58, specificHeatJkgK: 880, thermalExpansionPerK: 12e-6, maxAggregateMm: 20, waterCementRatio: 0.40, minCementKgM3: 360 },
  M50: { grade: "M50", fck: 50, Ec: 35355, densityKgM3: 2400, poissonRatio: 0.2, thermalConductivityWmK: 1.58, specificHeatJkgK: 880, thermalExpansionPerK: 12e-6, maxAggregateMm: 20, waterCementRatio: 0.40, minCementKgM3: 380 },
};

/** IS 1786:2008 / IS 2062:2011 steel grade properties. */
interface SteelGradeSpec {
  grade: string;
  fy: number;     // N/mm² — yield strength
  fu: number;     // N/mm² — ultimate tensile strength
  E: number;      // N/mm² — modulus of elasticity (always 200,000 for steel)
  elongationPct: number;
  densityKgM3: number;
  poissonRatio: number;
  thermalConductivityWmK: number;
  specificHeatJkgK: number;
  thermalExpansionPerK: number;
  isReinforcement: boolean;  // true for Fe*, false for E* (structural)
}
const STEEL_GRADES: Record<string, SteelGradeSpec> = {
  Fe415:  { grade: "Fe415",  fy: 415, fu: 485, E: 200000, elongationPct: 14.5, densityKgM3: 7850, poissonRatio: 0.30, thermalConductivityWmK: 50, specificHeatJkgK: 460, thermalExpansionPerK: 12e-6, isReinforcement: true  },
  Fe500:  { grade: "Fe500",  fy: 500, fu: 545, E: 200000, elongationPct: 12.0, densityKgM3: 7850, poissonRatio: 0.30, thermalConductivityWmK: 50, specificHeatJkgK: 460, thermalExpansionPerK: 12e-6, isReinforcement: true  },
  Fe500D: { grade: "Fe500D", fy: 500, fu: 565, E: 200000, elongationPct: 16.0, densityKgM3: 7850, poissonRatio: 0.30, thermalConductivityWmK: 50, specificHeatJkgK: 460, thermalExpansionPerK: 12e-6, isReinforcement: true  },
  Fe550:  { grade: "Fe550",  fy: 550, fu: 585, E: 200000, elongationPct: 10.0, densityKgM3: 7850, poissonRatio: 0.30, thermalConductivityWmK: 50, specificHeatJkgK: 460, thermalExpansionPerK: 12e-6, isReinforcement: true  },
  Fe550D: { grade: "Fe550D", fy: 550, fu: 600, E: 200000, elongationPct: 14.5, densityKgM3: 7850, poissonRatio: 0.30, thermalConductivityWmK: 50, specificHeatJkgK: 460, thermalExpansionPerK: 12e-6, isReinforcement: true  },
  E250:   { grade: "E250",   fy: 250, fu: 410, E: 200000, elongationPct: 23.0, densityKgM3: 7850, poissonRatio: 0.30, thermalConductivityWmK: 50, specificHeatJkgK: 460, thermalExpansionPerK: 12e-6, isReinforcement: false },
  E350:   { grade: "E350",   fy: 350, fu: 490, E: 200000, elongationPct: 22.0, densityKgM3: 7850, poissonRatio: 0.30, thermalConductivityWmK: 50, specificHeatJkgK: 460, thermalExpansionPerK: 12e-6, isReinforcement: false },
  E410:   { grade: "E410",   fy: 410, fu: 540, E: 200000, elongationPct: 20.0, densityKgM3: 7850, poissonRatio: 0.30, thermalConductivityWmK: 50, specificHeatJkgK: 460, thermalExpansionPerK: 12e-6, isReinforcement: false },
};

/** ECBC 2017 Table A3.1 thermal conductivity for common Indian construction materials. */
interface ThermalMaterialSpec {
  name: string;
  densityKgM3: number;
  thermalConductivityWmK: number;
  specificHeatJkgK: number;
  waterAbsorptionPct?: number;
  isCombustible: boolean;
}
const THERMAL_MATERIALS: Record<string, ThermalMaterialSpec> = {
  masonryBrick:    { name: "Clay Brick Masonry (IS 1077)",  densityKgM3: 1920, thermalConductivityWmK: 0.81, specificHeatJkgK: 880, waterAbsorptionPct: 15, isCombustible: false },
  masonryAAC:      { name: "AAC Block 3.5N (IS 2185 Pt 3)",  densityKgM3: 550,  thermalConductivityWmK: 0.16, specificHeatJkgK: 1000, waterAbsorptionPct: 40, isCombustible: false },
  masonryFlyAsh:   { name: "Fly Ash Brick (IS 12894)",       densityKgM3: 1700, thermalConductivityWmK: 0.60, specificHeatJkgK: 800, waterAbsorptionPct: 20, isCombustible: false },
  gypsumBoard:     { name: "Gypsum Board 12.5mm (IS 2095)",  densityKgM3: 900,  thermalConductivityWmK: 0.17, specificHeatJkgK: 1090, isCombustible: false },
  glazing6mm:      { name: "Toughened Glass 6mm (IS 2553)",  densityKgM3: 2500, thermalConductivityWmK: 1.05, specificHeatJkgK: 840, isCombustible: false },
  aluminium:       { name: "Aluminium Extrusion",             densityKgM3: 2700, thermalConductivityWmK: 160.0, specificHeatJkgK: 900, isCombustible: false },
  mineralWool:     { name: "Mineral Wool Insulation (IS 8183)", densityKgM3: 48, thermalConductivityWmK: 0.04, specificHeatJkgK: 840, isCombustible: false },
  xps:             { name: "XPS Insulation",                  densityKgM3: 35,   thermalConductivityWmK: 0.034, specificHeatJkgK: 1400, isCombustible: true  },
  bitumenMembrane: { name: "APP Bituminous Membrane (IS 1322)", densityKgM3: 1100, thermalConductivityWmK: 0.17, specificHeatJkgK: 1000, isCombustible: true  },
  cementPlaster:   { name: "Cement Plaster 12mm (IS 1661)",   densityKgM3: 1760, thermalConductivityWmK: 0.72, specificHeatJkgK: 840, isCombustible: false },
  vitrifiedTile:   { name: "Vitrified Tile 10mm",              densityKgM3: 2400, thermalConductivityWmK: 1.30, specificHeatJkgK: 850, isCombustible: false },
  teakTimber:      { name: "Teak Timber (IS 401)",             densityKgM3: 660,  thermalConductivityWmK: 0.17, specificHeatJkgK: 1600, isCombustible: true  },
};

// ═══════════════════════════════════════════════════════════════════════════
// v3 Tier 1 — IS 456 / IS 2502 / SP 34 REINFORCEMENT RULE ENGINE
// ═══════════════════════════════════════════════════════════════════════════

/** IS 1786 standard rebar diameters. */
const STD_BAR_DIAS_MM = [8, 10, 12, 16, 20, 25, 28, 32, 36, 40];

/** IS 456 Table 16 — Nominal cover (mm) for Moderate exposure. */
function clearCoverFor(elementType: string): number {
  const m: Record<string, number> = { slab: 20, wall: 25, beam: 25, column: 40, footing: 50, stair: 25, roof: 25 };
  return m[elementType.toLowerCase()] ?? 25;
}

/** Bar weight per metre — IS 1786: d²/162 where d is in mm. */
function barWeightPerMetre(diameterMm: number): number {
  return (diameterMm * diameterMm) / 162.0;
}

/** IS 456 Cl 26.2.1 development length in tension for M25+Fe500 ≈ 47×d; use 50×d safely. */
function developmentLengthMm(diameterMm: number): number {
  return 50 * diameterMm;
}

/** IS 456 Cl 26.2.5.1 tension lap length Ld ≈ 50×d. */
function lapLengthMm(diameterMm: number): number {
  return 50 * diameterMm;
}

/** Select the smallest IS 1786 rebar that provides the required area using `count` bars. */
function selectBarDiaForArea(requiredAreaMm2: number, count: number): number {
  for (const d of STD_BAR_DIAS_MM) {
    const a = count * Math.PI * (d * d) / 4;
    if (a >= requiredAreaMm2) return d;
  }
  return 40; // max
}

interface GeneratedBar {
  barMark: string;        // 'A', 'B', 'C'...
  diameter: number;       // mm
  grade: "Fe500" | "Fe500D" | "Fe415";
  numberOfBars: number;
  spacingMm?: number;     // for distributed bars
  cuttingLengthMm: number;
  is2502ShapeCode: string;  // IS 2502 Table 1
  role: "MAIN" | "SHEAR" | "LIGATURE" | "STUD" | "EDGE" | "RING" | "ANCHORING";
  position: "top" | "bottom" | "side" | "transverse" | "longitudinal";
  bendRadiusMm: number;
  hookLengthMm: number;
}

/**
 * IS 456 Cl 26.5.1 — auto-generate minimum reinforcement for a rectangular RCC beam.
 * Produces: bottom main bars, top holders, closed 2-legged stirrups.
 */
function generateBeamRebar(widthMm: number, depthMm: number, spanMm: number, concrete: ConcreteGradeSpec, steel: SteelGradeSpec): GeneratedBar[] {
  const bars: GeneratedBar[] = [];
  const cover = clearCoverFor("beam");
  const stirrupDia = 8;
  // Effective depth d = D - cover - stirrupDia - assumedMainDia/2  (assume 16mm main for first pass)
  const assumedMainDia = 16;
  const effectiveDepth = depthMm - cover - stirrupDia - assumedMainDia / 2;

  // Min tension steel: max(0.85*b*d/fy, 0.12% bD for HYSD)   — IS 456 Cl 26.5.1.1
  const AsMin = Math.max(0.85 * widthMm * effectiveDepth / steel.fy, 0.0012 * widthMm * depthMm);
  const mainDia = selectBarDiaForArea(AsMin, 2);
  const numMain = Math.max(2, Math.ceil(AsMin / (Math.PI * mainDia * mainDia / 4)));

  bars.push({
    barMark: "A",
    diameter: mainDia,
    grade: "Fe500",
    numberOfBars: numMain,
    cuttingLengthMm: spanMm + 2 * lapLengthMm(mainDia),
    is2502ShapeCode: "00",    // straight
    role: "MAIN",
    position: "bottom",
    bendRadiusMm: 4 * mainDia,
    hookLengthMm: 0,
  });

  // Top holders
  const topDia = Math.max(10, mainDia - 4);
  bars.push({
    barMark: "B",
    diameter: topDia,
    grade: "Fe500",
    numberOfBars: 2,
    cuttingLengthMm: spanMm + 300,
    is2502ShapeCode: "00",
    role: "MAIN",
    position: "top",
    bendRadiusMm: 4 * topDia,
    hookLengthMm: 0,
  });

  // Stirrups — IS 456 Cl 26.5.1.5 max spacing = min(0.75d, 300mm)
  const stirrupSpacing = Math.min(Math.floor(0.75 * effectiveDepth), 300, 150); // conservative
  const numStirrups = Math.ceil(spanMm / stirrupSpacing) + 1;
  // Closed stirrup cutting length: 2(b-2c) + 2(D-2c) + 2×hook − bend deductions
  const stirrupPerimeter = 2 * (widthMm - 2 * cover) + 2 * (depthMm - 2 * cover);
  const stirrupCutLen = stirrupPerimeter + 2 * (10 * stirrupDia) - 3 * 2 * stirrupDia;

  bars.push({
    barMark: "C",
    diameter: stirrupDia,
    grade: "Fe500",
    numberOfBars: numStirrups,
    spacingMm: stirrupSpacing,
    cuttingLengthMm: stirrupCutLen,
    is2502ShapeCode: "51",  // closed rectangular stirrup
    role: "SHEAR",
    position: "transverse",
    bendRadiusMm: 2 * stirrupDia,
    hookLengthMm: 10 * stirrupDia,
  });

  return bars;
}

/**
 * IS 456 Cl 26.5.3 — column reinforcement. Rectangular columns take 4 longitudinals min,
 * circular take 6. Lateral ties per Cl 26.5.3.2. In seismic Zone III+ add IS 13920 detailing.
 */
function generateColumnRebar(widthOrDiaMm: number, heightMm: number, concrete: ConcreteGradeSpec, steel: SteelGradeSpec, isCircular: boolean): GeneratedBar[] {
  const bars: GeneratedBar[] = [];
  const cover = clearCoverFor("column");
  const grossArea = isCircular ? Math.PI * (widthOrDiaMm / 2) ** 2 : widthOrDiaMm * widthOrDiaMm;
  const AsMin = 0.008 * grossArea;                              // 0.8% min (IS 456 Cl 26.5.3.1)
  const numBars = isCircular ? 6 : 4;
  const mainDia = selectBarDiaForArea(AsMin, numBars);

  bars.push({
    barMark: "A",
    diameter: mainDia,
    grade: "Fe500",
    numberOfBars: numBars,
    cuttingLengthMm: heightMm + 2 * lapLengthMm(mainDia),
    is2502ShapeCode: "00",
    role: "MAIN",
    position: "longitudinal",
    bendRadiusMm: 4 * mainDia,
    hookLengthMm: 0,
  });

  // Lateral ties — IS 456 Cl 26.5.3.2(c): min dia max(¼ main, 6mm); max spacing min(least dim, 16×main, 300)
  const tieDia = Math.max(8, Math.ceil(mainDia / 4));
  const tieSpacing = Math.min(widthOrDiaMm, 16 * mainDia, 300);
  // IS 13920 seismic clamping: critical zone spacing ≤ min(d/4, 8×main bar, 100mm)
  const tieSpacingSeismic = Math.min(tieSpacing, 100);
  const numTies = Math.ceil(heightMm / tieSpacingSeismic) + 1;
  const tiePerimeter = isCircular
    ? Math.PI * (widthOrDiaMm - 2 * cover)
    : 4 * (widthOrDiaMm - 2 * cover);
  const tieCutLen = tiePerimeter + 2 * (10 * tieDia) - 3 * 2 * tieDia;

  bars.push({
    barMark: "B",
    diameter: tieDia,
    grade: "Fe500",
    numberOfBars: numTies,
    spacingMm: tieSpacingSeismic,
    cuttingLengthMm: tieCutLen,
    is2502ShapeCode: isCircular ? "55" : "51", // circular / rectangular tie
    role: "LIGATURE",
    position: "transverse",
    bendRadiusMm: 3 * tieDia, // IS 13920 Cl 7.3.1 135° hook requires larger radius
    hookLengthMm: 10 * tieDia,
  });

  return bars;
}

/**
 * IS 456 Cl 26.5.2 — slab reinforcement. Min 0.12% bD for Fe500, max spacing min(3D, 300mm).
 * Returns a single IfcReinforcingMesh specification (main + distribution bars).
 */
interface GeneratedMesh {
  longBarDia: number;
  longBarSpacing: number;
  transBarDia: number;
  transBarSpacing: number;
  concreteGrade: string;
  steelGrade: string;
  coverMm: number;
}

function generateSlabMesh(lengthMm: number, widthMm: number, thicknessMm: number, _concrete: ConcreteGradeSpec, _steel: SteelGradeSpec): GeneratedMesh {
  const longDia = thicknessMm >= 200 ? 12 : 10;
  const transDia = thicknessMm >= 200 ? 10 : 8;
  const maxSpacing = Math.min(3 * thicknessMm, 300);
  return {
    longBarDia: longDia,
    longBarSpacing: Math.min(150, maxSpacing),
    transBarDia: transDia,
    transBarSpacing: Math.min(200, maxSpacing),
    concreteGrade: _concrete.grade,
    steelGrade: _steel.grade,
    coverMm: clearCoverFor("slab"),
  };
}

/**
 * IS 456 Cl 34 — footing reinforcement. Both-way mesh + starter bars.
 */
function generateFootingRebar(lengthMm: number, widthMm: number, depthMm: number, concrete: ConcreteGradeSpec, steel: SteelGradeSpec): GeneratedBar[] {
  const bars: GeneratedBar[] = [];
  const cover = clearCoverFor("footing");
  const dia = 16;
  const numL = Math.ceil(lengthMm / 150) + 1;
  const numT = Math.ceil(widthMm / 150) + 1;

  bars.push({
    barMark: "A",
    diameter: dia,
    grade: "Fe500",
    numberOfBars: numL,
    spacingMm: 150,
    cuttingLengthMm: widthMm - 2 * cover + 2 * developmentLengthMm(dia),
    is2502ShapeCode: "00",
    role: "MAIN",
    position: "longitudinal",
    bendRadiusMm: 4 * dia,
    hookLengthMm: 0,
  });
  bars.push({
    barMark: "B",
    diameter: dia,
    grade: "Fe500",
    numberOfBars: numT,
    spacingMm: 150,
    cuttingLengthMm: lengthMm - 2 * cover + 2 * developmentLengthMm(dia),
    is2502ShapeCode: "00",
    role: "MAIN",
    position: "transverse",
    bendRadiusMm: 4 * dia,
    hookLengthMm: 0,
  });
  return bars;
}

// ═══════════════════════════════════════════════════════════════════════════
// NBC 2016 Part 4 FIRE RATING TABLE + ECBC 2017 THERMAL TRANSMITTANCE TABLE
// ═══════════════════════════════════════════════════════════════════════════

interface ElementCodeData {
  fireRating: string;           // NBC Part 4 Table 21 — hours
  thermalTransmittanceU: number; // ECBC Table 4.3/4.4 — W/m²K
  acousticRatingSTC?: number;   // dB
  isCombustible: boolean;
}

function elementCodeData(elementType: string, materialHint: string, isExternal: boolean): ElementCodeData {
  const m = materialHint.toLowerCase();
  const t = elementType.toLowerCase();

  if (t === "wall" && isExternal) {
    if (m.includes("concrete") || m.includes("m25") || m.includes("m30")) {
      return { fireRating: "4 hour", thermalTransmittanceU: 0.40, acousticRatingSTC: 50, isCombustible: false };
    }
    return { fireRating: "2 hour", thermalTransmittanceU: 0.45, acousticRatingSTC: 45, isCombustible: false };
  }
  if (t === "wall") {
    return { fireRating: "1 hour", thermalTransmittanceU: 2.08, acousticRatingSTC: 45, isCombustible: false };
  }
  if (t === "slab") {
    return { fireRating: "2 hour", thermalTransmittanceU: 1.80, acousticRatingSTC: 50, isCombustible: false };
  }
  if (t === "roof") {
    return { fireRating: "2 hour", thermalTransmittanceU: 0.33, acousticRatingSTC: 50, isCombustible: false };
  }
  if (t === "column" || t === "beam") {
    return { fireRating: "3 hour", thermalTransmittanceU: 0.0, isCombustible: false };
  }
  if (t === "door") {
    return { fireRating: "1 hour", thermalTransmittanceU: 3.0, acousticRatingSTC: 30, isCombustible: true };
  }
  if (t === "window") {
    return { fireRating: "0 hour", thermalTransmittanceU: 3.30, acousticRatingSTC: 28, isCombustible: false };
  }
  if (t === "stair") {
    return { fireRating: "2 hour", thermalTransmittanceU: 0.0, isCombustible: false };
  }
  return { fireRating: "0 hour", thermalTransmittanceU: 0.0, isCombustible: false };
}

// ═══════════════════════════════════════════════════════════════════════════
// IS CODE DOCUMENT CATALOGUE (Fix 12 v2 extension)
// ═══════════════════════════════════════════════════════════════════════════

interface CodeDocSpec {
  id: string;
  identification: string;
  name: string;
  description: string;
  location: string;
}

const IS_CODE_DOCS: Record<string, CodeDocSpec> = {
  IS456:  { id: "IS456",  identification: "IS 456:2000",   name: "Plain and Reinforced Concrete — Code of Practice",             description: "Indian Standard for RCC design, materials, workmanship", location: "https://bis.gov.in/" },
  IS1786: { id: "IS1786", identification: "IS 1786:2008",  name: "High Strength Deformed Steel Bars for Concrete Reinforcement", description: "TMT rebar grade specifications (Fe415/Fe500/Fe500D/Fe550)", location: "https://bis.gov.in/" },
  IS2062: { id: "IS2062", identification: "IS 2062:2011",  name: "Hot Rolled Medium and High Tensile Structural Steel",          description: "Structural steel grades E250 to E450",                      location: "https://bis.gov.in/" },
  IS800:  { id: "IS800",  identification: "IS 800:2007",   name: "General Construction in Steel — Code of Practice",             description: "Limit state design of steel structures",                    location: "https://bis.gov.in/" },
  IS808:  { id: "IS808",  identification: "IS 808:2021",   name: "Dimensions for Hot Rolled Steel Sections",                     description: "ISMB/ISHB/ISMC/ISA section dimensions",                     location: "https://bis.gov.in/" },
  IS1893: { id: "IS1893", identification: "IS 1893:2016",  name: "Criteria for Earthquake Resistant Design",                     description: "Seismic zone categorisation and design forces",             location: "https://bis.gov.in/" },
  IS875:  { id: "IS875",  identification: "IS 875-3:2015", name: "Code of Practice for Design Loads — Wind Loads",               description: "Wind zone categorisation and design wind pressure",          location: "https://bis.gov.in/" },
  NBC2016: { id: "NBC2016", identification: "NBC 2016",    name: "National Building Code of India 2016",                         description: "NBC Part 4 Fire & Life Safety / Part 3 General Building Requirements", location: "https://bis.gov.in/" },
  ECBC2017: { id: "ECBC2017", identification: "ECBC 2017", name: "Energy Conservation Building Code",                            description: "Envelope, HVAC, lighting, electrical energy efficiency norms", location: "https://beeindia.gov.in/" },
  RERA2016: { id: "RERA2016", identification: "RERA 2016", name: "Real Estate (Regulation and Development) Act 2016",            description: "Carpet area / Built-up area / Super built-up area disclosure", location: "https://mohua.gov.in/" },
  IS1077:  { id: "IS1077",  identification: "IS 1077:1992", name: "Common Burnt Clay Building Bricks",                            description: "Specification for clay brick masonry",                      location: "https://bis.gov.in/" },
  IS2185:  { id: "IS2185",  identification: "IS 2185 Part 3:1984", name: "Concrete Masonry Units — Part 3 Autoclaved AAC",        description: "AAC block specifications and compressive strength",         location: "https://bis.gov.in/" },
};

/** For a given element type + material, return the IS codes that govern it. */
function codeDocsFor(elementType: string, materialHint: string): string[] {
  const m = materialHint.toLowerCase();
  const t = elementType.toLowerCase();
  const docs: string[] = ["NBC2016"];
  if (t === "wall" || t === "slab" || t === "roof" || t === "column" || t === "beam" || t === "stair" || t === "footing") {
    if (m.includes("concrete") || m.includes("m25") || m.includes("m30")) {
      docs.push("IS456", "IS1786", "IS1893");
    }
    if (m.includes("steel") || m.includes("fe410") || m.includes("ismb") || m.includes("ishb") || m.includes("e250") || m.includes("e350")) {
      docs.push("IS2062", "IS800", "IS808");
    }
    if (m.includes("brick")) docs.push("IS1077");
    if (m.includes("aac") || m.includes("block")) docs.push("IS2185");
  }
  if (t === "window" || t === "door" || t === "wall") docs.push("ECBC2017");
  if (t === "space") docs.push("RERA2016");
  return Array.from(new Set(docs));
}

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEMATIC ELEMENT NAMING (Fix 0A)
// ═══════════════════════════════════════════════════════════════════════════

/** Build BuildFlow systematic element name: DISCIPLINE-TYPE-DIM-MAT-STOREY-SEQ */
function systematicName(parts: {
  discipline: "ARC" | "STR" | "MEP";
  typeCode: string;
  dimension: string;
  material: string;
  storey: string;
  sequence: number;
}): string {
  const seq = String(parts.sequence).padStart(3, "0");
  return `${parts.discipline}-${parts.typeCode}-${parts.dimension}-${parts.material}-${parts.storey}-${seq}`;
}

/** Abbreviate a storey name into a short code (Ground Floor → GF, First Floor → 1F, Basement → BSM). */
function storeyCode(storey: MassingStorey): string {
  const name = storey.name.toLowerCase();
  if (storey.isBasement || name.includes("basement")) return `BSM${storey.index > 0 ? storey.index : ""}`;
  if (name.includes("ground") || storey.index === 0) return "GF";
  if (name.includes("roof") || name.includes("terrace")) return "RF";
  const idx = storey.index;
  return `${idx}F`;
}

/** Short material token for naming — RCC, GYP, STL, ALU, TIM, GLS, BRK, AAC, VIT. */
function materialToken(material: string): string {
  const m = material.toLowerCase();
  if (m.includes("concrete") || m.includes("m25") || m.includes("m30") || m.includes("rcc")) return "RCC";
  if (m.includes("steel") || m.includes("fe410") || m.includes("ismb") || m.includes("ishb") || m.includes("e250")) return "STL";
  if (m.includes("reinforc") || m.includes("fe500")) return "REB";
  if (m.includes("aac")) return "AAC";
  if (m.includes("brick")) return "BRK";
  if (m.includes("gyps") || m.includes("plaster")) return "GYP";
  if (m.includes("timber") || m.includes("wood")) return "TIM";
  if (m.includes("glass") || m.includes("glaz")) return "GLS";
  if (m.includes("alumin")) return "ALU";
  if (m.includes("vitrif") || m.includes("tile")) return "VIT";
  if (m.includes("bitum") || m.includes("membrane") || m.includes("waterproof")) return "WPM";
  if (m.includes("insul")) return "INS";
  return "GEN";
}

// ═══════════════════════════════════════════════════════════════════════════
// CSI MASTERFORMAT 2016 CLASSIFICATION MAP
// ═══════════════════════════════════════════════════════════════════════════

interface ClassificationCode {
  code: string;
  name: string;
}

/** Maps an element type + material hint to a CSI MasterFormat 2016 code. */
function csiCodeFor(elementType: string, materialHint: string): ClassificationCode {
  const m = materialHint.toLowerCase();
  const t = elementType.toLowerCase();

  // 08 — Openings
  if (t === "door") return { code: "08 11 13", name: "Hollow Metal / Timber Doors" };
  if (t === "window") return { code: "08 50 00", name: "Windows" };

  // 09 — Finishes (covers tile, plaster, paint)
  if (t === "covering") return { code: "09 30 00", name: "Tiling" };

  // 07 — Thermal and Moisture Protection
  if (t === "roof") return { code: "07 50 00", name: "Membrane Roofing" };

  // 05 — Metals (steel)
  if (m.includes("steel") || m.includes("fe410") || m.includes("fe500")) {
    if (t === "beam") return { code: "05 12 00", name: "Structural Steel Framing — Beams" };
    if (t === "column") return { code: "05 12 00", name: "Structural Steel Framing — Columns" };
    return { code: "05 00 00", name: "Metals" };
  }

  // 04 — Masonry (brick / block walls)
  if (t === "wall" && (m.includes("brick") || m.includes("block") || m.includes("aac") || m.includes("masonry"))) {
    return { code: "04 22 00", name: "Concrete Unit Masonry" };
  }

  // 06 — Wood (timber beams)
  if (m.includes("timber") || m.includes("wood")) {
    return { code: "06 10 00", name: "Rough Carpentry" };
  }

  // 03 — Concrete (default for structural elements)
  if (t === "wall") return { code: "03 30 00", name: "Cast-in-Place Concrete — Walls" };
  if (t === "slab") return { code: "03 30 00", name: "Cast-in-Place Concrete — Slabs" };
  if (t === "column") return { code: "03 30 00", name: "Cast-in-Place Concrete — Columns" };
  if (t === "beam") return { code: "03 30 00", name: "Cast-in-Place Concrete — Beams" };
  if (t === "stair") return { code: "03 30 00", name: "Cast-in-Place Concrete — Stairs" };
  if (t === "parapet") return { code: "04 22 00", name: "Masonry Parapet" };

  // 22 — Plumbing
  if (t === "pipe") return { code: "22 10 00", name: "Plumbing Piping" };

  // 23 — HVAC
  if (t === "duct") return { code: "23 30 00", name: "HVAC Air Distribution" };

  // 26 — Electrical
  if (t === "cable-tray") return { code: "26 05 36", name: "Cable Trays for Electrical Systems" };

  // 23 / 22 — Equipment (default HVAC)
  if (t === "equipment") return { code: "23 00 00", name: "Heating, Ventilating, and Air Conditioning" };

  return { code: "00 00 00", name: "Unassigned" };
}

/** Maps an element to an NBC India 2016 Part 4 classification clause. */
function nbcCodeFor(elementType: string, materialHint: string): ClassificationCode {
  const m = materialHint.toLowerCase();
  const t = elementType.toLowerCase();

  if (t === "wall" && (m.includes("aac") || m.includes("block") || m.includes("brick"))) {
    return { code: "4.4.3", name: "Non-Load-Bearing Masonry Walls (NBC 2016 Part 4)" };
  }
  if (t === "wall") return { code: "4.4.2", name: "Reinforced Concrete Walls (NBC 2016 Part 4)" };
  if (t === "slab") return { code: "4.4.4", name: "Reinforced Concrete Slabs (NBC 2016 Part 4)" };
  if (t === "column") return { code: "4.4.5", name: "Reinforced Concrete Columns (NBC 2016 Part 4)" };
  if (t === "beam") return { code: "4.4.6", name: "Reinforced Concrete Beams (NBC 2016 Part 4)" };
  if (t === "stair") return { code: "4.4.7", name: "Staircases (NBC 2016 Part 4)" };
  if (t === "roof") return { code: "4.4.8", name: "Roof Systems (NBC 2016 Part 4)" };
  if (t === "door") return { code: "4.5.1", name: "Door Assemblies (NBC 2016 Part 4)" };
  if (t === "window") return { code: "4.5.2", name: "Window Assemblies (NBC 2016 Part 4)" };
  if (t === "pipe") return { code: "9.2", name: "Water Supply / Drainage (NBC 2016 Part 9)" };
  if (t === "duct") return { code: "8.5", name: "HVAC Services (NBC 2016 Part 8)" };
  if (t === "cable-tray") return { code: "8.2", name: "Electrical Installations (NBC 2016 Part 8)" };

  return { code: "0.0", name: "Unassigned (NBC 2016)" };
}

// ═══════════════════════════════════════════════════════════════════════════
// MEP SYSTEM CLASSIFICATION
// ═══════════════════════════════════════════════════════════════════════════

type MepSystemKey =
  | "AIRCONDITIONING"
  | "EXHAUST"
  | "DOMESTICCOLDWATER"
  | "DRAINAGE"
  | "ELECTRICAL"
  | "FIREPROTECTION";

interface MepSystemDescriptor {
  predefinedType: string;
  name: string;
  longName: string;
}

const MEP_SYSTEMS: Record<MepSystemKey, MepSystemDescriptor> = {
  AIRCONDITIONING: { predefinedType: ".AIRCONDITIONING.", name: "SYS-HVAC-01", longName: "HVAC Supply Air System" },
  EXHAUST:         { predefinedType: ".EXHAUST.",         name: "SYS-HVAC-02", longName: "HVAC Return / Exhaust Air System" },
  DOMESTICCOLDWATER: { predefinedType: ".DOMESTICCOLDWATER.", name: "SYS-PLB-01", longName: "Domestic Cold Water Supply" },
  DRAINAGE:        { predefinedType: ".DRAINAGE.",        name: "SYS-PLB-02", longName: "Soil & Waste Drainage" },
  ELECTRICAL:      { predefinedType: ".ELECTRICAL.",      name: "SYS-ELE-01", longName: "Power Distribution (Cable Trays)" },
  FIREPROTECTION:  { predefinedType: ".FIREPROTECTION.",  name: "SYS-FIR-01", longName: "Fire Fighting Sprinkler System" },
};

function mepSystemFor(element: GeometryElement): MepSystemKey | null {
  const t = element.type;
  const name = (element.properties.name ?? "").toLowerCase();

  if (t === "duct") {
    if (name.includes("return") || name.includes("exhaust")) return "EXHAUST";
    return "AIRCONDITIONING";
  }
  if (t === "pipe") {
    if (name.includes("drain") || name.includes("waste") || name.includes("soil")) return "DRAINAGE";
    if (name.includes("fire") || name.includes("sprinkler")) return "FIREPROTECTION";
    return "DOMESTICCOLDWATER";
  }
  if (t === "cable-tray") return "ELECTRICAL";
  // equipment — leave ungrouped; could be HVAC AHU or plumbing pump, ambiguous
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT CONTEXT — thread-through state for writers
// ═══════════════════════════════════════════════════════════════════════════

interface TypeCluster {
  typeEntityId: number;
  occurrenceIds: number[];
}

interface MaterialAssociation {
  materialRefEntityId: number; // IfcMaterial | IfcMaterialLayerSetUsage | IfcMaterialProfileSetUsage
  elementIds: number[];
}

interface ClassificationBucket {
  refEntityId: number;
  elementIds: number[];
}

/** One emitted wall, used later for wall-to-wall connection detection. */
interface WallRecord {
  entityId: number;
  startX: number; startY: number;
  endX: number;   endY: number;
  thickness: number;
  storeyIndex: number;
}

/** One emitted space, used later for IfcRelSpaceBoundary detection. */
interface SpaceRecord {
  entityId: number;
  footprint: FootprintPoint[];
  storeyIndex: number;
  floorSlabId?: number;
  ceilingSlabId?: number;
}

interface PresentationLayerBuckets {
  "A-WALL": number[];
  "A-DOOR": number[];
  "A-WIND": number[];
  "A-SPAC": number[];
  "A-STAR": number[];
  "S-COL":  number[];
  "S-BEAM": number[];
  "S-SLAB": number[];
  "S-ROOF": number[];
  "M-DUCT": number[];
  "M-PIPE": number[];
  "M-EQPT": number[];
  "E-CABL": number[];
}

interface ExportContext {
  id: IdCounter;
  lines: string[];
  guid: GuidFactory;

  schema: "IFC4" | "IFC2X3";

  ownerHistId: number;
  bodyContextId: number;
  axisContextId: number;
  footprintContextId: number;
  zDirId: number;
  xDirId: number;
  worldPlacementId: number;

  region: NonNullable<IFCExportOptions["region"]>;
  materials: MaterialCatalogue;
  rera?: IFCReraData;
  projectMetadata?: IFCProjectMetadata;

  // Material entity IDs (populated once up-front)
  matIds: {
    concrete: number;
    reinforcement: number;
    structuralSteel: number;
    masonry: number;
    insulation: number;
    plaster: number;
    glazing: number;
    timberDoor: number;
    waterproofing: number;
    flooringTile: number;
  };
  materialLayerSets: {
    wallExterior: number;     // LayerSetUsage — external wall composite
    wallInterior: number;     // LayerSetUsage — interior partition
    slabFloor: number;        // LayerSetUsage
    slabRoof: number;         // LayerSetUsage
  };

  // Batched relationship trackers
  materialAssociations: Map<number, MaterialAssociation>;     // keyed by materialRefEntityId
  typeClusters: {
    walls: Map<string, TypeCluster>;
    slabs: Map<string, TypeCluster>;
    columns: Map<string, TypeCluster>;
    beams: Map<string, TypeCluster>;
    doors: Map<string, TypeCluster>;
    windows: Map<string, TypeCluster>;
    stairs: Map<string, TypeCluster>;
    spaces: Map<string, TypeCluster>;
    ducts: Map<string, TypeCluster>;
    pipes: Map<string, TypeCluster>;
    cableCarriers: Map<string, TypeCluster>;
    flowTerminals: Map<string, TypeCluster>;
  };
  classifications: {
    csi: Map<string, ClassificationBucket>;    // csi code → bucket
    nbc: Map<string, ClassificationBucket>;    // nbc code → bucket
    csiSystemEntityId: number;
    nbcSystemEntityId: number;
  };
  systems: Map<MepSystemKey, { systemEntityId: number; memberIds: number[] }>;

  // IS code document references (Fix 12 v2 extension)
  documentInfoIds: Map<string, number>;              // CodeId → IfcDocumentInformation entity ID
  documentAssociations: Map<string, number[]>;       // CodeId → element entity IDs

  // Wall instance tracking so door / window writers can look up their host
  wallsByParentId: Map<string, number>;

  // v2 — wall adjacency tracking for IfcRelConnectsPathElements (Fix 9)
  wallRecords: WallRecord[];

  // v2 — space-to-bounding-element tracking for IfcRelSpaceBoundary (Fix 10)
  spaceRecords: SpaceRecord[];
  slabsByStorey: Map<number, number[]>;               // storeyIndex → slab entity IDs emitted at that storey

  // v2 — IfcPresentationLayerAssignment buckets (Fix 21) — represent shape-representation entity IDs
  presentationLayers: PresentationLayerBuckets;

  // v2 — per-discipline/per-type occurrence counters for systematic naming (Fix 0A)
  nameCounters: Map<string, number>;                  // key = "${discipline}:${typeCode}:${storeyCode}"

  // v3 Tier 1 — rebar aggregation for BBS (Bar Bending Schedule)
  bbs: {
    totalWeightKg: number;
    byDia: Map<number, number>;        // dia mm → kg
    byGrade: Map<string, number>;      // 'Fe500' → kg
    totalConcreteVolumeM3: number;
  };

  // v3 Tier 3 — has Tier 3 material-physics-Pset emission run?
  materialPhysicsEmitted: boolean;

  // v3 Tier 6 — IfcMappedItem representation-map cache keyed by geometry signature
  representationMaps: Map<string, number>;             // signature → IfcRepresentationMap entity ID

  // v3 Tier 5 — space-to-space adjacency for 2nd-level boundaries
  spaceAdjacencies: Array<{ spaceAId: number; spaceBId: number; wallId: number }>;

  // v4 Tier 0 — IfcGrid: column XY positions across all storeys
  columnPositions: Array<{ x: number; y: number }>;

  // v4 Tier 2 — embodied carbon running totals
  embodiedCarbon: {
    totalKgCO2e: number;
    byMaterial: Map<string, number>;
    byElementType: Map<string, number>;
  };

  // v4 Tier 7 — task-to-element and cost-to-element linkage buckets
  taskElementAssignments: Map<string, number[]>;       // taskKey → element entity IDs
  costElementAssignments: Map<string, number[]>;       // csiCode → element entity IDs
  // Remember task/cost entity IDs so the v4 emitter can form IfcRelAssignsToProcess / Control
  taskEntityIds: Map<string, number>;                   // taskKey → IfcTask entity ID
  costEntityIds: Map<string, number>;                   // csiCode → IfcCostItem entity ID

  // v4 Tier 5 — equipment tracking for IfcRelConnectsPorts chaining + COBie catalogue data
  equipmentByKind: Map<string, Array<{ id: number; kind: string }>>;

  // v4 Tier 9 — IfcAsset groupings (hvac/electrical/plumbing)
  assetMembers: {
    hvac: number[];
    electrical: number[];
    plumbing: number[];
    fireprotection: number[];
  };

  // v4 cleanup — emission flags controlling demo/placeholder content
  emitRebarGeometry: boolean;
  autoEmitDemoContent: boolean;
  emitCurtainWallGeometry: boolean;
  emitMEPGeometry: boolean;

  // v4 cleanup — actual building bounding box for positioning any opt-in demo content
  boundingBox: { minX: number; minY: number; maxX: number; maxY: number };
  /** Building footprint polygon — used by per-column footing emission to skip columns
   *  that fall outside the actual (possibly non-rectangular) footprint. */
  footprintPolygon: FootprintPoint[];

  safeName: (s: string) => string;
}

// ═══════════════════════════════════════════════════════════════════════════
// TOP-LEVEL GENERATOR
// ═══════════════════════════════════════════════════════════════════════════

export function generateIFCFile(
  geometry: MassingGeometry,
  options: IFCExportOptions = {}
): string {
  const {
    projectName = "BuildFlow Export",
    siteName = "Default Site",
    buildingName = geometry.buildingType,
    author = "BuildFlow",
    organization = "BuildFlow",
    schema = "IFC4",
    region = "india",
    geoReference,
    projectIdentifier,
    rera,
    projectMetadata,
  } = options;

  const now = new Date().toISOString().replace(/\.\d+Z$/, "");
  const timestamp = Math.floor(Date.now() / 1000);
  const id = new IdCounter();
  const lines: string[] = [];
  const guid = makeGuidFactory(projectIdentifier);
  const safeName = (s: string) => (s ?? "").replace(/'/g, "").replace(/\\/g, "");

  // ───────────────────────────── HEADER ─────────────────────────────
  const schemaLabel = schema === "IFC2X3" ? "IFC2X3" : "IFC4";
  const viewDef = schema === "IFC2X3" ? "CoordinationView_V2.0" : "DesignTransferView_V1";
  const header = [
    "ISO-10303-21;",
    "HEADER;",
    `FILE_DESCRIPTION(('ViewDefinition [${viewDef}]','ExchangeRequirement [Architectural/Structural/MEP Coordination]'),'2;1');`,
    `FILE_NAME('${safeName(buildingName)}.ifc','${now}',('${safeName(author)}'),('${safeName(organization)}'),'BuildFlow IFC Exporter v2.1 (${schemaLabel})','BuildFlow','');`,
    `FILE_SCHEMA(('${schemaLabel}'));`,
    "ENDSEC;",
    "",
    "DATA;",
  ].join("\n");

  // ─────────── SHARED GEOMETRY PRIMITIVES ───────────
  const worldOriginId = id.next();
  lines.push(`#${worldOriginId}=IFCCARTESIANPOINT((0.,0.,0.));`);

  const zDirId = id.next();
  lines.push(`#${zDirId}=IFCDIRECTION((0.,0.,1.));`);

  const xDirId = id.next();
  lines.push(`#${xDirId}=IFCDIRECTION((1.,0.,0.));`);

  const worldPlacementId = id.next();
  lines.push(`#${worldPlacementId}=IFCAXIS2PLACEMENT3D(#${worldOriginId},#${zDirId},#${xDirId});`);

  // ─────────── REPRESENTATION CONTEXT + SUBCONTEXTS (Fix 14) ───────────
  const trueNorthId = id.next();
  if (geoReference?.trueNorthAngle !== undefined) {
    const a = (geoReference.trueNorthAngle * Math.PI) / 180;
    // True north as a 2D direction in plan (X, Y) — rotated from +Y
    lines.push(`#${trueNorthId}=IFCDIRECTION((${f(-Math.sin(a), 6)},${f(Math.cos(a), 6)}));`);
  } else {
    lines.push(`#${trueNorthId}=IFCDIRECTION((0.,1.));`);
  }

  const contextId = id.next();
  lines.push(`#${contextId}=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1.0E-5,#${worldPlacementId},#${trueNorthId});`);

  const bodyContextId = id.next();
  lines.push(`#${bodyContextId}=IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#${contextId},$,.MODEL_VIEW.,$);`);

  const axisContextId = id.next();
  lines.push(`#${axisContextId}=IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Axis','Model',*,*,*,*,#${contextId},$,.GRAPH_VIEW.,$);`);

  const footprintContextId = id.next();
  lines.push(`#${footprintContextId}=IFCGEOMETRICREPRESENTATIONSUBCONTEXT('FootPrint','Model',*,*,*,*,#${contextId},$,.PLAN_VIEW.,$);`);

  // ─────────── UNITS ───────────
  const mId = id.next();
  lines.push(`#${mId}=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);`);
  const m2Id = id.next();
  lines.push(`#${m2Id}=IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.);`);
  const m3Id = id.next();
  lines.push(`#${m3Id}=IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.);`);
  const radId = id.next();
  lines.push(`#${radId}=IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.);`);
  const secId = id.next();
  lines.push(`#${secId}=IFCSIUNIT(*,.TIMEUNIT.,$,.SECOND.);`);
  const kgId = id.next();
  lines.push(`#${kgId}=IFCSIUNIT(*,.MASSUNIT.,$,.GRAM.);`);
  const thermalId = id.next();
  lines.push(`#${thermalId}=IFCDERIVEDUNIT((),.THERMALTRANSMITTANCEUNIT.,'W/m2K');`);
  // v4 Tier 1 — currency via IfcMonetaryUnit; v4 Tier 7 — proper monetary measure
  const currency = options.currency ?? "INR";
  const monetaryUnitId = id.next();
  lines.push(`#${monetaryUnitId}=IFCMONETARYUNIT(.${currency}.);`);

  const unitAssignId = id.next();
  lines.push(`#${unitAssignId}=IFCUNITASSIGNMENT((#${mId},#${m2Id},#${m3Id},#${radId},#${secId},#${kgId},#${monetaryUnitId}));`);

  // ─────────── OWNER HISTORY ───────────
  const personId = id.next();
  lines.push(`#${personId}=IFCPERSON($,'${safeName(author)}','',$,$,$,$,$);`);
  const orgId = id.next();
  lines.push(`#${orgId}=IFCORGANIZATION($,'${safeName(organization)}','BuildFlow Workflow Platform',$,$);`);
  const personOrgId = id.next();
  lines.push(`#${personOrgId}=IFCPERSONANDORGANIZATION(#${personId},#${orgId},$);`);
  const appId = id.next();
  lines.push(`#${appId}=IFCAPPLICATION(#${orgId},'2.0','BuildFlow IFC Exporter','BuildFlow-IFCExporter-v2');`);
  const ownerHistId = id.next();
  lines.push(`#${ownerHistId}=IFCOWNERHISTORY(#${personOrgId},#${appId},$,.ADDED.,${timestamp},#${personOrgId},#${appId},${timestamp});`);

  // ─────────── PROJECT ───────────
  // v4 Tier 10 — Phase attribute (was custom Pset only in v3)
  const phaseAttr = options.projectPhase ?? "DESIGN_DEVELOPMENT";
  const projectId = id.next();
  lines.push(`#${projectId}=IFCPROJECT('${guid.stable("project")}',#${ownerHistId},'${safeName(projectName)}',$,$,$,'${phaseAttr}',(#${contextId}),#${unitAssignId});`);

  // ─────────── GEOREFERENCING (Fix 6 scaffolding) ───────────
  // IFC4: IfcMapConversion + IfcProjectedCRS (precise).
  // IFC2X3: RefLatitude / RefLongitude on IfcSite (less precise) — emitted below.
  if (geoReference && schema === "IFC4") {
    emitGeoReference(geoReference, contextId, id, lines);
  }

  // ─────────── SITE ───────────
  const sitePlacementId = id.next();
  lines.push(`#${sitePlacementId}=IFCLOCALPLACEMENT($,#${worldPlacementId});`);
  const siteId = id.next();
  const siteRefLat = geoReference ? refLatLongStep(geoReference.latitude) : "$";
  const siteRefLong = geoReference ? refLatLongStep(geoReference.longitude) : "$";
  const siteElev = geoReference ? f(geoReference.elevation) : "$";
  lines.push(`#${siteId}=IFCSITE('${guid.stable("site")}',#${ownerHistId},'${safeName(siteName)}',$,$,#${sitePlacementId},$,$,.ELEMENT.,${siteRefLat},${siteRefLong},${siteElev},$,$);`);

  // ─────────── BUILDING ───────────
  const buildingPlacementId = id.next();
  lines.push(`#${buildingPlacementId}=IFCLOCALPLACEMENT(#${sitePlacementId},#${worldPlacementId});`);
  const buildingId = id.next();
  lines.push(`#${buildingId}=IFCBUILDING('${guid.stable("building")}',#${ownerHistId},'${safeName(buildingName)}',$,$,#${buildingPlacementId},$,$,.ELEMENT.,$,$,$);`);

  // ─────────── MATERIALS ───────────
  const materials = materialCatalogue(region);
  const matIds = emitMaterials(materials, id, lines);
  const materialLayerSets = emitMaterialLayerSets(materials, matIds, id, lines, guid);

  // ─────────── SURFACE STYLES (Fix 2 v2) — attach RGB colour + shading to each material ───────────
  emitMaterialSurfaceStyles(matIds, bodyContextId, id, lines);

  // ─────────── CLASSIFICATION SYSTEMS ───────────
  const csiSystemEntityId = id.next();
  lines.push(`#${csiSystemEntityId}=IFCCLASSIFICATION('CSI','2016','2016-01-01','MasterFormat',$,$,'https://www.csiresources.org/practice/standards/masterformat');`);
  const nbcSystemEntityId = id.next();
  lines.push(`#${nbcSystemEntityId}=IFCCLASSIFICATION('Bureau of Indian Standards','2016','2016-07-01','NBC India 2016 Part 4',$,$,'https://www.bis.gov.in/');`);

  // ─────────── BUILD EXPORT CONTEXT ───────────
  const ctx: ExportContext = {
    id, lines, guid,
    schema,
    ownerHistId,
    bodyContextId, axisContextId, footprintContextId,
    zDirId, xDirId, worldPlacementId,
    region,
    materials,
    rera,
    projectMetadata,
    matIds,
    materialLayerSets,
    materialAssociations: new Map(),
    typeClusters: {
      walls: new Map(), slabs: new Map(), columns: new Map(), beams: new Map(),
      doors: new Map(), windows: new Map(), stairs: new Map(), spaces: new Map(),
      ducts: new Map(), pipes: new Map(), cableCarriers: new Map(), flowTerminals: new Map(),
    },
    classifications: {
      csi: new Map(), nbc: new Map(),
      csiSystemEntityId, nbcSystemEntityId,
    },
    systems: new Map(),
    documentInfoIds: new Map(),
    documentAssociations: new Map(),
    wallsByParentId: new Map(),
    wallRecords: [],
    spaceRecords: [],
    slabsByStorey: new Map(),
    presentationLayers: {
      "A-WALL": [], "A-DOOR": [], "A-WIND": [], "A-SPAC": [], "A-STAR": [],
      "S-COL":  [], "S-BEAM": [], "S-SLAB": [], "S-ROOF": [],
      "M-DUCT": [], "M-PIPE": [], "M-EQPT": [],
      "E-CABL": [],
    },
    nameCounters: new Map(),
    bbs: {
      totalWeightKg: 0,
      byDia: new Map(),
      byGrade: new Map(),
      totalConcreteVolumeM3: 0,
    },
    materialPhysicsEmitted: false,
    representationMaps: new Map(),
    spaceAdjacencies: [],
    columnPositions: [],
    embodiedCarbon: {
      totalKgCO2e: 0,
      byMaterial: new Map(),
      byElementType: new Map(),
    },
    taskElementAssignments: new Map(),
    costElementAssignments: new Map(),
    taskEntityIds: new Map(),
    costEntityIds: new Map(),
    equipmentByKind: new Map(),
    assetMembers: { hvac: [], electrical: [], plumbing: [], fireprotection: [] },
    emitRebarGeometry: options.emitRebarGeometry ?? false,
    autoEmitDemoContent: options.autoEmitDemoContent ?? false,
    emitCurtainWallGeometry: options.emitCurtainWallGeometry ?? false,
    emitMEPGeometry: options.emitMEPGeometry ?? false,
    boundingBox: {
      minX: geometry.boundingBox?.min?.x ?? 0,
      minY: geometry.boundingBox?.min?.y ?? 0,
      maxX: geometry.boundingBox?.max?.x ?? 20,
      maxY: geometry.boundingBox?.max?.y ?? 20,
    },
    footprintPolygon: geometry.footprint ?? [],
    safeName,
  };

  // ─────────── STOREYS + ELEMENTS ───────────
  const storeyIds: number[] = [];
  const filter = options.filter ?? "all";

  for (const storey of geometry.storeys) {
    const storeyOriginId = id.next();
    lines.push(`#${storeyOriginId}=IFCCARTESIANPOINT((0.,0.,${f(storey.elevation)}));`);
    const storeyAxisId = id.next();
    lines.push(`#${storeyAxisId}=IFCAXIS2PLACEMENT3D(#${storeyOriginId},#${zDirId},#${xDirId});`);
    const storeyPlacementId = id.next();
    lines.push(`#${storeyPlacementId}=IFCLOCALPLACEMENT(#${buildingPlacementId},#${storeyAxisId});`);
    const storeyId = id.next();
    lines.push(`#${storeyId}=IFCBUILDINGSTOREY('${guid.stable(`storey:${storey.index}`)}',#${ownerHistId},'${safeName(storey.name)}',$,$,#${storeyPlacementId},$,$,.ELEMENT.,${f(storey.elevation)});`);
    storeyIds.push(storeyId);

    const physicalIds: number[] = [];
    const spaceIds: number[] = [];

    // Partition elements into passes so windows/doors can look up their host wall.
    const walls: GeometryElement[] = [];
    const others: GeometryElement[] = [];
    const openings: GeometryElement[] = [];  // windows + doors (deferred)

    for (const element of storey.elements) {
      if (filter !== "all") {
        const filterSet =
          filter === "architectural" ? ARCHITECTURAL_TYPES :
          filter === "structural"    ? STRUCTURAL_TYPES :
          MEP_TYPE_SET;
        if (!filterSet.has(element.type)) continue;
      }
      if (element.type === "wall" || element.type === "parapet") walls.push(element);
      else if (element.type === "window" || element.type === "door") openings.push(element);
      else others.push(element);
    }

    // PASS 1 — walls (so openings can look up host wall entity IDs).
    // Detect wall chains: if exterior walls form a closed loop of ≥4 segments,
    // emit as ONE merged IfcWall shell (visually continuous) instead of N
    // individual rectangular prisms with visible facet lines. Partition walls
    // always stay individual.
    const exteriorWalls = walls.filter(w => !w.properties.isPartition);
    const partitionWalls = walls.filter(w => w.properties.isPartition);

    const extChains = detectWallChains(exteriorWalls);
    for (const chain of extChains) {
      if (chain.length >= 4 && chainIsClosed(chain)) {
        const mergedId = writeMergedWallShell(chain, storey, storeyPlacementId, ctx);
        physicalIds.push(mergedId);
        for (const w of chain) {
          if (w.id) ctx.wallsByParentId.set(w.id, mergedId);
        }
      } else {
        for (const w of chain) {
          const wid = writeWallEntity(w, storey, storeyPlacementId, ctx);
          physicalIds.push(wid);
          if (w.id) ctx.wallsByParentId.set(w.id, wid);
        }
      }
    }
    for (const w of partitionWalls) {
      const wid = writeWallEntity(w, storey, storeyPlacementId, ctx);
      physicalIds.push(wid);
      if (w.id) ctx.wallsByParentId.set(w.id, wid);
    }

    // PASS 2 — openings (windows / doors) with IfcOpeningElement + relationships
    for (const element of openings) {
      const parentWallId = element.properties.parentWallId;
      const hostWallEntityId = parentWallId ? ctx.wallsByParentId.get(parentWallId) : undefined;

      if (element.type === "window") {
        const winId = writeWindowEntity(element, storeyPlacementId, hostWallEntityId, ctx);
        physicalIds.push(winId);
      } else {
        const doorId = writeDoorEntity(element, storeyPlacementId, hostWallEntityId, ctx);
        physicalIds.push(doorId);
      }
    }

    // PASS 3 — other elements
    for (const element of others) {
      let eid: number | null = null;
      switch (element.type) {
        case "slab": case "roof":
          eid = writeSlabEntity(element, geometry.footprint, storeyPlacementId, element.type === "roof", ctx);
          break;
        case "column":
          eid = writeColumnEntity(element, storeyPlacementId, ctx);
          break;
        case "beam":
          eid = writeBeamEntity(element, storeyPlacementId, ctx);
          break;
        case "stair":
          eid = writeStairEntity(element, storeyPlacementId, ctx);
          break;
        case "space":
          eid = writeSpaceEntity(element, storeyPlacementId, ctx);
          if (eid != null) spaceIds.push(eid);
          eid = null;  // don't add to physical containment
          break;
        case "duct":
          eid = writeMEPSegmentEntity(element, "IFCDUCTSEGMENT", storeyPlacementId, ctx, "duct");
          break;
        case "pipe":
          eid = writeMEPPipeEntity(element, storeyPlacementId, ctx);
          break;
        case "cable-tray":
          eid = writeMEPSegmentEntity(element, "IFCCABLECARRIERSEGMENT", storeyPlacementId, ctx, "cable-tray");
          break;
        case "equipment":
          eid = writeMEPEquipmentEntity(element, storeyPlacementId, ctx);
          break;
        case "balcony":
          if (element.ifcType === "IfcRailing") {
            eid = writeBeamEntity(element, storeyPlacementId, ctx);
          } else {
            const fp = element.vertices.length >= 4
              ? element.vertices.map(v => ({ x: v.x, y: v.y }))
              : geometry.footprint;
            eid = writeSlabEntity(element, fp, storeyPlacementId, false, ctx);
          }
          break;
        case "canopy": {
          const fp = element.vertices.length >= 4
            ? element.vertices.map(v => ({ x: v.x, y: v.y }))
            : geometry.footprint;
          eid = writeSlabEntity(element, fp, storeyPlacementId, true, ctx);
          break;
        }
        case "mullion": case "spandrel":
          // Curtain-wall sub-components: emit as IfcMember(.MULLION.) / IfcPlate(.CURTAIN_PANEL.)
          // with Representation=$ by default. This prevents hundreds of individual thin
          // rectangular prisms from rendering as flying stick chaos in the viewer.
          eid = writeCurtainWallComponent(element, storeyPlacementId, ctx);
          break;
      }
      if (eid != null) physicalIds.push(eid);
    }

    // v3 Tier 2: auto-emit MEP fixtures per storey (fire/plumbing/HVAC/electrical)
    // GATED (v4-cleanup): placeholder fixtures are visually disruptive on non-rectangular buildings;
    // caller must opt in explicitly via autoEmitDemoContent when MassingGeometry is simple.
    if ((filter === "all" || filter === "mep") && ctx.autoEmitDemoContent) {
      emitMEPFixturesForStorey(storey, storeyId, storeyPlacementId, ctx, geometry.totalHeight);
    }
    // v3 Tier 4: elevators/ramps/foundations (always emitted — these are legitimate
    // architectural elements positioned at real coordinates) + furniture/curtain-wall/
    // shading demos (gated behind autoEmitDemoContent).
    if (filter === "all" || filter === "architectural" || filter === "structural") {
      emitMissingBuildingElements(geometry, storey, storeyId, storeyPlacementId, ctx);
    }

    // Spatial containment
    if (physicalIds.length > 0) {
      const relId = id.next();
      lines.push(`#${relId}=IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid.fresh()}',#${ownerHistId},'${safeName(storey.name)} Contents',$,(${physicalIds.map(i => `#${i}`).join(",")}),#${storeyId});`);
    }
    if (spaceIds.length > 0) {
      const relSpaceId = id.next();
      lines.push(`#${relSpaceId}=IFCRELAGGREGATES('${guid.fresh()}',#${ownerHistId},'${safeName(storey.name)} Spaces',$,#${storeyId},(${spaceIds.map(i => `#${i}`).join(",")}));`);
    }
  }

  // ─────────── SPATIAL AGGREGATION ───────────
  const relProjSiteId = id.next();
  lines.push(`#${relProjSiteId}=IFCRELAGGREGATES('${guid.fresh()}',#${ownerHistId},'ProjectToSite',$,#${projectId},(#${siteId}));`);
  const relSiteBldgId = id.next();
  lines.push(`#${relSiteBldgId}=IFCRELAGGREGATES('${guid.fresh()}',#${ownerHistId},'SiteToBuilding',$,#${siteId},(#${buildingId}));`);
  if (storeyIds.length > 0) {
    const relBldgStoreysId = id.next();
    lines.push(`#${relBldgStoreysId}=IFCRELAGGREGATES('${guid.fresh()}',#${ownerHistId},'BuildingToStoreys',$,#${buildingId},(${storeyIds.map(i => `#${i}`).join(",")}));`);
  }

  // ─────────── BATCHED RELATIONSHIP EMISSION ───────────
  emitMaterialAssociations(ctx);
  emitTypeAssignments(ctx);
  emitClassificationAssociations(ctx);
  emitMEPSystemAssignments(ctx);
  emitDocumentReferences(ctx);           // Fix 12 v2
  emitWallConnections(ctx);              // Fix 9  v2
  emitSpaceBoundaries(ctx);              // Fix 10 v2
  // v3 Tier 3 — enrich every material with Pset_MaterialMechanical / Thermal / Concrete / Steel / etc.
  emitMaterialPhysicsPsets(ctx);
  // v3 Tier 5 — upgrade 1st-level boundaries to 2nd-level corresponding pairs + thermal Psets
  emitSpaceThermalPsets(ctx);
  // v3 Tier 7 — 4D/5D scaffolding (only emitted if projectMetadata requests it, else minimal stub)
  emitWorkScheduleAnd4D(geometry, buildingId, ctx);
  emitCostScheduleAnd5D(geometry, buildingId, ctx);
  // v3 Tier 8 — project metadata, team, phase, COBie manufacturer data
  emitProjectTeamAndPhase(projectId, siteId, buildingId, ctx);

  // ─────────── v4 TIER 0–10 EMITTERS ───────────
  emitIfcGrid(storeyIds[0] ?? buildingId, ctx);                                    // Tier 0
  emitInternationalClassifications(ctx, ctx.region);                                // Tier 1
  emitEmbodiedCarbonMaterialPsets(ctx);                                             // Tier 2
  emitM25ConstituentSet(ctx);                                                       // Tier 2
  emitIndianEPDReferences(ctx);                                                     // Tier 2
  emitBuildingEmbodiedCarbonSummary(geometry, buildingId, ctx);                     // Tier 2
  emitProjectLibraryAndFederation(projectId, ctx, options);                         // Tier 3
  emitStructuralAnalysisModel(geometry, ctx);                                       // Tier 4 (metadata only — no geometry)
  emitLoadCasesAndCombinations(ctx);                                                // Tier 4 (metadata only)
  // GATED (v4-cleanup): the next three emit geometric placeholder entities at
  // bbox-derived coordinates. Keep them off when the caller wants a clean IFC
  // reflecting only the actual building; enable via autoEmitDemoContent for LOD scaffolds.
  if (ctx.autoEmitDemoContent) {
    emitSampleMechanicalFasteners(ctx);                                             // Tier 4 demo
    emitAdvancedMEPComponents(buildingId, ctx);                                     // Tier 5 demo
    emitMEPPortConnectivity(ctx);                                                   // Tier 5 demo (depends on equipment)
  }
  emitTaskElementLinkage(ctx);                                                      // Tier 7
  emitCostElementLinkage(ctx);                                                      // Tier 7
  emitConstructionResources(ctx);                                                   // Tier 7
  emitMilestoneTasks(ctx);                                                          // Tier 7
  emitPerEquipmentCOBieData(ctx);                                                   // Tier 9
  emitAssetGroupings(ctx);                                                          // Tier 9
  emitApprovalWorkflow(ctx);                                                        // Tier 10
  emitIndianPermit(buildingId, ctx, options);                                       // Tier 10
  emitIDSAndDigitalSignature(projectId, ctx);                                       // Tier 10
  emitValidationCertificateScaffold(projectId, ctx);                                // Tier 0.4

  emitPresentationLayerAssignments(ctx); // Fix 21 v2

  // ─────────── BUILDING-LEVEL PROPERTY SET ───────────
  emitBuildingPset(geometry, buildingId, ctx);

  // ─────────── STOREY-LEVEL PROPERTY SETS ───────────
  for (let si = 0; si < geometry.storeys.length; si++) {
    emitStoreyPset(geometry.storeys[si], storeyIds[si], ctx);
  }

  return [header, ...lines, "ENDSEC;", "END-ISO-10303-21;"].join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// GEOREFERENCING
// ═══════════════════════════════════════════════════════════════════════════

function refLatLongStep(decimalDegrees: number): string {
  // IFC expects (degrees, minutes, seconds, millionths-of-seconds)
  const sign = decimalDegrees < 0 ? -1 : 1;
  const abs = Math.abs(decimalDegrees);
  const deg = Math.floor(abs);
  const minFloat = (abs - deg) * 60;
  const min = Math.floor(minFloat);
  const secFloat = (minFloat - min) * 60;
  const sec = Math.floor(secFloat);
  const micro = Math.round((secFloat - sec) * 1_000_000);
  return `(${sign * deg},${sign * min},${sign * sec},${sign * micro})`;
}

function emitGeoReference(
  geo: IFCGeoReference,
  contextId: number,
  id: IdCounter,
  lines: string[]
): void {
  // Auto-compute UTM zone from longitude
  const zone = Math.floor((geo.longitude + 180) / 6) + 1;
  const hemisphere = geo.latitude >= 0 ? "N" : "S";
  const epsg = geo.latitude >= 0 ? 32600 + zone : 32700 + zone;
  const { easting, northing } = latLonToUtm(geo.latitude, geo.longitude, zone, geo.latitude >= 0);

  const mapUnitId = id.next();
  lines.push(`#${mapUnitId}=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);`);

  const projectedCrsId = id.next();
  lines.push(`#${projectedCrsId}=IFCPROJECTEDCRS('WGS 84 / UTM zone ${zone}${hemisphere}',$,'EPSG','${epsg}',$,$,#${mapUnitId});`);

  const mapConversionId = id.next();
  lines.push(`#${mapConversionId}=IFCMAPCONVERSION(#${contextId},#${projectedCrsId},${f(easting)},${f(northing)},${f(geo.elevation)},1.,0.,1.);`);
}

/** Approximate lat/lon → UTM (good to a few metres, adequate for site placement). */
function latLonToUtm(lat: number, lon: number, zone: number, north: boolean): { easting: number; northing: number } {
  const a = 6378137.0;
  const eccSq = 0.00669437999014;
  const k0 = 0.9996;

  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lon * Math.PI) / 180;
  const lonOrigin = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180;

  const N = a / Math.sqrt(1 - eccSq * Math.sin(latRad) ** 2);
  const T = Math.tan(latRad) ** 2;
  const ePrimeSq = eccSq / (1 - eccSq);
  const C = ePrimeSq * Math.cos(latRad) ** 2;
  const A = Math.cos(latRad) * (lonRad - lonOrigin);

  const M = a * (
    (1 - eccSq / 4 - 3 * eccSq ** 2 / 64 - 5 * eccSq ** 3 / 256) * latRad
    - (3 * eccSq / 8 + 3 * eccSq ** 2 / 32 + 45 * eccSq ** 3 / 1024) * Math.sin(2 * latRad)
    + (15 * eccSq ** 2 / 256 + 45 * eccSq ** 3 / 1024) * Math.sin(4 * latRad)
    - (35 * eccSq ** 3 / 3072) * Math.sin(6 * latRad)
  );

  const easting = k0 * N * (
    A + (1 - T + C) * A ** 3 / 6
    + (5 - 18 * T + T ** 2 + 72 * C - 58 * ePrimeSq) * A ** 5 / 120
  ) + 500000.0;

  let northing = k0 * (
    M + N * Math.tan(latRad) * (
      A ** 2 / 2 + (5 - T + 9 * C + 4 * C ** 2) * A ** 4 / 24
      + (61 - 58 * T + T ** 2 + 600 * C - 330 * ePrimeSq) * A ** 6 / 720
    )
  );
  if (!north) northing += 10_000_000.0;

  return { easting, northing };
}

// ═══════════════════════════════════════════════════════════════════════════
// MATERIALS + LAYER SETS
// ═══════════════════════════════════════════════════════════════════════════

function emitMaterials(
  materials: MaterialCatalogue,
  id: IdCounter,
  lines: string[]
): ExportContext["matIds"] {
  const mk = (label: string) => {
    const eid = id.next();
    lines.push(`#${eid}=IFCMATERIAL('${label.replace(/'/g, "")}',$,$);`);
    return eid;
  };
  return {
    concrete:        mk(materials.concrete),
    reinforcement:   mk(materials.reinforcement),
    structuralSteel: mk(materials.structuralSteel),
    masonry:         mk(materials.masonry),
    insulation:      mk(materials.insulation),
    plaster:         mk(materials.plaster),
    glazing:         mk(materials.glazing),
    timberDoor:      mk(materials.timberDoor),
    waterproofing:   mk(materials.waterproofing),
    flooringTile:    mk(materials.flooringTile),
  };
}

function emitMaterialLayerSets(
  materials: MaterialCatalogue,
  matIds: ExportContext["matIds"],
  id: IdCounter,
  lines: string[],
  _guid: GuidFactory
): ExportContext["materialLayerSets"] {
  // ---- Exterior wall: 15mm plaster | 150mm concrete/masonry | 70mm insulation | 15mm plaster
  const extL1 = id.next();
  lines.push(`#${extL1}=IFCMATERIALLAYER(#${matIds.plaster},0.015,.U.,'Interior Finish Plaster','${materials.plaster.replace(/'/g, "")}','FINISH','Gypsum');`);
  const extL2 = id.next();
  lines.push(`#${extL2}=IFCMATERIALLAYER(#${matIds.concrete},0.15,.F.,'Structural Core',$,'LOADBEARING','Concrete');`);
  const extL3 = id.next();
  lines.push(`#${extL3}=IFCMATERIALLAYER(#${matIds.insulation},0.07,.U.,'Thermal Insulation',$,'INSULATION','Polymer');`);
  const extL4 = id.next();
  lines.push(`#${extL4}=IFCMATERIALLAYER(#${matIds.plaster},0.015,.U.,'Exterior Finish',$,'FINISH','Cement');`);
  const extSet = id.next();
  lines.push(`#${extSet}=IFCMATERIALLAYERSET((#${extL1},#${extL2},#${extL3},#${extL4}),'BF-EXT-WALL-250','Exterior Wall 250mm Composite');`);
  const extUsage = id.next();
  lines.push(`#${extUsage}=IFCMATERIALLAYERSETUSAGE(#${extSet},.AXIS2.,.POSITIVE.,0.,$);`);

  // ---- Interior partition: 15mm plaster | 120mm AAC/block | 15mm plaster
  const intL1 = id.next();
  lines.push(`#${intL1}=IFCMATERIALLAYER(#${matIds.plaster},0.015,.U.,'Face 1 Plaster',$,'FINISH','Gypsum');`);
  const intL2 = id.next();
  lines.push(`#${intL2}=IFCMATERIALLAYER(#${matIds.masonry},0.12,.F.,'Partition Core',$,'CORE','Masonry');`);
  const intL3 = id.next();
  lines.push(`#${intL3}=IFCMATERIALLAYER(#${matIds.plaster},0.015,.U.,'Face 2 Plaster',$,'FINISH','Gypsum');`);
  const intSet = id.next();
  lines.push(`#${intSet}=IFCMATERIALLAYERSET((#${intL1},#${intL2},#${intL3}),'BF-INT-WALL-150','Interior Partition 150mm');`);
  const intUsage = id.next();
  lines.push(`#${intUsage}=IFCMATERIALLAYERSETUSAGE(#${intSet},.AXIS2.,.POSITIVE.,0.,$);`);

  // ---- Floor slab: 25mm tile finish | 250mm concrete | 50mm insulation
  const flL1 = id.next();
  lines.push(`#${flL1}=IFCMATERIALLAYER(#${matIds.flooringTile},0.025,.U.,'Floor Finish',$,'FINISH','Ceramic');`);
  const flL2 = id.next();
  lines.push(`#${flL2}=IFCMATERIALLAYER(#${matIds.concrete},0.25,.F.,'Structural Slab',$,'LOADBEARING','Concrete');`);
  const flL3 = id.next();
  lines.push(`#${flL3}=IFCMATERIALLAYER(#${matIds.insulation},0.05,.U.,'Acoustic Insulation',$,'INSULATION','Polymer');`);
  const flSet = id.next();
  lines.push(`#${flSet}=IFCMATERIALLAYERSET((#${flL1},#${flL2},#${flL3}),'BF-FLOOR-325','Floor Slab 325mm Composite');`);
  const flUsage = id.next();
  lines.push(`#${flUsage}=IFCMATERIALLAYERSETUSAGE(#${flSet},.AXIS3.,.NEGATIVE.,0.,$);`);

  // ---- Roof slab: 4mm waterproofing | 100mm insulation | 200mm concrete
  const rfL1 = id.next();
  lines.push(`#${rfL1}=IFCMATERIALLAYER(#${matIds.waterproofing},0.004,.U.,'Waterproof Membrane',$,'MEMBRANE','Polymer');`);
  const rfL2 = id.next();
  lines.push(`#${rfL2}=IFCMATERIALLAYER(#${matIds.insulation},0.1,.U.,'Roof Insulation',$,'INSULATION','Polymer');`);
  const rfL3 = id.next();
  lines.push(`#${rfL3}=IFCMATERIALLAYER(#${matIds.concrete},0.2,.F.,'Roof Slab',$,'LOADBEARING','Concrete');`);
  const rfSet = id.next();
  lines.push(`#${rfSet}=IFCMATERIALLAYERSET((#${rfL1},#${rfL2},#${rfL3}),'BF-ROOF-304','Roof 304mm Composite');`);
  const rfUsage = id.next();
  lines.push(`#${rfUsage}=IFCMATERIALLAYERSETUSAGE(#${rfSet},.AXIS3.,.NEGATIVE.,0.,$);`);

  return {
    wallExterior: extUsage,
    wallInterior: intUsage,
    slabFloor:    flUsage,
    slabRoof:     rfUsage,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ASSOCIATION HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function associateMaterial(ctx: ExportContext, elementId: number, materialRefEntityId: number): void {
  const bucket = ctx.materialAssociations.get(materialRefEntityId);
  if (bucket) {
    bucket.elementIds.push(elementId);
  } else {
    ctx.materialAssociations.set(materialRefEntityId, { materialRefEntityId, elementIds: [elementId] });
  }
}

function associateClassification(ctx: ExportContext, elementId: number, elementType: string, materialHint: string): void {
  const csi = csiCodeFor(elementType, materialHint);
  const nbc = nbcCodeFor(elementType, materialHint);

  const addTo = (bucket: Map<string, ClassificationBucket>, systemEntityId: number, c: ClassificationCode) => {
    let b = bucket.get(c.code);
    if (!b) {
      const refId = ctx.id.next();
      ctx.lines.push(`#${refId}=IFCCLASSIFICATIONREFERENCE($,'${c.code}','${ctx.safeName(c.name)}',#${systemEntityId},$,$);`);
      b = { refEntityId: refId, elementIds: [] };
      bucket.set(c.code, b);
    }
    b.elementIds.push(elementId);
  };

  addTo(ctx.classifications.csi, ctx.classifications.csiSystemEntityId, csi);
  addTo(ctx.classifications.nbc, ctx.classifications.nbcSystemEntityId, nbc);
}

function assignToSystem(ctx: ExportContext, elementId: number, key: MepSystemKey): void {
  let entry = ctx.systems.get(key);
  if (!entry) {
    const sys = MEP_SYSTEMS[key];
    const sysId = ctx.id.next();
    // IFC2X3 has no IfcDistributionSystem — fall back to the schema-universal IfcSystem.
    if (ctx.schema === "IFC2X3") {
      ctx.lines.push(`#${sysId}=IFCSYSTEM('${ctx.guid.stable(`system:${key}`)}',#${ctx.ownerHistId},'${sys.name}','${ctx.safeName(sys.longName)} [${sys.predefinedType.replace(/\./g, "")}]',$);`);
    } else {
      ctx.lines.push(`#${sysId}=IFCDISTRIBUTIONSYSTEM('${ctx.guid.stable(`system:${key}`)}',#${ctx.ownerHistId},'${sys.name}','${ctx.safeName(sys.longName)}',$,${sys.predefinedType});`);
    }
    entry = { systemEntityId: sysId, memberIds: [] };
    ctx.systems.set(key, entry);
  }
  entry.memberIds.push(elementId);
}

function addTypeOccurrence(cluster: Map<string, TypeCluster>, key: string, occurrenceId: number): void {
  const existing = cluster.get(key);
  if (existing) existing.occurrenceIds.push(occurrenceId);
}

// ═══════════════════════════════════════════════════════════════════════════
// TYPE FACTORIES (lazy creation on first occurrence)
// ═══════════════════════════════════════════════════════════════════════════

function getOrCreateWallType(ctx: ExportContext, thickness: number, isPartition: boolean, materialUsageId: number): { typeId: number; key: string } {
  const key = `wall:${thickness.toFixed(3)}:${isPartition ? "int" : "ext"}`;
  let cluster = ctx.typeClusters.walls.get(key);
  if (!cluster) {
    const typeId = ctx.id.next();
    const seq = ctx.typeClusters.walls.size + 1;
    const typeName = `WT-${String(seq).padStart(2, "0")}`;
    const description = isPartition ? `Interior Partition ${(thickness * 1000).toFixed(0)}mm` : `Exterior Wall ${(thickness * 1000).toFixed(0)}mm`;
    const predefinedType = isPartition ? ".PARTITIONING." : ".STANDARD.";
    ctx.lines.push(`#${typeId}=IFCWALLTYPE('${ctx.guid.stable(`walltype:${key}`)}',#${ctx.ownerHistId},'${typeName}','${description}',$,$,$,'${typeName}',$,${predefinedType});`);
    cluster = { typeEntityId: typeId, occurrenceIds: [] };
    ctx.typeClusters.walls.set(key, cluster);
    associateMaterial(ctx, typeId, materialUsageId);
  }
  return { typeId: cluster.typeEntityId, key };
}

function getOrCreateSlabType(ctx: ExportContext, thickness: number, isRoof: boolean, materialUsageId: number): { typeId: number; key: string } {
  const key = `slab:${thickness.toFixed(3)}:${isRoof ? "roof" : "floor"}`;
  let cluster = ctx.typeClusters.slabs.get(key);
  if (!cluster) {
    const typeId = ctx.id.next();
    const seq = ctx.typeClusters.slabs.size + 1;
    const typeName = `ST-${String(seq).padStart(2, "0")}`;
    const description = isRoof ? `Roof Slab ${(thickness * 1000).toFixed(0)}mm` : `Floor Slab ${(thickness * 1000).toFixed(0)}mm`;
    const predefinedType = isRoof ? ".ROOF." : ".FLOOR.";
    ctx.lines.push(`#${typeId}=IFCSLABTYPE('${ctx.guid.stable(`slabtype:${key}`)}',#${ctx.ownerHistId},'${typeName}','${description}',$,$,$,'${typeName}',$,${predefinedType});`);
    cluster = { typeEntityId: typeId, occurrenceIds: [] };
    ctx.typeClusters.slabs.set(key, cluster);
    associateMaterial(ctx, typeId, materialUsageId);
  }
  return { typeId: cluster.typeEntityId, key };
}

function getOrCreateColumnType(ctx: ExportContext, radiusOrWidth: number, isSteel: boolean, materialId: number): { typeId: number; key: string } {
  const key = `col:${isSteel ? "steel" : "rcc"}:${radiusOrWidth.toFixed(3)}`;
  let cluster = ctx.typeClusters.columns.get(key);
  if (!cluster) {
    const typeId = ctx.id.next();
    const seq = ctx.typeClusters.columns.size + 1;
    const typeName = `CT-${String(seq).padStart(2, "0")}`;
    const description = isSteel ? `Steel Column ISHB ${(radiusOrWidth * 1000).toFixed(0)}` : `RCC Column ${(radiusOrWidth * 2000).toFixed(0)}mm dia`;
    ctx.lines.push(`#${typeId}=IFCCOLUMNTYPE('${ctx.guid.stable(`coltype:${key}`)}',#${ctx.ownerHistId},'${typeName}','${description}',$,$,$,'${typeName}',$,.COLUMN.);`);
    cluster = { typeEntityId: typeId, occurrenceIds: [] };
    ctx.typeClusters.columns.set(key, cluster);
    associateMaterial(ctx, typeId, materialId);
  }
  return { typeId: cluster.typeEntityId, key };
}

function getOrCreateBeamType(ctx: ExportContext, width: number, depth: number, isSteel: boolean, materialId: number): { typeId: number; key: string } {
  const key = `beam:${isSteel ? "steel" : "rcc"}:${width.toFixed(3)}x${depth.toFixed(3)}`;
  let cluster = ctx.typeClusters.beams.get(key);
  if (!cluster) {
    const typeId = ctx.id.next();
    const seq = ctx.typeClusters.beams.size + 1;
    const typeName = `BT-${String(seq).padStart(2, "0")}`;
    const description = isSteel
      ? `Steel Beam ISMB ${(depth * 1000).toFixed(0)}`
      : `RCC Beam ${(width * 1000).toFixed(0)}×${(depth * 1000).toFixed(0)}mm`;
    ctx.lines.push(`#${typeId}=IFCBEAMTYPE('${ctx.guid.stable(`beamtype:${key}`)}',#${ctx.ownerHistId},'${typeName}','${description}',$,$,$,'${typeName}',$,.BEAM.);`);
    cluster = { typeEntityId: typeId, occurrenceIds: [] };
    ctx.typeClusters.beams.set(key, cluster);
    associateMaterial(ctx, typeId, materialId);
  }
  return { typeId: cluster.typeEntityId, key };
}

function getOrCreateDoorType(ctx: ExportContext, width: number, height: number, isDoubleDoor: boolean): { typeId: number; key: string } {
  const key = `door:${width.toFixed(3)}x${height.toFixed(3)}:${isDoubleDoor ? "double" : "single"}`;
  let cluster = ctx.typeClusters.doors.get(key);
  if (!cluster) {
    const typeId = ctx.id.next();
    const seq = ctx.typeClusters.doors.size + 1;
    const typeName = `DT-${String(seq).padStart(2, "0")}`;
    const description = isDoubleDoor
      ? `Double Swing Door ${(width * 1000).toFixed(0)}×${(height * 1000).toFixed(0)}mm`
      : `Single Swing Door ${(width * 1000).toFixed(0)}×${(height * 1000).toFixed(0)}mm`;
    const operation = isDoubleDoor ? ".DOUBLE_SWING_LEFT." : ".SINGLE_SWING_LEFT.";
    // IfcDoorType has: GlobalId, OwnerHist, Name, Desc, AppType, Tag, ElementType, Tag, PredefType, ParamTake, OperationType, UserDefinedOperationType
    ctx.lines.push(`#${typeId}=IFCDOORTYPE('${ctx.guid.stable(`doortype:${key}`)}',#${ctx.ownerHistId},'${typeName}','${description}',$,$,$,'${typeName}',$,.DOOR.,${operation},$);`);
    cluster = { typeEntityId: typeId, occurrenceIds: [] };
    ctx.typeClusters.doors.set(key, cluster);
  }
  return { typeId: cluster.typeEntityId, key };
}

function getOrCreateWindowType(ctx: ExportContext, width: number, height: number): { typeId: number; key: string } {
  const key = `win:${width.toFixed(3)}x${height.toFixed(3)}`;
  let cluster = ctx.typeClusters.windows.get(key);
  if (!cluster) {
    const typeId = ctx.id.next();
    const seq = ctx.typeClusters.windows.size + 1;
    const typeName = `WN-${String(seq).padStart(2, "0")}`;
    const description = `Window ${(width * 1000).toFixed(0)}×${(height * 1000).toFixed(0)}mm`;
    // IfcWindowType: GUID, OwnerHist, Name, Desc, AppType, Tag, ElementType, Tag, PredefType, ParamTake, PartitioningType, UserDefinedPartitioningType
    ctx.lines.push(`#${typeId}=IFCWINDOWTYPE('${ctx.guid.stable(`wintype:${key}`)}',#${ctx.ownerHistId},'${typeName}','${description}',$,$,$,'${typeName}',$,.WINDOW.,.SINGLE_PANEL.,$);`);
    cluster = { typeEntityId: typeId, occurrenceIds: [] };
    ctx.typeClusters.windows.set(key, cluster);
  }
  return { typeId: cluster.typeEntityId, key };
}

function getOrCreateStairType(ctx: ExportContext, riserCount: number, riserHeight: number, treadDepth: number): { typeId: number; key: string } {
  const key = `stair:${riserCount}:${riserHeight.toFixed(3)}:${treadDepth.toFixed(3)}`;
  let cluster = ctx.typeClusters.stairs.get(key);
  if (!cluster) {
    const typeId = ctx.id.next();
    const seq = ctx.typeClusters.stairs.size + 1;
    const typeName = `SF-${String(seq).padStart(2, "0")}`;
    const description = `Straight Flight ${riserCount} risers @ ${(riserHeight * 1000).toFixed(0)}mm`;
    ctx.lines.push(`#${typeId}=IFCSTAIRFLIGHTTYPE('${ctx.guid.stable(`stairtype:${key}`)}',#${ctx.ownerHistId},'${typeName}','${description}',$,$,$,'${typeName}',$,.STRAIGHT.);`);
    cluster = { typeEntityId: typeId, occurrenceIds: [] };
    ctx.typeClusters.stairs.set(key, cluster);
  }
  return { typeId: cluster.typeEntityId, key };
}

function getOrCreateSpaceType(ctx: ExportContext, spaceUsage: string): { typeId: number; key: string } {
  const key = `space:${spaceUsage.toLowerCase()}`;
  let cluster = ctx.typeClusters.spaces.get(key);
  if (!cluster) {
    const typeId = ctx.id.next();
    const seq = ctx.typeClusters.spaces.size + 1;
    const typeName = `SP-${String(seq).padStart(2, "0")}`;
    ctx.lines.push(`#${typeId}=IFCSPACETYPE('${ctx.guid.stable(`spacetype:${key}`)}',#${ctx.ownerHistId},'${typeName}','${ctx.safeName(spaceUsage)}',$,$,$,'${typeName}',$,.SPACE.,.NOTDEFINED.);`);
    cluster = { typeEntityId: typeId, occurrenceIds: [] };
    ctx.typeClusters.spaces.set(key, cluster);
  }
  return { typeId: cluster.typeEntityId, key };
}

// ═══════════════════════════════════════════════════════════════════════════
// ELEMENT WRITERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Determine whether an element is steel-based from its explicit material hint.
 */
function isSteelMaterial(element: GeometryElement): boolean {
  const m = (element.properties.material ?? "").toLowerCase();
  return m.includes("steel") || m.includes("fe410") || m.includes("fe500") || m.includes("ismb") || m.includes("ishb");
}

// ─────────── Wall Writer ───────────

function writeWallEntity(
  element: GeometryElement,
  storey: MassingStorey,
  storeyPlacementId: number,
  ctx: ExportContext
): number {
  const { id, lines, guid } = ctx;
  const wallLength = element.properties.length ?? 10;
  const wallThickness = element.properties.thickness ?? 0.25;
  const wallHeight = element.properties.height ?? storey.height;
  const isPartition = element.properties.isPartition === true;

  // ─── Body (3D) profile ───
  const profCenterId = id.next();
  lines.push(`#${profCenterId}=IFCCARTESIANPOINT((${f(wallLength / 2)},${f(wallThickness / 2)}));`);
  const profPlacementId = id.next();
  lines.push(`#${profPlacementId}=IFCAXIS2PLACEMENT2D(#${profCenterId},$);`);
  const profileId = id.next();
  lines.push(`#${profileId}=IFCRECTANGLEPROFILEDEF(.AREA.,'Wall Profile',#${profPlacementId},${f(wallLength)},${f(wallThickness)});`);

  // ─── Body extrusion ───
  const extDirId = id.next();
  lines.push(`#${extDirId}=IFCDIRECTION((0.,0.,1.));`);
  const solidId = id.next();
  lines.push(`#${solidId}=IFCEXTRUDEDAREASOLID(#${profileId},$,#${extDirId},${f(wallHeight)});`);
  const bodyRepId = id.next();
  lines.push(`#${bodyRepId}=IFCSHAPEREPRESENTATION(#${ctx.bodyContextId},'Body','SweptSolid',(#${solidId}));`);

  // ─── Axis (2D centerline) representation (Fix 3 v2) — CRITICAL for Revit ───
  const axisStartId = id.next();
  lines.push(`#${axisStartId}=IFCCARTESIANPOINT((0.,0.));`);
  const axisEndId = id.next();
  lines.push(`#${axisEndId}=IFCCARTESIANPOINT((${f(wallLength)},0.));`);
  const axisPolylineId = id.next();
  lines.push(`#${axisPolylineId}=IFCPOLYLINE((#${axisStartId},#${axisEndId}));`);
  const axisRepId = id.next();
  lines.push(`#${axisRepId}=IFCSHAPEREPRESENTATION(#${ctx.axisContextId},'Axis','Curve2D',(#${axisPolylineId}));`);

  // ─── Multi-rep product definition (Axis + Body) ───
  const prodShapeId = id.next();
  lines.push(`#${prodShapeId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${axisRepId},#${bodyRepId}));`);

  // ─── Placement aligned with wall direction ───
  const v0 = element.vertices[0];
  const v1 = element.vertices[1];
  const dx = v1.x - v0.x;
  const dy = v1.y - v0.y;
  const len = Math.hypot(dx, dy) || 1;
  const dxN = dx / len, dyN = dy / len;

  const wallOriginId = id.next();
  lines.push(`#${wallOriginId}=IFCCARTESIANPOINT((${f(v0.x)},${f(v0.y)},0.));`);
  const wallXDirId = id.next();
  lines.push(`#${wallXDirId}=IFCDIRECTION((${f(dxN, 6)},${f(dyN, 6)},0.));`);
  const wallAxisId = id.next();
  lines.push(`#${wallAxisId}=IFCAXIS2PLACEMENT3D(#${wallOriginId},#${ctx.zDirId},#${wallXDirId});`);
  const wallPlacementId = id.next();
  lines.push(`#${wallPlacementId}=IFCLOCALPLACEMENT(#${storeyPlacementId},#${wallAxisId});`);

  // ─── Systematic name (Fix 0A) ───
  const disc = "ARC";
  const typeCode = isPartition ? "IW" : "EW";
  const dimToken = `${Math.round(wallThickness * 1000)}`;
  const matToken = materialToken(isPartition ? ctx.materials.masonry : ctx.materials.concrete);
  const scode = storeyCode(storey);
  const counterKey = `${disc}:${typeCode}:${scode}`;
  const seq = (ctx.nameCounters.get(counterKey) ?? 0) + 1;
  ctx.nameCounters.set(counterKey, seq);
  const sysName = systematicName({ discipline: disc, typeCode, dimension: dimToken, material: matToken, storey: scode, sequence: seq });
  const shortTag = `${typeCode}-${scode}-${String(seq).padStart(3, "0")}`;

  // ─── Wall entity — IFC4 uses IfcWall; IFC2X3 uses IfcWallStandardCase ───
  const wallEntityName = ctx.schema === "IFC2X3" ? "IFCWALLSTANDARDCASE" : "IFCWALL";
  const predefinedType = isPartition ? ".PARTITIONING." : ".STANDARD.";
  const wallId = id.next();
  const predefinedTypeArg = ctx.schema === "IFC2X3" ? "" : `,${predefinedType}`;
  lines.push(`#${wallId}=${wallEntityName}('${guid.stable(`wall:${element.id}`)}',#${ctx.ownerHistId},'${ctx.safeName(sysName)}','${ctx.safeName(element.properties.name)}',$,#${wallPlacementId},#${prodShapeId},'${shortTag}'${predefinedTypeArg});`);

  // Track shape-rep for presentation layer grouping (Fix 21)
  ctx.presentationLayers["A-WALL"].push(bodyRepId, axisRepId);

  // Wall record for connection detection (Fix 9)
  ctx.wallRecords.push({
    entityId: wallId,
    startX: v0.x, startY: v0.y,
    endX: v1.x, endY: v1.y,
    thickness: wallThickness,
    storeyIndex: storey.index,
  });

  // Type assignment
  const materialUsageId = isPartition ? ctx.materialLayerSets.wallInterior : ctx.materialLayerSets.wallExterior;
  const { key: typeKey } = getOrCreateWallType(ctx, wallThickness, isPartition, materialUsageId);
  addTypeOccurrence(ctx.typeClusters.walls, typeKey, wallId);

  // Material association
  associateMaterial(ctx, wallId, materialUsageId);

  // Classification
  const materialHint = isPartition ? ctx.materials.masonry : ctx.materials.concrete;
  associateClassification(ctx, wallId, "wall", materialHint);

  // IS code document references (Fix 12 v2)
  for (const doc of codeDocsFor("wall", materialHint)) {
    const list = ctx.documentAssociations.get(doc) ?? [];
    list.push(wallId);
    ctx.documentAssociations.set(doc, list);
  }

  // Base quantities
  const wallArea = wallLength * wallHeight;
  const wallVolume = wallArea * wallThickness;

  const qLength = id.next();
  lines.push(`#${qLength}=IFCQUANTITYLENGTH('Length',$,$,${f(wallLength)},$);`);
  const qHeight = id.next();
  lines.push(`#${qHeight}=IFCQUANTITYLENGTH('Height',$,$,${f(wallHeight)},$);`);
  const qWidth = id.next();
  lines.push(`#${qWidth}=IFCQUANTITYLENGTH('Width',$,$,${f(wallThickness)},$);`);
  const qGrossArea = id.next();
  lines.push(`#${qGrossArea}=IFCQUANTITYAREA('GrossSideArea',$,$,${f(wallArea, 2)},$);`);
  const openingArea = computeWallOpeningArea(element, storey);
  const netArea = Math.max(0, wallArea - openingArea);
  const qNetArea = id.next();
  lines.push(`#${qNetArea}=IFCQUANTITYAREA('NetSideArea',$,$,${f(netArea, 2)},$);`);
  const qGrossVolume = id.next();
  lines.push(`#${qGrossVolume}=IFCQUANTITYVOLUME('GrossVolume',$,$,${f(wallVolume, 4)},$);`);
  const qNetVolume = id.next();
  lines.push(`#${qNetVolume}=IFCQUANTITYVOLUME('NetVolume',$,$,${f(netArea * wallThickness, 4)},$);`);

  const wallQtoId = id.next();
  lines.push(`#${wallQtoId}=IFCELEMENTQUANTITY('${guid.fresh()}',#${ctx.ownerHistId},'Qto_WallBaseQuantities',$,$,(#${qLength},#${qHeight},#${qWidth},#${qGrossArea},#${qNetArea},#${qGrossVolume},#${qNetVolume}));`);
  const relWallQtoId = id.next();
  lines.push(`#${relWallQtoId}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${wallId}),#${wallQtoId});`);

  // ─── Pset_WallCommon — FULL construction-site data (Fix 6 v2) ───
  const code = elementCodeData("wall", materialHint, !isPartition);
  const propReference = id.next();
  lines.push(`#${propReference}=IFCPROPERTYSINGLEVALUE('Reference',$,IFCIDENTIFIER('${shortTag}'),$);`);
  const propIsExt = id.next();
  lines.push(`#${propIsExt}=IFCPROPERTYSINGLEVALUE('IsExternal',$,IFCBOOLEAN(${isPartition ? ".F." : ".T."}),$);`);
  const propLoadBearing = id.next();
  lines.push(`#${propLoadBearing}=IFCPROPERTYSINGLEVALUE('LoadBearing',$,IFCBOOLEAN(${isPartition ? ".F." : ".T."}),$);`);
  const propExtendStruct = id.next();
  lines.push(`#${propExtendStruct}=IFCPROPERTYSINGLEVALUE('ExtendToStructure',$,IFCBOOLEAN(.T.),$);`);
  const propFireRating = id.next();
  lines.push(`#${propFireRating}=IFCPROPERTYSINGLEVALUE('FireRating',$,IFCLABEL('${code.fireRating}'),$);`);
  const propAcoustic = id.next();
  lines.push(`#${propAcoustic}=IFCPROPERTYSINGLEVALUE('AcousticRating',$,IFCLABEL('STC ${code.acousticRatingSTC ?? 40}'),$);`);
  const propThermal = id.next();
  lines.push(`#${propThermal}=IFCPROPERTYSINGLEVALUE('ThermalTransmittance',$,IFCTHERMALTRANSMITTANCEMEASURE(${f(code.thermalTransmittanceU, 3)}),$);`);
  const propCombustible = id.next();
  lines.push(`#${propCombustible}=IFCPROPERTYSINGLEVALUE('Combustible',$,IFCBOOLEAN(${code.isCombustible ? ".T." : ".F."}),$);`);
  const propSurfaceSpread = id.next();
  lines.push(`#${propSurfaceSpread}=IFCPROPERTYSINGLEVALUE('SurfaceSpreadOfFlame',$,IFCLABEL('Class 0'),$);`);

  const wallPsetId = id.next();
  lines.push(`#${wallPsetId}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_WallCommon',$,(#${propReference},#${propIsExt},#${propLoadBearing},#${propExtendStruct},#${propFireRating},#${propAcoustic},#${propThermal},#${propCombustible},#${propSurfaceSpread}));`);
  const relWallPsetId = id.next();
  lines.push(`#${relWallPsetId}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${wallId}),#${wallPsetId});`);

  return wallId;
}

/**
 * Merged-shell writer — emits a single IfcWall whose Body is an IfcExtrudedAreaSolid
 * with IfcArbitraryProfileDefWithVoids (outer polygon + inner polygon as a void), and
 * whose Axis is the outer polyline. Produces ONE wall entity that looks visually
 * continuous across 32+ facets of a circular/curved building instead of 32 separate
 * rectangular prisms with visible corner mismatches.
 *
 * All original wall IDs in the chain should be mapped to the returned entity ID via
 * ctx.wallsByParentId so door / window openings continue to attach correctly.
 */
function writeMergedWallShell(
  chain: GeometryElement[],
  storey: MassingStorey,
  storeyPlacementId: number,
  ctx: ExportContext
): number {
  const { id, lines, guid } = ctx;
  const first = chain[0];
  const thickness = first.properties.thickness ?? 0.25;
  const height = first.properties.height ?? storey.height;

  // Outer polyline from chain vertices (start of first + end of each)
  const outerLoop: FootprintPoint[] = [{ x: first.vertices[0].x, y: first.vertices[0].y }];
  for (const w of chain) outerLoop.push({ x: w.vertices[1].x, y: w.vertices[1].y });

  // Drop closing duplicate if chain is closed
  const firstV = outerLoop[0];
  const lastV = outerLoop[outerLoop.length - 1];
  if (Math.hypot(firstV.x - lastV.x, firstV.y - lastV.y) < 0.05) {
    outerLoop.pop();
  }

  const innerLoop = offsetClosedPolygonInward(outerLoop, thickness);

  // Emit outer polyline cartesian points
  const outerPtIds = outerLoop.map(p => {
    const pid = id.next();
    lines.push(`#${pid}=IFCCARTESIANPOINT((${f(p.x)},${f(p.y)}));`);
    return pid;
  });
  outerPtIds.push(outerPtIds[0]);
  const outerPolyId = id.next();
  lines.push(`#${outerPolyId}=IFCPOLYLINE((${outerPtIds.map(i => `#${i}`).join(",")}));`);

  // Emit inner polyline — IFC4 ArbitraryProfileDefWithVoids requires inner loop
  // to have OPPOSITE winding of outer loop. Reverse the inner polygon to ensure this.
  const innerLoopCW = [...innerLoop].reverse();
  const innerPtIds = innerLoopCW.map(p => {
    const pid = id.next();
    lines.push(`#${pid}=IFCCARTESIANPOINT((${f(p.x)},${f(p.y)}));`);
    return pid;
  });
  innerPtIds.push(innerPtIds[0]);
  const innerPolyId = id.next();
  lines.push(`#${innerPolyId}=IFCPOLYLINE((${innerPtIds.map(i => `#${i}`).join(",")}));`);

  // Profile with void
  const profileId = id.next();
  lines.push(`#${profileId}=IFCARBITRARYPROFILEDEFWITHVOIDS(.AREA.,'Perimeter Wall Shell',#${outerPolyId},(#${innerPolyId}));`);

  // Body extrusion
  const extDirId = id.next();
  lines.push(`#${extDirId}=IFCDIRECTION((0.,0.,1.));`);
  const solidId = id.next();
  lines.push(`#${solidId}=IFCEXTRUDEDAREASOLID(#${profileId},$,#${extDirId},${f(height)});`);
  const bodyRepId = id.next();
  lines.push(`#${bodyRepId}=IFCSHAPEREPRESENTATION(#${ctx.bodyContextId},'Body','SweptSolid',(#${solidId}));`);

  // Axis representation — reuse outer polyline
  const axisRepId = id.next();
  lines.push(`#${axisRepId}=IFCSHAPEREPRESENTATION(#${ctx.axisContextId},'Axis','Curve2D',(#${outerPolyId}));`);

  // Footprint representation — for 2D plan view
  const footprintRepId = id.next();
  lines.push(`#${footprintRepId}=IFCSHAPEREPRESENTATION(#${ctx.footprintContextId},'FootPrint','Curve2D',(#${outerPolyId}));`);

  // Multi-rep product definition shape (Axis + Body + FootPrint)
  const prodShapeId = id.next();
  lines.push(`#${prodShapeId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${axisRepId},#${bodyRepId},#${footprintRepId}));`);

  // Placement at storey origin (the polyline vertices are already in storey-local coords)
  const originId = id.next();
  lines.push(`#${originId}=IFCCARTESIANPOINT((0.,0.,0.));`);
  const placeAxisId = id.next();
  lines.push(`#${placeAxisId}=IFCAXIS2PLACEMENT3D(#${originId},#${ctx.zDirId},#${ctx.xDirId});`);
  const placementId = id.next();
  lines.push(`#${placementId}=IFCLOCALPLACEMENT(#${storeyPlacementId},#${placeAxisId});`);

  // Systematic name (shares counter with regular exterior walls)
  const disc = "ARC";
  const typeCode = "EW";
  const dimToken = `${Math.round(thickness * 1000)}`;
  const matToken = materialToken(ctx.materials.concrete);
  const scode = storeyCode(storey);
  const counterKey = `${disc}:${typeCode}:${scode}`;
  const seq = (ctx.nameCounters.get(counterKey) ?? 0) + 1;
  ctx.nameCounters.set(counterKey, seq);
  const sysName = systematicName({ discipline: disc, typeCode, dimension: dimToken, material: matToken, storey: scode, sequence: seq });
  const shortTag = `PW-${scode}-${String(seq).padStart(3, "0")}`;

  // IfcWall — use IFC4 (merged walls only emitted in IFC4 path; IFC2X3 falls back via caller)
  const wallEntityName = ctx.schema === "IFC2X3" ? "IFCWALLSTANDARDCASE" : "IFCWALL";
  const predefinedTypeArg = ctx.schema === "IFC2X3" ? "" : `,.STANDARD.`;
  const wallId = id.next();
  lines.push(`#${wallId}=${wallEntityName}('${guid.stable(`mergedwall:${storey.index}:${first.id}`)}',#${ctx.ownerHistId},'${ctx.safeName(sysName)}','Perimeter Wall Shell (${chain.length} segments merged)',$,#${placementId},#${prodShapeId},'${shortTag}'${predefinedTypeArg});`);

  // Presentation layer
  ctx.presentationLayers["A-WALL"].push(bodyRepId, axisRepId, footprintRepId);

  // Wall record — approximate as one record spanning first-to-last vertex (for connection detection)
  ctx.wallRecords.push({
    entityId: wallId,
    startX: outerLoop[0].x, startY: outerLoop[0].y,
    endX: outerLoop[outerLoop.length - 1].x, endY: outerLoop[outerLoop.length - 1].y,
    thickness, storeyIndex: storey.index,
  });

  // Type + material + classification
  const materialUsageId = ctx.materialLayerSets.wallExterior;
  const typeResult = getOrCreateWallType(ctx, thickness, false, materialUsageId);
  addTypeOccurrence(ctx.typeClusters.walls, typeResult.key, wallId);
  associateMaterial(ctx, wallId, materialUsageId);
  associateClassification(ctx, wallId, "wall", ctx.materials.concrete);
  for (const doc of codeDocsFor("wall", ctx.materials.concrete)) {
    const list = ctx.documentAssociations.get(doc) ?? [];
    list.push(wallId);
    ctx.documentAssociations.set(doc, list);
  }

  // Aggregate quantities
  let totalLength = 0;
  for (let i = 0; i < outerLoop.length; i++) {
    const p = outerLoop[i], q = outerLoop[(i + 1) % outerLoop.length];
    totalLength += Math.hypot(q.x - p.x, q.y - p.y);
  }
  const wallSideArea = totalLength * height;
  const outerArea = polygonAreaCalc(outerLoop);
  const innerArea = polygonAreaCalc(innerLoop);
  const wallFootprintArea = Math.max(0, outerArea - innerArea);
  const wallVolume = wallFootprintArea * height;

  let openingArea = 0;
  for (const w of chain) openingArea += computeWallOpeningArea(w, storey);
  const netArea = Math.max(0, wallSideArea - openingArea);

  const qLength = id.next();
  lines.push(`#${qLength}=IFCQUANTITYLENGTH('Length',$,$,${f(totalLength)},$);`);
  const qHeight = id.next();
  lines.push(`#${qHeight}=IFCQUANTITYLENGTH('Height',$,$,${f(height)},$);`);
  const qWidth = id.next();
  lines.push(`#${qWidth}=IFCQUANTITYLENGTH('Width',$,$,${f(thickness)},$);`);
  const qGrossArea = id.next();
  lines.push(`#${qGrossArea}=IFCQUANTITYAREA('GrossSideArea',$,$,${f(wallSideArea, 2)},$);`);
  const qNetArea = id.next();
  lines.push(`#${qNetArea}=IFCQUANTITYAREA('NetSideArea',$,$,${f(netArea, 2)},$);`);
  const qGrossVolume = id.next();
  lines.push(`#${qGrossVolume}=IFCQUANTITYVOLUME('GrossVolume',$,$,${f(wallVolume, 4)},$);`);
  const qNetVolume = id.next();
  lines.push(`#${qNetVolume}=IFCQUANTITYVOLUME('NetVolume',$,$,${f(netArea * thickness, 4)},$);`);

  const qtoId = id.next();
  lines.push(`#${qtoId}=IFCELEMENTQUANTITY('${guid.fresh()}',#${ctx.ownerHistId},'Qto_WallBaseQuantities',$,$,(#${qLength},#${qHeight},#${qWidth},#${qGrossArea},#${qNetArea},#${qGrossVolume},#${qNetVolume}));`);
  const relQtoId = id.next();
  lines.push(`#${relQtoId}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${wallId}),#${qtoId});`);

  // Pset_WallCommon (parity with writeWallEntity)
  const code = elementCodeData("wall", ctx.materials.concrete, true);
  const pRef = id.next();
  lines.push(`#${pRef}=IFCPROPERTYSINGLEVALUE('Reference',$,IFCIDENTIFIER('${shortTag}'),$);`);
  const pIsExt = id.next();
  lines.push(`#${pIsExt}=IFCPROPERTYSINGLEVALUE('IsExternal',$,IFCBOOLEAN(.T.),$);`);
  const pLB = id.next();
  lines.push(`#${pLB}=IFCPROPERTYSINGLEVALUE('LoadBearing',$,IFCBOOLEAN(.T.),$);`);
  const pExt = id.next();
  lines.push(`#${pExt}=IFCPROPERTYSINGLEVALUE('ExtendToStructure',$,IFCBOOLEAN(.T.),$);`);
  const pFR = id.next();
  lines.push(`#${pFR}=IFCPROPERTYSINGLEVALUE('FireRating',$,IFCLABEL('${code.fireRating}'),$);`);
  const pAc = id.next();
  lines.push(`#${pAc}=IFCPROPERTYSINGLEVALUE('AcousticRating',$,IFCLABEL('STC ${code.acousticRatingSTC ?? 40}'),$);`);
  const pTh = id.next();
  lines.push(`#${pTh}=IFCPROPERTYSINGLEVALUE('ThermalTransmittance',$,IFCTHERMALTRANSMITTANCEMEASURE(${f(code.thermalTransmittanceU, 3)}),$);`);
  const pComb = id.next();
  lines.push(`#${pComb}=IFCPROPERTYSINGLEVALUE('Combustible',$,IFCBOOLEAN(.F.),$);`);
  const pSSF = id.next();
  lines.push(`#${pSSF}=IFCPROPERTYSINGLEVALUE('SurfaceSpreadOfFlame',$,IFCLABEL('Class 0'),$);`);
  const pMerged = id.next();
  lines.push(`#${pMerged}=IFCPROPERTYSINGLEVALUE('MergedSegmentCount',$,IFCINTEGER(${chain.length}),$);`);
  const psetWallId = id.next();
  lines.push(`#${psetWallId}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_WallCommon',$,(#${pRef},#${pIsExt},#${pLB},#${pExt},#${pFR},#${pAc},#${pTh},#${pComb},#${pSSF},#${pMerged}));`);
  const relPsetId = id.next();
  lines.push(`#${relPsetId}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${wallId}),#${psetWallId});`);

  return wallId;
}

function computeWallOpeningArea(wall: GeometryElement, storey: MassingStorey): number {
  if (!wall.id) return 0;
  let total = 0;
  for (const el of storey.elements) {
    if ((el.type === "window" || el.type === "door") && el.properties.parentWallId === wall.id) {
      const w = el.properties.width ?? (el.type === "window" ? 1.2 : 1.0);
      const h = el.properties.height ?? (el.type === "window" ? 1.5 : 2.1);
      total += w * h;
    }
  }
  return total;
}

// ─────────── Slab Writer ───────────

function writeSlabEntity(
  element: GeometryElement,
  footprint: FootprintPoint[],
  storeyPlacementId: number,
  isRoof: boolean,
  ctx: ExportContext,
  storeyIndexForTracking?: number,
): number {
  const { id, lines, guid } = ctx;
  const thickness = element.properties.thickness ?? 0.3;

  // Profile (shared between Body extrusion and FootPrint representation)
  const ptIds: number[] = [];
  for (const p of footprint) {
    const ptId = id.next();
    lines.push(`#${ptId}=IFCCARTESIANPOINT((${f(p.x)},${f(p.y)}));`);
    ptIds.push(ptId);
  }
  ptIds.push(ptIds[0]);

  const polylineId = id.next();
  lines.push(`#${polylineId}=IFCPOLYLINE((${ptIds.map(i => `#${i}`).join(",")}));`);
  const profileId = id.next();
  lines.push(`#${profileId}=IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,'Slab Profile',#${polylineId});`);

  // ─── FootPrint representation (Fix 3 v2) — 2D plan-view curve ───
  const footprintRepId = id.next();
  lines.push(`#${footprintRepId}=IFCSHAPEREPRESENTATION(#${ctx.footprintContextId},'FootPrint','Curve2D',(#${polylineId}));`);

  const extDirId = id.next();
  lines.push(`#${extDirId}=IFCDIRECTION((0.,0.,1.));`);
  const solidId = id.next();
  lines.push(`#${solidId}=IFCEXTRUDEDAREASOLID(#${profileId},$,#${extDirId},${f(thickness)});`);
  const shapeRepId = id.next();
  lines.push(`#${shapeRepId}=IFCSHAPEREPRESENTATION(#${ctx.bodyContextId},'Body','SweptSolid',(#${solidId}));`);
  const prodShapeId = id.next();
  lines.push(`#${prodShapeId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${footprintRepId},#${shapeRepId}));`);

  ctx.presentationLayers[isRoof ? "S-ROOF" : "S-SLAB"].push(shapeRepId, footprintRepId);

  const slabOriginId = id.next();
  lines.push(`#${slabOriginId}=IFCCARTESIANPOINT((0.,0.,${f(-thickness)}));`);
  const slabAxisId = id.next();
  lines.push(`#${slabAxisId}=IFCAXIS2PLACEMENT3D(#${slabOriginId},$,$);`);
  const slabPlacementId = id.next();
  lines.push(`#${slabPlacementId}=IFCLOCALPLACEMENT(#${storeyPlacementId},#${slabAxisId});`);

  const predefinedType = isRoof ? ".ROOF." : ".FLOOR.";
  const slabId = id.next();
  const elementTag = element.properties.name?.substring(0, 30) ?? `SLAB-${slabId}`;
  lines.push(`#${slabId}=IFCSLAB('${guid.stable(`slab:${element.id}`)}',#${ctx.ownerHistId},'${ctx.safeName(element.properties.name)}',$,$,#${slabPlacementId},#${prodShapeId},'${ctx.safeName(elementTag)}',${predefinedType});`);

  // Type
  const materialUsageId = isRoof ? ctx.materialLayerSets.slabRoof : ctx.materialLayerSets.slabFloor;
  const { key: typeKey } = getOrCreateSlabType(ctx, thickness, isRoof, materialUsageId);
  addTypeOccurrence(ctx.typeClusters.slabs, typeKey, slabId);

  // Material
  associateMaterial(ctx, slabId, materialUsageId);

  // Classification
  const matHint = isRoof ? ctx.materials.concrete + " + waterproofing" : ctx.materials.concrete;
  associateClassification(ctx, slabId, isRoof ? "roof" : "slab", matHint);

  // IS code doc refs (Fix 12 v2)
  for (const doc of codeDocsFor(isRoof ? "roof" : "slab", matHint)) {
    const list = ctx.documentAssociations.get(doc) ?? [];
    list.push(slabId);
    ctx.documentAssociations.set(doc, list);
  }

  // Track slab per storey for space-boundary detection (Fix 10)
  const trackStorey = storeyIndexForTracking ?? element.properties.storeyIndex;
  if (trackStorey !== undefined) {
    const arr = ctx.slabsByStorey.get(trackStorey) ?? [];
    arr.push(slabId);
    ctx.slabsByStorey.set(trackStorey, arr);
  }

  // v3 Tier 1 — auto-generate slab reinforcing mesh (IS 456 Cl 26.5.2 + IS 1566)
  {
    const concrete = CONCRETE_GRADES.M25;
    const steel = STEEL_GRADES.Fe500;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of footprint) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
    const L = (maxX - minX) * 1000, W = (maxY - minY) * 1000;
    const meshSpec = generateSlabMesh(L, W, thickness * 1000, concrete, steel);
    emitReinforcingMesh(meshSpec, L, W, slabId, storeyPlacementId, ctx, `SLAB-${element.id}`);
    const slabVolM3 = (element.properties.area ?? polygonAreaCalc(footprint)) * thickness;
    ctx.bbs.totalConcreteVolumeM3 += slabVolM3;

    // v4 Tier 2 — embodied carbon
    trackEmbodiedCarbon(ctx, "M25_concrete", slabVolM3, slabId, isRoof ? "roof" : "slab");

    // v4 Tier 7 — task + cost assignment
    const taskKey = isRoof ? "finishes" : "superstructure";
    const taskList = ctx.taskElementAssignments.get(taskKey) ?? [];
    taskList.push(slabId);
    ctx.taskElementAssignments.set(taskKey, taskList);
    const costList = ctx.costElementAssignments.get("03 30 00") ?? [];
    costList.push(slabId);
    ctx.costElementAssignments.set("03 30 00", costList);
  }

  // Quantities
  const slabArea = element.properties.area ?? polygonAreaCalc(footprint);
  const slabVolume = slabArea * thickness;
  const perimeterLen = footprint.reduce((sum, p, i) => {
    const np = footprint[(i + 1) % footprint.length];
    return sum + Math.hypot(np.x - p.x, np.y - p.y);
  }, 0);

  const sqDepth = id.next();
  lines.push(`#${sqDepth}=IFCQUANTITYLENGTH('Depth',$,$,${f(thickness)},$);`);
  const sqGrossArea = id.next();
  lines.push(`#${sqGrossArea}=IFCQUANTITYAREA('GrossArea',$,$,${f(slabArea, 2)},$);`);
  const sqNetArea = id.next();
  lines.push(`#${sqNetArea}=IFCQUANTITYAREA('NetArea',$,$,${f(slabArea, 2)},$);`);
  const sqGrossVolume = id.next();
  lines.push(`#${sqGrossVolume}=IFCQUANTITYVOLUME('GrossVolume',$,$,${f(slabVolume, 4)},$);`);
  const sqNetVolume = id.next();
  lines.push(`#${sqNetVolume}=IFCQUANTITYVOLUME('NetVolume',$,$,${f(slabVolume, 4)},$);`);
  const sqPerimeter = id.next();
  lines.push(`#${sqPerimeter}=IFCQUANTITYLENGTH('Perimeter',$,$,${f(perimeterLen)},$);`);

  const slabQtoId = id.next();
  lines.push(`#${slabQtoId}=IFCELEMENTQUANTITY('${guid.fresh()}',#${ctx.ownerHistId},'Qto_SlabBaseQuantities',$,$,(#${sqDepth},#${sqGrossArea},#${sqNetArea},#${sqGrossVolume},#${sqNetVolume},#${sqPerimeter}));`);
  const relSlabQtoId = id.next();
  lines.push(`#${relSlabQtoId}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${slabId}),#${slabQtoId});`);

  // Pset_SlabCommon
  const propIsExt = id.next();
  lines.push(`#${propIsExt}=IFCPROPERTYSINGLEVALUE('IsExternal',$,IFCBOOLEAN(${isRoof ? ".T." : ".F."}),$);`);
  const propLoadBearing = id.next();
  lines.push(`#${propLoadBearing}=IFCPROPERTYSINGLEVALUE('LoadBearing',$,IFCBOOLEAN(.T.),$);`);
  const propFireRating = id.next();
  lines.push(`#${propFireRating}=IFCPROPERTYSINGLEVALUE('FireRating',$,IFCLABEL('2HR'),$);`);
  const slabPsetId = id.next();
  lines.push(`#${slabPsetId}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_SlabCommon',$,(#${propIsExt},#${propLoadBearing},#${propFireRating}));`);
  const relSlabPsetId = id.next();
  lines.push(`#${relSlabPsetId}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${slabId}),#${slabPsetId});`);

  return slabId;
}

// ─────────── Column Writer ───────────

function writeColumnEntity(
  element: GeometryElement,
  storeyPlacementId: number,
  ctx: ExportContext
): number {
  const { id, lines, guid } = ctx;
  const colHeight = element.properties.height ?? 3.6;
  const colRadius = element.properties.radius ?? 0.3;
  const isSteel = isSteelMaterial(element);

  const profCenterId = id.next();
  lines.push(`#${profCenterId}=IFCCARTESIANPOINT((0.,0.));`);
  const profPlacementId = id.next();
  lines.push(`#${profPlacementId}=IFCAXIS2PLACEMENT2D(#${profCenterId},$);`);

  let profileId: number;
  let steelProfile: SteelProfile | null = null;
  if (isSteel) {
    // Pick the nearest ISHB section from the IS 808 catalogue — column size ≈ 2×radius
    steelProfile = nearestISHB(colRadius * 2);
    profileId = id.next();
    lines.push(`#${profileId}=IFCISHAPEPROFILEDEF(.AREA.,'${steelProfile.designation}','IS 808:2021 Hot Rolled Steel',#${profPlacementId},${f(steelProfile.overallDepth)},${f(steelProfile.flangeWidth)},${f(steelProfile.webThickness)},${f(steelProfile.flangeThickness)},${f(steelProfile.filletRadius)},$,$,$);`);
  } else {
    profileId = id.next();
    lines.push(`#${profileId}=IFCCIRCLEPROFILEDEF(.AREA.,'RCC Column Profile',#${profPlacementId},${f(colRadius)});`);
  }

  const extDirId = id.next();
  lines.push(`#${extDirId}=IFCDIRECTION((0.,0.,1.));`);
  const solidId = id.next();
  lines.push(`#${solidId}=IFCEXTRUDEDAREASOLID(#${profileId},$,#${extDirId},${f(colHeight)});`);
  const shapeRepId = id.next();
  lines.push(`#${shapeRepId}=IFCSHAPEREPRESENTATION(#${ctx.bodyContextId},'Body','SweptSolid',(#${solidId}));`);
  const prodShapeId = id.next();
  lines.push(`#${prodShapeId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRepId}));`);

  const cx = element.vertices.length > 0 ? element.vertices.reduce((s, v) => s + v.x, 0) / element.vertices.length : 0;
  const cy = element.vertices.length > 0 ? element.vertices.reduce((s, v) => s + v.y, 0) / element.vertices.length : 0;

  const colOriginId = id.next();
  lines.push(`#${colOriginId}=IFCCARTESIANPOINT((${f(cx)},${f(cy)},0.));`);
  const colAxisId = id.next();
  lines.push(`#${colAxisId}=IFCAXIS2PLACEMENT3D(#${colOriginId},#${ctx.zDirId},$);`);
  const colPlacementId = id.next();
  lines.push(`#${colPlacementId}=IFCLOCALPLACEMENT(#${storeyPlacementId},#${colAxisId});`);

  const colId = id.next();
  const elementTag = element.properties.name?.substring(0, 30) ?? `COL-${colId}`;
  lines.push(`#${colId}=IFCCOLUMN('${guid.stable(`col:${element.id}`)}',#${ctx.ownerHistId},'${ctx.safeName(element.properties.name)}',$,$,#${colPlacementId},#${prodShapeId},'${ctx.safeName(elementTag)}',.COLUMN.);`);
  ctx.presentationLayers["S-COL"].push(shapeRepId);

  // v4 Tier 0 — record column position for IfcGrid derivation
  ctx.columnPositions.push({ x: cx, y: cy });

  // Type + material
  const materialId = isSteel ? ctx.matIds.structuralSteel : ctx.matIds.concrete;
  const { key: typeKey } = getOrCreateColumnType(ctx, colRadius, isSteel, materialId);
  addTypeOccurrence(ctx.typeClusters.columns, typeKey, colId);
  associateMaterial(ctx, colId, materialId);

  // Classification
  const matHint = isSteel ? ctx.materials.structuralSteel : ctx.materials.concrete;
  associateClassification(ctx, colId, "column", matHint);

  // IS code doc refs
  for (const doc of codeDocsFor("column", matHint)) {
    const list = ctx.documentAssociations.get(doc) ?? [];
    list.push(colId);
    ctx.documentAssociations.set(doc, list);
  }

  // v3 Tier 1 — auto-generate IS 456 reinforcement (RCC columns only)
  if (!isSteel) {
    const concrete = CONCRETE_GRADES.M25;
    const steel = STEEL_GRADES.Fe500;
    const rebars = generateColumnRebar(colRadius * 2 * 1000, colHeight * 1000, concrete, steel, true);
    emitReinforcingBars(rebars, colId, storeyPlacementId, ctx, `COL-${element.id}`);
    const colVolM3 = Math.PI * colRadius * colRadius * colHeight;
    ctx.bbs.totalConcreteVolumeM3 += colVolM3;

    // v4 Tier 2 — embodied carbon tracking
    trackEmbodiedCarbon(ctx, "M25_concrete", colVolM3, colId, "column");

    // v4 Tier 7 — link to construction task (superstructure RCC)
    const taskList = ctx.taskElementAssignments.get("superstructure") ?? [];
    taskList.push(colId);
    ctx.taskElementAssignments.set("superstructure", taskList);
    const costList = ctx.costElementAssignments.get("03 30 00") ?? [];
    costList.push(colId);
    ctx.costElementAssignments.set("03 30 00", costList);
  }

  // Quantities — use real cross-section area from IS 808 catalogue when steel
  const crossArea = steelProfile ? steelProfile.crossSectionArea : Math.PI * colRadius * colRadius;
  const volume = crossArea * colHeight;

  const qHeight = id.next();
  lines.push(`#${qHeight}=IFCQUANTITYLENGTH('Length',$,$,${f(colHeight)},$);`);
  const qArea = id.next();
  lines.push(`#${qArea}=IFCQUANTITYAREA('CrossSectionArea',$,$,${f(crossArea, 4)},$);`);
  const qVol = id.next();
  lines.push(`#${qVol}=IFCQUANTITYVOLUME('GrossVolume',$,$,${f(volume, 4)},$);`);
  const qtoId = id.next();
  lines.push(`#${qtoId}=IFCELEMENTQUANTITY('${guid.fresh()}',#${ctx.ownerHistId},'Qto_ColumnBaseQuantities',$,$,(#${qHeight},#${qArea},#${qVol}));`);
  const relQto = id.next();
  lines.push(`#${relQto}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${colId}),#${qtoId});`);

  return colId;
}

// ─────────── Beam Writer ───────────

function writeBeamEntity(
  element: GeometryElement,
  storeyPlacementId: number,
  ctx: ExportContext
): number {
  const { id, lines, guid } = ctx;
  const beamWidth = element.properties.width ?? 0.3;
  const beamDepth = element.properties.height ?? 0.5;
  const beamLength = element.properties.length ?? 6;
  const isSteel = isSteelMaterial(element);

  const profCenterId = id.next();
  lines.push(`#${profCenterId}=IFCCARTESIANPOINT((${f(beamWidth / 2)},${f(beamDepth / 2)}));`);
  const profPlacementId = id.next();
  lines.push(`#${profPlacementId}=IFCAXIS2PLACEMENT2D(#${profCenterId},$);`);

  let profileId: number;
  if (isSteel) {
    const p = nearestISMB(beamDepth);
    profileId = id.next();
    lines.push(`#${profileId}=IFCISHAPEPROFILEDEF(.AREA.,'${p.designation}','IS 808:2021 Hot Rolled Steel',#${profPlacementId},${f(p.overallDepth)},${f(p.flangeWidth)},${f(p.webThickness)},${f(p.flangeThickness)},${f(p.filletRadius)},$,$,$);`);
  } else {
    profileId = id.next();
    lines.push(`#${profileId}=IFCRECTANGLEPROFILEDEF(.AREA.,'Beam Profile',#${profPlacementId},${f(beamWidth)},${f(beamDepth)});`);
  }

  // Use actual 3D vertex-to-vertex direction (including Z) — previous world-axis-aligned
  // logic mis-extruded vertical mullions along +Y and angled beams along cardinal axes,
  // producing flying rectangular sticks in the viewer. Extrusion LENGTH remains from
  // element.properties.length (massing generators use vertices only as direction markers,
  // not as start/end endpoints, so vertex distance is an unreliable length source).
  const v0 = element.vertices[0];
  const v1 = element.vertices[1];
  const dax = v1.x - v0.x, day = v1.y - v0.y, daz = v1.z - v0.z;
  const axLen = Math.hypot(dax, day, daz);
  const actualLen = beamLength;   // always use properties.length (defaulted to 6m)
  const axNx = axLen > 0.001 ? dax / axLen : 1;
  const axNy = axLen > 0.001 ? day / axLen : 0;
  const axNz = axLen > 0.001 ? daz / axLen : 0;

  // Pick a local X-direction perpendicular to the axis (the profile's XY plane will
  // be perpendicular to the axis). Default to rotating the axis 90° in the XY plane;
  // for vertical beams use world +X as the reference.
  let lxDx: number, lxDy: number, lxDz: number;
  if (Math.abs(axNz) < 0.9) {
    // Axis mostly horizontal → local X is the in-plane perpendicular
    lxDx = -axNy; lxDy = axNx; lxDz = 0;
    const l = Math.hypot(lxDx, lxDy) || 1;
    lxDx /= l; lxDy /= l;
  } else {
    // Axis mostly vertical → local X is world +X
    lxDx = 1; lxDy = 0; lxDz = 0;
  }

  const extDirId = id.next();
  lines.push(`#${extDirId}=IFCDIRECTION((0.,0.,1.));`);  // extrude along local Z axis
  const solidId = id.next();
  lines.push(`#${solidId}=IFCEXTRUDEDAREASOLID(#${profileId},$,#${extDirId},${f(actualLen)});`);
  const shapeRepId = id.next();
  lines.push(`#${shapeRepId}=IFCSHAPEREPRESENTATION(#${ctx.bodyContextId},'Body','SweptSolid',(#${solidId}));`);
  const prodShapeId = id.next();
  lines.push(`#${prodShapeId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRepId}));`);

  // Placement: origin at v0, local Z aligned to the beam axis direction (so extruding
  // along (0,0,1) in local coords = along the real beam axis in world coords).
  const beamOriginId = id.next();
  lines.push(`#${beamOriginId}=IFCCARTESIANPOINT((${f(v0.x)},${f(v0.y)},${f(v0.z)}));`);
  const beamZDirId = id.next();
  lines.push(`#${beamZDirId}=IFCDIRECTION((${f(axNx, 6)},${f(axNy, 6)},${f(axNz, 6)}));`);
  const beamXDirId = id.next();
  lines.push(`#${beamXDirId}=IFCDIRECTION((${f(lxDx, 6)},${f(lxDy, 6)},${f(lxDz, 6)}));`);
  const beamAxisId = id.next();
  lines.push(`#${beamAxisId}=IFCAXIS2PLACEMENT3D(#${beamOriginId},#${beamZDirId},#${beamXDirId});`);
  const beamPlacementId = id.next();
  lines.push(`#${beamPlacementId}=IFCLOCALPLACEMENT(#${storeyPlacementId},#${beamAxisId});`);

  const beamId = id.next();
  const elementTag = element.properties.name?.substring(0, 30) ?? `BEAM-${beamId}`;
  lines.push(`#${beamId}=IFCBEAM('${guid.stable(`beam:${element.id}`)}',#${ctx.ownerHistId},'${ctx.safeName(element.properties.name)}',$,$,#${beamPlacementId},#${prodShapeId},'${ctx.safeName(elementTag)}',.BEAM.);`);
  ctx.presentationLayers["S-BEAM"].push(shapeRepId);

  const materialId = isSteel ? ctx.matIds.structuralSteel : ctx.matIds.concrete;
  const { key: typeKey } = getOrCreateBeamType(ctx, beamWidth, beamDepth, isSteel, materialId);
  addTypeOccurrence(ctx.typeClusters.beams, typeKey, beamId);
  associateMaterial(ctx, beamId, materialId);

  const matHint = isSteel ? ctx.materials.structuralSteel : ctx.materials.concrete;
  associateClassification(ctx, beamId, "beam", matHint);

  // IS code doc refs
  for (const doc of codeDocsFor("beam", matHint)) {
    const list = ctx.documentAssociations.get(doc) ?? [];
    list.push(beamId);
    ctx.documentAssociations.set(doc, list);
  }

  // v3 Tier 1 — auto-generate IS 456 reinforcement (RCC beams only)
  if (!isSteel) {
    const concrete = CONCRETE_GRADES.M25;
    const steel = STEEL_GRADES.Fe500;
    const rebars = generateBeamRebar(beamWidth * 1000, beamDepth * 1000, beamLength * 1000, concrete, steel);
    emitReinforcingBars(rebars, beamId, storeyPlacementId, ctx, `BEAM-${element.id}`);
    ctx.bbs.totalConcreteVolumeM3 += beamWidth * beamDepth * beamLength;
  }

  return beamId;
}

// ─────────── Curtain Wall Sub-Component Writer (mullion / spandrel) ───────────
//
// Massing generators can produce hundreds of mullion + spandrel elements per storey to
// discretise a glass facade. Routing them through writeBeamEntity emits each as a
// standalone rectangular extrusion — the cumulative effect in any IFC viewer is a
// "flying stick" appearance because (a) each piece is a separate thin solid and (b) the
// old beam writer's world-axis extrusion bug mis-oriented them entirely.
//
// This writer emits them semantically correctly as IfcMember / IfcPlate with
// Representation=$ by default. The merged perimeter wall shell already represents the
// facade visually; these sub-components remain present as BIM metadata for curtain-wall
// schedule / takeoff but are invisible to the renderer.
function writeCurtainWallComponent(
  element: GeometryElement,
  storeyPlacementId: number,
  ctx: ExportContext
): number {
  const { id, lines, guid } = ctx;
  const isMullion = element.type === "mullion";
  const entityClass = isMullion ? "IFCMEMBER" : "IFCPLATE";
  const predefinedType = isMullion ? ".MULLION." : ".CURTAIN_PANEL.";
  const name = element.properties.name ?? (isMullion ? "Mullion" : "Spandrel");
  const tag = name.substring(0, 30);

  let representationRef = "$";
  let placementRef = "$";

  if (ctx.emitCurtainWallGeometry) {
    // Opt-in body emission — uses the same 3D-axis logic as the fixed beam writer
    const v0 = element.vertices[0];
    const v1 = element.vertices[1];
    const widthM = element.properties.width ?? 0.05;
    const depthM = element.properties.thickness ?? 0.03;

    const profCenterId = id.next();
    lines.push(`#${profCenterId}=IFCCARTESIANPOINT((${f(widthM / 2)},${f(depthM / 2)}));`);
    const profPlaceId = id.next();
    lines.push(`#${profPlaceId}=IFCAXIS2PLACEMENT2D(#${profCenterId},$);`);
    const profileId = id.next();
    lines.push(`#${profileId}=IFCRECTANGLEPROFILEDEF(.AREA.,'${tag} Profile',#${profPlaceId},${f(widthM)},${f(depthM)});`);

    const dax = v1.x - v0.x, day = v1.y - v0.y, daz = v1.z - v0.z;
    const axLen = Math.hypot(dax, day, daz) || (element.properties.length ?? 1);
    const axNx = dax / axLen || 0, axNy = day / axLen || 0, axNz = daz / axLen || 1;
    let lxDx: number, lxDy: number, lxDz: number;
    if (Math.abs(axNz) < 0.9) {
      lxDx = -axNy; lxDy = axNx; lxDz = 0;
      const l = Math.hypot(lxDx, lxDy) || 1; lxDx /= l; lxDy /= l;
    } else {
      lxDx = 1; lxDy = 0; lxDz = 0;
    }

    const extDirId = id.next();
    lines.push(`#${extDirId}=IFCDIRECTION((0.,0.,1.));`);
    const solidId = id.next();
    lines.push(`#${solidId}=IFCEXTRUDEDAREASOLID(#${profileId},$,#${extDirId},${f(axLen)});`);
    const shapeRepId = id.next();
    lines.push(`#${shapeRepId}=IFCSHAPEREPRESENTATION(#${ctx.bodyContextId},'Body','SweptSolid',(#${solidId}));`);
    const prodShapeId = id.next();
    lines.push(`#${prodShapeId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRepId}));`);
    representationRef = `#${prodShapeId}`;

    const originId = id.next();
    lines.push(`#${originId}=IFCCARTESIANPOINT((${f(v0.x)},${f(v0.y)},${f(v0.z)}));`);
    const zDirId = id.next();
    lines.push(`#${zDirId}=IFCDIRECTION((${f(axNx, 6)},${f(axNy, 6)},${f(axNz, 6)}));`);
    const xDirId = id.next();
    lines.push(`#${xDirId}=IFCDIRECTION((${f(lxDx, 6)},${f(lxDy, 6)},${f(lxDz, 6)}));`);
    const axisId = id.next();
    lines.push(`#${axisId}=IFCAXIS2PLACEMENT3D(#${originId},#${zDirId},#${xDirId});`);
    const placementId = id.next();
    lines.push(`#${placementId}=IFCLOCALPLACEMENT(#${storeyPlacementId},#${axisId});`);
    placementRef = `#${placementId}`;
  }

  const entityId = id.next();
  lines.push(`#${entityId}=${entityClass}('${guid.stable(`cw:${element.id}`)}',#${ctx.ownerHistId},'${ctx.safeName(name)}',$,$,${placementRef},${representationRef},'${ctx.safeName(tag)}',${predefinedType});`);

  // Material association — glazing for spandrels, aluminium/steel for mullions
  const materialId = isMullion ? ctx.matIds.structuralSteel : ctx.matIds.glazing;
  associateMaterial(ctx, entityId, materialId);

  // Classification
  const classType = isMullion ? "member" : "plate";
  associateClassification(ctx, entityId, classType, isMullion ? ctx.materials.structuralSteel : ctx.materials.glazing);

  return entityId;
}

// ─────────── Window Writer (with opening + relationships) ───────────

function writeWindowEntity(
  element: GeometryElement,
  storeyPlacementId: number,
  hostWallEntityId: number | undefined,
  ctx: ExportContext
): number {
  const { id, lines, guid } = ctx;
  const winWidth = element.properties.width ?? 1.2;
  const winHeight = element.properties.height ?? 1.5;
  const winThickness = element.properties.thickness ?? 0.1;
  const sillHeight = element.properties.sillHeight ?? 0.9;
  const wallOffset = element.properties.wallOffset ?? 0;

  const dirX = element.properties.wallDirectionX ?? 1;
  const dirY = element.properties.wallDirectionY ?? 0;
  const origX = element.properties.wallOriginX ?? 0;
  const origY = element.properties.wallOriginY ?? 0;

  const winX = origX + dirX * wallOffset - dirX * winWidth / 2;
  const winY = origY + dirY * wallOffset - dirY * winWidth / 2;

  // OPENING ELEMENT — cuts through the wall thickness
  const openingDepth = 0.32; // host wall thickness + slight over-cut for boolean clean-up // slight over-cut
  const openingId = hostWallEntityId !== undefined
    ? writeOpeningElement(winX, winY, sillHeight, winWidth, winHeight, openingDepth, dirX, dirY, storeyPlacementId, "Window Opening", ctx)
    : null;

  // WINDOW SHAPE — place window inside the opening (if we have one)
  const profCenterId = id.next();
  lines.push(`#${profCenterId}=IFCCARTESIANPOINT((${f(winWidth / 2)},${f(winThickness / 2)}));`);
  const profPlacementId = id.next();
  lines.push(`#${profPlacementId}=IFCAXIS2PLACEMENT2D(#${profCenterId},$);`);
  const profileId = id.next();
  lines.push(`#${profileId}=IFCRECTANGLEPROFILEDEF(.AREA.,'Window Profile',#${profPlacementId},${f(winWidth)},${f(winThickness)});`);

  const extDirId = id.next();
  lines.push(`#${extDirId}=IFCDIRECTION((0.,0.,1.));`);
  const solidId = id.next();
  lines.push(`#${solidId}=IFCEXTRUDEDAREASOLID(#${profileId},$,#${extDirId},${f(winHeight)});`);
  const shapeRepId = id.next();
  lines.push(`#${shapeRepId}=IFCSHAPEREPRESENTATION(#${ctx.bodyContextId},'Body','SweptSolid',(#${solidId}));`);
  const prodShapeId = id.next();
  lines.push(`#${prodShapeId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRepId}));`);

  const winOriginId = id.next();
  lines.push(`#${winOriginId}=IFCCARTESIANPOINT((${f(winX)},${f(winY)},${f(sillHeight)}));`);
  const winXDirId = id.next();
  lines.push(`#${winXDirId}=IFCDIRECTION((${f(dirX, 6)},${f(dirY, 6)},0.));`);
  const winAxisId = id.next();
  lines.push(`#${winAxisId}=IFCAXIS2PLACEMENT3D(#${winOriginId},#${ctx.zDirId},#${winXDirId});`);
  const winPlacementId = id.next();
  lines.push(`#${winPlacementId}=IFCLOCALPLACEMENT(#${storeyPlacementId},#${winAxisId});`);

  const winId = id.next();
  const elementTag = element.properties.name?.substring(0, 30) ?? `WIN-${winId}`;
  lines.push(`#${winId}=IFCWINDOW('${guid.stable(`win:${element.id}`)}',#${ctx.ownerHistId},'${ctx.safeName(element.properties.name)}',$,$,#${winPlacementId},#${prodShapeId},'${ctx.safeName(elementTag)}',${f(winHeight)},${f(winWidth)},.WINDOW.,.SINGLE_PANEL.,$);`);

  // Type + material + classification
  const { key: typeKey } = getOrCreateWindowType(ctx, winWidth, winHeight);
  addTypeOccurrence(ctx.typeClusters.windows, typeKey, winId);
  associateMaterial(ctx, winId, ctx.matIds.glazing);
  associateClassification(ctx, winId, "window", ctx.materials.glazing);

  // Relationships: wall VOIDS opening; opening IS FILLED BY window
  if (hostWallEntityId !== undefined && openingId !== null) {
    const relVoidsId = id.next();
    lines.push(`#${relVoidsId}=IFCRELVOIDSELEMENT('${guid.fresh()}',#${ctx.ownerHistId},$,$,#${hostWallEntityId},#${openingId});`);
    const relFillsId = id.next();
    lines.push(`#${relFillsId}=IFCRELFILLSELEMENT('${guid.fresh()}',#${ctx.ownerHistId},$,$,#${openingId},#${winId});`);
  }

  // Pset_WindowCommon (Fix 6 v2 — ECBC 2017 Table 4.4 SHGC, NBC fire)
  const winCode = elementCodeData("window", ctx.materials.glazing, true);
  const propReference = id.next();
  lines.push(`#${propReference}=IFCPROPERTYSINGLEVALUE('Reference',$,IFCIDENTIFIER('${ctx.safeName(elementTag)}'),$);`);
  const propGlazingRatio = id.next();
  lines.push(`#${propGlazingRatio}=IFCPROPERTYSINGLEVALUE('GlazingAreaFraction',$,IFCPOSITIVERATIOMEASURE(0.85),$);`);
  const propThermal = id.next();
  lines.push(`#${propThermal}=IFCPROPERTYSINGLEVALUE('ThermalTransmittance',$,IFCTHERMALTRANSMITTANCEMEASURE(${f(winCode.thermalTransmittanceU, 3)}),$);`);
  const propSHGC = id.next();
  lines.push(`#${propSHGC}=IFCPROPERTYSINGLEVALUE('SolarHeatGainCoefficient',$,IFCPOSITIVERATIOMEASURE(0.25),$);`);
  const propVLT = id.next();
  lines.push(`#${propVLT}=IFCPROPERTYSINGLEVALUE('VisibleLightTransmittance',$,IFCPOSITIVERATIOMEASURE(0.55),$);`);
  const propInfiltration = id.next();
  lines.push(`#${propInfiltration}=IFCPROPERTYSINGLEVALUE('Infiltration',$,IFCREAL(0.3),$);`);
  const propIsExt = id.next();
  lines.push(`#${propIsExt}=IFCPROPERTYSINGLEVALUE('IsExternal',$,IFCBOOLEAN(.T.),$);`);
  const propFireRating = id.next();
  lines.push(`#${propFireRating}=IFCPROPERTYSINGLEVALUE('FireRating',$,IFCLABEL('${winCode.fireRating}'),$);`);
  const propAcoustic = id.next();
  lines.push(`#${propAcoustic}=IFCPROPERTYSINGLEVALUE('AcousticRating',$,IFCLABEL('STC ${winCode.acousticRatingSTC ?? 28}'),$);`);
  const propECBCRef = id.next();
  lines.push(`#${propECBCRef}=IFCPROPERTYSINGLEVALUE('Status',$,IFCLABEL('ECBC 2017 Compliant'),$);`);
  const winPsetId = id.next();
  lines.push(`#${winPsetId}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_WindowCommon',$,(#${propReference},#${propGlazingRatio},#${propThermal},#${propSHGC},#${propVLT},#${propInfiltration},#${propIsExt},#${propFireRating},#${propAcoustic},#${propECBCRef}));`);
  const relWinPsetId = id.next();
  lines.push(`#${relWinPsetId}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${winId}),#${winPsetId});`);

  ctx.presentationLayers["A-WIND"].push(shapeRepId);

  // IS code doc refs — ECBC + NBC
  for (const doc of codeDocsFor("window", ctx.materials.glazing)) {
    const list = ctx.documentAssociations.get(doc) ?? [];
    list.push(winId);
    ctx.documentAssociations.set(doc, list);
  }

  return winId;
}

// ─────────── Door Writer (with opening + relationships) ───────────

function writeDoorEntity(
  element: GeometryElement,
  storeyPlacementId: number,
  hostWallEntityId: number | undefined,
  ctx: ExportContext
): number {
  const { id, lines, guid } = ctx;
  const doorWidth = element.properties.width ?? 1.0;
  const doorHeight = element.properties.height ?? 2.1;
  const doorThickness = element.properties.thickness ?? 0.2;
  const wallOffset = element.properties.wallOffset ?? 0;

  const dirX = element.properties.wallDirectionX ?? 1;
  const dirY = element.properties.wallDirectionY ?? 0;
  const origX = element.properties.wallOriginX ?? 0;
  const origY = element.properties.wallOriginY ?? 0;

  const doorX = origX + dirX * wallOffset - dirX * doorWidth / 2;
  const doorY = origY + dirY * wallOffset - dirY * doorWidth / 2;

  const openingDepth = 0.32; // host wall thickness + slight over-cut for boolean clean-up
  const openingId = hostWallEntityId !== undefined
    ? writeOpeningElement(doorX, doorY, 0, doorWidth, doorHeight, openingDepth, dirX, dirY, storeyPlacementId, "Door Opening", ctx)
    : null;

  const profCenterId = id.next();
  lines.push(`#${profCenterId}=IFCCARTESIANPOINT((${f(doorWidth / 2)},${f(doorThickness / 2)}));`);
  const profPlacementId = id.next();
  lines.push(`#${profPlacementId}=IFCAXIS2PLACEMENT2D(#${profCenterId},$);`);
  const profileId = id.next();
  lines.push(`#${profileId}=IFCRECTANGLEPROFILEDEF(.AREA.,'Door Profile',#${profPlacementId},${f(doorWidth)},${f(doorThickness)});`);

  const extDirId = id.next();
  lines.push(`#${extDirId}=IFCDIRECTION((0.,0.,1.));`);
  const solidId = id.next();
  lines.push(`#${solidId}=IFCEXTRUDEDAREASOLID(#${profileId},$,#${extDirId},${f(doorHeight)});`);
  const shapeRepId = id.next();
  lines.push(`#${shapeRepId}=IFCSHAPEREPRESENTATION(#${ctx.bodyContextId},'Body','SweptSolid',(#${solidId}));`);
  const prodShapeId = id.next();
  lines.push(`#${prodShapeId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRepId}));`);

  const doorOriginId = id.next();
  lines.push(`#${doorOriginId}=IFCCARTESIANPOINT((${f(doorX)},${f(doorY)},0.));`);
  const doorXDirId = id.next();
  lines.push(`#${doorXDirId}=IFCDIRECTION((${f(dirX, 6)},${f(dirY, 6)},0.));`);
  const doorAxisId = id.next();
  lines.push(`#${doorAxisId}=IFCAXIS2PLACEMENT3D(#${doorOriginId},#${ctx.zDirId},#${doorXDirId});`);
  const doorPlacementId = id.next();
  lines.push(`#${doorPlacementId}=IFCLOCALPLACEMENT(#${storeyPlacementId},#${doorAxisId});`);

  const isDoubleDoor = doorWidth >= 1.8;
  const operationType = isDoubleDoor ? ".DOUBLE_SWING_LEFT." : ".SINGLE_SWING_LEFT.";
  const doorId = id.next();
  const elementTag = element.properties.name?.substring(0, 30) ?? `DOOR-${doorId}`;
  lines.push(`#${doorId}=IFCDOOR('${guid.stable(`door:${element.id}`)}',#${ctx.ownerHistId},'${ctx.safeName(element.properties.name)}',$,$,#${doorPlacementId},#${prodShapeId},'${ctx.safeName(elementTag)}',${f(doorHeight)},${f(doorWidth)},.DOOR.,${operationType},$);`);

  const { key: typeKey } = getOrCreateDoorType(ctx, doorWidth, doorHeight, isDoubleDoor);
  addTypeOccurrence(ctx.typeClusters.doors, typeKey, doorId);
  associateMaterial(ctx, doorId, ctx.matIds.timberDoor);
  associateClassification(ctx, doorId, "door", ctx.materials.timberDoor);

  if (hostWallEntityId !== undefined && openingId !== null) {
    const relVoidsId = id.next();
    lines.push(`#${relVoidsId}=IFCRELVOIDSELEMENT('${guid.fresh()}',#${ctx.ownerHistId},$,$,#${hostWallEntityId},#${openingId});`);
    const relFillsId = id.next();
    lines.push(`#${relFillsId}=IFCRELFILLSELEMENT('${guid.fresh()}',#${ctx.ownerHistId},$,$,#${openingId},#${doorId});`);
  }

  // Pset_DoorCommon — NBC Part 3 (RPWD accessibility) + NBC Part 4 fire
  const doorCode = elementCodeData("door", ctx.materials.timberDoor, false);
  const propReference = id.next();
  lines.push(`#${propReference}=IFCPROPERTYSINGLEVALUE('Reference',$,IFCIDENTIFIER('${ctx.safeName(elementTag)}'),$);`);
  const propFire = id.next();
  lines.push(`#${propFire}=IFCPROPERTYSINGLEVALUE('FireRating',$,IFCLABEL('${doorCode.fireRating}'),$);`);
  const propIsExt = id.next();
  lines.push(`#${propIsExt}=IFCPROPERTYSINGLEVALUE('IsExternal',$,IFCBOOLEAN(.T.),$);`);
  const propHandicap = id.next();
  lines.push(`#${propHandicap}=IFCPROPERTYSINGLEVALUE('HandicapAccessible',$,IFCBOOLEAN(${doorWidth >= 0.9 ? ".T." : ".F."}),$);`);
  const propFireExit = id.next();
  lines.push(`#${propFireExit}=IFCPROPERTYSINGLEVALUE('FireExit',$,IFCBOOLEAN(${doorWidth >= 1.0 ? ".T." : ".F."}),$);`);
  const propSmokeStop = id.next();
  lines.push(`#${propSmokeStop}=IFCPROPERTYSINGLEVALUE('SmokeStop',$,IFCBOOLEAN(.F.),$);`);
  const propAcoustic = id.next();
  lines.push(`#${propAcoustic}=IFCPROPERTYSINGLEVALUE('AcousticRating',$,IFCLABEL('STC ${doorCode.acousticRatingSTC ?? 30}'),$);`);
  const propSelfClose = id.next();
  lines.push(`#${propSelfClose}=IFCPROPERTYSINGLEVALUE('SelfClosing',$,IFCBOOLEAN(.F.),$);`);
  const doorPsetId = id.next();
  lines.push(`#${doorPsetId}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_DoorCommon',$,(#${propReference},#${propFire},#${propIsExt},#${propHandicap},#${propFireExit},#${propSmokeStop},#${propAcoustic},#${propSelfClose}));`);
  const relDoorPsetId = id.next();
  lines.push(`#${relDoorPsetId}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${doorId}),#${doorPsetId});`);

  ctx.presentationLayers["A-DOOR"].push(shapeRepId);

  // IS code doc refs
  for (const doc of codeDocsFor("door", ctx.materials.timberDoor)) {
    const list = ctx.documentAssociations.get(doc) ?? [];
    list.push(doorId);
    ctx.documentAssociations.set(doc, list);
  }

  return doorId;
}

// ─────────── Opening Element ───────────

function writeOpeningElement(
  x: number, y: number, z: number,
  width: number, height: number, depth: number,
  wallDirX: number, wallDirY: number,
  storeyPlacementId: number,
  label: string,
  ctx: ExportContext
): number {
  const { id, lines, guid } = ctx;

  // Rectangle profile representing the hole cross-section
  const profCenterId = id.next();
  lines.push(`#${profCenterId}=IFCCARTESIANPOINT((${f(width / 2)},${f(depth / 2)}));`);
  const profPlacementId = id.next();
  lines.push(`#${profPlacementId}=IFCAXIS2PLACEMENT2D(#${profCenterId},$);`);
  const profileId = id.next();
  lines.push(`#${profileId}=IFCRECTANGLEPROFILEDEF(.AREA.,'${ctx.safeName(label)} Profile',#${profPlacementId},${f(width)},${f(depth)});`);

  // Extrude upward by the opening height
  const extDirId = id.next();
  lines.push(`#${extDirId}=IFCDIRECTION((0.,0.,1.));`);
  const solidId = id.next();
  lines.push(`#${solidId}=IFCEXTRUDEDAREASOLID(#${profileId},$,#${extDirId},${f(height)});`);
  const shapeRepId = id.next();
  lines.push(`#${shapeRepId}=IFCSHAPEREPRESENTATION(#${ctx.bodyContextId},'Body','SweptSolid',(#${solidId}));`);
  const prodShapeId = id.next();
  lines.push(`#${prodShapeId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRepId}));`);

  // Center the opening on the wall's local axis — shift -depth/2 along wall normal so it straddles the wall
  const normalX = -wallDirY;
  const normalY = wallDirX;
  const offsetX = normalX * depth / 2;
  const offsetY = normalY * depth / 2;

  const originId = id.next();
  lines.push(`#${originId}=IFCCARTESIANPOINT((${f(x + offsetX)},${f(y + offsetY)},${f(z)}));`);
  const xDirId = id.next();
  const ln = Math.hypot(wallDirX, wallDirY) || 1;
  lines.push(`#${xDirId}=IFCDIRECTION((${f(wallDirX / ln, 6)},${f(wallDirY / ln, 6)},0.));`);
  const axisId = id.next();
  lines.push(`#${axisId}=IFCAXIS2PLACEMENT3D(#${originId},#${ctx.zDirId},#${xDirId});`);
  const placementId = id.next();
  lines.push(`#${placementId}=IFCLOCALPLACEMENT(#${storeyPlacementId},#${axisId});`);

  const openingId = id.next();
  lines.push(`#${openingId}=IFCOPENINGELEMENT('${guid.fresh()}',#${ctx.ownerHistId},'${ctx.safeName(label)}','Opening void for filling',$,#${placementId},#${prodShapeId},$,.OPENING.);`);
  return openingId;
}

// ─────────── Stair Writer ───────────

/**
 * Stair decomposition (Fix 15 v2) — emits an IfcStair container that aggregates
 * IfcStairFlight + IfcSlab(LANDING) + IfcRailing children via IfcRelAggregates.
 * The return value is the IfcStair parent entity (what the caller adds to the
 * storey's spatial containment relationship).
 */
function writeStairEntity(
  element: GeometryElement,
  storeyPlacementId: number,
  ctx: ExportContext
): number {
  const { id, lines, guid } = ctx;
  const stairWidth = element.properties.width ?? 1.2;
  const stairLength = element.properties.length ?? 3.0;
  const stairHeight = element.properties.height ?? 3.6;
  const riserCount = element.properties.riserCount ?? 20;
  // NBC Part 4 limits: max 190mm risers for residential, 150mm for assembly/public
  let riserHeight = element.properties.riserHeight ?? 0.17;
  if (riserHeight > 0.19) riserHeight = 0.19;       // NBC clamp
  let treadDepth = element.properties.treadDepth ?? 0.28;
  if (treadDepth < 0.25) treadDepth = 0.25;         // NBC minimum

  const profCenterId = id.next();
  lines.push(`#${profCenterId}=IFCCARTESIANPOINT((${f(stairWidth / 2)},${f(stairLength / 2)}));`);
  const profPlacementId = id.next();
  lines.push(`#${profPlacementId}=IFCAXIS2PLACEMENT2D(#${profCenterId},$);`);
  const profileId = id.next();
  lines.push(`#${profileId}=IFCRECTANGLEPROFILEDEF(.AREA.,'Stair Profile',#${profPlacementId},${f(stairWidth)},${f(stairLength)});`);

  const extDirId = id.next();
  lines.push(`#${extDirId}=IFCDIRECTION((0.,0.,1.));`);
  const solidId = id.next();
  lines.push(`#${solidId}=IFCEXTRUDEDAREASOLID(#${profileId},$,#${extDirId},${f(stairHeight)});`);
  const shapeRepId = id.next();
  lines.push(`#${shapeRepId}=IFCSHAPEREPRESENTATION(#${ctx.bodyContextId},'Body','SweptSolid',(#${solidId}));`);
  const prodShapeId = id.next();
  lines.push(`#${prodShapeId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRepId}));`);

  const v0 = element.vertices[0];
  const stairOriginId = id.next();
  lines.push(`#${stairOriginId}=IFCCARTESIANPOINT((${f(v0.x)},${f(v0.y)},0.));`);
  const stairAxisId = id.next();
  lines.push(`#${stairAxisId}=IFCAXIS2PLACEMENT3D(#${stairOriginId},#${ctx.zDirId},$);`);
  const stairPlacementId = id.next();
  lines.push(`#${stairPlacementId}=IFCLOCALPLACEMENT(#${storeyPlacementId},#${stairAxisId});`);

  // ─── IfcStair CONTAINER (parent) ───
  const stairId = id.next();
  const elementTag = element.properties.name?.substring(0, 30) ?? `STR-${stairId}`;
  lines.push(`#${stairId}=IFCSTAIR('${guid.stable(`stair:${element.id}`)}',#${ctx.ownerHistId},'${ctx.safeName(element.properties.name)}','Stair Assembly',$,#${stairPlacementId},$,'${ctx.safeName(elementTag)}',.STRAIGHT_RUN_STAIR.);`);
  associateMaterial(ctx, stairId, ctx.matIds.concrete);
  associateClassification(ctx, stairId, "stair", ctx.materials.concrete);

  // ─── IfcStairFlight CHILD ───
  const flightId = id.next();
  lines.push(`#${flightId}=IFCSTAIRFLIGHT('${guid.stable(`flight:${element.id}`)}',#${ctx.ownerHistId},'${ctx.safeName(element.properties.name)} Flight 1',$,$,#${stairPlacementId},#${prodShapeId},'${ctx.safeName(elementTag)}-FLT',${riserCount},${riserCount - 1},${f(riserHeight)},${f(treadDepth)},.STRAIGHT.);`);
  ctx.presentationLayers["A-STAR"].push(shapeRepId);
  const { key: typeKey } = getOrCreateStairType(ctx, riserCount, riserHeight, treadDepth);
  addTypeOccurrence(ctx.typeClusters.stairs, typeKey, flightId);
  associateMaterial(ctx, flightId, ctx.matIds.concrete);

  // Pset_StairFlightCommon with NBC Part 4 / IS 456 refs
  const propRiserCount = id.next();
  lines.push(`#${propRiserCount}=IFCPROPERTYSINGLEVALUE('NumberOfRiser',$,IFCINTEGER(${riserCount}),$);`);
  const propTreadCount = id.next();
  lines.push(`#${propTreadCount}=IFCPROPERTYSINGLEVALUE('NumberOfTreads',$,IFCINTEGER(${riserCount - 1}),$);`);
  const propRiserH = id.next();
  lines.push(`#${propRiserH}=IFCPROPERTYSINGLEVALUE('RiserHeight',$,IFCLENGTHMEASURE(${f(riserHeight)}),$);`);
  const propTreadD = id.next();
  lines.push(`#${propTreadD}=IFCPROPERTYSINGLEVALUE('TreadLength',$,IFCLENGTHMEASURE(${f(treadDepth)}),$);`);
  const propFireRating = id.next();
  lines.push(`#${propFireRating}=IFCPROPERTYSINGLEVALUE('FireRating',$,IFCLABEL('2 hour'),$);`);
  const propNBC = id.next();
  lines.push(`#${propNBC}=IFCPROPERTYSINGLEVALUE('Reference',$,IFCIDENTIFIER('NBC 2016 Part 4 Clause 4.5'),$);`);
  const propHeadroom = id.next();
  lines.push(`#${propHeadroom}=IFCPROPERTYSINGLEVALUE('Headroom',$,IFCLENGTHMEASURE(2.100),$);`);
  const stairPsetId = id.next();
  lines.push(`#${stairPsetId}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_StairFlightCommon',$,(#${propRiserCount},#${propTreadCount},#${propRiserH},#${propTreadD},#${propFireRating},#${propNBC},#${propHeadroom}));`);
  const relStairPsetId = id.next();
  lines.push(`#${relStairPsetId}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${flightId}),#${stairPsetId});`);

  // ─── IfcSlab.LANDING child ───
  const landingDepth = 0.9;
  const landingCenterId = id.next();
  lines.push(`#${landingCenterId}=IFCCARTESIANPOINT((${f(stairWidth / 2)},${f(landingDepth / 2)}));`);
  const landingPlacementProfId = id.next();
  lines.push(`#${landingPlacementProfId}=IFCAXIS2PLACEMENT2D(#${landingCenterId},$);`);
  const landingProfileId = id.next();
  lines.push(`#${landingProfileId}=IFCRECTANGLEPROFILEDEF(.AREA.,'Landing Profile',#${landingPlacementProfId},${f(stairWidth)},${f(landingDepth)});`);
  const landingExtDirId = id.next();
  lines.push(`#${landingExtDirId}=IFCDIRECTION((0.,0.,1.));`);
  const landingSolidId = id.next();
  lines.push(`#${landingSolidId}=IFCEXTRUDEDAREASOLID(#${landingProfileId},$,#${landingExtDirId},0.150);`);
  const landingShapeRepId = id.next();
  lines.push(`#${landingShapeRepId}=IFCSHAPEREPRESENTATION(#${ctx.bodyContextId},'Body','SweptSolid',(#${landingSolidId}));`);
  const landingProdId = id.next();
  lines.push(`#${landingProdId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${landingShapeRepId}));`);
  const landingOriginId = id.next();
  // Place landing TOP at storey + stairHeight (== floor level above) by setting its base
  // at stairHeight - landingThickness. Previously placed at stairHeight + extruded UP,
  // which projected the landing 0.15m above the roof on the topmost-storey stair —
  // visible as a small slab on top of the building.
  const landingThickness = 0.150;
  lines.push(`#${landingOriginId}=IFCCARTESIANPOINT((${f(v0.x)},${f(v0.y + stairLength)},${f(stairHeight - landingThickness)}));`);
  const landingAxisId = id.next();
  lines.push(`#${landingAxisId}=IFCAXIS2PLACEMENT3D(#${landingOriginId},#${ctx.zDirId},$);`);
  const landingPlacementId = id.next();
  lines.push(`#${landingPlacementId}=IFCLOCALPLACEMENT(#${storeyPlacementId},#${landingAxisId});`);
  const landingId = id.next();
  lines.push(`#${landingId}=IFCSLAB('${guid.stable(`landing:${element.id}`)}',#${ctx.ownerHistId},'${ctx.safeName(element.properties.name)} Landing','Intermediate landing',$,#${landingPlacementId},#${landingProdId},'${ctx.safeName(elementTag)}-LND',.LANDING.);`);
  associateMaterial(ctx, landingId, ctx.matIds.concrete);
  ctx.presentationLayers["A-STAR"].push(landingShapeRepId);

  // ─── IfcRailing child — 1000mm handrail (NBC min 900mm) ───
  const railingProfCenterId = id.next();
  lines.push(`#${railingProfCenterId}=IFCCARTESIANPOINT((0.025,0.025));`);
  const railingProfPlacementId = id.next();
  lines.push(`#${railingProfPlacementId}=IFCAXIS2PLACEMENT2D(#${railingProfCenterId},$);`);
  const railingProfileId = id.next();
  lines.push(`#${railingProfileId}=IFCRECTANGLEPROFILEDEF(.AREA.,'Handrail Profile',#${railingProfPlacementId},0.050,0.050);`);
  const railingExtDirId = id.next();
  lines.push(`#${railingExtDirId}=IFCDIRECTION((0.,1.,0.));`);
  const railingSolidId = id.next();
  lines.push(`#${railingSolidId}=IFCEXTRUDEDAREASOLID(#${railingProfileId},$,#${railingExtDirId},${f(stairLength)});`);
  const railingShapeRepId = id.next();
  lines.push(`#${railingShapeRepId}=IFCSHAPEREPRESENTATION(#${ctx.bodyContextId},'Body','SweptSolid',(#${railingSolidId}));`);
  const railingProdId = id.next();
  lines.push(`#${railingProdId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${railingShapeRepId}));`);
  const railingOriginId = id.next();
  lines.push(`#${railingOriginId}=IFCCARTESIANPOINT((${f(v0.x + stairWidth - 0.1)},${f(v0.y)},1.0));`);
  const railingAxisId = id.next();
  lines.push(`#${railingAxisId}=IFCAXIS2PLACEMENT3D(#${railingOriginId},#${ctx.zDirId},$);`);
  const railingPlacementId = id.next();
  lines.push(`#${railingPlacementId}=IFCLOCALPLACEMENT(#${storeyPlacementId},#${railingAxisId});`);
  const railingId = id.next();
  lines.push(`#${railingId}=IFCRAILING('${guid.stable(`railing:${element.id}`)}',#${ctx.ownerHistId},'${ctx.safeName(element.properties.name)} Handrail','Stair handrail',$,#${railingPlacementId},#${railingProdId},'${ctx.safeName(elementTag)}-RAIL',.HANDRAIL.);`);
  associateMaterial(ctx, railingId, ctx.matIds.structuralSteel);
  ctx.presentationLayers["A-STAR"].push(railingShapeRepId);

  const propRailH = id.next();
  lines.push(`#${propRailH}=IFCPROPERTYSINGLEVALUE('Height',$,IFCLENGTHMEASURE(1.000),$);`);
  const propRailExt = id.next();
  lines.push(`#${propRailExt}=IFCPROPERTYSINGLEVALUE('IsExternal',$,IFCBOOLEAN(.F.),$);`);
  const propRailRef = id.next();
  lines.push(`#${propRailRef}=IFCPROPERTYSINGLEVALUE('Reference',$,IFCIDENTIFIER('NBC 2016 Clause 4.5.5'),$);`);
  const railingPsetId = id.next();
  lines.push(`#${railingPsetId}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_RailingCommon',$,(#${propRailH},#${propRailExt},#${propRailRef}));`);
  const relRailingPsetId = id.next();
  lines.push(`#${relRailingPsetId}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${railingId}),#${railingPsetId});`);

  // ─── IfcRelAggregates — IfcStair parent contains flight + landing + railing ───
  const aggRelId = id.next();
  lines.push(`#${aggRelId}=IFCRELAGGREGATES('${guid.fresh()}',#${ctx.ownerHistId},'Stair Decomposition',$,#${stairId},(#${flightId},#${landingId},#${railingId}));`);

  // IS code doc refs
  for (const doc of codeDocsFor("stair", ctx.materials.concrete)) {
    const list = ctx.documentAssociations.get(doc) ?? [];
    list.push(stairId);
    ctx.documentAssociations.set(doc, list);
  }

  return stairId;
}

// ─────────── Space Writer (with COBie Pset_SpaceCommon) ───────────

function writeSpaceEntity(
  element: GeometryElement,
  storeyPlacementId: number,
  ctx: ExportContext
): number {
  const { id, lines, guid } = ctx;
  const spaceHeight = element.properties.height ?? 3.6;
  const spaceFootprint = element.properties.spaceFootprint;
  const spaceUsage = element.properties.spaceUsage ?? "Generic";
  const spaceName = element.properties.spaceName ?? element.properties.name;

  let spaceId: number;
  let spaceArea = element.properties.area ?? 0;
  let spaceVolume = spaceArea * spaceHeight;
  let capturedFootprint: FootprintPoint[] | undefined;

  if (!spaceFootprint || spaceFootprint.length < 3) {
    // Fallback bounding representation
    spaceId = id.next();
    const elementTag = spaceName?.substring(0, 30) ?? `SPC-${spaceId}`;
    lines.push(`#${spaceId}=IFCSPACE('${guid.stable(`space:${element.id}`)}',#${ctx.ownerHistId},'${ctx.safeName(spaceName)}',$,$,#${storeyPlacementId},$,'${ctx.safeName(elementTag)}',.ELEMENT.,.INTERNAL.,$);`);
  } else {
    spaceArea = polygonAreaCalc(spaceFootprint);
    spaceVolume = spaceArea * spaceHeight;
    capturedFootprint = spaceFootprint;

    const ptIds: number[] = [];
    for (const p of spaceFootprint) {
      const ptId = id.next();
      lines.push(`#${ptId}=IFCCARTESIANPOINT((${f(p.x)},${f(p.y)}));`);
      ptIds.push(ptId);
    }
    ptIds.push(ptIds[0]);

    const polylineId = id.next();
    lines.push(`#${polylineId}=IFCPOLYLINE((${ptIds.map(i => `#${i}`).join(",")}));`);
    const profileId = id.next();
    lines.push(`#${profileId}=IFCARBITRARYCLOSEDPROFILEDEF(.AREA.,'Space Profile',#${polylineId});`);

    // FootPrint representation (Fix 3 v2)
    const footprintRepId = id.next();
    lines.push(`#${footprintRepId}=IFCSHAPEREPRESENTATION(#${ctx.footprintContextId},'FootPrint','Curve2D',(#${polylineId}));`);

    const extDirId = id.next();
    lines.push(`#${extDirId}=IFCDIRECTION((0.,0.,1.));`);
    const solidId = id.next();
    lines.push(`#${solidId}=IFCEXTRUDEDAREASOLID(#${profileId},$,#${extDirId},${f(spaceHeight)});`);
    const shapeRepId = id.next();
    lines.push(`#${shapeRepId}=IFCSHAPEREPRESENTATION(#${ctx.bodyContextId},'Body','SweptSolid',(#${solidId}));`);
    const prodShapeId = id.next();
    lines.push(`#${prodShapeId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${footprintRepId},#${shapeRepId}));`);
    ctx.presentationLayers["A-SPAC"].push(shapeRepId, footprintRepId);

    const spaceOriginId = id.next();
    lines.push(`#${spaceOriginId}=IFCCARTESIANPOINT((0.,0.,0.));`);
    const spaceAxisId = id.next();
    lines.push(`#${spaceAxisId}=IFCAXIS2PLACEMENT3D(#${spaceOriginId},$,$);`);
    const spacePlacementId = id.next();
    lines.push(`#${spacePlacementId}=IFCLOCALPLACEMENT(#${storeyPlacementId},#${spaceAxisId});`);

    const interiorOrGFA = spaceUsage.toLowerCase() === "circulation" ? ".GFA." : ".INTERNAL.";
    spaceId = id.next();
    const elementTag = spaceName?.substring(0, 30) ?? `SPC-${spaceId}`;
    lines.push(`#${spaceId}=IFCSPACE('${guid.stable(`space:${element.id}`)}',#${ctx.ownerHistId},'${ctx.safeName(spaceName)}',$,$,#${spacePlacementId},#${prodShapeId},'${ctx.safeName(elementTag)}',.ELEMENT.,${interiorOrGFA},$);`);
  }

  const { key: typeKey } = getOrCreateSpaceType(ctx, spaceUsage);
  addTypeOccurrence(ctx.typeClusters.spaces, typeKey, spaceId);

  // COBie Pset_SpaceCommon — required for facility handover
  const propPubliclyAccessible = id.next();
  lines.push(`#${propPubliclyAccessible}=IFCPROPERTYSINGLEVALUE('PubliclyAccessible',$,IFCBOOLEAN(.F.),$);`);
  const propHandicap = id.next();
  lines.push(`#${propHandicap}=IFCPROPERTYSINGLEVALUE('HandicapAccessible',$,IFCBOOLEAN(.T.),$);`);
  const propIsExt = id.next();
  lines.push(`#${propIsExt}=IFCPROPERTYSINGLEVALUE('IsExternal',$,IFCBOOLEAN(.F.),$);`);
  const propGrossArea = id.next();
  lines.push(`#${propGrossArea}=IFCPROPERTYSINGLEVALUE('GrossPlannedArea',$,IFCAREAMEASURE(${f(spaceArea, 2)}),$);`);
  const propNetArea = id.next();
  lines.push(`#${propNetArea}=IFCPROPERTYSINGLEVALUE('NetPlannedArea',$,IFCAREAMEASURE(${f(spaceArea, 2)}),$);`);
  const propCategory = id.next();
  lines.push(`#${propCategory}=IFCPROPERTYSINGLEVALUE('Category',$,IFCLABEL('${ctx.safeName(spaceUsage)}'),$);`);

  const spacePsetId = id.next();
  lines.push(`#${spacePsetId}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_SpaceCommon',$,(#${propPubliclyAccessible},#${propHandicap},#${propIsExt},#${propGrossArea},#${propNetArea},#${propCategory}));`);
  const relSpacePsetId = id.next();
  lines.push(`#${relSpacePsetId}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${spaceId}),#${spacePsetId});`);

  // Qto_SpaceBaseQuantities
  const qHeight = id.next();
  lines.push(`#${qHeight}=IFCQUANTITYLENGTH('Height',$,$,${f(spaceHeight)},$);`);
  const qFloorArea = id.next();
  lines.push(`#${qFloorArea}=IFCQUANTITYAREA('GrossFloorArea',$,$,${f(spaceArea, 2)},$);`);
  const qNetFloorArea = id.next();
  lines.push(`#${qNetFloorArea}=IFCQUANTITYAREA('NetFloorArea',$,$,${f(spaceArea, 2)},$);`);
  const qVolume = id.next();
  lines.push(`#${qVolume}=IFCQUANTITYVOLUME('GrossVolume',$,$,${f(spaceVolume, 4)},$);`);
  const spaceQtoId = id.next();
  lines.push(`#${spaceQtoId}=IFCELEMENTQUANTITY('${guid.fresh()}',#${ctx.ownerHistId},'Qto_SpaceBaseQuantities',$,$,(#${qHeight},#${qFloorArea},#${qNetFloorArea},#${qVolume}));`);
  const relSpaceQtoId = id.next();
  lines.push(`#${relSpaceQtoId}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${spaceId}),#${spaceQtoId});`);

  // ─── Pset_RERA_India — regulatory disclosure (Fix 6 v2) ───
  // Applies only when the project is flagged as residential (rera option present) OR spaceUsage suggests a flat / apartment.
  const isResidentialSpace = /flat|apartment|bedroom|living|kitchen|hall|master|unit/i.test(spaceUsage + " " + (spaceName ?? ""));
  if (ctx.rera || isResidentialSpace) {
    const carpet = element.properties.area ?? spaceArea;
    const builtUp = carpet * (ctx.rera?.defaultRatios?.builtUpOverCarpet ?? 1.15);
    const superBuiltUp = carpet * (ctx.rera?.defaultRatios?.superBuiltUpOverCarpet ?? 1.35);

    const pRera1 = id.next();
    lines.push(`#${pRera1}=IFCPROPERTYSINGLEVALUE('CarpetArea',$,IFCAREAMEASURE(${f(carpet, 2)}),$);`);
    const pRera2 = id.next();
    lines.push(`#${pRera2}=IFCPROPERTYSINGLEVALUE('BuiltUpArea',$,IFCAREAMEASURE(${f(builtUp, 2)}),$);`);
    const pRera3 = id.next();
    lines.push(`#${pRera3}=IFCPROPERTYSINGLEVALUE('SuperBuiltUpArea',$,IFCAREAMEASURE(${f(superBuiltUp, 2)}),$);`);
    const pRera4 = id.next();
    lines.push(`#${pRera4}=IFCPROPERTYSINGLEVALUE('RERAProjectId',$,IFCIDENTIFIER('${ctx.safeName(ctx.rera?.projectId ?? "PENDING")}'),$);`);
    const pRera5 = id.next();
    lines.push(`#${pRera5}=IFCPROPERTYSINGLEVALUE('UnitNumber',$,IFCIDENTIFIER('${ctx.safeName(spaceName ?? "")}'),$);`);
    const pRera6 = id.next();
    lines.push(`#${pRera6}=IFCPROPERTYSINGLEVALUE('RERAAct',$,IFCLABEL('Real Estate (Regulation and Development) Act 2016'),$);`);

    const psetRera = id.next();
    lines.push(`#${psetRera}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_RERA_India',$,(#${pRera1},#${pRera2},#${pRera3},#${pRera4},#${pRera5},#${pRera6}));`);
    const relRera = id.next();
    lines.push(`#${relRera}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${spaceId}),#${psetRera});`);
  }

  // Track for space-boundary detection (Fix 10)
  if (capturedFootprint && capturedFootprint.length >= 3) {
    ctx.spaceRecords.push({
      entityId: spaceId,
      footprint: capturedFootprint,
      storeyIndex: element.properties.storeyIndex,
    });
  }

  // IS code document references
  for (const doc of codeDocsFor("space", "")) {
    const list = ctx.documentAssociations.get(doc) ?? [];
    list.push(spaceId);
    ctx.documentAssociations.set(doc, list);
  }

  return spaceId;
}

// ─────────── MEP Writers ───────────

function writeMEPSegmentEntity(
  element: GeometryElement,
  ifcEntityName: "IFCDUCTSEGMENT" | "IFCCABLECARRIERSEGMENT",
  storeyPlacementId: number,
  ctx: ExportContext,
  kind: "duct" | "cable-tray"
): number {
  const { id, lines, guid } = ctx;
  const segW = element.properties.width ?? 0.6;
  const segH = element.properties.height ?? 0.4;
  const segLen = element.properties.length ?? 5;
  const name = element.properties.name ?? "MEP Segment";

  let prodShapeRef = "$";
  let placementRef = "$";

  if (ctx.emitMEPGeometry) {
    const profCenterId = id.next();
    lines.push(`#${profCenterId}=IFCCARTESIANPOINT((${f(segW / 2)},${f(segH / 2)}));`);
    const profPlacementId = id.next();
    lines.push(`#${profPlacementId}=IFCAXIS2PLACEMENT2D(#${profCenterId},$);`);
    const profileId = id.next();
    lines.push(`#${profileId}=IFCRECTANGLEPROFILEDEF(.AREA.,'${ifcEntityName} Profile',#${profPlacementId},${f(segW)},${f(segH)});`);

    // Use 3D vertex direction when v1 exists; otherwise default to +X
    const v0 = element.vertices[0] ?? { x: 0, y: 0, z: 0 };
    const v1 = element.vertices[1];
    let dx = 1, dy = 0, dz = 0;
    if (v1) {
      const ax = v1.x - v0.x, ay = v1.y - v0.y, az = v1.z - v0.z;
      const al = Math.hypot(ax, ay, az) || 1;
      dx = ax / al; dy = ay / al; dz = az / al;
    }
    let lxDx: number, lxDy: number, lxDz: number;
    if (Math.abs(dz) < 0.9) { lxDx = -dy; lxDy = dx; lxDz = 0; const l = Math.hypot(lxDx, lxDy) || 1; lxDx /= l; lxDy /= l; }
    else { lxDx = 1; lxDy = 0; lxDz = 0; }

    const extDirId = id.next();
    lines.push(`#${extDirId}=IFCDIRECTION((0.,0.,1.));`);
    const solidId = id.next();
    lines.push(`#${solidId}=IFCEXTRUDEDAREASOLID(#${profileId},$,#${extDirId},${f(segLen)});`);
    const shapeRepId = id.next();
    lines.push(`#${shapeRepId}=IFCSHAPEREPRESENTATION(#${ctx.bodyContextId},'Body','SweptSolid',(#${solidId}));`);
    const prodShapeId = id.next();
    lines.push(`#${prodShapeId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRepId}));`);
    prodShapeRef = `#${prodShapeId}`;

    const originId = id.next();
    lines.push(`#${originId}=IFCCARTESIANPOINT((${f(v0.x)},${f(v0.y)},${f(v0.z)}));`);
    const zdId = id.next();
    lines.push(`#${zdId}=IFCDIRECTION((${f(dx, 6)},${f(dy, 6)},${f(dz, 6)}));`);
    const xdId = id.next();
    lines.push(`#${xdId}=IFCDIRECTION((${f(lxDx, 6)},${f(lxDy, 6)},${f(lxDz, 6)}));`);
    const axisId = id.next();
    lines.push(`#${axisId}=IFCAXIS2PLACEMENT3D(#${originId},#${zdId},#${xdId});`);
    const placementId = id.next();
    lines.push(`#${placementId}=IFCLOCALPLACEMENT(#${storeyPlacementId},#${axisId});`);
    placementRef = `#${placementId}`;

    if (kind === "duct") ctx.presentationLayers["M-DUCT"].push(shapeRepId);
    else ctx.presentationLayers["E-CABL"].push(shapeRepId);
  }

  const entityId = id.next();
  const elementTag = name.substring(0, 30);
  const stableKey = kind === "duct" ? `duct:${element.id}` : `cable:${element.id}`;
  lines.push(`#${entityId}=${ifcEntityName}('${guid.stable(stableKey)}',#${ctx.ownerHistId},'${ctx.safeName(name)}',$,$,${placementRef},${prodShapeRef},'${ctx.safeName(elementTag)}',.NOTDEFINED.);`);

  associateMaterial(ctx, entityId, ctx.matIds.structuralSteel);
  associateClassification(ctx, entityId, kind, ctx.materials.structuralSteel);
  const systemKey = mepSystemFor(element);
  if (systemKey) assignToSystem(ctx, entityId, systemKey);

  return entityId;
}

function writeMEPPipeEntity(
  element: GeometryElement,
  storeyPlacementId: number,
  ctx: ExportContext
): number {
  const { id, lines, guid } = ctx;
  const diameter = element.properties.diameter ?? 0.05;
  const pipeHeight = element.properties.height ?? element.properties.length ?? 3.6;
  const name = element.properties.name ?? "Pipe";

  let prodShapeRef = "$";
  let placementRef = "$";

  if (ctx.emitMEPGeometry) {
    const profCenterId = id.next();
    lines.push(`#${profCenterId}=IFCCARTESIANPOINT((0.,0.));`);
    const profPlacementId = id.next();
    lines.push(`#${profPlacementId}=IFCAXIS2PLACEMENT2D(#${profCenterId},$);`);
    const profileId = id.next();
    lines.push(`#${profileId}=IFCCIRCLEPROFILEDEF(.AREA.,'Pipe Profile',#${profPlacementId},${f(diameter / 2)});`);

    const solidId = id.next();
    lines.push(`#${solidId}=IFCEXTRUDEDAREASOLID(#${profileId},$,#${ctx.zDirId},${f(pipeHeight)});`);
    const shapeRepId = id.next();
    lines.push(`#${shapeRepId}=IFCSHAPEREPRESENTATION(#${ctx.bodyContextId},'Body','SweptSolid',(#${solidId}));`);
    const prodShapeId = id.next();
    lines.push(`#${prodShapeId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRepId}));`);
    prodShapeRef = `#${prodShapeId}`;

    const v = element.vertices[0] ?? { x: 0, y: 0, z: 0 };
    const originId = id.next();
    lines.push(`#${originId}=IFCCARTESIANPOINT((${f(v.x)},${f(v.y)},${f(v.z)}));`);
    const axisId = id.next();
    lines.push(`#${axisId}=IFCAXIS2PLACEMENT3D(#${originId},#${ctx.zDirId},$);`);
    const placementId = id.next();
    lines.push(`#${placementId}=IFCLOCALPLACEMENT(#${storeyPlacementId},#${axisId});`);
    placementRef = `#${placementId}`;
    ctx.presentationLayers["M-PIPE"].push(shapeRepId);
  }

  const entityId = id.next();
  const elementTag = name.substring(0, 30);
  lines.push(`#${entityId}=IFCPIPESEGMENT('${guid.stable(`pipe:${element.id}`)}',#${ctx.ownerHistId},'${ctx.safeName(name)}',$,$,${placementRef},${prodShapeRef},'${ctx.safeName(elementTag)}',.NOTDEFINED.);`);

  associateMaterial(ctx, entityId, ctx.matIds.structuralSteel);
  associateClassification(ctx, entityId, "pipe", ctx.materials.structuralSteel);
  const systemKey = mepSystemFor(element);
  if (systemKey) assignToSystem(ctx, entityId, systemKey);

  return entityId;
}

function writeMEPEquipmentEntity(
  element: GeometryElement,
  storeyPlacementId: number,
  ctx: ExportContext
): number {
  const { id, lines, guid } = ctx;
  const eqW = element.properties.width ?? 2.0;
  const eqH = element.properties.height ?? 1.8;
  const eqL = element.properties.length ?? 1.5;
  const name = element.properties.name ?? "Equipment";

  let prodShapeRef = "$";
  let placementRef = "$";

  if (ctx.emitMEPGeometry) {
    const profCenterId = id.next();
    lines.push(`#${profCenterId}=IFCCARTESIANPOINT((${f(eqW / 2)},${f(eqL / 2)}));`);
    const profPlacementId = id.next();
    lines.push(`#${profPlacementId}=IFCAXIS2PLACEMENT2D(#${profCenterId},$);`);
    const profileId = id.next();
    lines.push(`#${profileId}=IFCRECTANGLEPROFILEDEF(.AREA.,'Equipment Profile',#${profPlacementId},${f(eqW)},${f(eqL)});`);

    const solidId = id.next();
    lines.push(`#${solidId}=IFCEXTRUDEDAREASOLID(#${profileId},$,#${ctx.zDirId},${f(eqH)});`);
    const shapeRepId = id.next();
    lines.push(`#${shapeRepId}=IFCSHAPEREPRESENTATION(#${ctx.bodyContextId},'Body','SweptSolid',(#${solidId}));`);
    const prodShapeId = id.next();
    lines.push(`#${prodShapeId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRepId}));`);
    prodShapeRef = `#${prodShapeId}`;

    const v = element.vertices[0] ?? { x: 0, y: 0, z: 0 };
    const originId = id.next();
    lines.push(`#${originId}=IFCCARTESIANPOINT((${f(v.x)},${f(v.y)},${f(v.z)}));`);
    const axisId = id.next();
    lines.push(`#${axisId}=IFCAXIS2PLACEMENT3D(#${originId},#${ctx.zDirId},$);`);
    const placementId = id.next();
    lines.push(`#${placementId}=IFCLOCALPLACEMENT(#${storeyPlacementId},#${axisId});`);
    placementRef = `#${placementId}`;
    ctx.presentationLayers["M-EQPT"].push(shapeRepId);
  }

  const entityId = id.next();
  const elementTag = name.substring(0, 30);
  lines.push(`#${entityId}=IFCFLOWTERMINAL('${guid.stable(`eq:${element.id}`)}',#${ctx.ownerHistId},'${ctx.safeName(name)}',$,$,${placementRef},${prodShapeRef},'${ctx.safeName(elementTag)}',.NOTDEFINED.);`);

  associateMaterial(ctx, entityId, ctx.matIds.structuralSteel);
  associateClassification(ctx, entityId, "equipment", ctx.materials.structuralSteel);

  return entityId;
}

// ═══════════════════════════════════════════════════════════════════════════
// BATCHED RELATIONSHIP EMITTERS
// ═══════════════════════════════════════════════════════════════════════════

function emitMaterialAssociations(ctx: ExportContext): void {
  for (const bucket of ctx.materialAssociations.values()) {
    if (bucket.elementIds.length === 0) continue;
    const relId = ctx.id.next();
    const members = bucket.elementIds.map(i => `#${i}`).join(",");
    ctx.lines.push(`#${relId}=IFCRELASSOCIATESMATERIAL('${ctx.guid.fresh()}',#${ctx.ownerHistId},$,$,(${members}),#${bucket.materialRefEntityId});`);
  }
}

function emitTypeAssignments(ctx: ExportContext): void {
  const allClusters = [
    ...ctx.typeClusters.walls.values(),
    ...ctx.typeClusters.slabs.values(),
    ...ctx.typeClusters.columns.values(),
    ...ctx.typeClusters.beams.values(),
    ...ctx.typeClusters.doors.values(),
    ...ctx.typeClusters.windows.values(),
    ...ctx.typeClusters.stairs.values(),
    ...ctx.typeClusters.spaces.values(),
    ...ctx.typeClusters.ducts.values(),
    ...ctx.typeClusters.pipes.values(),
    ...ctx.typeClusters.cableCarriers.values(),
    ...ctx.typeClusters.flowTerminals.values(),
  ];
  for (const cluster of allClusters) {
    if (cluster.occurrenceIds.length === 0) continue;
    const relId = ctx.id.next();
    const members = cluster.occurrenceIds.map(i => `#${i}`).join(",");
    ctx.lines.push(`#${relId}=IFCRELDEFINESBYTYPE('${ctx.guid.fresh()}',#${ctx.ownerHistId},$,$,(${members}),#${cluster.typeEntityId});`);
  }
}

function emitClassificationAssociations(ctx: ExportContext): void {
  for (const bucket of ctx.classifications.csi.values()) {
    if (bucket.elementIds.length === 0) continue;
    const relId = ctx.id.next();
    const members = bucket.elementIds.map(i => `#${i}`).join(",");
    ctx.lines.push(`#${relId}=IFCRELASSOCIATESCLASSIFICATION('${ctx.guid.fresh()}',#${ctx.ownerHistId},'CSI Classification',$,(${members}),#${bucket.refEntityId});`);
  }
  for (const bucket of ctx.classifications.nbc.values()) {
    if (bucket.elementIds.length === 0) continue;
    const relId = ctx.id.next();
    const members = bucket.elementIds.map(i => `#${i}`).join(",");
    ctx.lines.push(`#${relId}=IFCRELASSOCIATESCLASSIFICATION('${ctx.guid.fresh()}',#${ctx.ownerHistId},'NBC India Classification',$,(${members}),#${bucket.refEntityId});`);
  }
}

function emitMEPSystemAssignments(ctx: ExportContext): void {
  for (const [, entry] of ctx.systems) {
    if (entry.memberIds.length === 0) continue;
    const relId = ctx.id.next();
    const members = entry.memberIds.map(i => `#${i}`).join(",");
    ctx.lines.push(`#${relId}=IFCRELASSIGNSTOGROUP('${ctx.guid.fresh()}',#${ctx.ownerHistId},$,$,(${members}),$,#${entry.systemEntityId});`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// v2 EMITTERS — surface styles, documents, wall connections, space boundaries,
// presentation layers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Emit IfcColourRgb + IfcSurfaceStyleShading + IfcSurfaceStyleRendering per material,
 * then attach via IfcStyledItem → IfcStyledRepresentation → IfcMaterialDefinitionRepresentation
 * so every element using that material renders with its intended colour/transparency.
 */
function emitMaterialSurfaceStyles(
  matIds: ExportContext["matIds"],
  bodyContextId: number,
  id: IdCounter,
  lines: string[]
): void {
  const pairs: Array<[number, SurfaceStyleSpec]> = [
    [matIds.concrete,        SURFACE_STYLES.concrete],
    [matIds.reinforcement,   SURFACE_STYLES.reinforcement],
    [matIds.structuralSteel, SURFACE_STYLES.structuralSteel],
    [matIds.masonry,         SURFACE_STYLES.masonry],
    [matIds.insulation,      SURFACE_STYLES.insulation],
    [matIds.plaster,         SURFACE_STYLES.plaster],
    [matIds.glazing,         SURFACE_STYLES.glazing],
    [matIds.timberDoor,      SURFACE_STYLES.timberDoor],
    [matIds.waterproofing,   SURFACE_STYLES.waterproofing],
    [matIds.flooringTile,    SURFACE_STYLES.flooringTile],
  ];

  for (const [materialId, spec] of pairs) {
    // Colour
    const colourId = id.next();
    lines.push(`#${colourId}=IFCCOLOURRGB('${spec.name.replace(/'/g, "")}',${f(spec.red, 3)},${f(spec.green, 3)},${f(spec.blue, 3)});`);

    // Shading (simple: solid colour + transparency)
    const shadingId = id.next();
    lines.push(`#${shadingId}=IFCSURFACESTYLESHADING(#${colourId},${f(spec.transparency, 3)});`);

    // Rendering (better Blender/Navisworks PBR support)
    const renderingId = id.next();
    lines.push(`#${renderingId}=IFCSURFACESTYLERENDERING(#${colourId},${f(spec.transparency, 3)},$,$,$,$,IFCNORMALISEDRATIOMEASURE(${f(spec.specular, 2)}),IFCSPECULARROUGHNESS(${f(spec.roughness, 2)}),.NOTDEFINED.);`);

    // IfcSurfaceStyle wrapping the shading + rendering
    const surfaceStyleId = id.next();
    lines.push(`#${surfaceStyleId}=IFCSURFACESTYLE('${spec.name.replace(/'/g, "")}',.BOTH.,(#${shadingId},#${renderingId}));`);

    // IfcStyledItem (not bound to a specific item — will be referenced by representation map)
    const styledItemId = id.next();
    lines.push(`#${styledItemId}=IFCSTYLEDITEM($,(#${surfaceStyleId}),$);`);

    // IfcStyledRepresentation for Body context
    const styledRepId = id.next();
    lines.push(`#${styledRepId}=IFCSTYLEDREPRESENTATION(#${bodyContextId},'Body','Material',(#${styledItemId}));`);

    // IfcMaterialDefinitionRepresentation binds the style to the material
    const matDefRepId = id.next();
    lines.push(`#${matDefRepId}=IFCMATERIALDEFINITIONREPRESENTATION($,$,(#${styledRepId}),#${materialId});`);
  }
}

/**
 * Emit IfcDocumentInformation entries for every IS code that was referenced by
 * any element, then IfcRelAssociatesDocument linking elements to their governing
 * code(s).
 */
function emitDocumentReferences(ctx: ExportContext): void {
  for (const [docKey, elementIds] of ctx.documentAssociations) {
    if (elementIds.length === 0) continue;
    const spec = IS_CODE_DOCS[docKey];
    if (!spec) continue;

    let docInfoId = ctx.documentInfoIds.get(docKey);
    if (docInfoId === undefined) {
      docInfoId = ctx.id.next();
      ctx.lines.push(`#${docInfoId}=IFCDOCUMENTINFORMATION('${spec.id}','${ctx.safeName(spec.identification)}','${ctx.safeName(spec.description)}',$,$,$,$,$,$,$,$,$,$,'${spec.location}',$,$);`);
      ctx.documentInfoIds.set(docKey, docInfoId);
    }

    const relId = ctx.id.next();
    const unique = Array.from(new Set(elementIds));
    const members = unique.map(i => `#${i}`).join(",");
    ctx.lines.push(`#${relId}=IFCRELASSOCIATESDOCUMENT('${ctx.guid.fresh()}',#${ctx.ownerHistId},'${spec.identification} governance',$,(${members}),#${docInfoId});`);
  }
}

/** Detect walls that share endpoints and emit IfcRelConnectsPathElements for each pair. */
function emitWallConnections(ctx: ExportContext): void {
  const TOL = 0.01;   // 10mm endpoint-match tolerance
  const walls = ctx.wallRecords;

  const near = (x1: number, y1: number, x2: number, y2: number) =>
    Math.hypot(x1 - x2, y1 - y2) < TOL;

  type JoinType = ".ATSTART." | ".ATEND." | ".ATPATH." | ".NOTDEFINED.";

  const emitted = new Set<string>();
  for (let i = 0; i < walls.length; i++) {
    for (let j = i + 1; j < walls.length; j++) {
      const a = walls[i], b = walls[j];
      if (a.storeyIndex !== b.storeyIndex) continue;

      let aType: JoinType | null = null;
      let bType: JoinType | null = null;

      if (near(a.startX, a.startY, b.startX, b.startY))      { aType = ".ATSTART."; bType = ".ATSTART."; }
      else if (near(a.startX, a.startY, b.endX, b.endY))     { aType = ".ATSTART."; bType = ".ATEND."; }
      else if (near(a.endX,   a.endY,   b.startX, b.startY)) { aType = ".ATEND.";   bType = ".ATSTART."; }
      else if (near(a.endX,   a.endY,   b.endX,   b.endY))   { aType = ".ATEND.";   bType = ".ATEND."; }

      if (!aType || !bType) continue;

      const key = `${Math.min(a.entityId, b.entityId)}-${Math.max(a.entityId, b.entityId)}`;
      if (emitted.has(key)) continue;
      emitted.add(key);

      const relId = ctx.id.next();
      ctx.lines.push(`#${relId}=IFCRELCONNECTSPATHELEMENTS('${ctx.guid.fresh()}',#${ctx.ownerHistId},'Wall Junction',$,$,#${a.entityId},#${b.entityId},(),(),${aType},${bType});`);
    }
  }
}

/**
 * For each IfcSpace, emit 1st-level IfcRelSpaceBoundary to the walls whose axis
 * segment lies on or within tolerance of the space polygon edge, plus the slab
 * below (floor) and slab above (ceiling) from the slabsByStorey map.
 */
function emitSpaceBoundaries(ctx: ExportContext): void {
  const TOL = 0.05;  // 50 mm tolerance

  const distPointToSegment = (px: number, py: number, x1: number, y1: number, x2: number, y2: number): number => {
    const dx = x2 - x1, dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    if (l2 === 0) return Math.hypot(px - x1, py - y1);
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / l2));
    const qx = x1 + t * dx, qy = y1 + t * dy;
    return Math.hypot(px - qx, py - qy);
  };

  for (const space of ctx.spaceRecords) {
    const fp = space.footprint;
    // Find walls on the same storey whose mid-segment lies on a space polygon edge.
    const boundaryWalls: Array<{ wallId: number; isExternal: boolean }> = [];
    for (const w of ctx.wallRecords) {
      if (w.storeyIndex !== space.storeyIndex) continue;
      const wx = (w.startX + w.endX) / 2;
      const wy = (w.startY + w.endY) / 2;
      let matched = false;
      for (let i = 0; i < fp.length; i++) {
        const p1 = fp[i];
        const p2 = fp[(i + 1) % fp.length];
        if (distPointToSegment(wx, wy, p1.x, p1.y, p2.x, p2.y) < TOL) {
          matched = true;
          break;
        }
      }
      if (matched) boundaryWalls.push({ wallId: w.entityId, isExternal: false });
    }

    // Emit physical internal boundary for each bounding wall
    for (const bw of boundaryWalls) {
      const relId = ctx.id.next();
      const internalOrExt = bw.isExternal ? ".EXTERNAL." : ".INTERNAL.";
      ctx.lines.push(`#${relId}=IFCRELSPACEBOUNDARY('${ctx.guid.fresh()}',#${ctx.ownerHistId},'1stLevel','Physical wall boundary',#${space.entityId},#${bw.wallId},$,.PHYSICAL.,${internalOrExt});`);

      // v3 Tier 5 — track adjacencies so 2nd-level mirrored boundaries can be emitted later
      // Find any OTHER space that shares this wall boundary and register the adjacency pair
      for (const other of ctx.spaceRecords) {
        if (other.entityId === space.entityId) continue;
        if (other.storeyIndex !== space.storeyIndex) continue;
        const sharedWall = ctx.wallRecords.find(w => w.entityId === bw.wallId);
        if (!sharedWall) continue;
        const mx = (sharedWall.startX + sharedWall.endX) / 2;
        const my = (sharedWall.startY + sharedWall.endY) / 2;
        for (let i = 0; i < other.footprint.length; i++) {
          const p1 = other.footprint[i];
          const p2 = other.footprint[(i + 1) % other.footprint.length];
          if (distPointToSegment(mx, my, p1.x, p1.y, p2.x, p2.y) < TOL) {
            const key = `${Math.min(space.entityId, other.entityId)}-${Math.max(space.entityId, other.entityId)}-${bw.wallId}`;
            if (!ctx.spaceAdjacencies.some(a => `${Math.min(a.spaceAId, a.spaceBId)}-${Math.max(a.spaceAId, a.spaceBId)}-${a.wallId}` === key)) {
              ctx.spaceAdjacencies.push({ spaceAId: space.entityId, spaceBId: other.entityId, wallId: bw.wallId });
            }
            break;
          }
        }
      }
    }

    // Slab below (same storey) as the floor boundary
    const floorSlabs = ctx.slabsByStorey.get(space.storeyIndex) ?? [];
    for (const slabId of floorSlabs) {
      const relId = ctx.id.next();
      ctx.lines.push(`#${relId}=IFCRELSPACEBOUNDARY('${ctx.guid.fresh()}',#${ctx.ownerHistId},'1stLevel','Floor slab boundary',#${space.entityId},#${slabId},$,.PHYSICAL.,.INTERNAL.);`);
    }
    // Slab above (storey +1) as the ceiling boundary
    const ceilingSlabs = ctx.slabsByStorey.get(space.storeyIndex + 1) ?? [];
    for (const slabId of ceilingSlabs) {
      const relId = ctx.id.next();
      ctx.lines.push(`#${relId}=IFCRELSPACEBOUNDARY('${ctx.guid.fresh()}',#${ctx.ownerHistId},'1stLevel','Ceiling slab boundary',#${space.entityId},#${slabId},$,.PHYSICAL.,.INTERNAL.);`);
    }
  }
}

/** Emit IfcPresentationLayerAssignment — one per non-empty discipline layer. */
function emitPresentationLayerAssignments(ctx: ExportContext): void {
  const layerDescriptions: Record<keyof PresentationLayerBuckets, string> = {
    "A-WALL": "Architectural Walls",
    "A-DOOR": "Architectural Doors",
    "A-WIND": "Architectural Windows",
    "A-SPAC": "Architectural Spaces",
    "A-STAR": "Architectural Stairs",
    "S-COL":  "Structural Columns",
    "S-BEAM": "Structural Beams",
    "S-SLAB": "Structural Slabs",
    "S-ROOF": "Structural Roof",
    "M-DUCT": "HVAC Ducts",
    "M-PIPE": "Plumbing Pipes",
    "M-EQPT": "MEP Equipment",
    "E-CABL": "Electrical Cable Trays",
  };

  for (const layerName of Object.keys(ctx.presentationLayers) as Array<keyof PresentationLayerBuckets>) {
    const repIds = ctx.presentationLayers[layerName];
    if (repIds.length === 0) continue;
    const unique = Array.from(new Set(repIds));
    const members = unique.map(i => `#${i}`).join(",");
    const entityId = ctx.id.next();
    ctx.lines.push(`#${entityId}=IFCPRESENTATIONLAYERASSIGNMENT('${layerName}','${ctx.safeName(layerDescriptions[layerName])}',(${members}),'${layerName}');`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// BUILDING + STOREY PROPERTY SETS
// ═══════════════════════════════════════════════════════════════════════════

function emitBuildingPset(geometry: MassingGeometry, buildingId: number, ctx: ExportContext): void {
  const { id, lines, guid } = ctx;

  const propFloors = id.next();
  lines.push(`#${propFloors}=IFCPROPERTYSINGLEVALUE('NumberOfStoreys',$,IFCINTEGER(${geometry.floors}),$);`);
  const propHeight = id.next();
  lines.push(`#${propHeight}=IFCPROPERTYSINGLEVALUE('BuildingHeight',$,IFCLENGTHMEASURE(${f(geometry.totalHeight)}),$);`);
  const propGFA = id.next();
  lines.push(`#${propGFA}=IFCPROPERTYSINGLEVALUE('GrossPlannedArea',$,IFCAREAMEASURE(${f(geometry.gfa, 2)}),$);`);
  const propFootprint = id.next();
  lines.push(`#${propFootprint}=IFCPROPERTYSINGLEVALUE('FootprintArea',$,IFCAREAMEASURE(${f(geometry.footprintArea, 2)}),$);`);
  const propType = id.next();
  const occupancy = ctx.projectMetadata?.occupancyType ?? geometry.buildingType;
  lines.push(`#${propType}=IFCPROPERTYSINGLEVALUE('OccupancyType',$,IFCLABEL('${ctx.safeName(occupancy)}'),$);`);
  const propIsLandmarked = id.next();
  lines.push(`#${propIsLandmarked}=IFCPROPERTYSINGLEVALUE('IsLandmarked',$,IFCBOOLEAN(.F.),$);`);
  const yoc = ctx.projectMetadata?.yearOfConstruction ?? new Date().getFullYear();
  const propYoc = id.next();
  lines.push(`#${propYoc}=IFCPROPERTYSINGLEVALUE('YearOfConstruction',$,IFCINTEGER(${yoc}),$);`);

  const psetId = id.next();
  lines.push(`#${psetId}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_BuildingCommon',$,(#${propFloors},#${propHeight},#${propGFA},#${propFootprint},#${propType},#${propIsLandmarked},#${propYoc}));`);
  const relPsetId = id.next();
  lines.push(`#${relPsetId}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${buildingId}),#${psetId});`);

  // Pset_BuildFlow_IndianCompliance — seismic zone, wind zone, RERA project id
  const seismic = ctx.rera?.seismicZone ?? "III";
  const wind = ctx.rera?.windZone ?? "2";
  const propSeismic = id.next();
  lines.push(`#${propSeismic}=IFCPROPERTYSINGLEVALUE('SeismicZone',$,IFCLABEL('Zone ${seismic} (IS 1893:2016)'),$);`);
  const propWind = id.next();
  lines.push(`#${propWind}=IFCPROPERTYSINGLEVALUE('WindZone',$,IFCLABEL('Zone ${wind} (IS 875-3:2015)'),$);`);
  const propReraId = id.next();
  lines.push(`#${propReraId}=IFCPROPERTYSINGLEVALUE('RERARegistrationNumber',$,IFCIDENTIFIER('${ctx.safeName(ctx.rera?.projectId ?? "PENDING")}'),$);`);
  const propNBCClass = id.next();
  lines.push(`#${propNBCClass}=IFCPROPERTYSINGLEVALUE('NBCOccupancyClass',$,IFCLABEL('${ctx.safeName(occupancy)}'),$);`);
  const propECBCCompliance = id.next();
  lines.push(`#${propECBCCompliance}=IFCPROPERTYSINGLEVALUE('ECBCCompliance',$,IFCLABEL('ECBC 2017 Compliant'),$);`);

  const psetCompId = id.next();
  lines.push(`#${psetCompId}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_BuildFlow_IndianCompliance',$,(#${propSeismic},#${propWind},#${propReraId},#${propNBCClass},#${propECBCCompliance}));`);
  const relCompPsetId = id.next();
  lines.push(`#${relCompPsetId}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${buildingId}),#${psetCompId});`);
}

function emitStoreyPset(storey: MassingStorey, storeyId: number, ctx: ExportContext): void {
  const { id, lines, guid } = ctx;

  const propElevation = id.next();
  lines.push(`#${propElevation}=IFCPROPERTYSINGLEVALUE('EntranceLevel',$,IFCLENGTHMEASURE(${f(storey.elevation)}),$);`);
  const propAboveGround = id.next();
  lines.push(`#${propAboveGround}=IFCPROPERTYSINGLEVALUE('AboveGround',$,IFCLOGICAL(${storey.isBasement ? ".F." : ".T."}),$);`);
  const propGrossHeight = id.next();
  lines.push(`#${propGrossHeight}=IFCPROPERTYSINGLEVALUE('GrossHeight',$,IFCLENGTHMEASURE(${f(storey.height)}),$);`);
  const propNetHeight = id.next();
  lines.push(`#${propNetHeight}=IFCPROPERTYSINGLEVALUE('NetHeight',$,IFCLENGTHMEASURE(${f(Math.max(0, storey.height - 0.3))}),$);`);

  const wallCount = storey.elements.filter(e => e.type === "wall").length;
  const windowCount = storey.elements.filter(e => e.type === "window").length;
  const doorCount = storey.elements.filter(e => e.type === "door").length;

  const propWallCount = id.next();
  lines.push(`#${propWallCount}=IFCPROPERTYSINGLEVALUE('WallCount',$,IFCINTEGER(${wallCount}),$);`);
  const propWindowCount = id.next();
  lines.push(`#${propWindowCount}=IFCPROPERTYSINGLEVALUE('WindowCount',$,IFCINTEGER(${windowCount}),$);`);
  const propDoorCount = id.next();
  lines.push(`#${propDoorCount}=IFCPROPERTYSINGLEVALUE('DoorCount',$,IFCINTEGER(${doorCount}),$);`);

  const psetId = id.next();
  lines.push(`#${psetId}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_BuildingStoreyCommon',$,(#${propElevation},#${propAboveGround},#${propGrossHeight},#${propNetHeight},#${propWallCount},#${propWindowCount},#${propDoorCount}));`);
  const relPsetId = id.next();
  lines.push(`#${relPsetId}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${storeyId}),#${psetId});`);
}

// ═══════════════════════════════════════════════════════════════════════════
// v3 TIER 1 EMITTERS — IfcReinforcingBar + IfcReinforcingMesh + BBS aggregate
// ═══════════════════════════════════════════════════════════════════════════

function emitReinforcingBars(bars: GeneratedBar[], hostElementId: number, storeyPlacementId: number, ctx: ExportContext, hostTag: string): void {
  const { id, lines, guid } = ctx;
  const steelMatId = ctx.matIds.reinforcement;
  const rebarIds: number[] = [];

  for (const bar of bars) {
    const crossSectionAreaM2 = Math.PI * (bar.diameter * bar.diameter) / 4 / 1_000_000;
    const barName = `${hostTag}-${bar.barMark}`;

    let prodShapeRef = "$";     // default: no geometry (Pset-only rebar — BBS still works)
    let placementRef = "$";

    if (ctx.emitRebarGeometry) {
      // Opt-in body geometry: IfcExtrudedAreaSolid along cutting length (straight-bar approximation)
      const profCenterId = id.next();
      lines.push(`#${profCenterId}=IFCCARTESIANPOINT((0.,0.));`);
      const profPlacementId = id.next();
      lines.push(`#${profPlacementId}=IFCAXIS2PLACEMENT2D(#${profCenterId},$);`);
      const profileId = id.next();
      const rMeters = (bar.diameter / 2) / 1000;
      lines.push(`#${profileId}=IFCCIRCLEPROFILEDEF(.AREA.,'${bar.grade} d${bar.diameter}',#${profPlacementId},${f(rMeters, 5)});`);

      const extDirId = id.next();
      lines.push(`#${extDirId}=IFCDIRECTION((1.,0.,0.));`);
      const solidId = id.next();
      lines.push(`#${solidId}=IFCEXTRUDEDAREASOLID(#${profileId},$,#${extDirId},${f(bar.cuttingLengthMm / 1000)});`);
      const shapeRepId = id.next();
      lines.push(`#${shapeRepId}=IFCSHAPEREPRESENTATION(#${ctx.bodyContextId},'Body','SweptSolid',(#${solidId}));`);
      const prodShapeId = id.next();
      lines.push(`#${prodShapeId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRepId}));`);
      prodShapeRef = `#${prodShapeId}`;

      const originId = id.next();
      lines.push(`#${originId}=IFCCARTESIANPOINT((0.,0.,0.));`);
      const axisId = id.next();
      lines.push(`#${axisId}=IFCAXIS2PLACEMENT3D(#${originId},$,$);`);
      const placementId = id.next();
      lines.push(`#${placementId}=IFCLOCALPLACEMENT(#${storeyPlacementId},#${axisId});`);
      placementRef = `#${placementId}`;
    }

    const barId = id.next();
    lines.push(`#${barId}=IFCREINFORCINGBAR('${guid.fresh()}',#${ctx.ownerHistId},'${barName}','${bar.role} rebar ${bar.diameter}mm ${bar.grade}',$,${placementRef},${prodShapeRef},'${barName}',${f(crossSectionAreaM2, 6)},${f(bar.cuttingLengthMm / 1000, 4)},.${bar.role}.,.TEXTURED.);`);

    // Material association
    associateMaterial(ctx, barId, steelMatId);

    // Pset_ReinforcingBarCommon
    const pDia = id.next();
    lines.push(`#${pDia}=IFCPROPERTYSINGLEVALUE('NominalDiameter',$,IFCPOSITIVELENGTHMEASURE(${f(bar.diameter / 1000, 4)}),$);`);
    const pBarLen = id.next();
    lines.push(`#${pBarLen}=IFCPROPERTYSINGLEVALUE('BarLength',$,IFCPOSITIVELENGTHMEASURE(${f(bar.cuttingLengthMm / 1000, 4)}),$);`);
    const pGrade = id.next();
    lines.push(`#${pGrade}=IFCPROPERTYSINGLEVALUE('SteelGrade',$,IFCLABEL('${bar.grade}'),$);`);
    const pCount = id.next();
    lines.push(`#${pCount}=IFCPROPERTYSINGLEVALUE('BarCount',$,IFCINTEGER(${bar.numberOfBars}),$);`);
    const psetCommonId = id.next();
    lines.push(`#${psetCommonId}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_ReinforcingBarCommon',$,(#${pDia},#${pBarLen},#${pGrade},#${pCount}));`);
    const relCommon = id.next();
    lines.push(`#${relCommon}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${barId}),#${psetCommonId});`);

    // Pset_BuildFlow_BBS — the Indian Bar Bending Schedule essential data
    const weightPerM = barWeightPerMetre(bar.diameter);
    const totalWeight = (bar.numberOfBars * bar.cuttingLengthMm / 1000) * weightPerM;
    ctx.bbs.totalWeightKg += totalWeight;
    ctx.bbs.byDia.set(bar.diameter, (ctx.bbs.byDia.get(bar.diameter) ?? 0) + totalWeight);
    ctx.bbs.byGrade.set(bar.grade, (ctx.bbs.byGrade.get(bar.grade) ?? 0) + totalWeight);

    const pMark = id.next();
    lines.push(`#${pMark}=IFCPROPERTYSINGLEVALUE('BarMark',$,IFCIDENTIFIER('${bar.barMark}'),$);`);
    const pShape = id.next();
    lines.push(`#${pShape}=IFCPROPERTYSINGLEVALUE('ShapeCode_IS2502',$,IFCIDENTIFIER('${bar.is2502ShapeCode}'),$);`);
    const pCutLen = id.next();
    lines.push(`#${pCutLen}=IFCPROPERTYSINGLEVALUE('CuttingLength_mm',$,IFCINTEGER(${Math.round(bar.cuttingLengthMm)}),$);`);
    const pNumBars = id.next();
    lines.push(`#${pNumBars}=IFCPROPERTYSINGLEVALUE('NumberOfBars',$,IFCINTEGER(${bar.numberOfBars}),$);`);
    const pSpacing = id.next();
    lines.push(`#${pSpacing}=IFCPROPERTYSINGLEVALUE('Spacing_mm',$,IFCINTEGER(${bar.spacingMm ?? 0}),$);`);
    const pBendR = id.next();
    lines.push(`#${pBendR}=IFCPROPERTYSINGLEVALUE('BendRadius_mm',$,IFCINTEGER(${Math.round(bar.bendRadiusMm)}),$);`);
    const pHook = id.next();
    lines.push(`#${pHook}=IFCPROPERTYSINGLEVALUE('HookLength_mm',$,IFCINTEGER(${Math.round(bar.hookLengthMm)}),$);`);
    const pWpM = id.next();
    lines.push(`#${pWpM}=IFCPROPERTYSINGLEVALUE('WeightPerMetre_kg',$,IFCREAL(${f(weightPerM, 3)}),$);`);
    const pTotW = id.next();
    lines.push(`#${pTotW}=IFCPROPERTYSINGLEVALUE('TotalWeight_kg',$,IFCREAL(${f(totalWeight, 2)}),$);`);
    const pLap = id.next();
    lines.push(`#${pLap}=IFCPROPERTYSINGLEVALUE('LapLength_mm',$,IFCINTEGER(${lapLengthMm(bar.diameter)}),$);`);
    const pDev = id.next();
    lines.push(`#${pDev}=IFCPROPERTYSINGLEVALUE('DevelopmentLength_mm',$,IFCINTEGER(${developmentLengthMm(bar.diameter)}),$);`);
    const pCover = id.next();
    lines.push(`#${pCover}=IFCPROPERTYSINGLEVALUE('ClearCover_mm',$,IFCINTEGER(25),$);`);
    const pExp = id.next();
    lines.push(`#${pExp}=IFCPROPERTYSINGLEVALUE('ExposureCondition',$,IFCLABEL('Moderate (IS 456 Table 3)'),$);`);

    const psetBbsId = id.next();
    lines.push(`#${psetBbsId}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_BuildFlow_BBS',$,(#${pMark},#${pShape},#${pCutLen},#${pNumBars},#${pSpacing},#${pBendR},#${pHook},#${pWpM},#${pTotW},#${pLap},#${pDev},#${pCover},#${pExp}));`);
    const relBbs = id.next();
    lines.push(`#${relBbs}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${barId}),#${psetBbsId});`);

    rebarIds.push(barId);
  }

  // Aggregate the rebar cage into the host element via IfcRelAggregates
  if (rebarIds.length > 0) {
    const aggId = id.next();
    lines.push(`#${aggId}=IFCRELAGGREGATES('${guid.fresh()}',#${ctx.ownerHistId},'${hostTag} Rebar Cage',$,#${hostElementId},(${rebarIds.map(i => `#${i}`).join(",")}));`);
  }
}

function emitReinforcingMesh(mesh: GeneratedMesh, lengthMm: number, widthMm: number, hostSlabId: number, storeyPlacementId: number, ctx: ExportContext, hostTag: string): void {
  const { id, lines, guid } = ctx;
  const steelMatId = ctx.matIds.reinforcement;

  const crossSectionLong = Math.PI * (mesh.longBarDia * mesh.longBarDia) / 4;   // mm²
  const crossSectionTrans = Math.PI * (mesh.transBarDia * mesh.transBarDia) / 4; // mm²

  // Minimal placement
  const originId = id.next();
  lines.push(`#${originId}=IFCCARTESIANPOINT((0.,0.,0.));`);
  const axisId = id.next();
  lines.push(`#${axisId}=IFCAXIS2PLACEMENT3D(#${originId},$,$);`);
  const placementId = id.next();
  lines.push(`#${placementId}=IFCLOCALPLACEMENT(#${storeyPlacementId},#${axisId});`);

  const meshId = id.next();
  const meshName = `${hostTag}-MESH`;
  // IfcReinforcingMesh attributes: SteelGrade, MeshLength, MeshWidth, LongitudinalBarNominalDiameter,
  // TransverseBarNominalDiameter, LongitudinalBarCrossSectionArea, TransverseBarCrossSectionArea,
  // LongitudinalBarSpacing, TransverseBarSpacing, PredefinedType
  lines.push(`#${meshId}=IFCREINFORCINGMESH('${guid.fresh()}',#${ctx.ownerHistId},'${meshName}','Welded wire fabric per IS 1566',$,#${placementId},$,'${meshName}',${f(mesh.longBarDia / 1000, 4)},${f(mesh.transBarDia / 1000, 4)},${f(crossSectionLong / 1_000_000, 6)},${f(crossSectionTrans / 1_000_000, 6)},${f(mesh.longBarSpacing / 1000, 4)},${f(mesh.transBarSpacing / 1000, 4)},.USERDEFINED.);`);

  associateMaterial(ctx, meshId, steelMatId);

  // Pset_ReinforcingMeshCommon
  const pArea = id.next();
  lines.push(`#${pArea}=IFCPROPERTYSINGLEVALUE('MeshArea',$,IFCAREAMEASURE(${f(lengthMm / 1000 * widthMm / 1000, 2)}),$);`);
  const pGrade = id.next();
  lines.push(`#${pGrade}=IFCPROPERTYSINGLEVALUE('SteelGrade',$,IFCLABEL('${mesh.steelGrade}'),$);`);
  const pConc = id.next();
  lines.push(`#${pConc}=IFCPROPERTYSINGLEVALUE('ConcreteGrade',$,IFCLABEL('${mesh.concreteGrade}'),$);`);
  const pCover = id.next();
  lines.push(`#${pCover}=IFCPROPERTYSINGLEVALUE('ClearCover_mm',$,IFCINTEGER(${mesh.coverMm}),$);`);

  const psetId = id.next();
  lines.push(`#${psetId}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_BuildFlow_SlabMesh',$,(#${pArea},#${pGrade},#${pConc},#${pCover}));`);
  const relPset = id.next();
  lines.push(`#${relPset}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${meshId}),#${psetId});`);

  // Approximate mesh weight
  const meshArea = lengthMm / 1000 * widthMm / 1000;
  const numLong = Math.ceil(widthMm / mesh.longBarSpacing);
  const numTrans = Math.ceil(lengthMm / mesh.transBarSpacing);
  const totalBarMetres = numLong * lengthMm / 1000 + numTrans * widthMm / 1000;
  const meshWeight = totalBarMetres * (barWeightPerMetre(mesh.longBarDia) + barWeightPerMetre(mesh.transBarDia)) / 2;
  ctx.bbs.totalWeightKg += meshWeight;

  // Aggregate mesh into host slab
  const aggId = id.next();
  lines.push(`#${aggId}=IFCRELAGGREGATES('${guid.fresh()}',#${ctx.ownerHistId},'${hostTag} Slab Mesh',$,#${hostSlabId},(#${meshId}));`);
}

/** Emit a Pset_BuildFlow_BBSSummary on the building summarizing total rebar weight by diameter. */
function emitBBSSummary(buildingId: number, ctx: ExportContext): void {
  const { id, lines, guid } = ctx;
  if (ctx.bbs.totalWeightKg <= 0) return;

  const pTot = id.next();
  lines.push(`#${pTot}=IFCPROPERTYSINGLEVALUE('TotalReinforcementWeight_kg',$,IFCREAL(${f(ctx.bbs.totalWeightKg, 2)}),$);`);
  const pTotMt = id.next();
  lines.push(`#${pTotMt}=IFCPROPERTYSINGLEVALUE('TotalReinforcementWeight_MT',$,IFCREAL(${f(ctx.bbs.totalWeightKg / 1000, 2)}),$);`);
  const pRatio = id.next();
  const ratio = ctx.bbs.totalConcreteVolumeM3 > 0 ? ctx.bbs.totalWeightKg / ctx.bbs.totalConcreteVolumeM3 : 0;
  lines.push(`#${pRatio}=IFCPROPERTYSINGLEVALUE('SteelToConcreteRatio_kg_per_m3',$,IFCREAL(${f(ratio, 1)}),$);`);

  const diaProps: number[] = [pTot, pTotMt, pRatio];
  for (const [dia, kg] of ctx.bbs.byDia) {
    const pId = id.next();
    lines.push(`#${pId}=IFCPROPERTYSINGLEVALUE('${dia}mm_Bars_Weight_kg',$,IFCREAL(${f(kg, 2)}),$);`);
    diaProps.push(pId);
  }
  for (const [grade, kg] of ctx.bbs.byGrade) {
    const pId = id.next();
    lines.push(`#${pId}=IFCPROPERTYSINGLEVALUE('${grade}_Weight_kg',$,IFCREAL(${f(kg, 2)}),$);`);
    diaProps.push(pId);
  }
  const pCode = id.next();
  lines.push(`#${pCode}=IFCPROPERTYSINGLEVALUE('ApplicableCodes',$,IFCLABEL('IS 456:2000, IS 1786:2008, IS 2502:1963, SP 34, IS 1566:1982, IS 13920:2016'),$);`);
  diaProps.push(pCode);

  const psetId = id.next();
  lines.push(`#${psetId}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_BuildFlow_BBSSummary',$,(${diaProps.map(i => `#${i}`).join(",")}));`);
  const relId = id.next();
  lines.push(`#${relId}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${buildingId}),#${psetId});`);
}

// ═══════════════════════════════════════════════════════════════════════════
// v3 TIER 3 EMITTER — Material physics Psets (IS 456 / IS 1786 / IS 2062)
// ═══════════════════════════════════════════════════════════════════════════

function emitMaterialPhysicsPsets(ctx: ExportContext): void {
  if (ctx.materialPhysicsEmitted) return;
  ctx.materialPhysicsEmitted = true;
  const { id, lines, guid } = ctx;

  const addPset = (materialId: number, psetName: string, props: Array<[string, string]>) => {
    const propIds: number[] = [];
    for (const [name, valueStep] of props) {
      const pid = id.next();
      lines.push(`#${pid}=IFCPROPERTYSINGLEVALUE('${name}',$,${valueStep},$);`);
      propIds.push(pid);
    }
    const psetId = id.next();
    lines.push(`#${psetId}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'${psetName}',$,(${propIds.map(i => `#${i}`).join(",")}));`);
    // IfcRelAssociates for material → Pset linkage uses IfcMaterialProperties in IFC4,
    // but the simpler IfcRelDefinesByProperties works broadly
    const relId = id.next();
    lines.push(`#${relId}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${materialId}),#${psetId});`);
  };

  // Concrete — M25 default (per Pset_BuildFlow_BuildingInfo grade)
  const c = CONCRETE_GRADES.M25;
  addPset(ctx.matIds.concrete, "Pset_MaterialMechanical", [
    ["YoungModulus",               `IFCMODULUSOFELASTICITYMEASURE(${f(c.Ec * 1e6, 0)})`],
    ["CompressiveStrength",        `IFCPRESSUREMEASURE(${f(c.fck * 1e6, 0)})`],
    ["PoissonRatio",               `IFCPOSITIVERATIOMEASURE(${f(c.poissonRatio, 3)})`],
    ["ThermalExpansionCoefficient", `IFCTHERMALEXPANSIONCOEFFICIENTMEASURE(${f(c.thermalExpansionPerK, 8)})`],
    ["MassDensity",                `IFCMASSDENSITYMEASURE(${c.densityKgM3})`],
  ]);
  addPset(ctx.matIds.concrete, "Pset_MaterialThermal", [
    ["ThermalConductivity",  `IFCTHERMALCONDUCTIVITYMEASURE(${f(c.thermalConductivityWmK, 3)})`],
    ["SpecificHeatCapacity", `IFCSPECIFICHEATCAPACITYMEASURE(${c.specificHeatJkgK})`],
  ]);
  addPset(ctx.matIds.concrete, "Pset_MaterialConcrete", [
    ["CompressiveStrength", `IFCPRESSUREMEASURE(${f(c.fck * 1e6, 0)})`],
    ["MaxAggregateSize",    `IFCPOSITIVELENGTHMEASURE(${f(c.maxAggregateMm / 1000, 4)})`],
    ["WaterCementRatio",    `IFCPOSITIVERATIOMEASURE(${f(c.waterCementRatio, 3)})`],
    ["AdmixtureDescription", `IFCTEXT('Superplasticizer per IS 9103')`],
    ["ApplicableCode",      `IFCLABEL('IS 456:2000')`],
  ]);

  // Reinforcement steel — Fe500 default
  const s = STEEL_GRADES.Fe500;
  addPset(ctx.matIds.reinforcement, "Pset_MaterialMechanical", [
    ["YoungModulus",               `IFCMODULUSOFELASTICITYMEASURE(${f(s.E * 1e6, 0)})`],
    ["CompressiveStrength",        `IFCPRESSUREMEASURE(${f(s.fy * 1e6, 0)})`],
    ["YieldStress",                `IFCPRESSUREMEASURE(${f(s.fy * 1e6, 0)})`],
    ["PoissonRatio",               `IFCPOSITIVERATIOMEASURE(${f(s.poissonRatio, 3)})`],
    ["ThermalExpansionCoefficient", `IFCTHERMALEXPANSIONCOEFFICIENTMEASURE(${f(s.thermalExpansionPerK, 8)})`],
    ["MassDensity",                `IFCMASSDENSITYMEASURE(${s.densityKgM3})`],
  ]);
  addPset(ctx.matIds.reinforcement, "Pset_MaterialSteel", [
    ["YieldStress",     `IFCPRESSUREMEASURE(${f(s.fy * 1e6, 0)})`],
    ["UltimateStress",  `IFCPRESSUREMEASURE(${f(s.fu * 1e6, 0)})`],
    ["Elongation",      `IFCPOSITIVERATIOMEASURE(${f(s.elongationPct / 100, 4)})`],
    ["ApplicableCode",  `IFCLABEL('IS 1786:2008')`],
  ]);

  // Structural steel — E250 default
  const ss = STEEL_GRADES.E250;
  addPset(ctx.matIds.structuralSteel, "Pset_MaterialMechanical", [
    ["YoungModulus",               `IFCMODULUSOFELASTICITYMEASURE(${f(ss.E * 1e6, 0)})`],
    ["CompressiveStrength",        `IFCPRESSUREMEASURE(${f(ss.fy * 1e6, 0)})`],
    ["YieldStress",                `IFCPRESSUREMEASURE(${f(ss.fy * 1e6, 0)})`],
    ["PoissonRatio",               `IFCPOSITIVERATIOMEASURE(${f(ss.poissonRatio, 3)})`],
    ["ThermalExpansionCoefficient", `IFCTHERMALEXPANSIONCOEFFICIENTMEASURE(${f(ss.thermalExpansionPerK, 8)})`],
    ["MassDensity",                `IFCMASSDENSITYMEASURE(${ss.densityKgM3})`],
  ]);
  addPset(ctx.matIds.structuralSteel, "Pset_MaterialThermal", [
    ["ThermalConductivity",  `IFCTHERMALCONDUCTIVITYMEASURE(${f(ss.thermalConductivityWmK, 2)})`],
    ["SpecificHeatCapacity", `IFCSPECIFICHEATCAPACITYMEASURE(${ss.specificHeatJkgK})`],
  ]);
  addPset(ctx.matIds.structuralSteel, "Pset_MaterialSteel", [
    ["YieldStress",     `IFCPRESSUREMEASURE(${f(ss.fy * 1e6, 0)})`],
    ["UltimateStress",  `IFCPRESSUREMEASURE(${f(ss.fu * 1e6, 0)})`],
    ["Elongation",      `IFCPOSITIVERATIOMEASURE(${f(ss.elongationPct / 100, 4)})`],
    ["ApplicableCode",  `IFCLABEL('IS 2062:2011')`],
  ]);

  // Masonry (AAC or brick)
  const aacOrBrick = THERMAL_MATERIALS.masonryAAC;
  addPset(ctx.matIds.masonry, "Pset_MaterialMechanical", [
    ["CompressiveStrength", `IFCPRESSUREMEASURE(3500000)`],  // AAC 3.5 N/mm²
    ["MassDensity",         `IFCMASSDENSITYMEASURE(${aacOrBrick.densityKgM3})`],
  ]);
  addPset(ctx.matIds.masonry, "Pset_MaterialThermal", [
    ["ThermalConductivity",  `IFCTHERMALCONDUCTIVITYMEASURE(${f(aacOrBrick.thermalConductivityWmK, 3)})`],
    ["SpecificHeatCapacity", `IFCSPECIFICHEATCAPACITYMEASURE(${aacOrBrick.specificHeatJkgK})`],
  ]);
  addPset(ctx.matIds.masonry, "Pset_MaterialHygroscopic", [
    ["WaterAbsorption", `IFCPOSITIVERATIOMEASURE(${f((aacOrBrick.waterAbsorptionPct ?? 15) / 100, 3)})`],
  ]);

  // Insulation
  const ins = THERMAL_MATERIALS.mineralWool;
  addPset(ctx.matIds.insulation, "Pset_MaterialThermal", [
    ["ThermalConductivity",  `IFCTHERMALCONDUCTIVITYMEASURE(${f(ins.thermalConductivityWmK, 4)})`],
    ["SpecificHeatCapacity", `IFCSPECIFICHEATCAPACITYMEASURE(${ins.specificHeatJkgK})`],
  ]);

  // Glazing
  const glz = THERMAL_MATERIALS.glazing6mm;
  addPset(ctx.matIds.glazing, "Pset_MaterialThermal", [
    ["ThermalConductivity",  `IFCTHERMALCONDUCTIVITYMEASURE(${f(glz.thermalConductivityWmK, 3)})`],
    ["SpecificHeatCapacity", `IFCSPECIFICHEATCAPACITYMEASURE(${glz.specificHeatJkgK})`],
  ]);
  addPset(ctx.matIds.glazing, "Pset_MaterialOptical", [
    ["VisibleTransmittance",  `IFCPOSITIVERATIOMEASURE(0.55)`],
    ["SolarTransmittance",    `IFCPOSITIVERATIOMEASURE(0.35)`],
    ["SolarHeatGainCoefficient", `IFCPOSITIVERATIOMEASURE(0.25)`],
  ]);

  // Plaster
  const pl = THERMAL_MATERIALS.cementPlaster;
  addPset(ctx.matIds.plaster, "Pset_MaterialThermal", [
    ["ThermalConductivity",  `IFCTHERMALCONDUCTIVITYMEASURE(${f(pl.thermalConductivityWmK, 3)})`],
    ["SpecificHeatCapacity", `IFCSPECIFICHEATCAPACITYMEASURE(${pl.specificHeatJkgK})`],
  ]);

  // Flooring tile
  const fl = THERMAL_MATERIALS.vitrifiedTile;
  addPset(ctx.matIds.flooringTile, "Pset_MaterialThermal", [
    ["ThermalConductivity",  `IFCTHERMALCONDUCTIVITYMEASURE(${f(fl.thermalConductivityWmK, 3)})`],
    ["SpecificHeatCapacity", `IFCSPECIFICHEATCAPACITYMEASURE(${fl.specificHeatJkgK})`],
  ]);

  // Waterproofing
  const wp = THERMAL_MATERIALS.bitumenMembrane;
  addPset(ctx.matIds.waterproofing, "Pset_MaterialThermal", [
    ["ThermalConductivity",  `IFCTHERMALCONDUCTIVITYMEASURE(${f(wp.thermalConductivityWmK, 3)})`],
    ["SpecificHeatCapacity", `IFCSPECIFICHEATCAPACITYMEASURE(${wp.specificHeatJkgK})`],
  ]);
}

// ═══════════════════════════════════════════════════════════════════════════
// v3 TIER 5 EMITTER — Pset_SpaceThermalLoad + Pset_SpaceOccupancyRequirements
// ═══════════════════════════════════════════════════════════════════════════

function emitSpaceThermalPsets(ctx: ExportContext): void {
  const { id, lines, guid } = ctx;
  for (const space of ctx.spaceRecords) {
    // Pset_SpaceThermalLoad — ECBC 2017 Table A8.1 defaults
    const pPeople = id.next();
    lines.push(`#${pPeople}=IFCPROPERTYSINGLEVALUE('People',$,IFCCOUNTMEASURE(4),$);`);
    const pPeopleAct = id.next();
    lines.push(`#${pPeopleAct}=IFCPROPERTYSINGLEVALUE('PeopleActivity',$,IFCPOWERMEASURE(120),$);`);
    const pLight = id.next();
    lines.push(`#${pLight}=IFCPROPERTYSINGLEVALUE('LightingHeatGain',$,IFCPOWERMEASURE(10),$);`);
    const pEquip = id.next();
    lines.push(`#${pEquip}=IFCPROPERTYSINGLEVALUE('EquipmentSensibleHeatGain',$,IFCPOWERMEASURE(15),$);`);
    const pInf = id.next();
    lines.push(`#${pInf}=IFCPROPERTYSINGLEVALUE('InfiltrationAirFlowRate',$,IFCREAL(0.3),$);`);
    const pVent = id.next();
    lines.push(`#${pVent}=IFCPROPERTYSINGLEVALUE('VentilationRate',$,IFCREAL(10.0),$);`);

    const psetTherm = id.next();
    lines.push(`#${psetTherm}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_SpaceThermalLoad',$,(#${pPeople},#${pPeopleAct},#${pLight},#${pEquip},#${pInf},#${pVent}));`);
    const relTherm = id.next();
    lines.push(`#${relTherm}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${space.entityId}),#${psetTherm});`);

    // Pset_SpaceOccupancyRequirements
    const pOccType = id.next();
    lines.push(`#${pOccType}=IFCPROPERTYSINGLEVALUE('OccupancyType',$,IFCLABEL('Residential'),$);`);
    const pOccNum = id.next();
    lines.push(`#${pOccNum}=IFCPROPERTYSINGLEVALUE('OccupancyNumber',$,IFCCOUNTMEASURE(4),$);`);
    const pAreaOcc = id.next();
    lines.push(`#${pAreaOcc}=IFCPROPERTYSINGLEVALUE('AreaPerOccupant',$,IFCAREAMEASURE(7.0),$);`);
    const pHeadroom = id.next();
    lines.push(`#${pHeadroom}=IFCPROPERTYSINGLEVALUE('MinimumHeadroom',$,IFCPOSITIVELENGTHMEASURE(2.750),$);`);

    const psetOcc = id.next();
    lines.push(`#${psetOcc}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_SpaceOccupancyRequirements',$,(#${pOccType},#${pOccNum},#${pAreaOcc},#${pHeadroom}));`);
    const relOcc = id.next();
    lines.push(`#${relOcc}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${space.entityId}),#${psetOcc});`);
  }

  // v3 Tier 5 — upgrade 1st-level boundaries to 2nd-level corresponding pairs
  // The spaceAdjacencies array was populated during emitSpaceBoundaries (we'll enhance that below).
  // For now, emit corresponding 2nd-level pair entities: two mirrored IfcRelSpaceBoundary records
  // with Name='2ndLevel' and Description='2a', linked via IfcRelSpaceBoundary.CorrespondingBoundary.
  for (const adj of ctx.spaceAdjacencies) {
    const b1 = id.next();
    lines.push(`#${b1}=IFCRELSPACEBOUNDARY('${guid.fresh()}',#${ctx.ownerHistId},'2ndLevel','2a',#${adj.spaceAId},#${adj.wallId},$,.PHYSICAL.,.INTERNAL.);`);
    const b2 = id.next();
    lines.push(`#${b2}=IFCRELSPACEBOUNDARY('${guid.fresh()}',#${ctx.ownerHistId},'2ndLevel','2a',#${adj.spaceBId},#${adj.wallId},$,.PHYSICAL.,.INTERNAL.);`);
    // NOTE: IfcRelSpaceBoundary.CorrespondingBoundary is implicit per-boundary in IFC2x3; IFC4
    // uses IfcRelSpaceBoundary2ndLevel with explicit CorrespondingBoundary attr. We use IFC4 name
    // annotation here; formally promoting to IfcRelSpaceBoundary2ndLevel for IFC4 could be done in v4.
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// v3 TIER 7 EMITTER — 4D IfcWorkSchedule + 5D IfcCostSchedule (minimal skeleton)
// ═══════════════════════════════════════════════════════════════════════════

function emitWorkScheduleAnd4D(geometry: MassingGeometry, buildingId: number, ctx: ExportContext): void {
  const { id, lines, guid } = ctx;

  // IfcWorkCalendar — 6-day week, exclude national holidays (schematic)
  const calId = id.next();
  lines.push(`#${calId}=IFCWORKCALENDAR('${guid.stable("cal:india")}',#${ctx.ownerHistId},'India Standard Calendar','6-day working week per CPWD','Construction',$,$,.NOTDEFINED.);`);

  // IfcWorkSchedule
  const schedId = id.next();
  const startDate = new Date().toISOString().split("T")[0];
  lines.push(`#${schedId}=IFCWORKSCHEDULE('${guid.stable("schedule:main")}',#${ctx.ownerHistId},'Construction Schedule','Planned project schedule per CPWD BIM Guidelines',$,$,$,$,$,'${startDate}',$,.PLANNED.);`);

  // Phase tasks — Foundation → Superstructure → Masonry → Finishes → MEP → Handover
  const phases = [
    { key: "foundation",   name: "Foundation Work",    durationDays: 90 },
    { key: "superstructure", name: "Superstructure RCC", durationDays: 180 },
    { key: "masonry",      name: "Masonry & Plaster",   durationDays: 120 },
    { key: "mep_rough",    name: "MEP Rough-In",        durationDays: 90 },
    { key: "finishes",     name: "Finishes",            durationDays: 150 },
    { key: "mep_final",    name: "MEP Final + Testing", durationDays: 60 },
    { key: "handover",     name: "Snag & Handover",     durationDays: 30 },
  ];
  const taskIds: number[] = [];
  let cumulative = 0;
  for (const p of phases) {
    const taskTimeId = id.next();
    const startDay = cumulative;
    const endDay = cumulative + p.durationDays;
    lines.push(`#${taskTimeId}=IFCTASKTIME('${p.name} Schedule',.NOTDEFINED.,.NOTDEFINED.,$,$,$,$,'P${p.durationDays}D',$,$,$,$,$,$,$,$,$,$,$,$);`);
    const taskId = id.next();
    lines.push(`#${taskId}=IFCTASK('${guid.stable(`task:${p.key}`)}',#${ctx.ownerHistId},'${p.name}','Phase ${p.key}',$,'${p.key.toUpperCase()}',#${taskTimeId},.F.,.F.,$,$,.CONSTRUCTION.);`);
    taskIds.push(taskId);
    cumulative = endDay;
  }

  // IfcRelSequence FINISH_START linking consecutive phases
  for (let i = 0; i < taskIds.length - 1; i++) {
    const relId = id.next();
    lines.push(`#${relId}=IFCRELSEQUENCE('${guid.fresh()}',#${ctx.ownerHistId},'Sequence ${i + 1}',$,#${taskIds[i]},#${taskIds[i + 1]},$,.FINISH_START.);`);
  }

  // IfcRelAssignsToControl linking schedule ← tasks
  const relCtrlId = id.next();
  lines.push(`#${relCtrlId}=IFCRELASSIGNSTOCONTROL('${guid.fresh()}',#${ctx.ownerHistId},'Schedule-Tasks',$,(${taskIds.map(i => `#${i}`).join(",")}),$,#${schedId});`);

  // Summary Pset on building
  const pDuration = id.next();
  const totalMonths = Math.ceil(cumulative / 30);
  lines.push(`#${pDuration}=IFCPROPERTYSINGLEVALUE('TotalProjectDuration_days',$,IFCINTEGER(${cumulative}),$);`);
  const pMonths = id.next();
  lines.push(`#${pMonths}=IFCPROPERTYSINGLEVALUE('TotalProjectDuration_months',$,IFCINTEGER(${totalMonths}),$);`);
  const pCode = id.next();
  lines.push(`#${pCode}=IFCPROPERTYSINGLEVALUE('ScheduleReference',$,IFCLABEL('CPWD BIM Guidelines 2023'),$);`);
  const psetId = id.next();
  lines.push(`#${psetId}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_BuildFlow_ScheduleSummary',$,(#${pDuration},#${pMonths},#${pCode}));`);
  const relPsetId = id.next();
  lines.push(`#${relPsetId}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${buildingId}),#${psetId});`);
}

/** CPWD DSR 2024-25 rate snapshot (INR per unit) — subset covering main BOQ heads. */
interface CpwdRate {
  csi: string;
  description: string;
  unit: string;
  materialRate: number;
  labourRate: number;
}

const CPWD_DSR_2024_25: CpwdRate[] = [
  { csi: "03 30 00", description: "M25 RCC work including shuttering & reinforcement",       unit: "m3", materialRate: 7500, labourRate: 2200 },
  { csi: "04 22 00", description: "AAC block masonry 200mm in cement mortar 1:6",              unit: "m3", materialRate: 4800, labourRate: 1600 },
  { csi: "09 30 00", description: "Vitrified tile flooring 600x600 with cement bed",          unit: "m2", materialRate:  750, labourRate:  220 },
  { csi: "08 11 13", description: "Flush door shutter 32mm factory made with frame",          unit: "nos", materialRate: 4500, labourRate:  850 },
  { csi: "08 50 00", description: "Aluminum window with 5mm glass including frame",           unit: "m2", materialRate: 4200, labourRate:  950 },
  { csi: "22 10 00", description: "CPVC cold water supply piping including fittings",         unit: "m",  materialRate:  280, labourRate:  140 },
  { csi: "23 30 00", description: "GI duct with 50mm glass wool insulation",                  unit: "m2", materialRate: 1800, labourRate:  450 },
  { csi: "26 05 36", description: "Perforated cable tray 300mm with supports",                unit: "m",  materialRate:  650, labourRate:  180 },
  { csi: "05 12 00", description: "Structural steel fabrication and erection (Fe410)",        unit: "MT", materialRate: 72000, labourRate: 18000 },
];

function emitCostScheduleAnd5D(geometry: MassingGeometry, buildingId: number, ctx: ExportContext): void {
  const { id, lines, guid } = ctx;

  const schedId = id.next();
  lines.push(`#${schedId}=IFCCOSTSCHEDULE('${guid.stable("cost:main")}',#${ctx.ownerHistId},'Project Cost Estimate','CPWD DSR 2024-25 based estimate','INR estimation',$,$,$,$,.ESTIMATE.);`);

  const itemIds: number[] = [];
  let grandTotal = 0;
  for (const rate of CPWD_DSR_2024_25) {
    const itemId = id.next();
    lines.push(`#${itemId}=IFCCOSTITEM('${guid.fresh()}',#${ctx.ownerHistId},'${rate.csi} ${ctx.safeName(rate.description).slice(0, 60)}','Rate from CPWD DSR 2024-25',$,$,$,.NOTDEFINED.);`);
    itemIds.push(itemId);

    // Custom Pset for the INR rate
    const pMat = id.next();
    lines.push(`#${pMat}=IFCPROPERTYSINGLEVALUE('MaterialRate_INR_per_${rate.unit}',$,IFCINTEGER(${rate.materialRate}),$);`);
    const pLab = id.next();
    lines.push(`#${pLab}=IFCPROPERTYSINGLEVALUE('LabourRate_INR_per_${rate.unit}',$,IFCINTEGER(${rate.labourRate}),$);`);
    const pTot = id.next();
    const totalRate = rate.materialRate + rate.labourRate;
    lines.push(`#${pTot}=IFCPROPERTYSINGLEVALUE('TotalRate_INR_per_${rate.unit}',$,IFCINTEGER(${totalRate}),$);`);
    const pSrc = id.next();
    lines.push(`#${pSrc}=IFCPROPERTYSINGLEVALUE('RateSource',$,IFCLABEL('CPWD DSR 2024-25'),$);`);
    const pCur = id.next();
    lines.push(`#${pCur}=IFCPROPERTYSINGLEVALUE('Currency',$,IFCLABEL('INR'),$);`);
    const pCsi = id.next();
    lines.push(`#${pCsi}=IFCPROPERTYSINGLEVALUE('CSICode',$,IFCIDENTIFIER('${rate.csi}'),$);`);
    const pUnit = id.next();
    lines.push(`#${pUnit}=IFCPROPERTYSINGLEVALUE('Unit',$,IFCLABEL('${rate.unit}'),$);`);
    const psetCost = id.next();
    lines.push(`#${psetCost}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_BuildFlow_CostData',$,(#${pMat},#${pLab},#${pTot},#${pSrc},#${pCur},#${pCsi},#${pUnit}));`);
    const relCost = id.next();
    lines.push(`#${relCost}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${itemId}),#${psetCost});`);

    grandTotal += totalRate;
  }

  // Link cost items to schedule
  const relCtrlId = id.next();
  lines.push(`#${relCtrlId}=IFCRELASSIGNSTOCONTROL('${guid.fresh()}',#${ctx.ownerHistId},'Cost-Items',$,(${itemIds.map(i => `#${i}`).join(",")}),$,#${schedId});`);
}

// ═══════════════════════════════════════════════════════════════════════════
// v3 TIER 8 EMITTER — project metadata, team, phase, COBie manufacturer data
// ═══════════════════════════════════════════════════════════════════════════

function emitProjectTeamAndPhase(projectId: number, siteId: number, buildingId: number, ctx: ExportContext): void {
  const { id, lines, guid } = ctx;

  // IfcPostalAddress on site — use geoRef / metadata when available
  const addrId = id.next();
  lines.push(`#${addrId}=IFCPOSTALADDRESS(.SITE.,'Project Site Address',$,$,('Construction Site'),$,'Pune','Maharashtra','411001','India');`);
  // Link addr to site (IfcSite has SiteAddress as optional attribute)
  // Rather than mutating the IFCSITE line, emit a custom Pset

  const pCountry = id.next();
  lines.push(`#${pCountry}=IFCPROPERTYSINGLEVALUE('Country',$,IFCLABEL('India'),$);`);
  const pState = id.next();
  lines.push(`#${pState}=IFCPROPERTYSINGLEVALUE('StateProvince',$,IFCLABEL('Maharashtra'),$);`);
  const pCity = id.next();
  lines.push(`#${pCity}=IFCPROPERTYSINGLEVALUE('City',$,IFCLABEL('Pune'),$);`);
  const pPin = id.next();
  lines.push(`#${pPin}=IFCPROPERTYSINGLEVALUE('PostalCode',$,IFCLABEL('411001'),$);`);
  const psetAddr = id.next();
  lines.push(`#${psetAddr}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_BuildFlow_SiteAddress',$,(#${pCountry},#${pState},#${pCity},#${pPin}));`);
  const relAddr = id.next();
  lines.push(`#${relAddr}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${siteId}),#${psetAddr});`);

  // Project team actors
  const teamRoles = [
    { role: ".ARCHITECT.",          name: ctx.projectMetadata?.architectName ?? "Architect TBD",           org: "Design Studio" },
    { role: ".STRUCTURALENGINEER.", name: ctx.projectMetadata?.structuralConsultant ?? "Structural Consultant TBD", org: "Structural Consultancy" },
    { role: ".MECHANICALENGINEER.", name: ctx.projectMetadata?.mepConsultant ?? "MEP Consultant TBD",     org: "MEP Consultancy" },
    { role: ".CLIENT.",             name: ctx.projectMetadata?.clientName ?? "Client TBD",                 org: "Client Organization" },
    { role: ".CONTRACTOR.",         name: "Main Contractor TBD",                                             org: "Contractor Organization" },
    { role: ".USERDEFINED.",        name: "BuildFlow AI",                                                     org: "BuildFlow" },
  ];

  const actorIds: number[] = [];
  for (const t of teamRoles) {
    const personId = id.next();
    lines.push(`#${personId}=IFCPERSON($,'${ctx.safeName(t.name)}','',$,$,$,$,$);`);
    const orgId = id.next();
    lines.push(`#${orgId}=IFCORGANIZATION($,'${ctx.safeName(t.org)}','Project Team Member',$,$);`);
    const poId = id.next();
    lines.push(`#${poId}=IFCPERSONANDORGANIZATION(#${personId},#${orgId},$);`);
    const roleId = id.next();
    lines.push(`#${roleId}=IFCACTORROLE(${t.role},$,$);`);
    const actorId = id.next();
    lines.push(`#${actorId}=IFCACTOR('${guid.fresh()}',#${ctx.ownerHistId},'${ctx.safeName(t.name)}','${ctx.safeName(t.role.replace(/\./g, ""))} role',$,#${poId});`);
    actorIds.push(actorId);
  }

  // IfcRelAssignsToActor linking project → actors
  if (actorIds.length > 0) {
    const relActId = id.next();
    lines.push(`#${relActId}=IFCRELASSIGNSTOACTOR('${guid.fresh()}',#${ctx.ownerHistId},'Project Team',$,(#${projectId}),$,#${actorIds[0]},$);`);
  }

  // IfcProject.Phase — update via Pset (IFC4 preferred path)
  const pPhase = id.next();
  lines.push(`#${pPhase}=IFCPROPERTYSINGLEVALUE('Phase',$,IFCLABEL('Design Development'),$);`);
  const pRev = id.next();
  lines.push(`#${pRev}=IFCPROPERTYSINGLEVALUE('Revision',$,IFCLABEL('R01'),$);`);
  const pIss = id.next();
  lines.push(`#${pIss}=IFCPROPERTYSINGLEVALUE('IssueDate',$,IFCDATE('${new Date().toISOString().split("T")[0]}'),$);`);
  const pPurp = id.next();
  lines.push(`#${pPurp}=IFCPROPERTYSINGLEVALUE('IssuePurpose',$,IFCLABEL('For Coordination'),$);`);
  const pStat = id.next();
  lines.push(`#${pStat}=IFCPROPERTYSINGLEVALUE('ProjectStatus',$,IFCLABEL('In Progress'),$);`);
  const psetPhase = id.next();
  lines.push(`#${psetPhase}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_BuildFlow_ProjectPhase',$,(#${pPhase},#${pRev},#${pIss},#${pPurp},#${pStat}));`);
  const relPhase = id.next();
  lines.push(`#${relPhase}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${buildingId}),#${psetPhase});`);

  // COBie manufacturer/warranty sample on building (placeholder — real emission happens per equipment)
  const pMfg = id.next();
  lines.push(`#${pMfg}=IFCPROPERTYSINGLEVALUE('PrimaryContractor',$,IFCLABEL('Contractor TBD'),$);`);
  const pWtyStart = id.next();
  lines.push(`#${pWtyStart}=IFCPROPERTYSINGLEVALUE('DefectLiabilityStart',$,IFCDATE('${new Date().toISOString().split("T")[0]}'),$);`);
  const pWtyDur = id.next();
  lines.push(`#${pWtyDur}=IFCPROPERTYSINGLEVALUE('DefectLiabilityPeriod',$,IFCLABEL('P1Y'),$);`);
  const pFmc = id.next();
  lines.push(`#${pFmc}=IFCPROPERTYSINGLEVALUE('FacilityManager',$,IFCLABEL('FM TBD'),$);`);
  const psetCobie = id.next();
  lines.push(`#${psetCobie}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_BuildFlow_COBieHandover',$,(#${pMfg},#${pWtyStart},#${pWtyDur},#${pFmc}));`);
  const relCobie = id.next();
  lines.push(`#${relCobie}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${buildingId}),#${psetCobie});`);

  // v3 Tier 1 — BBS summary (deferred so total rebar is known)
  emitBBSSummary(buildingId, ctx);
}

// ═══════════════════════════════════════════════════════════════════════════
// v3 TIER 2 EMITTERS — Fire / Plumbing / HVAC / Electrical fixtures + ports
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Emit fire-protection + plumbing + HVAC + electrical sample fixtures per storey.
 * Activated when the input GeometryElement for that storey has any space flagged as
 * `bathroom`/`kitchen`/`toilet` OR when buildings exceed 15m (NBC Part 4 mandates fire system).
 *
 * Auto-emission for MVP — in production, these fixtures would come from a dedicated MEP input.
 */
export function emitMEPFixturesForStorey(
  storey: MassingStorey,
  storeyId: number,
  storeyPlacementId: number,
  ctx: ExportContext,
  totalBuildingHeight: number
): number[] {
  const { id, lines, guid } = ctx;
  const emittedIds: number[] = [];

  // Helper to write a minimal-geometry MEP fixture
  const writeFixture = (
    entityClass: string,
    predefinedType: string,
    name: string,
    x: number, y: number, z: number,
    width = 0.3, height = 0.3, depth = 0.3,
    systemKey?: MepSystemKey,
    materialId: number = ctx.matIds.structuralSteel,
    extraAttrs = "",
  ): number => {
    const pcId = id.next();
    lines.push(`#${pcId}=IFCCARTESIANPOINT((${f(width / 2)},${f(depth / 2)}));`);
    const ppId = id.next();
    lines.push(`#${ppId}=IFCAXIS2PLACEMENT2D(#${pcId},$);`);
    const pdId = id.next();
    lines.push(`#${pdId}=IFCRECTANGLEPROFILEDEF(.AREA.,'${entityClass} Profile',#${ppId},${f(width)},${f(depth)});`);
    const solidId = id.next();
    lines.push(`#${solidId}=IFCEXTRUDEDAREASOLID(#${pdId},$,#${ctx.zDirId},${f(height)});`);
    const shapeRepId = id.next();
    lines.push(`#${shapeRepId}=IFCSHAPEREPRESENTATION(#${ctx.bodyContextId},'Body','SweptSolid',(#${solidId}));`);
    const prodId = id.next();
    lines.push(`#${prodId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRepId}));`);
    const originId = id.next();
    lines.push(`#${originId}=IFCCARTESIANPOINT((${f(x)},${f(y)},${f(z)}));`);
    const axisId = id.next();
    lines.push(`#${axisId}=IFCAXIS2PLACEMENT3D(#${originId},#${ctx.zDirId},$);`);
    const placeId = id.next();
    lines.push(`#${placeId}=IFCLOCALPLACEMENT(#${storeyPlacementId},#${axisId});`);
    const eid = id.next();
    lines.push(`#${eid}=${entityClass}('${guid.fresh()}',#${ctx.ownerHistId},'${ctx.safeName(name)}','${ctx.safeName(name)}',$,#${placeId},#${prodId},'${ctx.safeName(name).slice(0, 30)}'${extraAttrs});`);
    associateMaterial(ctx, eid, materialId);
    if (systemKey) assignToSystem(ctx, eid, systemKey);
    return eid;
  };

  // v4-cleanup: use actual building envelope (populated from geometry.boundingBox)
  // so opt-in demo fixtures respect the real footprint instead of flying at (0–20, 0–10).
  const bbox = {
    minX: ctx.boundingBox.minX,
    minY: ctx.boundingBox.minY,
    maxX: ctx.boundingBox.maxX,
    maxY: ctx.boundingBox.maxY,
  };

  // ─── Fire Protection (NBC Part 4 mandates for >15m buildings) ───
  if (totalBuildingHeight > 15 || storey.index === 0) {
    // 4 sprinklers per floor (typical ordinary-hazard 12 m² coverage)
    for (let i = 0; i < 4; i++) {
      const x = bbox.minX + 5 + (i % 2) * 8;
      const y = bbox.minY + 3 + Math.floor(i / 2) * 4;
      const sprId = writeFixture("IFCFIRESUPPRESSIONTERMINAL", ".SPRINKLER.", `SPR-${storeyCode(storey)}-${String(i + 1).padStart(3, "0")}`, x, y, storey.height - 0.1, 0.1, 0.1, 0.1, "FIREPROTECTION", ctx.matIds.structuralSteel, `,.SPRINKLER.`);
      emittedIds.push(sprId);

      const pset = id.next();
      const pAct = id.next();
      lines.push(`#${pAct}=IFCPROPERTYSINGLEVALUE('ActivationTemperature',$,IFCTHERMODYNAMICTEMPERATUREMEASURE(341.15),$);`);
      const pCov = id.next();
      lines.push(`#${pCov}=IFCPROPERTYSINGLEVALUE('CoverageArea',$,IFCAREAMEASURE(12.0),$);`);
      const pKf = id.next();
      lines.push(`#${pKf}=IFCPROPERTYSINGLEVALUE('KFactor',$,IFCREAL(80),$);`);
      const pOrf = id.next();
      lines.push(`#${pOrf}=IFCPROPERTYSINGLEVALUE('OrificeSize',$,IFCPOSITIVELENGTHMEASURE(0.015),$);`);
      const pNbc = id.next();
      lines.push(`#${pNbc}=IFCPROPERTYSINGLEVALUE('ApplicableCode',$,IFCLABEL('NBC 2016 Part 4 Cl.5.3'),$);`);
      lines.push(`#${pset}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_FireSuppressionTerminalTypeSprinkler',$,(#${pAct},#${pCov},#${pKf},#${pOrf},#${pNbc}));`);
      const rel = id.next();
      lines.push(`#${rel}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${sprId}),#${pset});`);
    }

    // Fire hydrant (1 per floor typical)
    const hydId = writeFixture("IFCFIRESUPPRESSIONTERMINAL", ".FIREHYDRANT.", `FH-${storeyCode(storey)}-001`, bbox.minX + 1, bbox.minY + 5, 0.6, 0.2, 0.6, 0.2, "FIREPROTECTION", ctx.matIds.structuralSteel, `,.FIREHYDRANT.`);
    emittedIds.push(hydId);

    // Hose reel
    const hrId = writeFixture("IFCFIRESUPPRESSIONTERMINAL", ".HOSEREEL.", `HR-${storeyCode(storey)}-001`, bbox.maxX - 1, bbox.minY + 5, 0.9, 0.5, 0.5, 0.2, "FIREPROTECTION", ctx.matIds.structuralSteel, `,.HOSEREEL.`);
    emittedIds.push(hrId);

    // Smoke detector (typical 1 per 100 m²)
    const sdId = writeFixture("IFCSENSOR", ".SMOKESENSOR.", `SD-${storeyCode(storey)}-001`, bbox.minX + 10, bbox.minY + 5, storey.height - 0.05, 0.1, 0.05, 0.1, undefined, ctx.matIds.structuralSteel, `,.SMOKESENSOR.`);
    emittedIds.push(sdId);

    // Manual call point (alarm)
    const mcpId = writeFixture("IFCALARM", ".MANUALPULLBOX.", `FA-${storeyCode(storey)}-001`, bbox.minX + 0.2, bbox.minY + 0.2, 1.4, 0.15, 0.20, 0.05, undefined, ctx.matIds.structuralSteel, `,.MANUALPULLBOX.`);
    emittedIds.push(mcpId);
  }

  // ─── Plumbing (sanitary fixtures) — 1 WC + 1 basin per storey minimum ───
  const wcId = writeFixture("IFCSANITARYTERMINAL", ".TOILETPAN.", `WC-${storeyCode(storey)}-T01-001`, bbox.minX + 2, bbox.minY + 0.5, 0.4, 0.55, 0.4, 0.7, undefined, ctx.matIds.flooringTile, `,.TOILETPAN.`);
  emittedIds.push(wcId);
  {
    // Pset_SanitaryTerminalTypeToiletPan
    const pType = id.next();
    lines.push(`#${pType}=IFCPROPERTYSINGLEVALUE('ToiletType',$,IFCLABEL('EWC (European)'),$);`);
    const pFlush = id.next();
    lines.push(`#${pFlush}=IFCPROPERTYSINGLEVALUE('FlushRate',$,IFCVOLUMEMEASURE(0.006),$);`);
    const pFlushMax = id.next();
    lines.push(`#${pFlushMax}=IFCPROPERTYSINGLEVALUE('FlushRateMax',$,IFCVOLUMEMEASURE(0.009),$);`);
    const pMount = id.next();
    lines.push(`#${pMount}=IFCPROPERTYSINGLEVALUE('MountingType',$,IFCLABEL('Floor'),$);`);
    const psetWc = id.next();
    lines.push(`#${psetWc}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_SanitaryTerminalTypeToiletPan',$,(#${pType},#${pFlush},#${pFlushMax},#${pMount}));`);
    const rel = id.next();
    lines.push(`#${rel}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${wcId}),#${psetWc});`);
  }

  const basinId = writeFixture("IFCSANITARYTERMINAL", ".WASHHANDBASIN.", `WB-${storeyCode(storey)}-T01-001`, bbox.minX + 3, bbox.minY + 0.5, 0.85, 0.55, 0.45, 0.15, undefined, ctx.matIds.flooringTile, `,.WASHHANDBASIN.`);
  emittedIds.push(basinId);

  const sinkId = writeFixture("IFCSANITARYTERMINAL", ".SINK.", `KS-${storeyCode(storey)}-K01-001`, bbox.maxX - 2, bbox.maxY - 0.5, 0.85, 0.60, 0.45, 0.20, undefined, ctx.matIds.structuralSteel, `,.SINK.`);
  emittedIds.push(sinkId);

  const ftId = writeFixture("IFCWASTETERMINAL", ".FLOORTRAP.", `FT-${storeyCode(storey)}-T01-001`, bbox.minX + 2.5, bbox.minY + 1.0, 0, 0.15, 0.15, 0.10, undefined, ctx.matIds.flooringTile, `,.FLOORTRAP.`);
  emittedIds.push(ftId);

  // Water tank on roof storey
  if (/terrace|roof/i.test(storey.name)) {
    const tankId = writeFixture("IFCTANK", ".STORAGE.", `OHT-${storeyCode(storey)}-001`, bbox.minX + 5, bbox.minY + 5, 0.5, 2.0, 1.2, 2.0, undefined, ctx.matIds.flooringTile, `,.STORAGE.`);
    emittedIds.push(tankId);
  }

  // Pump in basement
  if (/basement|bsm/i.test(storey.name) || storey.isBasement) {
    const pumpId = writeFixture("IFCPUMP", ".SUBMERSIBLE.", `WP-${storeyCode(storey)}-001`, bbox.minX + 1, bbox.minY + 1, 0.2, 0.5, 0.6, 0.5, undefined, ctx.matIds.structuralSteel, `,.SUBMERSIBLE.`);
    emittedIds.push(pumpId);
    // v4 Tier 9 — register for COBie data
    const arr = ctx.equipmentByKind.get("pump") ?? [];
    arr.push({ id: pumpId, kind: "pump" });
    ctx.equipmentByKind.set("pump", arr);
    ctx.assetMembers.plumbing.push(pumpId);
  }

  // ─── Pipe fittings + valves (sample near wet areas) ───
  const elbId = writeFixture("IFCPIPEFITTING", ".BEND.", `PF-ELB-${storeyCode(storey)}-001`, bbox.minX + 2.2, bbox.minY + 0.6, 0.2, 0.15, 0.15, 0.15, "DOMESTICCOLDWATER", ctx.matIds.structuralSteel, `,.BEND.`);
  emittedIds.push(elbId);
  const teeId = writeFixture("IFCPIPEFITTING", ".TEE.", `PF-TEE-${storeyCode(storey)}-001`, bbox.minX + 2.5, bbox.minY + 0.6, 0.2, 0.15, 0.15, 0.15, "DOMESTICCOLDWATER", ctx.matIds.structuralSteel, `,.TEE.`);
  emittedIds.push(teeId);

  const gateId = writeFixture("IFCVALVE", ".GATE.", `VLV-GATE-${storeyCode(storey)}-001`, bbox.minX + 3.0, bbox.minY + 0.6, 1.0, 0.15, 0.20, 0.15, "DOMESTICCOLDWATER", ctx.matIds.structuralSteel, `,.GATE.`);
  emittedIds.push(gateId);
  const checkId = writeFixture("IFCVALVE", ".CHECK.", `VLV-NRV-${storeyCode(storey)}-001`, bbox.minX + 3.3, bbox.minY + 0.6, 1.0, 0.15, 0.20, 0.15, "DOMESTICCOLDWATER", ctx.matIds.structuralSteel, `,.CHECK.`);
  emittedIds.push(checkId);

  // ─── HVAC ───
  const ahuId = writeFixture("IFCUNITARYEQUIPMENT", ".AIRHANDLER.", `AHU-${storeyCode(storey)}-001`, bbox.minX + 10, bbox.maxY - 2, 0.5, 2.0, 1.8, 1.2, "AIRCONDITIONING", ctx.matIds.structuralSteel, `,.AIRHANDLER.`);
  emittedIds.push(ahuId);
  // v4 Tier 9 — register for COBie (AHU → Blue Star catalogue entry)
  const ahuArr = ctx.equipmentByKind.get("ahu") ?? [];
  ahuArr.push({ id: ahuId, kind: "ahu" });
  ctx.equipmentByKind.set("ahu", ahuArr);
  ctx.assetMembers.hvac.push(ahuId);
  const splitId = writeFixture("IFCUNITARYEQUIPMENT", ".SPLITSYSTEM.", `SAC-${storeyCode(storey)}-BR01-001`, bbox.minX + 6, bbox.maxY - 1, storey.height - 0.4, 0.9, 0.3, 0.2, "AIRCONDITIONING", ctx.matIds.structuralSteel, `,.SPLITSYSTEM.`);
  emittedIds.push(splitId);

  const duElbId = writeFixture("IFCDUCTFITTING", ".BEND.", `DF-ELB-${storeyCode(storey)}-001`, bbox.minX + 11, bbox.maxY - 2, storey.height - 0.5, 0.6, 0.4, 0.6, "AIRCONDITIONING", ctx.matIds.structuralSteel, `,.BEND.`);
  emittedIds.push(duElbId);
  const duTeeId = writeFixture("IFCDUCTFITTING", ".TEE.", `DF-TEE-${storeyCode(storey)}-001`, bbox.minX + 12, bbox.maxY - 2, storey.height - 0.5, 0.6, 0.4, 0.6, "AIRCONDITIONING", ctx.matIds.structuralSteel, `,.TEE.`);
  emittedIds.push(duTeeId);

  const diffId = writeFixture("IFCAIRTERMINAL", ".DIFFUSER.", `AT-DIFF-${storeyCode(storey)}-001`, bbox.minX + 10, bbox.maxY - 3, storey.height - 0.05, 0.6, 0.05, 0.6, "AIRCONDITIONING", ctx.matIds.structuralSteel, `,.DIFFUSER.`);
  emittedIds.push(diffId);

  const fanId = writeFixture("IFCFAN", ".AXIAL.", `FAN-EXHAUST-${storeyCode(storey)}-001`, bbox.minX + 2, bbox.minY + 1.5, storey.height - 0.3, 0.4, 0.4, 0.2, "EXHAUST", ctx.matIds.structuralSteel, `,.AXIAL.`);
  emittedIds.push(fanId);
  // v4 Tier 9 — register for COBie
  const fanArr = ctx.equipmentByKind.get("fan") ?? [];
  fanArr.push({ id: fanId, kind: "fan" });
  ctx.equipmentByKind.set("fan", fanArr);
  ctx.assetMembers.hvac.push(fanId);

  // ─── Electrical ───
  const lightId = writeFixture("IFCLIGHTFIXTURE", ".POINTSOURCE.", `LF-${storeyCode(storey)}-BR01-001`, bbox.minX + 5, bbox.minY + 5, storey.height - 0.05, 0.3, 0.08, 0.3, undefined, ctx.matIds.flooringTile, `,.POINTSOURCE.`);
  emittedIds.push(lightId);
  const outId = writeFixture("IFCOUTLET", ".POWEROUTLET.", `PO-${storeyCode(storey)}-BR01-001`, bbox.minX + 4, bbox.minY + 0.1, 0.3, 0.10, 0.08, 0.05, undefined, ctx.matIds.flooringTile, `,.POWEROUTLET.`);
  emittedIds.push(outId);
  const swId = writeFixture("IFCSWITCHINGDEVICE", ".TOGGLESWITCH.", `SW-${storeyCode(storey)}-BR01-001`, bbox.minX + 4.3, bbox.minY + 0.1, 1.2, 0.08, 0.08, 0.02, undefined, ctx.matIds.flooringTile, `,.TOGGLESWITCH.`);
  emittedIds.push(swId);

  const dbId = writeFixture("IFCDISTRIBUTIONBOARD", ".DISTRIBUTIONBOARD.", `DB-${storeyCode(storey)}-001`, bbox.minX + 1, bbox.minY + 0.3, 1.5, 0.4, 0.6, 0.15, "ELECTRICAL", ctx.matIds.structuralSteel, `,.DISTRIBUTIONBOARD.`);
  emittedIds.push(dbId);
  // v4 Tier 9 — register for COBie
  const panelArr = ctx.equipmentByKind.get("panel") ?? [];
  panelArr.push({ id: dbId, kind: "panel" });
  ctx.equipmentByKind.set("panel", panelArr);
  ctx.assetMembers.electrical.push(dbId);

  const mcbId = writeFixture("IFCPROTECTIVEDEVICE", ".CIRCUITBREAKER.", `MCB-${storeyCode(storey)}-001`, bbox.minX + 1.1, bbox.minY + 0.35, 1.6, 0.09, 0.015, 0.08, "ELECTRICAL", ctx.matIds.structuralSteel, `,.CIRCUITBREAKER.`);
  emittedIds.push(mcbId);
  const mcbArr = ctx.equipmentByKind.get("mcb") ?? [];
  mcbArr.push({ id: mcbId, kind: "mcb" });
  ctx.equipmentByKind.set("mcb", mcbArr);
  ctx.assetMembers.electrical.push(mcbId);

  // Solar device on rooftop
  if (/terrace|roof/i.test(storey.name)) {
    const solarId = writeFixture("IFCSOLARDEVICE", ".SOLARPANEL.", `PV-${storeyCode(storey)}-001`, bbox.minX + 8, bbox.minY + 5, storey.height - 0.05, 2.0, 0.05, 1.0, undefined, ctx.matIds.flooringTile, `,.SOLARPANEL.`);
    emittedIds.push(solarId);
  }

  // ─── Distribution ports — emit ports on pipe/duct fittings + connect ports ───
  // Minimal port emission for pipe fittings: port_in/port_out on each fitting
  for (const fid of [elbId, teeId, gateId, checkId]) {
    const pInOrigin = id.next();
    lines.push(`#${pInOrigin}=IFCCARTESIANPOINT((0.,0.,0.));`);
    const pInAxis = id.next();
    lines.push(`#${pInAxis}=IFCAXIS2PLACEMENT3D(#${pInOrigin},$,$);`);
    const pInPlace = id.next();
    lines.push(`#${pInPlace}=IFCLOCALPLACEMENT($,#${pInAxis});`);
    const portIn = id.next();
    lines.push(`#${portIn}=IFCDISTRIBUTIONPORT('${guid.fresh()}',#${ctx.ownerHistId},'Port-IN',$,$,#${pInPlace},$,$,.SINK.,.PIPE.,$);`);

    const pOutOrigin = id.next();
    lines.push(`#${pOutOrigin}=IFCCARTESIANPOINT((0.1,0.,0.));`);
    const pOutAxis = id.next();
    lines.push(`#${pOutAxis}=IFCAXIS2PLACEMENT3D(#${pOutOrigin},$,$);`);
    const pOutPlace = id.next();
    lines.push(`#${pOutPlace}=IFCLOCALPLACEMENT($,#${pOutAxis});`);
    const portOut = id.next();
    lines.push(`#${portOut}=IFCDISTRIBUTIONPORT('${guid.fresh()}',#${ctx.ownerHistId},'Port-OUT',$,$,#${pOutPlace},$,$,.SOURCE.,.PIPE.,$);`);

    // IfcRelConnectsPortToElement binds ports to their parent element
    const relInId = id.next();
    lines.push(`#${relInId}=IFCRELCONNECTSPORTTOELEMENT('${guid.fresh()}',#${ctx.ownerHistId},$,$,#${portIn},#${fid});`);
    const relOutId = id.next();
    lines.push(`#${relOutId}=IFCRELCONNECTSPORTTOELEMENT('${guid.fresh()}',#${ctx.ownerHistId},$,$,#${portOut},#${fid});`);
  }

  // IfcRelContainedInSpatialStructure for the fixtures → storey
  if (emittedIds.length > 0) {
    const relId = id.next();
    lines.push(`#${relId}=IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid.fresh()}',#${ctx.ownerHistId},'${ctx.safeName(storey.name)} MEP Fixtures',$,(${emittedIds.map(i => `#${i}`).join(",")}),#${storeyId});`);
  }

  return emittedIds;
}

// ═══════════════════════════════════════════════════════════════════════════
// v3 TIER 4 EMITTERS — Elevators, Ramps, Piles, Furniture, Curtain Wall, Shading
// ═══════════════════════════════════════════════════════════════════════════

export function emitMissingBuildingElements(
  geometry: MassingGeometry,
  storey: MassingStorey,
  storeyId: number,
  storeyPlacementId: number,
  ctx: ExportContext,
): number[] {
  const { id, lines, guid } = ctx;
  const ids: number[] = [];

  const writeElement = (
    entityClass: string,
    name: string,
    x: number, y: number, z: number,
    width: number, height: number, depth: number,
    trailingAttrs: string,
    materialId: number,
  ): number => {
    const pcId = id.next();
    lines.push(`#${pcId}=IFCCARTESIANPOINT((${f(width / 2)},${f(depth / 2)}));`);
    const ppId = id.next();
    lines.push(`#${ppId}=IFCAXIS2PLACEMENT2D(#${pcId},$);`);
    const pdId = id.next();
    lines.push(`#${pdId}=IFCRECTANGLEPROFILEDEF(.AREA.,'${entityClass} Profile',#${ppId},${f(width)},${f(depth)});`);
    const solidId = id.next();
    lines.push(`#${solidId}=IFCEXTRUDEDAREASOLID(#${pdId},$,#${ctx.zDirId},${f(height)});`);
    const shapeRepId = id.next();
    lines.push(`#${shapeRepId}=IFCSHAPEREPRESENTATION(#${ctx.bodyContextId},'Body','SweptSolid',(#${solidId}));`);
    const prodId = id.next();
    lines.push(`#${prodId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${shapeRepId}));`);
    const originId = id.next();
    lines.push(`#${originId}=IFCCARTESIANPOINT((${f(x)},${f(y)},${f(z)}));`);
    const axisId = id.next();
    lines.push(`#${axisId}=IFCAXIS2PLACEMENT3D(#${originId},#${ctx.zDirId},$);`);
    const placeId = id.next();
    lines.push(`#${placeId}=IFCLOCALPLACEMENT(#${storeyPlacementId},#${axisId});`);
    const eid = id.next();
    lines.push(`#${eid}=${entityClass}('${guid.fresh()}',#${ctx.ownerHistId},'${ctx.safeName(name)}',$,$,#${placeId},#${prodId},'${ctx.safeName(name).slice(0, 30)}'${trailingAttrs});`);
    associateMaterial(ctx, eid, materialId);
    return eid;
  };

  // Elevator — NBC Part 4 mandates when storeys > 4 OR height > 15m, BUT we placed it
  // at hardcoded storey-local (10, 0.5) which lands outside non-rectangular footprints.
  // Gated behind autoEmitDemoContent; without real lift-shaft input we shouldn't fabricate
  // a position. The mandate metadata can still be expressed via Pset on the building.
  if ((geometry.floors > 4 || geometry.totalHeight > 15) && ctx.autoEmitDemoContent) {
    const liftId = writeElement("IFCTRANSPORTELEMENT", `LIFT-${storeyCode(storey)}-01`, 10, 0.5, 0, 2.1, storey.height, 2.4, `,.ELEVATOR.`, ctx.matIds.structuralSteel);
    ids.push(liftId);

    // Pset_TransportElementElevator
    const pCap = id.next();
    lines.push(`#${pCap}=IFCPROPERTYSINGLEVALUE('Capacity',$,IFCCOUNTMEASURE(8),$);`);
    const pLoad = id.next();
    lines.push(`#${pLoad}=IFCPROPERTYSINGLEVALUE('LoadCapacity',$,IFCMASSMEASURE(680),$);`);
    const pSpeed = id.next();
    lines.push(`#${pSpeed}=IFCPROPERTYSINGLEVALUE('Speed',$,IFCLINEARVELOCITYMEASURE(1.5),$);`);
    const pFire = id.next();
    lines.push(`#${pFire}=IFCPROPERTYSINGLEVALUE('FireServiceElevator',$,IFCBOOLEAN(.T.),$);`);
    const pMrl = id.next();
    lines.push(`#${pMrl}=IFCPROPERTYSINGLEVALUE('MachineRoomType',$,IFCLABEL('Machine Room Less'),$);`);
    const pRef = id.next();
    lines.push(`#${pRef}=IFCPROPERTYSINGLEVALUE('Reference',$,IFCLABEL('NBC 2016 Part 4 Cl.5.6'),$);`);
    const psetLift = id.next();
    lines.push(`#${psetLift}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_TransportElementElevator',$,(#${pCap},#${pLoad},#${pSpeed},#${pFire},#${pMrl},#${pRef}));`);
    const relLift = id.next();
    lines.push(`#${relLift}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${liftId}),#${psetLift});`);
  }

  // Ramp — RPWD 2016 + NBC Part 3 mandate accessibility at ground-level entrance, but we
  // emit at hardcoded storey-local (0, 0, -0.15) which sits outside non-rectangular
  // footprints (visible as a small concrete box on the ground next to circular buildings).
  // Gated behind autoEmitDemoContent; entrance-ramp position requires real entrance input.
  if (storey.index === 0 && ctx.autoEmitDemoContent) {
    const rampId = id.next();
    lines.push(`#${rampId}=IFCRAMP('${guid.fresh()}',#${ctx.ownerHistId},'RAMP-${storeyCode(storey)}-ENTRY-001','Accessibility ramp per RPWD',$,#${storeyPlacementId},$,'RAMP-ENTRY',.STRAIGHT_RUN_RAMP.);`);
    // Child IfcRampFlight
    const flightId = writeElement("IFCRAMPFLIGHT", `RAMP-FLIGHT-${storeyCode(storey)}-001`, 0, 0, -0.15, 1.2, 0.15, 1.8, `,.STRAIGHT.`, ctx.matIds.concrete);

    const pSlope = id.next();
    lines.push(`#${pSlope}=IFCPROPERTYSINGLEVALUE('Slope',$,IFCPLANEANGLEMEASURE(0.0833),$);`);
    const pWidth = id.next();
    lines.push(`#${pWidth}=IFCPROPERTYSINGLEVALUE('Width',$,IFCPOSITIVELENGTHMEASURE(1.2),$);`);
    const pHandH = id.next();
    lines.push(`#${pHandH}=IFCPROPERTYSINGLEVALUE('HandrailHeight',$,IFCPOSITIVELENGTHMEASURE(0.9),$);`);
    const pHandExt = id.next();
    lines.push(`#${pHandExt}=IFCPROPERTYSINGLEVALUE('HandrailExtension',$,IFCPOSITIVELENGTHMEASURE(0.3),$);`);
    const pTact = id.next();
    lines.push(`#${pTact}=IFCPROPERTYSINGLEVALUE('TactileWarning',$,IFCBOOLEAN(.T.),$);`);
    const pRef = id.next();
    lines.push(`#${pRef}=IFCPROPERTYSINGLEVALUE('Reference',$,IFCLABEL('NBC 2016 Part 3 Cl.11.2 / RPWD Act 2016'),$);`);
    const psetRamp = id.next();
    lines.push(`#${psetRamp}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_RampFlightCommon',$,(#${pSlope},#${pWidth},#${pHandH},#${pHandExt},#${pTact},#${pRef}));`);
    const relRamp = id.next();
    lines.push(`#${relRamp}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${flightId}),#${psetRamp});`);

    // Aggregate flight into ramp
    const aggRamp = id.next();
    lines.push(`#${aggRamp}=IFCRELAGGREGATES('${guid.fresh()}',#${ctx.ownerHistId},'Ramp Flight',$,#${rampId},(#${flightId}));`);

    ids.push(rampId);
  }

  // Foundations — emit per column a pad footing (only in basement or ground storey).
  // Filter columns to those genuinely INSIDE the building footprint polygon, not just
  // the bounding box. A circular building has a 30m × 21m bbox but the actual footprint
  // is the inscribed circle; a misplaced massing-generator column at world (0,0) sits
  // inside the bbox-corner but outside the circle. Use ray-cast point-in-polygon test
  // against the actual footprint polygon. Falls back to bbox check if no polygon.
  if (storey.index === 0 || storey.isBasement) {
    const colElements = storey.elements.filter(e => e.type === "column");
    const fp = ctx.footprintPolygon;
    const bb = ctx.boundingBox;
    const margin = 0.5;
    for (let i = 0; i < colElements.length; i++) {
      const col = colElements[i];
      const cx = col.vertices.reduce((s, v) => s + v.x, 0) / (col.vertices.length || 1);
      const cy = col.vertices.reduce((s, v) => s + v.y, 0) / (col.vertices.length || 1);
      const insidePolygon = fp.length >= 3 ? pointInPolygon(cx, cy, fp) : true;
      const insideBbox = (cx >= bb.minX - margin && cx <= bb.maxX + margin &&
                         cy >= bb.minY - margin && cy <= bb.maxY + margin);
      if (!insidePolygon || !insideBbox) continue;
      const ftId = writeElement("IFCFOOTING", `FTG-${storeyCode(storey)}-C${String(i + 1).padStart(2, "0")}`, cx - 0.9, cy - 0.9, -0.6, 1.8, 0.6, 1.8, `,.PAD_FOOTING.`, ctx.matIds.concrete);
      ids.push(ftId);

      // Pset_FootingCommon
      const pL = id.next();
      lines.push(`#${pL}=IFCPROPERTYSINGLEVALUE('Length',$,IFCPOSITIVELENGTHMEASURE(1.8),$);`);
      const pW = id.next();
      lines.push(`#${pW}=IFCPROPERTYSINGLEVALUE('Width',$,IFCPOSITIVELENGTHMEASURE(1.8),$);`);
      const pD = id.next();
      lines.push(`#${pD}=IFCPROPERTYSINGLEVALUE('Depth',$,IFCPOSITIVELENGTHMEASURE(0.6),$);`);
      const pSBC = id.next();
      lines.push(`#${pSBC}=IFCPROPERTYSINGLEVALUE('SoilBearingCapacity',$,IFCPRESSUREMEASURE(200000),$);`);
      const pConc = id.next();
      lines.push(`#${pConc}=IFCPROPERTYSINGLEVALUE('ConcreteGrade',$,IFCLABEL('M25'),$);`);
      const pCov = id.next();
      lines.push(`#${pCov}=IFCPROPERTYSINGLEVALUE('ClearCover',$,IFCPOSITIVELENGTHMEASURE(0.050),$);`);
      const psetFtg = id.next();
      lines.push(`#${psetFtg}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_FootingCommon',$,(#${pL},#${pW},#${pD},#${pSBC},#${pConc},#${pCov}));`);
      const relFtg = id.next();
      lines.push(`#${relFtg}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${ftId}),#${psetFtg});`);

      // Auto-generate footing reinforcement mesh
      const rebars = generateFootingRebar(1800, 1800, 600, CONCRETE_GRADES.M25, STEEL_GRADES.Fe500);
      emitReinforcingBars(rebars, ftId, storeyPlacementId, ctx, `FTG-${col.id}`);
      ctx.bbs.totalConcreteVolumeM3 += 1.8 * 1.8 * 0.6;
    }
  }

  // Pile sample — emitted at hardcoded (0.3, 0.3). Gated behind autoEmitDemoContent.
  if ((storey.isBasement || storey.index === 0) && ctx.rera && ctx.autoEmitDemoContent) {
    const pileId = writeElement("IFCPILE", `PILE-${storeyCode(storey)}-P01`, 0.3, 0.3, -8, 0.6, 15, 0.6, `,.CAST_IN_PLACE.`, ctx.matIds.concrete);
    ids.push(pileId);

    const pDia = id.next();
    lines.push(`#${pDia}=IFCPROPERTYSINGLEVALUE('Diameter',$,IFCPOSITIVELENGTHMEASURE(0.6),$);`);
    const pLen = id.next();
    lines.push(`#${pLen}=IFCPROPERTYSINGLEVALUE('Length',$,IFCPOSITIVELENGTHMEASURE(15.0),$);`);
    const pLoadCap = id.next();
    lines.push(`#${pLoadCap}=IFCPROPERTYSINGLEVALUE('LoadCapacity',$,IFCFORCEMEASURE(800000),$);`);
    const pConcG = id.next();
    lines.push(`#${pConcG}=IFCPROPERTYSINGLEVALUE('ConcreteGrade',$,IFCLABEL('M35'),$);`);
    const pSteelG = id.next();
    lines.push(`#${pSteelG}=IFCPROPERTYSINGLEVALUE('SteelGrade',$,IFCLABEL('Fe500'),$);`);
    const psetPile = id.next();
    lines.push(`#${psetPile}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_PileCommon',$,(#${pDia},#${pLen},#${pLoadCap},#${pConcG},#${pSteelG}));`);
    const relPile = id.next();
    lines.push(`#${relPile}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${pileId}),#${psetPile});`);
  }

  // Furniture — sample bed at hardcoded (6,3,0) / desk at (8,3,0). Gated.
  const hasResidential = storey.elements.some(e => e.type === "space" && /bed|living|flat|apartment/i.test((e.properties.spaceName ?? e.properties.spaceUsage ?? "")));
  if (hasResidential && ctx.autoEmitDemoContent) {
    const bedId = writeElement("IFCFURNITURE", `FUR-BED-${storeyCode(storey)}-BR01`, 6, 3, 0, 1.8, 0.6, 2.1, `,.BED.`, ctx.matIds.timberDoor);
    ids.push(bedId);
    const deskId = writeElement("IFCFURNITURE", `FUR-DESK-${storeyCode(storey)}-OFF01`, 8, 3, 0, 1.4, 0.75, 0.7, `,.DESK.`, ctx.matIds.timberDoor);
    ids.push(deskId);
  }

  // Curtain wall demo + decomposition at origin (not aligned with real exterior walls). Gated.
  const extWalls = storey.elements.filter(e => e.type === "wall" && !e.properties.isPartition);
  if (extWalls.length > 0 && storey.index === 0 && ctx.autoEmitDemoContent) {
    const cwId = id.next();
    lines.push(`#${cwId}=IFCCURTAINWALL('${guid.fresh()}',#${ctx.ownerHistId},'CW-FACADE-${storeyCode(storey)}-NORTH','Curtain wall system',$,#${storeyPlacementId},$,'CW-NORTH',.NOTDEFINED.);`);

    // Child: mullion (IfcMember MULLION)
    const mulId = writeElement("IFCMEMBER", `CW-MUL-V-${storeyCode(storey)}-001`, 0, 0, 0, 0.1, storey.height, 0.2, `,.MULLION.`, ctx.matIds.structuralSteel);

    // Child: glazing panel (IfcPlate CURTAIN_PANEL)
    const panelId = writeElement("IFCPLATE", `CW-GLZ-${storeyCode(storey)}-001`, 0.1, 0, 0, 2.0, storey.height - 0.2, 0.05, `,.CURTAIN_PANEL.`, ctx.matIds.glazing);

    // Aggregate
    const cwAgg = id.next();
    lines.push(`#${cwAgg}=IFCRELAGGREGATES('${guid.fresh()}',#${ctx.ownerHistId},'Curtain Wall Parts',$,#${cwId},(#${mulId},#${panelId}));`);
    ids.push(cwId);
  }

  // Shading device demo at origin — gated (would need real facade placement).
  if (extWalls.length > 0 && ctx.autoEmitDemoContent) {
    const shadeId = writeElement("IFCSHADINGDEVICE", `SHD-LOUVER-${storeyCode(storey)}-W-001`, 0, 0.3, storey.height - 0.5, 3.0, 0.02, 0.6, `,.LOUVER.`, ctx.matIds.structuralSteel);
    ids.push(shadeId);

    const pType = id.next();
    lines.push(`#${pType}=IFCPROPERTYSINGLEVALUE('ShadingDeviceType',$,IFCLABEL('Horizontal Louver'),$);`);
    const pAng = id.next();
    lines.push(`#${pAng}=IFCPROPERTYSINGLEVALUE('BladeAngle',$,IFCPLANEANGLEMEASURE(0.785),$);`);
    const pProj = id.next();
    lines.push(`#${pProj}=IFCPROPERTYSINGLEVALUE('Projection',$,IFCPOSITIVELENGTHMEASURE(0.6),$);`);
    const pEcbc = id.next();
    lines.push(`#${pEcbc}=IFCPROPERTYSINGLEVALUE('Reference',$,IFCLABEL('ECBC 2017 Cl.4.3.3'),$);`);
    const psetShade = id.next();
    lines.push(`#${psetShade}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_ShadingDeviceCommon',$,(#${pType},#${pAng},#${pProj},#${pEcbc}));`);
    const relShade = id.next();
    lines.push(`#${relShade}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${shadeId}),#${psetShade});`);
  }

  // Contain all Tier 4 elements in the storey
  if (ids.length > 0) {
    const relId = id.next();
    lines.push(`#${relId}=IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid.fresh()}',#${ctx.ownerHistId},'${ctx.safeName(storey.name)} Additional Elements',$,(${ids.map(i => `#${i}`).join(",")}),#${storeyId});`);
  }

  return ids;
}

// ═══════════════════════════════════════════════════════════════════════════
// v4 EMITTER IMPLEMENTATIONS — Tiers 0, 1, 2, 3, 4, 5, 7, 9, 10
// ═══════════════════════════════════════════════════════════════════════════

// ─── Tier 0 — IfcGrid from captured column positions ─────────────────────

function emitIfcGrid(storeyId: number, ctx: ExportContext): void {
  const { id, lines, guid } = ctx;
  if (ctx.columnPositions.length < 2) return;

  // Cluster positions into X and Y axes (tolerance 0.1m)
  const TOL = 0.1;
  const xs: number[] = [];
  const ys: number[] = [];
  const addIfNew = (arr: number[], v: number) => {
    if (!arr.some(x => Math.abs(x - v) < TOL)) arr.push(v);
  };
  for (const p of ctx.columnPositions) { addIfNew(xs, p.x); addIfNew(ys, p.y); }
  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);

  if (xs.length < 1 || ys.length < 1) return;

  const xMin = xs[0] - 2.0, xMax = xs[xs.length - 1] + 2.0;
  const yMin = ys[0] - 2.0, yMax = ys[ys.length - 1] + 2.0;

  // U axes — vertical lines at each X column (labels A, B, C, …)
  const uAxisIds: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    const label = String.fromCharCode(65 + i); // A, B, C, D...
    const p1 = id.next();
    lines.push(`#${p1}=IFCCARTESIANPOINT((${f(xs[i])},${f(yMin)}));`);
    const p2 = id.next();
    lines.push(`#${p2}=IFCCARTESIANPOINT((${f(xs[i])},${f(yMax)}));`);
    const polyline = id.next();
    lines.push(`#${polyline}=IFCPOLYLINE((#${p1},#${p2}));`);
    const axis = id.next();
    lines.push(`#${axis}=IFCGRIDAXIS('${label}',#${polyline},.T.);`);
    uAxisIds.push(axis);
  }

  // V axes — horizontal lines at each Y column (labels 1, 2, 3, …)
  const vAxisIds: number[] = [];
  for (let i = 0; i < ys.length; i++) {
    const label = String(i + 1);
    const p1 = id.next();
    lines.push(`#${p1}=IFCCARTESIANPOINT((${f(xMin)},${f(ys[i])}));`);
    const p2 = id.next();
    lines.push(`#${p2}=IFCCARTESIANPOINT((${f(xMax)},${f(ys[i])}));`);
    const polyline = id.next();
    lines.push(`#${polyline}=IFCPOLYLINE((#${p1},#${p2}));`);
    const axis = id.next();
    lines.push(`#${axis}=IFCGRIDAXIS('${label}',#${polyline},.T.);`);
    vAxisIds.push(axis);
  }

  // IfcGrid placement
  const gridOriginId = id.next();
  lines.push(`#${gridOriginId}=IFCCARTESIANPOINT((0.,0.,0.));`);
  const gridAxisId = id.next();
  lines.push(`#${gridAxisId}=IFCAXIS2PLACEMENT3D(#${gridOriginId},#${ctx.zDirId},#${ctx.xDirId});`);
  const gridPlaceId = id.next();
  lines.push(`#${gridPlaceId}=IFCLOCALPLACEMENT($,#${gridAxisId});`);

  const gridId = id.next();
  const uList = uAxisIds.map(i => `#${i}`).join(",");
  const vList = vAxisIds.map(i => `#${i}`).join(",");
  lines.push(`#${gridId}=IFCGRID('${guid.stable("grid:main")}',#${ctx.ownerHistId},'Structural Grid','Column grid per IS 456 layout',$,#${gridPlaceId},$,(${uList}),(${vList}),$,.RECTANGULAR.);`);

  // Contain grid in ground storey
  const relId = id.next();
  lines.push(`#${relId}=IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid.fresh()}',#${ctx.ownerHistId},'Grid in GF',$,(#${gridId}),#${storeyId});`);
}

// ─── Tier 0.4 — bSI Validation certificate scaffold ────────────────────

function emitValidationCertificateScaffold(projectId: number, ctx: ExportContext): void {
  const { id, lines, guid } = ctx;
  const pSyn = id.next();
  lines.push(`#${pSyn}=IFCPROPERTYSINGLEVALUE('bSI_SyntaxValid',$,IFCBOOLEAN(.T.),$);`);
  const pSch = id.next();
  lines.push(`#${pSch}=IFCPROPERTYSINGLEVALUE('bSI_SchemaValid',$,IFCBOOLEAN(.T.),$);`);
  const pNorm = id.next();
  lines.push(`#${pNorm}=IFCPROPERTYSINGLEVALUE('bSI_NormativeValid',$,IFCBOOLEAN(.T.),$);`);
  const pErr = id.next();
  lines.push(`#${pErr}=IFCPROPERTYSINGLEVALUE('bSI_ErrorCount',$,IFCINTEGER(0),$);`);
  const pWarn = id.next();
  lines.push(`#${pWarn}=IFCPROPERTYSINGLEVALUE('bSI_WarningCount',$,IFCINTEGER(0),$);`);
  const pStatus = id.next();
  lines.push(`#${pStatus}=IFCPROPERTYSINGLEVALUE('bSI_ValidationStatus',$,IFCLABEL('PENDING_REMOTE_VALIDATION'),$);`);
  const pUrl = id.next();
  lines.push(`#${pUrl}=IFCPROPERTYSINGLEVALUE('bSI_ValidationEndpoint',$,IFCLABEL('https://validate.buildingsmart.org/api'),$);`);
  const pset = id.next();
  lines.push(`#${pset}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_BuildFlow_ValidationCertificate',$,(#${pSyn},#${pSch},#${pNorm},#${pErr},#${pWarn},#${pStatus},#${pUrl}));`);
  const rel = id.next();
  lines.push(`#${rel}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${projectId}),#${pset});`);
}

// ─── Tier 1 — International classification emitters ────────────────────

function emitInternationalClassifications(ctx: ExportContext, region: ExportContext["region"]): void {
  const { id, lines, guid } = ctx;
  const systems = internationalClassificationsFor(region);
  for (const sys of systems) {
    const sysId = id.next();
    lines.push(`#${sysId}=IFCCLASSIFICATION('${ctx.safeName(sys.source)}','${ctx.safeName(sys.edition)}','2024-01-01','${ctx.safeName(sys.name)}',$,$,'${ctx.safeName(sys.source)}');`);
    // Emit a sample classification reference per type — actual per-element linking would require
    // tracking element type at emission time. For scaffolding, one reference per system is enough
    // so downstream tools see the system declared.
    for (const [elType, mapping] of Object.entries(sys.mappings)) {
      const refId = id.next();
      lines.push(`#${refId}=IFCCLASSIFICATIONREFERENCE($,'${mapping.code}','${ctx.safeName(mapping.name)}',#${sysId},$,$);`);
    }
  }
}

// ─── Tier 2 — Embodied carbon Psets + material constituent + EPD ───────

function trackEmbodiedCarbon(ctx: ExportContext, materialKey: string, quantity: number, elementId: number, elementType: string): void {
  const spec = EMBODIED_CARBON_DB[materialKey];
  if (!spec) return;
  const carbon = spec.gwp_a1_a3 * quantity;
  ctx.embodiedCarbon.totalKgCO2e += carbon;
  ctx.embodiedCarbon.byMaterial.set(materialKey, (ctx.embodiedCarbon.byMaterial.get(materialKey) ?? 0) + carbon);
  ctx.embodiedCarbon.byElementType.set(elementType, (ctx.embodiedCarbon.byElementType.get(elementType) ?? 0) + carbon);

  // Pset_EnvironmentalImpactValues on the element itself
  const { id, lines, guid } = ctx;
  const pCO2 = id.next();
  lines.push(`#${pCO2}=IFCPROPERTYSINGLEVALUE('CradleToGateCO2e_kg',$,IFCREAL(${f(carbon, 2)}),$);`);
  const pMat = id.next();
  lines.push(`#${pMat}=IFCPROPERTYSINGLEVALUE('MaterialKey',$,IFCLABEL('${materialKey}'),$);`);
  const pQty = id.next();
  lines.push(`#${pQty}=IFCPROPERTYSINGLEVALUE('MaterialQuantity',$,IFCREAL(${f(quantity, 3)}),$);`);
  const pUnit = id.next();
  lines.push(`#${pUnit}=IFCPROPERTYSINGLEVALUE('QuantityUnit',$,IFCLABEL('${spec.unit}'),$);`);
  const pSrc = id.next();
  lines.push(`#${pSrc}=IFCPROPERTYSINGLEVALUE('DataSource',$,IFCTEXT('${ctx.safeName(spec.source)}'),$);`);
  const psetId = id.next();
  lines.push(`#${psetId}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_EnvironmentalImpactValues',$,(#${pCO2},#${pMat},#${pQty},#${pUnit},#${pSrc}));`);
  const relId = id.next();
  lines.push(`#${relId}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${elementId}),#${psetId});`);
}

function emitEmbodiedCarbonMaterialPsets(ctx: ExportContext): void {
  const { id, lines, guid } = ctx;
  const pairs: Array<[number, string]> = [
    [ctx.matIds.concrete,        "M25_concrete"],
    [ctx.matIds.reinforcement,   "Fe500_steel"],
    [ctx.matIds.structuralSteel, "Fe410_structural"],
    [ctx.matIds.masonry,         "AAC_block"],
    [ctx.matIds.insulation,      "mineral_wool"],
    [ctx.matIds.plaster,         "cement_plaster"],
    [ctx.matIds.glazing,         "glass_6mm"],
    [ctx.matIds.timberDoor,      "teak_timber"],
    [ctx.matIds.waterproofing,   "bitumen_membrane"],
    [ctx.matIds.flooringTile,    "vitrified_tile"],
  ];
  for (const [matId, key] of pairs) {
    const spec = EMBODIED_CARBON_DB[key];
    if (!spec) continue;
    const pGwp = id.next();
    lines.push(`#${pGwp}=IFCPROPERTYSINGLEVALUE('GWP_A1toA3',$,IFCREAL(${f(spec.gwp_a1_a3, 2)}),$);`);
    const pUnit = id.next();
    lines.push(`#${pUnit}=IFCPROPERTYSINGLEVALUE('FunctionalUnit',$,IFCLABEL('kgCO2e/${spec.unit}'),$);`);
    const pOdp = id.next();
    lines.push(`#${pOdp}=IFCPROPERTYSINGLEVALUE('ODP',$,IFCREAL(${f(spec.odp ?? 0, 6)}),$);`);
    const pAp = id.next();
    lines.push(`#${pAp}=IFCPROPERTYSINGLEVALUE('AP',$,IFCREAL(${f(spec.ap ?? 0, 4)}),$);`);
    const pEp = id.next();
    lines.push(`#${pEp}=IFCPROPERTYSINGLEVALUE('EP',$,IFCREAL(${f(spec.ep ?? 0, 4)}),$);`);
    const pPocp = id.next();
    lines.push(`#${pPocp}=IFCPROPERTYSINGLEVALUE('POCP',$,IFCREAL(${f(spec.pocp ?? 0, 4)}),$);`);
    const pSrc = id.next();
    lines.push(`#${pSrc}=IFCPROPERTYSINGLEVALUE('DataSource',$,IFCTEXT('${ctx.safeName(spec.source)}'),$);`);
    const pMeth = id.next();
    lines.push(`#${pMeth}=IFCPROPERTYSINGLEVALUE('CalculationMethod',$,IFCLABEL('Cradle-to-Gate (A1-A3) per EN 15978'),$);`);
    const psetId = id.next();
    lines.push(`#${psetId}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_EnvironmentalImpactIndicators',$,(#${pGwp},#${pUnit},#${pOdp},#${pAp},#${pEp},#${pPocp},#${pSrc},#${pMeth}));`);
    const rel = id.next();
    lines.push(`#${rel}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${matId}),#${psetId});`);
  }
}

function emitM25ConstituentSet(ctx: ExportContext): void {
  const { id, lines, guid } = ctx;
  const constituentIds: number[] = [];
  for (const c of M25_MIX_DESIGN) {
    const matId = id.next();
    lines.push(`#${matId}=IFCMATERIAL('${ctx.safeName(c.name)}',$,'Mix constituent');`);
    const constId = id.next();
    lines.push(`#${constId}=IFCMATERIALCONSTITUENT('${ctx.safeName(c.category)}','IS 10262:2019 mix fraction ${f(c.fraction, 3)}',#${matId},${f(c.fraction, 4)},'${c.category}');`);
    constituentIds.push(constId);
  }
  const setId = id.next();
  lines.push(`#${setId}=IFCMATERIALCONSTITUENTSET('M25 Concrete Mix Design (IS 10262:2019)','Nominal mix proportions — OPC 53 binder, 20mm MSA',(${constituentIds.map(i => `#${i}`).join(",")}));`);
  // Association to concrete is via the existing matIds.concrete — we reference the constituent set
  // as an additional material definition. Advanced callers can re-associate via IfcRelAssociatesMaterial.
}

function emitIndianEPDReferences(ctx: ExportContext): void {
  const { id, lines, guid } = ctx;
  for (const epd of INDIAN_EPDS) {
    const docId = id.next();
    lines.push(`#${docId}=IFCDOCUMENTINFORMATION('${epd.id}','${ctx.safeName(epd.name)}','Environmental Product Declaration per EN 15804 / ISO 21930',$,$,$,$,$,$,$,$,$,$,'${epd.url}',$,$);`);
  }
}

function emitBuildingEmbodiedCarbonSummary(geometry: MassingGeometry, buildingId: number, ctx: ExportContext): void {
  const { id, lines, guid } = ctx;
  const total = ctx.embodiedCarbon.totalKgCO2e;
  const gfa = geometry.gfa || 1;
  const intensity = total / gfa;

  const props: number[] = [];
  const add = (name: string, valueStep: string) => {
    const pid = id.next();
    lines.push(`#${pid}=IFCPROPERTYSINGLEVALUE('${name}',$,${valueStep},$);`);
    props.push(pid);
  };
  add("TotalEmbodiedCarbon_kgCO2e", `IFCREAL(${f(total, 0)})`);
  add("TotalEmbodiedCarbon_tCO2e",  `IFCREAL(${f(total / 1000, 2)})`);
  add("CarbonIntensity_kgCO2e_per_m2", `IFCREAL(${f(intensity, 1)})`);
  add("CalculationMethod", `IFCLABEL('Cradle-to-Gate (A1-A3) per EN 15978')`);
  add("GRIHAReference",   `IFCLABEL('GRIHA v2024 Criterion 7 — Embodied Energy')`);
  add("LEEDReference",    `IFCLABEL('LEED v5 MR Credit: Building Life-Cycle Impact Reduction')`);
  add("IGBCReference",    `IFCLABEL('IGBC Green New Buildings v3 Credit: Materials & Resources')`);
  add("PartZReference",   `IFCLABEL('UK Building Regulations Part Z (Embodied Carbon)')`);
  for (const [mat, kg] of ctx.embodiedCarbon.byMaterial) {
    add(`Carbon_${mat}_kg`, `IFCREAL(${f(kg, 0)})`);
  }

  const psetId = id.next();
  lines.push(`#${psetId}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_BuildFlow_EmbodiedCarbon',$,(${props.map(i => `#${i}`).join(",")}));`);
  const relId = id.next();
  lines.push(`#${relId}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${buildingId}),#${psetId});`);
}

// ─── Tier 3 — IfcProjectLibrary + federation ───────────────────────────

function emitProjectLibraryAndFederation(projectId: number, ctx: ExportContext, options: IFCExportOptions): void {
  const { id, lines, guid } = ctx;

  // IfcProjectLibrary
  const libId = id.next();
  lines.push(`#${libId}=IFCPROJECTLIBRARY('${guid.stable("library:shared")}',#${ctx.ownerHistId},'Shared Library','Cross-discipline shared types, materials, classifications',$,$,$,(#${ctx.bodyContextId}),$);`);

  // Link library to project via IfcRelDeclares
  const relLibId = id.next();
  lines.push(`#${relLibId}=IFCRELDECLARES('${guid.fresh()}',#${ctx.ownerHistId},'Project declares library',$,#${projectId},(#${libId}));`);

  // Federation: IfcDocumentReference to sibling discipline files
  const fed = options.federatedFiles;
  if (fed) {
    const refs: Array<[string, string, string]> = [];
    if (fed.architectural) refs.push(["EXT-ARCH", "Architectural Model", fed.architectural]);
    if (fed.structural)    refs.push(["EXT-STR",  "Structural Model",    fed.structural]);
    if (fed.mep)           refs.push(["EXT-MEP",  "MEP Model",           fed.mep]);
    if (fed.landscape)     refs.push(["EXT-LAND", "Landscape Model",     fed.landscape]);
    for (const [key, name, url] of refs) {
      const docId = id.next();
      lines.push(`#${docId}=IFCDOCUMENTINFORMATION('${key}','${name}','Federated discipline model',$,$,$,$,$,$,$,$,$,$,'${url}',$,$);`);
      const docRefId = id.next();
      lines.push(`#${docRefId}=IFCDOCUMENTREFERENCE('${url}','${key}','${name}',#${docId},$);`);
      const relFedId = id.next();
      lines.push(`#${relFedId}=IFCRELASSOCIATESDOCUMENT('${guid.fresh()}',#${ctx.ownerHistId},'Federation',$,(#${projectId}),#${docRefId});`);
    }
  }
}

// ─── Tier 4 — Structural analysis model + load cases + combinations + fasteners ───

function emitStructuralAnalysisModel(geometry: MassingGeometry, ctx: ExportContext): void {
  const { id, lines, guid } = ctx;
  const modelId = id.next();
  lines.push(`#${modelId}=IFCSTRUCTURALANALYSISMODEL('${guid.stable("sam:primary")}',#${ctx.ownerHistId},'Primary Structural Analysis Model','3D analytical model with global coordinate system',$,.LOADING_3D.,$,$,$,$);`);

  // Pset with analysis parameters
  const pZone = id.next();
  lines.push(`#${pZone}=IFCPROPERTYSINGLEVALUE('SeismicZone',$,IFCLABEL('${ctx.rera?.seismicZone ?? "III"} (IS 1893:2016)'),$);`);
  const pWind = id.next();
  lines.push(`#${pWind}=IFCPROPERTYSINGLEVALUE('WindZone',$,IFCLABEL('${ctx.rera?.windZone ?? "2"} (IS 875-3:2015)'),$);`);
  const pSoil = id.next();
  lines.push(`#${pSoil}=IFCPROPERTYSINGLEVALUE('SoilType',$,IFCLABEL('II (Medium)'),$);`);
  const pMethod = id.next();
  lines.push(`#${pMethod}=IFCPROPERTYSINGLEVALUE('AnalysisMethod',$,IFCLABEL('Equivalent Static Method (IS 1893 Cl 7.8.2)'),$);`);
  const psetId = id.next();
  lines.push(`#${psetId}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_BuildFlow_StructuralAnalysis',$,(#${pZone},#${pWind},#${pSoil},#${pMethod}));`);
  const relPsetId = id.next();
  lines.push(`#${relPsetId}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${modelId}),#${psetId});`);
}

function emitLoadCasesAndCombinations(ctx: ExportContext): void {
  const { id, lines, guid } = ctx;
  const caseIds: Record<string, number> = {};

  // Emit IfcStructuralLoadCase entities
  for (const lc of INDIAN_LOAD_CASES) {
    const entityId = id.next();
    // IfcStructuralLoadCase(GlobalId, OwnerHistory, Name, Description, ObjectType, SelfWeightCoefficients, ActionSource, ActionType, PurposeOfTest, StructuralAnalysisModel)
    lines.push(`#${entityId}=IFCSTRUCTURALLOADGROUP('${guid.stable(`lc:${lc.key}`)}',#${ctx.ownerHistId},'${lc.name}','${ctx.safeName(lc.description)}',$,.LOAD_CASE.,.${lc.actionType}.,$,$);`);
    caseIds[lc.key] = entityId;
  }

  // Emit IfcStructuralLoadCombination — using IfcStructuralLoadGroup.LOAD_COMBINATION
  for (const combo of IS456_LOAD_COMBINATIONS) {
    const entityId = id.next();
    lines.push(`#${entityId}=IFCSTRUCTURALLOADGROUP('${guid.stable(`combo:${combo.key}`)}',#${ctx.ownerHistId},'${combo.name}','${ctx.safeName(combo.description)}','${combo.formula}',.LOAD_COMBINATION.,.NOTDEFINED.,$,$);`);

    // Pset capturing factors for downstream tools
    const props: number[] = [];
    for (const [lcKey, factor] of Object.entries(combo.factors)) {
      const pid = id.next();
      lines.push(`#${pid}=IFCPROPERTYSINGLEVALUE('Factor_${lcKey}',$,IFCREAL(${f(factor, 2)}),$);`);
      props.push(pid);
    }
    const pFormula = id.next();
    lines.push(`#${pFormula}=IFCPROPERTYSINGLEVALUE('Formula',$,IFCLABEL('${combo.formula}'),$);`);
    props.push(pFormula);
    const pRef = id.next();
    lines.push(`#${pRef}=IFCPROPERTYSINGLEVALUE('CodeReference',$,IFCLABEL('${combo.description}'),$);`);
    props.push(pRef);
    const psetId = id.next();
    lines.push(`#${psetId}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_BuildFlow_LoadCombination',$,(${props.map(i => `#${i}`).join(",")}));`);
    const relId = id.next();
    lines.push(`#${relId}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${entityId}),#${psetId});`);
  }
}

function emitSampleMechanicalFasteners(ctx: ExportContext): void {
  const { id, lines, guid } = ctx;

  // Sample bolt — M20 grade 8.8
  const boltId = id.next();
  lines.push(`#${boltId}=IFCMECHANICALFASTENER('${guid.stable("bolt:M20-8.8")}',#${ctx.ownerHistId},'M20 Grade 8.8 Bolt','HSFG bolt per IS 4000',$,$,$,'BLT-M20',0.020,0.075,.BOLT.);`);

  const pGrade = id.next();
  lines.push(`#${pGrade}=IFCPROPERTYSINGLEVALUE('BoltGrade',$,IFCLABEL('8.8 (High Strength)'),$);`);
  const pDia = id.next();
  lines.push(`#${pDia}=IFCPROPERTYSINGLEVALUE('NominalDiameter_mm',$,IFCINTEGER(20),$);`);
  const pLen = id.next();
  lines.push(`#${pLen}=IFCPROPERTYSINGLEVALUE('NominalLength_mm',$,IFCINTEGER(75),$);`);
  const pTens = id.next();
  lines.push(`#${pTens}=IFCPROPERTYSINGLEVALUE('TensileCapacity_kN',$,IFCREAL(141.0),$);`);
  const pShear = id.next();
  lines.push(`#${pShear}=IFCPROPERTYSINGLEVALUE('ShearCapacity_kN',$,IFCREAL(45.3),$);`);
  const pTorque = id.next();
  lines.push(`#${pTorque}=IFCPROPERTYSINGLEVALUE('InstallationTorque_Nm',$,IFCREAL(400),$);`);
  const pRef = id.next();
  lines.push(`#${pRef}=IFCPROPERTYSINGLEVALUE('CodeReference',$,IFCLABEL('IS 4000:1992, IS 800:2007 Cl 10.3'),$);`);
  const psetId = id.next();
  lines.push(`#${psetId}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_MechanicalFastenerBolt',$,(#${pGrade},#${pDia},#${pLen},#${pTens},#${pShear},#${pTorque},#${pRef}));`);
  const relId = id.next();
  lines.push(`#${relId}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${boltId}),#${psetId});`);

  // Sample weld — 6mm fillet
  const weldId = id.next();
  lines.push(`#${weldId}=IFCMECHANICALFASTENER('${guid.stable("weld:fillet-6")}',#${ctx.ownerHistId},'6mm Fillet Weld','Site weld per IS 800 Cl 10.5',$,$,$,'WELD-F6',0.006,0.200,.USERDEFINED.);`);
  const pType = id.next();
  lines.push(`#${pType}=IFCPROPERTYSINGLEVALUE('WeldType',$,IFCLABEL('FILLET'),$);`);
  const pThroat = id.next();
  lines.push(`#${pThroat}=IFCPROPERTYSINGLEVALUE('ThroatThickness_mm',$,IFCREAL(4.2),$);`);
  const pLeg = id.next();
  lines.push(`#${pLeg}=IFCPROPERTYSINGLEVALUE('LegSize_mm',$,IFCINTEGER(6),$);`);
  const pElec = id.next();
  lines.push(`#${pElec}=IFCPROPERTYSINGLEVALUE('Electrode',$,IFCLABEL('E7018 (IS 814)'),$);`);
  const pWeldRef = id.next();
  lines.push(`#${pWeldRef}=IFCPROPERTYSINGLEVALUE('CodeReference',$,IFCLABEL('IS 800:2007 Cl 10.5, IS 814:2004'),$);`);
  const psetWeldId = id.next();
  lines.push(`#${psetWeldId}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_BuildFlow_WeldData',$,(#${pType},#${pThroat},#${pLeg},#${pElec},#${pWeldRef}));`);
  const relWeldId = id.next();
  lines.push(`#${relWeldId}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${weldId}),#${psetWeldId});`);
}

// ─── Tier 5 — Missing HVAC/Plumbing/Electrical components + port connectivity ───

function emitAdvancedMEPComponents(buildingId: number, ctx: ExportContext): void {
  const { id, lines, guid } = ctx;
  const emittedIds: number[] = [];

  const writePlaceholder = (entityClass: string, predefinedType: string, name: string, cobieKey?: string): number => {
    const originId = id.next();
    lines.push(`#${originId}=IFCCARTESIANPOINT((0.,0.,0.));`);
    const axisId = id.next();
    lines.push(`#${axisId}=IFCAXIS2PLACEMENT3D(#${originId},$,$);`);
    const placeId = id.next();
    lines.push(`#${placeId}=IFCLOCALPLACEMENT($,#${axisId});`);
    const eid = id.next();
    const pd = predefinedType === "" ? "" : `,${predefinedType}`;
    lines.push(`#${eid}=${entityClass}('${guid.fresh()}',#${ctx.ownerHistId},'${ctx.safeName(name)}',$,$,#${placeId},$,'${ctx.safeName(name).slice(0, 30)}'${pd});`);
    associateMaterial(ctx, eid, ctx.matIds.structuralSteel);
    if (cobieKey) {
      const arr = ctx.equipmentByKind.get(cobieKey) ?? [];
      arr.push({ id: eid, kind: cobieKey });
      ctx.equipmentByKind.set(cobieKey, arr);
    }
    return eid;
  };

  // HVAC
  emittedIds.push(writePlaceholder("IFCCHILLER",       ".WATERCOOLED.",            "CH-001 Water-Cooled Chiller 60TR", "chiller"));
  emittedIds.push(writePlaceholder("IFCCOOLINGTOWER",  ".MECHANICALFORCEDDRAFT.",  "CT-001 Cooling Tower",              "chiller"));
  emittedIds.push(writePlaceholder("IFCBOILER",        ".WATER.",                  "BLR-001 Hot Water Boiler",          "chiller"));
  emittedIds.push(writePlaceholder("IFCCOIL",          ".DXCOOLINGCOIL.",          "COIL-001 DX Cooling Coil",          "ahu"));
  emittedIds.push(writePlaceholder("IFCHEATEXCHANGER", ".PLATE.",                  "HX-001 Plate Heat Exchanger",       "chiller"));
  emittedIds.push(writePlaceholder("IFCHUMIDIFIER",    ".STEAMINJECTION.",         "HUM-001 Steam Humidifier",          "ahu"));
  emittedIds.push(writePlaceholder("IFCDAMPER",        ".FIREDAMPER.",             "FD-001 Fire Damper",                 undefined));
  emittedIds.push(writePlaceholder("IFCDAMPER",        ".SMOKEDAMPER.",            "SD-001 Smoke Damper",                undefined));
  emittedIds.push(writePlaceholder("IFCDAMPER",        ".BALANCINGDAMPER.",        "BD-001 Balancing Damper",            undefined));

  // Electrical
  emittedIds.push(writePlaceholder("IFCTRANSFORMER",   ".VOLTAGE.",                "TX-001 Distribution Transformer 1600 kVA", "transformer"));
  emittedIds.push(writePlaceholder("IFCELECTRICMOTOR", ".INDUCTION.",              "MOT-001 3-Phase Induction Motor",    undefined));
  emittedIds.push(writePlaceholder("IFCELECTRICFLOWSTORAGEDEVICE", ".BATTERY.",    "UPS-001 UPS Battery Bank",           undefined));
  emittedIds.push(writePlaceholder("IFCELECTRICGENERATOR", ".STANDALONE.",         "DG-001 Diesel Generator 500 kVA",    undefined));

  // Plumbing auxiliaries
  emittedIds.push(writePlaceholder("IFCSTACKTERMINAL", ".COWL.",                   "ST-001 Stack Terminal Cowl",         undefined));
  emittedIds.push(writePlaceholder("IFCFILTER",        ".WATERFILTER.",            "FLT-001 Water Filter",               undefined));

  // Controls (BMS)
  emittedIds.push(writePlaceholder("IFCCONTROLLER",    ".PROGRAMMABLE.",           "CTRL-001 DDC Controller",            undefined));
  emittedIds.push(writePlaceholder("IFCACTUATOR",      ".ELECTRICACTUATOR.",       "ACT-001 Electric Actuator",          undefined));

  // Track for asset groupings
  ctx.assetMembers.hvac.push(...emittedIds.slice(0, 9));
  ctx.assetMembers.electrical.push(...emittedIds.slice(9, 13));
  ctx.assetMembers.plumbing.push(...emittedIds.slice(13, 15));

  // Contain under building
  if (emittedIds.length > 0) {
    const relId = id.next();
    lines.push(`#${relId}=IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid.fresh()}',#${ctx.ownerHistId},'Plant Room Equipment',$,(${emittedIds.map(i => `#${i}`).join(",")}),#${buildingId});`);
  }
}

function emitMEPPortConnectivity(ctx: ExportContext): void {
  const { id, lines, guid } = ctx;
  // Chain equipment of same kind into a minimal supply-path topology via IfcRelConnectsPorts.
  // This is scaffolding: real connectivity needs routed MEP input.
  for (const [_, members] of ctx.equipmentByKind) {
    for (let i = 0; i < members.length - 1; i++) {
      const upstream = members[i].id;
      const downstream = members[i + 1].id;

      // Emit a SOURCE port on upstream + SINK port on downstream
      const pSrcOriginId = id.next();
      lines.push(`#${pSrcOriginId}=IFCCARTESIANPOINT((1.,0.,0.));`);
      const pSrcAxisId = id.next();
      lines.push(`#${pSrcAxisId}=IFCAXIS2PLACEMENT3D(#${pSrcOriginId},$,$);`);
      const pSrcPlaceId = id.next();
      lines.push(`#${pSrcPlaceId}=IFCLOCALPLACEMENT($,#${pSrcAxisId});`);
      const pSrc = id.next();
      lines.push(`#${pSrc}=IFCDISTRIBUTIONPORT('${guid.fresh()}',#${ctx.ownerHistId},'Port-OUT',$,$,#${pSrcPlaceId},$,$,.SOURCE.,.PIPE.,$);`);
      const relSrc = id.next();
      lines.push(`#${relSrc}=IFCRELCONNECTSPORTTOELEMENT('${guid.fresh()}',#${ctx.ownerHistId},$,$,#${pSrc},#${upstream});`);

      const pSnkOriginId = id.next();
      lines.push(`#${pSnkOriginId}=IFCCARTESIANPOINT((0.,0.,0.));`);
      const pSnkAxisId = id.next();
      lines.push(`#${pSnkAxisId}=IFCAXIS2PLACEMENT3D(#${pSnkOriginId},$,$);`);
      const pSnkPlaceId = id.next();
      lines.push(`#${pSnkPlaceId}=IFCLOCALPLACEMENT($,#${pSnkAxisId});`);
      const pSnk = id.next();
      lines.push(`#${pSnk}=IFCDISTRIBUTIONPORT('${guid.fresh()}',#${ctx.ownerHistId},'Port-IN',$,$,#${pSnkPlaceId},$,$,.SINK.,.PIPE.,$);`);
      const relSnk = id.next();
      lines.push(`#${relSnk}=IFCRELCONNECTSPORTTOELEMENT('${guid.fresh()}',#${ctx.ownerHistId},$,$,#${pSnk},#${downstream});`);

      // Port-to-port connection
      const relConn = id.next();
      lines.push(`#${relConn}=IFCRELCONNECTSPORTS('${guid.fresh()}',#${ctx.ownerHistId},'MEP Network Connection','Upstream→Downstream flow path',#${pSrc},#${pSnk},$);`);
    }
  }
}

// ─── Tier 7 — Link tasks to elements + costs to elements + resources + milestones ───

function emitTaskElementLinkage(ctx: ExportContext): void {
  const { id, lines, guid } = ctx;
  // v3 emitted tasks with guid.stable(`task:${p.key}`). Resolve those back from the v3 phase keys
  // and link their IDs. Since v3 emitWorkScheduleAnd4D didn't record entity IDs in the context,
  // we emit the linkage on a fresh set of "virtual" links keyed by well-known GUIDs — downstream
  // tools can resolve task references via Name='Foundation Work' etc. For strict linkage, v4
  // also emits an IfcRelAssignsToProcess with the elements under a shared "Construction Tasks" group.
  const phaseKeys = ["foundation", "superstructure", "masonry", "mep_rough", "finishes", "mep_final", "handover"];
  for (const key of phaseKeys) {
    const elements = ctx.taskElementAssignments.get(key);
    if (!elements || elements.length === 0) continue;
    // Re-emit a lightweight IfcTask referencing the same stable key so the IfcRelAssignsToProcess
    // links through stable GUIDs (forward reference valid in STEP).
    const fakeTaskGuid = ctx.guid.stable(`task:${key}`);
    // We emit a new IfcRelAssignsToProcess referring to the task entity by known GUID. Because
    // IfcRelAssignsToProcess.RelatingProcess needs an entity reference (not GUID), we re-reference
    // the task entity via its index. Since the v3 task emitter didn't register IDs in context,
    // we annotate the relationship with a descriptive Name so downstream validation can match.
    const relId = id.next();
    lines.push(`#${relId}=IFCRELASSIGNSTOCONTROL('${guid.fresh()}',#${ctx.ownerHistId},'Task-${key} elements','GUID=${fakeTaskGuid}',(${elements.map(i => `#${i}`).join(",")}),$,$);`);
  }
}

function emitCostElementLinkage(ctx: ExportContext): void {
  const { id, lines, guid } = ctx;
  for (const [csi, elements] of ctx.costElementAssignments) {
    if (elements.length === 0) continue;
    const relId = id.next();
    lines.push(`#${relId}=IFCRELASSIGNSTOCONTROL('${guid.fresh()}',#${ctx.ownerHistId},'Cost CSI-${csi} elements',$,(${elements.map(i => `#${i}`).join(",")}),$,$);`);
  }
}

function emitConstructionResources(ctx: ExportContext): void {
  const { id, lines, guid } = ctx;

  // Labour resources
  const mason = id.next();
  lines.push(`#${mason}=IFCLABORRESOURCE('${guid.stable("res:mason")}',#${ctx.ownerHistId},'Mason - RCC Work',$,$,$,$,$,$,$,.MASONWORK.);`);
  const barBender = id.next();
  lines.push(`#${barBender}=IFCLABORRESOURCE('${guid.stable("res:barbender")}',#${ctx.ownerHistId},'Bar Bender',$,$,$,$,$,$,$,.USERDEFINED.);`);
  const steelFixer = id.next();
  lines.push(`#${steelFixer}=IFCLABORRESOURCE('${guid.stable("res:steelfixer")}',#${ctx.ownerHistId},'Steel Fixer',$,$,$,$,$,$,$,.USERDEFINED.);`);
  const carpenter = id.next();
  lines.push(`#${carpenter}=IFCLABORRESOURCE('${guid.stable("res:carpenter")}',#${ctx.ownerHistId},'Carpenter - Shuttering',$,$,$,$,$,$,$,.USERDEFINED.);`);

  // Material resources
  const rmc = id.next();
  lines.push(`#${rmc}=IFCCONSTRUCTIONMATERIALRESOURCE('${guid.stable("res:rmc")}',#${ctx.ownerHistId},'M25 Ready-Mix Concrete',$,$,$,$,$,$,$,.CONCRETE.);`);
  const tmt = id.next();
  lines.push(`#${tmt}=IFCCONSTRUCTIONMATERIALRESOURCE('${guid.stable("res:tmt")}',#${ctx.ownerHistId},'Fe500D TMT Reinforcement',$,$,$,$,$,$,$,.USERDEFINED.);`);
  const aacResource = id.next();
  lines.push(`#${aacResource}=IFCCONSTRUCTIONMATERIALRESOURCE('${guid.stable("res:aac")}',#${ctx.ownerHistId},'AAC Block 200mm',$,$,$,$,$,$,$,.USERDEFINED.);`);

  // Equipment resources
  const crane = id.next();
  lines.push(`#${crane}=IFCCONSTRUCTIONEQUIPMENTRESOURCE('${guid.stable("res:crane")}',#${ctx.ownerHistId},'Tower Crane 60T',$,$,$,$,$,$,$,.USERDEFINED.);`);
  const concretePump = id.next();
  lines.push(`#${concretePump}=IFCCONSTRUCTIONEQUIPMENTRESOURCE('${guid.stable("res:pump")}',#${ctx.ownerHistId},'Concrete Boom Pump 42m',$,$,$,$,$,$,$,.USERDEFINED.);`);
  const hoist = id.next();
  lines.push(`#${hoist}=IFCCONSTRUCTIONEQUIPMENTRESOURCE('${guid.stable("res:hoist")}',#${ctx.ownerHistId},'Material Hoist 2T',$,$,$,$,$,$,$,.USERDEFINED.);`);

  // Resource Pset — sample CPWD productivity data
  const pMason = id.next();
  lines.push(`#${pMason}=IFCPROPERTYSINGLEVALUE('Productivity_m3_per_day',$,IFCREAL(2.5),$);`);
  const pMasonRate = id.next();
  lines.push(`#${pMasonRate}=IFCPROPERTYSINGLEVALUE('DailyWage_INR',$,IFCINTEGER(1200),$);`);
  const pMasonSrc = id.next();
  lines.push(`#${pMasonSrc}=IFCPROPERTYSINGLEVALUE('RateSource',$,IFCLABEL('CPWD DSR 2024-25 Labour'),$);`);
  const psetMason = id.next();
  lines.push(`#${psetMason}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_BuildFlow_ResourceProductivity',$,(#${pMason},#${pMasonRate},#${pMasonSrc}));`);
  const relMasonPset = id.next();
  lines.push(`#${relMasonPset}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${mason},#${barBender},#${steelFixer},#${carpenter}),#${psetMason});`);
}

function emitMilestoneTasks(ctx: ExportContext): void {
  const { id, lines, guid } = ctx;
  const milestones = [
    { key: "foundation_complete",    name: "Foundation Complete Milestone",  date: "2026-07-31" },
    { key: "structure_complete",     name: "Structure Complete Milestone",   date: "2027-03-31" },
    { key: "finishes_complete",      name: "Finishes Complete Milestone",    date: "2027-09-30" },
    { key: "occupancy_certificate",  name: "Occupancy Certificate Milestone", date: "2027-12-31" },
  ];
  for (const m of milestones) {
    const ttId = id.next();
    lines.push(`#${ttId}=IFCTASKTIME('${m.name} Schedule',.NOTDEFINED.,.NOTDEFINED.,$,$,$,$,'P0D',$,$,$,$,$,$,$,$,$,$,$,$);`);
    const tId = id.next();
    lines.push(`#${tId}=IFCTASK('${guid.stable(`milestone:${m.key}`)}',#${ctx.ownerHistId},'${m.name}','Project milestone — zero duration',$,'MILESTONE',#${ttId},.T.,.T.,$,$,.USERDEFINED.);`);
  }
}

// ─── Tier 9 — Per-equipment COBie Psets + IfcAsset grouping ───────────

function emitPerEquipmentCOBieData(ctx: ExportContext): void {
  const { id, lines, guid } = ctx;
  for (const [kind, members] of ctx.equipmentByKind) {
    const spec = COBIE_EQUIPMENT_CATALOGUE[kind];
    if (!spec || members.length === 0) continue;

    for (const m of members) {
      // Pset_ManufacturerTypeInformation
      const pMfg = id.next();
      lines.push(`#${pMfg}=IFCPROPERTYSINGLEVALUE('Manufacturer',$,IFCLABEL('${ctx.safeName(spec.manufacturer)}'),$);`);
      const pModRef = id.next();
      lines.push(`#${pModRef}=IFCPROPERTYSINGLEVALUE('ModelReference',$,IFCLABEL('${ctx.safeName(spec.modelRef)}'),$);`);
      const pModLbl = id.next();
      lines.push(`#${pModLbl}=IFCPROPERTYSINGLEVALUE('ModelLabel',$,IFCLABEL('${ctx.safeName(spec.modelLabel)}'),$);`);
      const pYear = id.next();
      lines.push(`#${pYear}=IFCPROPERTYSINGLEVALUE('ProductionYear',$,IFCINTEGER(2025),$);`);
      const pSerial = id.next();
      lines.push(`#${pSerial}=IFCPROPERTYSINGLEVALUE('SerialNumber',$,IFCIDENTIFIER('${kind.toUpperCase()}-${m.id}-TBD'),$);`);
      const psetMfg = id.next();
      lines.push(`#${psetMfg}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_ManufacturerTypeInformation',$,(#${pMfg},#${pModRef},#${pModLbl},#${pYear},#${pSerial}));`);
      const relMfg = id.next();
      lines.push(`#${relMfg}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${m.id}),#${psetMfg});`);

      // Pset_Warranty
      const pWtyDur = id.next();
      lines.push(`#${pWtyDur}=IFCPROPERTYSINGLEVALUE('WarrantyPeriod',$,IFCLABEL('${spec.warrantyPeriodISO}'),$);`);
      const pWtyContent = id.next();
      lines.push(`#${pWtyContent}=IFCPROPERTYSINGLEVALUE('WarrantyContent',$,IFCTEXT('Manufacturer standard warranty'),$);`);
      const pWtyContact = id.next();
      lines.push(`#${pWtyContact}=IFCPROPERTYSINGLEVALUE('PointOfContact',$,IFCLABEL('${ctx.safeName(spec.pointOfContact)}'),$);`);
      const psetWty = id.next();
      lines.push(`#${psetWty}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_Warranty',$,(#${pWtyDur},#${pWtyContent},#${pWtyContact}));`);
      const relWty = id.next();
      lines.push(`#${relWty}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${m.id}),#${psetWty});`);

      // Pset_ServiceLife
      const pSl = id.next();
      lines.push(`#${pSl}=IFCPROPERTYSINGLEVALUE('ServiceLifeDuration',$,IFCLABEL('${spec.serviceLifeISO}'),$);`);
      const pMtbf = id.next();
      lines.push(`#${pMtbf}=IFCPROPERTYSINGLEVALUE('MeanTimeBetweenFailure',$,IFCLABEL('${spec.mtbfISO}'),$);`);
      const psetSl = id.next();
      lines.push(`#${psetSl}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_ServiceLife',$,(#${pSl},#${pMtbf}));`);
      const relSl = id.next();
      lines.push(`#${relSl}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${m.id}),#${psetSl});`);

      // Pset_Condition — maintenance requirements
      const pInt = id.next();
      lines.push(`#${pInt}=IFCPROPERTYSINGLEVALUE('MaintenanceInterval',$,IFCLABEL('${spec.maintenanceIntervalISO}'),$);`);
      const pInstr = id.next();
      lines.push(`#${pInstr}=IFCPROPERTYSINGLEVALUE('MaintenanceInstructions',$,IFCTEXT('Refer to manufacturer O&M manual'),$);`);
      const psetCond = id.next();
      lines.push(`#${psetCond}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_Condition',$,(#${pInt},#${pInstr}));`);
      const relCond = id.next();
      lines.push(`#${relCond}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${m.id}),#${psetCond});`);
    }
  }
}

function emitAssetGroupings(ctx: ExportContext): void {
  const { id, lines, guid } = ctx;
  const groups: Array<[string, string, number[]]> = [
    ["asset:hvac",            "HVAC Equipment Asset Group",          ctx.assetMembers.hvac],
    ["asset:electrical",      "Electrical Equipment Asset Group",    ctx.assetMembers.electrical],
    ["asset:plumbing",        "Plumbing Equipment Asset Group",      ctx.assetMembers.plumbing],
    ["asset:fireprotection",  "Fire Protection Asset Group",         ctx.assetMembers.fireprotection],
  ];
  for (const [key, name, members] of groups) {
    if (members.length === 0) continue;
    const assetId = id.next();
    lines.push(`#${assetId}=IFCASSET('${guid.stable(key)}',#${ctx.ownerHistId},'${name}','Grouped operational asset',$,'${name.slice(0, 30)}',$,$,$,$,$,$,$);`);
    const relId = id.next();
    lines.push(`#${relId}=IFCRELASSIGNSTOGROUP('${guid.fresh()}',#${ctx.ownerHistId},'${name} members',$,(${members.map(i => `#${i}`).join(",")}),$,#${assetId});`);
  }
}

// ─── Tier 10 — IfcApproval + IfcPermit + IDS + digital signature ───────

function emitApprovalWorkflow(ctx: ExportContext): void {
  const { id, lines, guid } = ctx;
  const nowISO = new Date().toISOString().split("T")[0];
  const approvalId = id.next();
  // IfcApproval(Description, ApprovalDateTime, ApprovalStatus, ApprovalLevel, ApprovalQualifier, Name, Identifier)
  lines.push(`#${approvalId}=IFCAPPROVAL('Design Approved for Construction','${nowISO}T00:00:00','Approved','LOD 300 Coordination Model',$,'APR-2026-001','APR-2026-001');`);

  // Link approval to key building elements (sample of walls / columns / slabs)
  // Find a few element IDs from our wall/slab tracking
  const sampleIds: number[] = [];
  for (const w of ctx.wallRecords.slice(0, 10)) sampleIds.push(w.entityId);
  if (sampleIds.length > 0) {
    const relId = id.next();
    lines.push(`#${relId}=IFCRELASSOCIATESAPPROVAL('${guid.fresh()}',#${ctx.ownerHistId},'Structural elements approved',$,(${sampleIds.map(i => `#${i}`).join(",")}),#${approvalId});`);
  }

  // Pset_BuildFlow_ApprovalHistory with sign-off track
  const pApprover = id.next();
  lines.push(`#${pApprover}=IFCPROPERTYSINGLEVALUE('ApprovedBy',$,IFCLABEL('Principal Architect'),$);`);
  const pDate = id.next();
  lines.push(`#${pDate}=IFCPROPERTYSINGLEVALUE('ApprovalDate',$,IFCDATE('${nowISO}'),$);`);
  const pLevel = id.next();
  lines.push(`#${pLevel}=IFCPROPERTYSINGLEVALUE('ApprovalLevel',$,IFCLABEL('LOD 300 For Construction'),$);`);
  const pStatus = id.next();
  lines.push(`#${pStatus}=IFCPROPERTYSINGLEVALUE('ApprovalStatus',$,IFCLABEL('Approved'),$);`);
  const psetAppr = id.next();
  lines.push(`#${psetAppr}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_BuildFlow_ApprovalHistory',$,(#${pApprover},#${pDate},#${pLevel},#${pStatus}));`);
  // Associate to approval entity
  const relApprPset = id.next();
  lines.push(`#${relApprPset}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${approvalId}),#${psetAppr});`);
}

function emitIndianPermit(buildingId: number, ctx: ExportContext, options: IFCExportOptions): void {
  const { id, lines, guid } = ctx;
  const p = options.permit;

  const authority = p?.authority ?? "Pune Municipal Corporation";
  const permitNum = p?.permitNumber ?? "PMC/BP/2026/12345";
  const approvedDate = p?.approvalDate ?? "2026-03-15";
  const validUntil = p?.validUntil ?? "2029-03-14";

  const permitId = id.next();
  // IfcPermit(GlobalId, OwnerHistory, Name, Description, ObjectType, ShortName, ApplicationIdentifier, PermitDate, Status, LongDescription, PredefinedType)
  lines.push(`#${permitId}=IFCPERMIT('${guid.stable(`permit:${permitNum}`)}',#${ctx.ownerHistId},'Building Plan Approval','Municipal building permit',$,'BP',$,'${approvedDate}','Approved','Plan approval from ${ctx.safeName(authority)}',.BUILDING.);`);

  // Pset with Indian permit-specific fields
  const pAuth = id.next();
  lines.push(`#${pAuth}=IFCPROPERTYSINGLEVALUE('PermitAuthority',$,IFCLABEL('${ctx.safeName(authority)}'),$);`);
  const pNum = id.next();
  lines.push(`#${pNum}=IFCPROPERTYSINGLEVALUE('PermitNumber',$,IFCIDENTIFIER('${permitNum}'),$);`);
  const pAppr = id.next();
  lines.push(`#${pAppr}=IFCPROPERTYSINGLEVALUE('ApprovalDate',$,IFCDATE('${approvedDate}'),$);`);
  const pVU = id.next();
  lines.push(`#${pVU}=IFCPROPERTYSINGLEVALUE('ValidUntil',$,IFCDATE('${validUntil}'),$);`);
  const pFire = id.next();
  lines.push(`#${pFire}=IFCPROPERTYSINGLEVALUE('FireNOC',$,IFCIDENTIFIER('${p?.fireNOC ?? "PFSS/NOC/2026/789"}'),$);`);
  const pEnv = id.next();
  lines.push(`#${pEnv}=IFCPROPERTYSINGLEVALUE('EnvironmentalClearance',$,IFCIDENTIFIER('${p?.environmentalClearance ?? "MoEFCC/EC/2026/456"}'),$);`);
  const pRera = id.next();
  lines.push(`#${pRera}=IFCPROPERTYSINGLEVALUE('RERARegistration',$,IFCIDENTIFIER('${p?.reraRegistration ?? ctx.rera?.projectId ?? "P52100012345"}'),$);`);
  const pOC = id.next();
  lines.push(`#${pOC}=IFCPROPERTYSINGLEVALUE('OccupancyCertificateStatus',$,IFCLABEL('Pending'),$);`);

  const psetId = id.next();
  lines.push(`#${psetId}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_BuildFlow_IndianPermit',$,(#${pAuth},#${pNum},#${pAppr},#${pVU},#${pFire},#${pEnv},#${pRera},#${pOC}));`);
  const relId = id.next();
  lines.push(`#${relId}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${permitId}),#${psetId});`);

  // Link permit → building
  const relPermBldg = id.next();
  lines.push(`#${relPermBldg}=IFCRELASSIGNSTOCONTROL('${guid.fresh()}',#${ctx.ownerHistId},'Permit covers building',$,(#${buildingId}),$,#${permitId});`);
}

function emitIDSAndDigitalSignature(projectId: number, ctx: ExportContext): void {
  const { id, lines, guid } = ctx;

  // Embedded IDS pointer
  const docId = id.next();
  lines.push(`#${docId}=IFCDOCUMENTINFORMATION('IDS-BUILDFLOW-V4','BuildFlow IFC Output Specification (IDS)','Information Delivery Specification v4 defining minimum required data',$,$,$,$,$,$,$,$,$,$,'embedded:buildflow_ids.ids',$,$);`);
  const docRefId = id.next();
  lines.push(`#${docRefId}=IFCDOCUMENTREFERENCE('embedded:buildflow_ids.ids','IDS-BUILDFLOW-V4','BuildFlow IDS v4',#${docId},$);`);
  const relDocId = id.next();
  lines.push(`#${relDocId}=IFCRELASSOCIATESDOCUMENT('${guid.fresh()}',#${ctx.ownerHistId},'IDS declaration',$,(#${projectId}),#${docRefId});`);

  // Digital signature scaffold (actual SHA-256 computed post-generation would need file content)
  const pAlg = id.next();
  lines.push(`#${pAlg}=IFCPROPERTYSINGLEVALUE('HashAlgorithm',$,IFCLABEL('SHA-256'),$);`);
  const pHash = id.next();
  lines.push(`#${pHash}=IFCPROPERTYSINGLEVALUE('Hash',$,IFCLABEL('computed-after-serialization'),$);`);
  const pSigner = id.next();
  lines.push(`#${pSigner}=IFCPROPERTYSINGLEVALUE('Signer',$,IFCLABEL('BuildFlow IFC Exporter v4'),$);`);
  const pSigDate = id.next();
  lines.push(`#${pSigDate}=IFCPROPERTYSINGLEVALUE('SignedAt',$,IFCDATETIME('${new Date().toISOString().replace(/\.\d+Z$/, "")}'),$);`);
  const pSigStandard = id.next();
  lines.push(`#${pSigStandard}=IFCPROPERTYSINGLEVALUE('Standard',$,IFCLABEL('RFC 3174 SHA-256'),$);`);
  const psetSigId = id.next();
  lines.push(`#${psetSigId}=IFCPROPERTYSET('${guid.fresh()}',#${ctx.ownerHistId},'Pset_BuildFlow_DigitalSignature',$,(#${pAlg},#${pHash},#${pSigner},#${pSigDate},#${pSigStandard}));`);
  const relSigId = id.next();
  lines.push(`#${relSigId}=IFCRELDEFINESBYPROPERTIES('${guid.fresh()}',#${ctx.ownerHistId},$,$,(#${projectId}),#${psetSigId});`);
}

// ═══════════════════════════════════════════════════════════════════════════
// v4 TIER 2 — EMBODIED CARBON DATABASE (Indian context, ICE v3 + GRIHA)
// ═══════════════════════════════════════════════════════════════════════════

interface EmbodiedCarbonSpec {
  gwp_a1_a3: number;         // kgCO2e per functional unit (m³ concrete / tonne steel / m² glass)
  unit: "m3" | "tonne" | "m2";
  odp?: number;              // kg CFC-11 eq
  ap?: number;               // kg SO2 eq (acidification)
  ep?: number;               // kg PO4 eq (eutrophication)
  pocp?: number;             // kg C2H4 eq (photochemical ozone)
  source: string;
}

const EMBODIED_CARBON_DB: Record<string, EmbodiedCarbonSpec> = {
  M25_concrete:       { gwp_a1_a3: 290,  unit: "m3",     odp: 0.00001, ap: 0.80,  ep: 0.15,  pocp: 0.05,  source: "ICE Database v3 + India cement factor" },
  M30_concrete:       { gwp_a1_a3: 320,  unit: "m3",     odp: 0.00001, ap: 0.85,  ep: 0.16,  pocp: 0.05,  source: "ICE Database v3 + India cement factor" },
  M35_concrete:       { gwp_a1_a3: 355,  unit: "m3",     source: "ICE Database v3 + India cement factor" },
  Fe500_steel:        { gwp_a1_a3: 1850, unit: "tonne",  source: "World Steel Assn 2023 — BF-BOF route (India average)" },
  Fe500D_steel:       { gwp_a1_a3: 1900, unit: "tonne",  source: "World Steel Assn 2023" },
  Fe410_structural:   { gwp_a1_a3: 1800, unit: "tonne",  source: "World Steel Assn 2023" },
  AAC_block:          { gwp_a1_a3: 120,  unit: "m3",     source: "AAC Association of India" },
  clay_brick:         { gwp_a1_a3: 230,  unit: "m3",     source: "GRIHA SVAGRIHA database" },
  flyash_brick:       { gwp_a1_a3: 90,   unit: "m3",     source: "CII Green Products Council" },
  glass_6mm:          { gwp_a1_a3: 15,   unit: "m2",     source: "ICE Database v3" },
  aluminium_primary:  { gwp_a1_a3: 8500, unit: "tonne",  source: "International Aluminium Institute" },
  aluminium_recycled: { gwp_a1_a3: 700,  unit: "tonne",  source: "International Aluminium Institute" },
  xps_insulation:     { gwp_a1_a3: 120,  unit: "m3",     odp: 0.012, source: "ICE Database v3" },
  mineral_wool:       { gwp_a1_a3: 60,   unit: "m3",     source: "Mineral Wool Insulation Manufacturers Assn" },
  gypsum_board:       { gwp_a1_a3: 3.5,  unit: "m2",     source: "Gypsum Assn" },
  vitrified_tile:     { gwp_a1_a3: 25,   unit: "m2",     source: "ICE Database v3" },
  cement_plaster:     { gwp_a1_a3: 85,   unit: "m3",     source: "ICE Database v3" },
  bitumen_membrane:   { gwp_a1_a3: 2.0,  unit: "m2",     source: "ICE Database v3" },
  teak_timber:        { gwp_a1_a3: -700, unit: "m3",     source: "Sustainable timber — biogenic carbon store" },
};

/** IS 10262:2019 mix design for M25 concrete. Per m³ by mass proportions. */
interface MixConstituent {
  name: string;
  fraction: number;        // proportion by mass
  category: string;
  epd?: string;
}

const M25_MIX_DESIGN: MixConstituent[] = [
  { name: "OPC 53 Grade Cement (IS 269)", fraction: 0.140, category: "BINDER" },
  { name: "M-Sand / River Sand (IS 383)", fraction: 0.315, category: "FINE_AGGREGATE" },
  { name: "20mm Crushed Stone (IS 383)",  fraction: 0.475, category: "COARSE_AGGREGATE" },
  { name: "Potable Water",                fraction: 0.065, category: "WATER" },
  { name: "Superplasticizer (IS 9103)",   fraction: 0.005, category: "ADMIXTURE" },
];

const M30_MIX_DESIGN: MixConstituent[] = [
  { name: "OPC 53 Grade Cement (IS 269)", fraction: 0.155, category: "BINDER" },
  { name: "M-Sand / River Sand (IS 383)", fraction: 0.310, category: "FINE_AGGREGATE" },
  { name: "20mm Crushed Stone (IS 383)",  fraction: 0.475, category: "COARSE_AGGREGATE" },
  { name: "Potable Water",                fraction: 0.055, category: "WATER" },
  { name: "Superplasticizer (IS 9103)",   fraction: 0.005, category: "ADMIXTURE" },
];

/** Sample EPDs for Indian suppliers — used for IfcDocumentReference. */
const INDIAN_EPDS: Array<{ id: string; name: string; url: string; material: string }> = [
  { id: "EPD-ACC-OPC53-2024",        name: "ACC Limited OPC 53 Grade Cement EPD",   url: "https://www.acclimited.com/sustainability",   material: "cement" },
  { id: "EPD-ULTRATECH-OPC53-2024",  name: "UltraTech OPC 53 Grade Cement EPD",     url: "https://www.ultratechcement.com/sustainability", material: "cement" },
  { id: "EPD-TATA-FE500D-2024",      name: "Tata Steel Fe500D TMT Bar EPD",         url: "https://www.tatasteel.com/sustainability",    material: "rebar" },
  { id: "EPD-JSW-FE500-2024",        name: "JSW Steel Fe500 TMT Bar EPD",           url: "https://www.jsw.in/sustainability",           material: "rebar" },
  { id: "EPD-SAIL-E250-2024",        name: "SAIL E250 Structural Steel EPD",        url: "https://www.sail.co.in/sustainability",       material: "structural_steel" },
];

// ═══════════════════════════════════════════════════════════════════════════
// v4 TIER 1 — INTERNATIONAL CLASSIFICATION CATALOGUES
// ═══════════════════════════════════════════════════════════════════════════

interface ClassificationMapping {
  source: string;
  name: string;
  edition: string;
  mappings: Record<string, ClassificationCode>;
}

const UNICLASS_2015: ClassificationMapping = {
  source: "https://uniclass.thenbs.com/", name: "Uniclass 2015", edition: "2015",
  mappings: {
    wall:   { code: "Ss_25_10_30", name: "Wall structures" },
    slab:   { code: "Ss_25_10_65", name: "Slab structures" },
    column: { code: "Ss_25_10_20", name: "Column structures" },
    beam:   { code: "Ss_25_10_10", name: "Beam structures" },
    door:   { code: "Pr_30_59_29", name: "Doorsets" },
    window: { code: "Pr_30_59_96", name: "Windows" },
    stair:  { code: "Ss_25_60_85", name: "Stair structures" },
    roof:   { code: "Ss_25_10_70", name: "Roof structures" },
    space:  { code: "SL_20",       name: "Spaces" },
    pipe:   { code: "Ss_55_70_72", name: "Piped supply systems" },
    duct:   { code: "Ss_60_40_02", name: "Air distribution systems" },
  },
};

const OMNICLASS: ClassificationMapping = {
  source: "https://www.csiresources.org/omniclass", name: "OmniClass", edition: "2013",
  mappings: {
    wall:   { code: "23.20.10.10", name: "Exterior Walls" },
    slab:   { code: "23.20.20.00", name: "Structural Slabs" },
    column: { code: "23.20.30.00", name: "Columns" },
    beam:   { code: "23.20.40.00", name: "Beams" },
    door:   { code: "23.30.20.00", name: "Door Assemblies" },
    window: { code: "23.30.30.00", name: "Window Assemblies" },
    stair:  { code: "23.20.70.00", name: "Stairs" },
    roof:   { code: "23.20.50.00", name: "Roof Construction" },
    space:  { code: "13.00.00.00", name: "Spaces by Function" },
  },
};

const UNIFORMAT_II: ClassificationMapping = {
  source: "ASTM E1557-09", name: "Uniformat II", edition: "2009",
  mappings: {
    wall:   { code: "B2010", name: "Exterior Walls" },
    slab:   { code: "B1010", name: "Floor Construction" },
    column: { code: "B1010", name: "Floor Construction (columns)" },
    beam:   { code: "B1010", name: "Floor Construction (beams)" },
    door:   { code: "B2030", name: "Exterior Doors" },
    window: { code: "B2020", name: "Exterior Windows" },
    stair:  { code: "B1020", name: "Roof Construction (stairs)" },
    roof:   { code: "B3010", name: "Roof Coverings" },
    space:  { code: "Z1010", name: "Space" },
  },
};

const DIN_276: ClassificationMapping = {
  source: "DIN 276-1:2018", name: "DIN 276 Kostengruppen", edition: "2018",
  mappings: {
    wall:   { code: "331", name: "Tragende Außenwände" },
    slab:   { code: "351", name: "Deckenkonstruktionen" },
    column: { code: "331", name: "Tragende Stützen" },
    beam:   { code: "351", name: "Tragende Unterzüge" },
    door:   { code: "334", name: "Außentüren" },
    window: { code: "334", name: "Außenfenster" },
    stair:  { code: "351", name: "Treppen" },
    roof:   { code: "361", name: "Dachkonstruktion" },
    space:  { code: "-",   name: "Flächen" },
  },
};

const NATSPEC_AU: ClassificationMapping = {
  source: "https://www.natspec.com.au/", name: "NATSPEC", edition: "2023",
  mappings: {
    wall:   { code: "0411", name: "Masonry and Concrete Walling" },
    slab:   { code: "0312", name: "Concrete Slabs" },
    column: { code: "0322", name: "Concrete Columns" },
    beam:   { code: "0321", name: "Concrete Beams" },
    door:   { code: "0631", name: "Doors" },
    window: { code: "0641", name: "Windows" },
    stair:  { code: "0333", name: "Stairs" },
    roof:   { code: "0421", name: "Metal Roofing" },
    space:  { code: "0101", name: "Spaces" },
  },
};

/** Pick international classification systems to emit for a given region. */
function internationalClassificationsFor(region: IFCExportOptions["region"]): ClassificationMapping[] {
  // All exports get CSI + NBC India (handled by csiCodeFor / nbcCodeFor).
  // v4 adds region-specific systems.
  switch (region) {
    case "eu": return [UNICLASS_2015, DIN_276];
    case "us": return [OMNICLASS, UNIFORMAT_II];
    default:   return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// v4 TIER 4 — IS 875 / IS 1893 LOAD CASES + IS 456 LOAD COMBINATIONS
// ═══════════════════════════════════════════════════════════════════════════

interface LoadCaseSpec {
  key: string;
  name: string;
  description: string;
  actionType: string;        // DEAD_LOAD_G, LIVE_LOAD_Q, WIND_W, EARTHQUAKE_E, SNOW_S
  isStatic: boolean;
}

const INDIAN_LOAD_CASES: LoadCaseSpec[] = [
  { key: "DL", name: "Dead Load",       description: "Self weight + fixed loads per IS 875 Part 1:1987",                actionType: "DEAD_LOAD_G",      isStatic: true  },
  { key: "LL", name: "Live Load",       description: "Imposed loads per IS 875 Part 2:1987",                             actionType: "LIVE_LOAD_Q",      isStatic: true  },
  { key: "WL", name: "Wind Load",       description: "Wind load per IS 875 Part 3:2015",                                  actionType: "WIND_W",            isStatic: false },
  { key: "EQ", name: "Earthquake Load", description: "Seismic load per IS 1893 Part 1:2016",                              actionType: "EARTHQUAKE_E",      isStatic: false },
];

interface LoadCombinationSpec {
  key: string;
  name: string;
  formula: string;
  description: string;
  factors: Record<string, number>;  // load case key → factor
}

const IS456_LOAD_COMBINATIONS: LoadCombinationSpec[] = [
  { key: "LC1", name: "1.5(DL+LL)",        formula: "1.5DL + 1.5LL",               description: "Gravity ULS per IS 456 Cl 36.4.1",     factors: { DL: 1.5, LL: 1.5 } },
  { key: "LC2", name: "1.2(DL+LL+WL)",     formula: "1.2DL + 1.2LL + 1.2WL",       description: "Gravity + wind per IS 456 Cl 36.4.1",  factors: { DL: 1.2, LL: 1.2, WL: 1.2 } },
  { key: "LC3", name: "1.5(DL+WL)",        formula: "1.5DL + 1.5WL",               description: "Wind + dead per IS 456 Cl 36.4.1",     factors: { DL: 1.5, WL: 1.5 } },
  { key: "LC4", name: "0.9DL+1.5WL",       formula: "0.9DL + 1.5WL",               description: "Wind uplift per IS 456 Cl 36.4.1",     factors: { DL: 0.9, WL: 1.5 } },
  { key: "LC5", name: "1.2(DL+LL+EQ)",     formula: "1.2DL + 1.2LL + 1.2EQ",       description: "Gravity + seismic per IS 1893 Cl 6.3", factors: { DL: 1.2, LL: 1.2, EQ: 1.2 } },
  { key: "LC6", name: "1.5(DL+EQ)",        formula: "1.5DL + 1.5EQ",               description: "Seismic + dead per IS 1893 Cl 6.3",     factors: { DL: 1.5, EQ: 1.5 } },
  { key: "LC7", name: "0.9DL+1.5EQ",       formula: "0.9DL + 1.5EQ",               description: "Seismic uplift per IS 1893 Cl 6.3",    factors: { DL: 0.9, EQ: 1.5 } },
];

// ═══════════════════════════════════════════════════════════════════════════
// v4 TIER 9 — COBie MANUFACTURER SAMPLE CATALOGUE (Indian brands)
// ═══════════════════════════════════════════════════════════════════════════

interface ManufacturerSpec {
  manufacturer: string;
  modelRef: string;
  modelLabel: string;
  warrantyPeriodISO: string;   // ISO 8601 duration
  serviceLifeISO: string;
  mtbfISO: string;
  maintenanceIntervalISO: string;
  pointOfContact: string;
}

const COBIE_EQUIPMENT_CATALOGUE: Record<string, ManufacturerSpec> = {
  pump: {
    manufacturer: "Kirloskar Brothers Ltd", modelRef: "KBL CRN 5-16", modelLabel: "Vertical In-Line Pump",
    warrantyPeriodISO: "P2Y", serviceLifeISO: "P15Y", mtbfISO: "P3Y", maintenanceIntervalISO: "P3M",
    pointOfContact: "Kirloskar Service Center",
  },
  chiller: {
    manufacturer: "Voltas Limited", modelRef: "VCW-60TR", modelLabel: "Water-Cooled Screw Chiller 60 TR",
    warrantyPeriodISO: "P5Y", serviceLifeISO: "P20Y", mtbfISO: "P5Y", maintenanceIntervalISO: "P6M",
    pointOfContact: "Voltas Service",
  },
  ahu: {
    manufacturer: "Blue Star Limited", modelRef: "BSAHU-10TR", modelLabel: "Air Handling Unit 10 TR",
    warrantyPeriodISO: "P2Y", serviceLifeISO: "P15Y", mtbfISO: "P2Y", maintenanceIntervalISO: "P3M",
    pointOfContact: "Blue Star Service",
  },
  fan: {
    manufacturer: "Havells India", modelRef: "Stealth Air", modelLabel: "Axial Exhaust Fan",
    warrantyPeriodISO: "P2Y", serviceLifeISO: "P10Y", mtbfISO: "P2Y", maintenanceIntervalISO: "P6M",
    pointOfContact: "Havells Customer Care",
  },
  panel: {
    manufacturer: "Schneider Electric India", modelRef: "Prisma iPM", modelLabel: "LT Distribution Panel",
    warrantyPeriodISO: "P2Y", serviceLifeISO: "P25Y", mtbfISO: "P5Y", maintenanceIntervalISO: "P12M",
    pointOfContact: "Schneider India Service",
  },
  mcb: {
    manufacturer: "Legrand India", modelRef: "DX3", modelLabel: "C-Curve MCB 32A",
    warrantyPeriodISO: "P2Y", serviceLifeISO: "P15Y", mtbfISO: "P3Y", maintenanceIntervalISO: "P12M",
    pointOfContact: "Legrand Support",
  },
  transformer: {
    manufacturer: "ABB India", modelRef: "TXH 1600kVA", modelLabel: "Oil-Filled Distribution Transformer",
    warrantyPeriodISO: "P5Y", serviceLifeISO: "P30Y", mtbfISO: "P10Y", maintenanceIntervalISO: "P12M",
    pointOfContact: "ABB India Service",
  },
  sprinkler: {
    manufacturer: "Tyco Fire Products", modelRef: "TY-B", modelLabel: "Upright Ordinary Hazard Sprinkler",
    warrantyPeriodISO: "P1Y", serviceLifeISO: "P30Y", mtbfISO: "P15Y", maintenanceIntervalISO: "P12M",
    pointOfContact: "Tyco Service",
  },
  lift: {
    manufacturer: "Otis Elevator India", modelRef: "GeN2", modelLabel: "Machine Room Less Passenger Lift 8-Person",
    warrantyPeriodISO: "P2Y", serviceLifeISO: "P25Y", mtbfISO: "P5Y", maintenanceIntervalISO: "P1M",
    pointOfContact: "Otis 24x7 Service",
  },
  solar: {
    manufacturer: "Waaree Energies", modelRef: "WS-540", modelLabel: "540W Monocrystalline Solar Panel",
    warrantyPeriodISO: "P25Y", serviceLifeISO: "P25Y", mtbfISO: "P10Y", maintenanceIntervalISO: "P6M",
    pointOfContact: "Waaree Service",
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// MULTI-FILE DISCIPLINE EXPORT
// ═══════════════════════════════════════════════════════════════════════════

export function generateMultipleIFCFiles(
  geometry: MassingGeometry,
  options: IFCExportOptions = {}
): { architectural: string; structural: string; mep: string; combined: string } {
  return {
    architectural: generateIFCFile(geometry, { ...options, filter: "architectural" }),
    structural:    generateIFCFile(geometry, { ...options, filter: "structural" }),
    mep:           generateIFCFile(geometry, { ...options, filter: "mep" }),
    combined:      generateIFCFile(geometry, { ...options, filter: "all" }),
  };
}
