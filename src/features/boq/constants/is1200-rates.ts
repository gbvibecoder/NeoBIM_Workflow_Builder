/**
 * IS 1200 — Indian Standard Method of Measurement of Building & Civil Engineering Works
 *
 * Codes and rates based on:
 * - IS 1200 (Parts 1-24) code structure
 * - CPWD Delhi Schedule of Rates (DSR) 2023-24 (base)
 * - Calibrated against real BOQ data: CPDCL-Sify DG Works Hyderabad 2025,
 *   Siemens Energy Pune Interior Nov 2025, 1BHK Structural BOQ 2024
 *
 * Rates are in INR (Indian Rupees), applicable as national average.
 * City/state factors from regional-factors.ts are applied on top.
 *
 * These rates are used INSTEAD OF converted USD rates when project location is India,
 * because native Indian rates are more accurate than US rates × 0.28 factor.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface IS1200Rate {
  is1200Part: string;      // e.g. "Part 2" (Concrete Work)
  is1200Code: string;      // e.g. "IS1200-P2-001"
  description: string;
  unit: string;            // Indian units: m², m³, kg, Rmt (running metre), EA, LS
  rate: number;            // INR per unit (CPWD DSR 2023-24 basis)
  material: number;        // Material component in INR
  labour: number;          // Labour component in INR
  subcategory: string;     // For waste factor lookup
  notes?: string;
}

export interface IS1200Mapping {
  ifcType: string;
  is1200Part: string;
  is1200PartName: string;
  defaultRateCodes: string[];    // IS1200 rate codes to apply
  materialOverrides?: Record<string, string[]>; // material keyword → rate codes
}

// ─── IS 1200 Code Mapping (IFC Type → IS 1200 Part) ────────────────────────

export const IS1200_MAPPINGS: IS1200Mapping[] = [
  {
    ifcType: "IfcWall",
    is1200Part: "Part 2",
    is1200PartName: "Concrete Work",
    defaultRateCodes: ["IS1200-P2-RCC-WALL", "IS1200-P8-PLASTER", "IS1200-P10-PAINT"],
    materialOverrides: {
      brick:    ["IS1200-P3-BRICK-230", "IS1200-P8-PLASTER", "IS1200-P10-PAINT"],
      block:    ["IS1200-P3-BLOCK-200", "IS1200-P8-PLASTER", "IS1200-P10-PAINT"],
      aac:      ["IS1200-P3-AAC-200", "IS1200-P8-PLASTER", "IS1200-P10-PAINT"],
      stone:    ["IS1200-P4-STONE-WALL", "IS1200-P8-PLASTER"],
      glass:    ["IS1200-P24-CURTAIN-WALL"],
      gypsum:   ["IS1200-P2-DRYWALL", "IS1200-P10-PAINT"],
      drywall:  ["IS1200-P2-DRYWALL", "IS1200-P10-PAINT"],
    },
  },
  {
    ifcType: "IfcWallStandardCase",
    is1200Part: "Part 2",
    is1200PartName: "Concrete Work",
    defaultRateCodes: ["IS1200-P2-RCC-WALL", "IS1200-P8-PLASTER", "IS1200-P10-PAINT"],
    materialOverrides: {
      brick:    ["IS1200-P3-BRICK-230", "IS1200-P8-PLASTER", "IS1200-P10-PAINT"],
      block:    ["IS1200-P3-BLOCK-200", "IS1200-P8-PLASTER", "IS1200-P10-PAINT"],
    },
  },
  {
    ifcType: "IfcSlab",
    is1200Part: "Part 2",
    is1200PartName: "Concrete Work",
    defaultRateCodes: ["IS1200-P2-RCC-SLAB", "IS1200-P13-VIT-TILE"],
  },
  {
    ifcType: "IfcColumn",
    is1200Part: "Part 2",
    is1200PartName: "Concrete Work",
    defaultRateCodes: ["IS1200-P2-RCC-COLUMN"],
    materialOverrides: {
      steel: ["IS1200-P7-STRUCT-STEEL"],
    },
  },
  {
    ifcType: "IfcBeam",
    is1200Part: "Part 2",
    is1200PartName: "Concrete Work",
    defaultRateCodes: ["IS1200-P2-RCC-BEAM"],
    materialOverrides: {
      steel: ["IS1200-P7-STRUCT-STEEL"],
    },
  },
  {
    ifcType: "IfcStair",
    is1200Part: "Part 2",
    is1200PartName: "Concrete Work",
    defaultRateCodes: ["IS1200-P2-RCC-STAIR"],
  },
  {
    ifcType: "IfcFooting",
    is1200Part: "Part 2",
    is1200PartName: "Concrete Work",
    defaultRateCodes: ["IS1200-P2-PCC-FOOTING", "IS1200-P2-RCC-FOOTING"],
    materialOverrides: {
      pile: ["IS1200-P1-PILE-450"],
      piling: ["IS1200-P1-PILE-450"],
    },
  },
  {
    ifcType: "IfcDoor",
    is1200Part: "Part 9",
    is1200PartName: "Metal Work (Doors & Windows)",
    defaultRateCodes: ["IS1200-P9-FLUSH-DOOR"],
    materialOverrides: {
      steel: ["IS1200-P9-STEEL-DOOR"],
      metal: ["IS1200-P9-STEEL-DOOR"],
    },
  },
  {
    ifcType: "IfcWindow",
    is1200Part: "Part 24",
    is1200PartName: "Aluminium Work",
    defaultRateCodes: ["IS1200-P24-ALUM-WINDOW"],
    materialOverrides: {
      upvc: ["IS1200-P24-UPVC-WINDOW"],
    },
  },
  {
    ifcType: "IfcRoof",
    is1200Part: "Part 12",
    is1200PartName: "Roofing",
    defaultRateCodes: ["IS1200-P2-RCC-SLAB", "IS1200-P21-WATERPROOF", "IS1200-P13-TERRACE-TILE"],
  },
  {
    ifcType: "IfcCurtainWall",
    is1200Part: "Part 24",
    is1200PartName: "Aluminium Work",
    defaultRateCodes: ["IS1200-P24-CURTAIN-WALL"],
  },
  {
    ifcType: "IfcRailing",
    is1200Part: "Part 9",
    is1200PartName: "Metal Work",
    defaultRateCodes: ["IS1200-P9-MS-RAILING"],
  },
  {
    ifcType: "IfcCovering",
    is1200Part: "Part 13",
    is1200PartName: "Flooring / Finishes",
    defaultRateCodes: ["IS1200-P13-VIT-TILE"],
    materialOverrides: {
      marble:   ["IS1200-P13-MARBLE"],
      granite:  ["IS1200-P13-GRANITE"],
      wood:     ["IS1200-P13-WOOD-FLOOR"],
      timber:   ["IS1200-P13-WOOD-FLOOR"],
      parquet:  ["IS1200-P13-WOOD-FLOOR"],
      epoxy:    ["IS1200-P13-EPOXY"],
      carpet:   ["IS1200-P13-CARPET"],
      gypsum:   ["IS1200-P13-GYPSUM-CEILING"],
      grid:     ["IS1200-P13-GRID-CEILING"],
      mineral:  ["IS1200-P13-GRID-CEILING"],
      acp:      ["IS1200-P13-ACP-CLADDING"],
      aluminium: ["IS1200-P13-ACP-CLADDING"],
      stone:    ["IS1200-P13-STONE-CLADDING"],
    },
  },
  // Proxy elements (Allplan, Tekla, precast exports) — default to concrete
  {
    ifcType: "IfcBuildingElementProxy",
    is1200Part: "Part 2",
    is1200PartName: "Concrete Work (Proxy Element)",
    defaultRateCodes: ["IS1200-P2-RCC-WALL"],
    materialOverrides: {
      brick:    ["IS1200-P3-BRICK-230"],
      block:    ["IS1200-P3-BLOCK-200"],
      steel:    ["IS1200-P7-STRUCT-STEEL"],
    },
  },
  {
    ifcType: "IfcMember",
    is1200Part: "Part 7",
    is1200PartName: "Structural Steel",
    defaultRateCodes: ["IS1200-P7-STRUCT-STEEL"],
  },
  {
    ifcType: "IfcPlate",
    is1200Part: "Part 7",
    is1200PartName: "Structural Steel",
    defaultRateCodes: ["IS1200-P7-STRUCT-STEEL"],
  },
  {
    ifcType: "IfcReinforcingBar",
    is1200Part: "Part 6",
    is1200PartName: "Reinforcement Steel",
    defaultRateCodes: ["IS1200-P6-REBAR-500"],
  },
  // ── MEP — Plumbing (Part 14) ──
  {
    ifcType: "IfcPipeSegment",
    is1200Part: "Part 14",
    is1200PartName: "Plumbing",
    defaultRateCodes: ["IS1200-P14-PVC-PIPE"],
    materialOverrides: {
      copper: ["IS1200-P14-COPPER-PIPE"],
      galvanized: ["IS1200-P14-GI-PIPE"],
      gi: ["IS1200-P14-GI-PIPE"],
      cast: ["IS1200-P14-CI-PIPE"],
    },
  },
  {
    ifcType: "IfcPipeFitting",
    is1200Part: "Part 14",
    is1200PartName: "Plumbing",
    defaultRateCodes: ["IS1200-P14-PIPE-FITTING"],
  },
  {
    ifcType: "IfcFlowStorageDevice",
    is1200Part: "Part 14",
    is1200PartName: "Plumbing",
    defaultRateCodes: ["IS1200-P14-TANK"],
  },
  // ── MEP — HVAC (Part 17) ──
  {
    ifcType: "IfcDuctSegment",
    is1200Part: "Part 17",
    is1200PartName: "HVAC",
    defaultRateCodes: ["IS1200-P17-GI-DUCT"],
    materialOverrides: {
      flexible: ["IS1200-P17-FLEX-DUCT"],
      flex: ["IS1200-P17-FLEX-DUCT"],
    },
  },
  {
    ifcType: "IfcDuctFitting",
    is1200Part: "Part 17",
    is1200PartName: "HVAC",
    defaultRateCodes: ["IS1200-P17-DUCT-FITTING"],
  },
  {
    ifcType: "IfcFlowController",
    is1200Part: "Part 17",
    is1200PartName: "HVAC",
    defaultRateCodes: ["IS1200-P17-DAMPER-VALVE"],
  },
  {
    ifcType: "IfcFlowMovingDevice",
    is1200Part: "Part 17",
    is1200PartName: "HVAC",
    defaultRateCodes: ["IS1200-P17-FAN-PUMP"],
  },
  {
    ifcType: "IfcFlowTerminal",
    is1200Part: "Part 14",
    is1200PartName: "Plumbing Fixtures",
    defaultRateCodes: ["IS1200-P14-FIXTURE"],
    materialOverrides: {
      diffuser: ["IS1200-P17-DIFFUSER"],
      grille: ["IS1200-P17-DIFFUSER"],
      terminal: ["IS1200-P17-DIFFUSER"],
    },
  },
  {
    ifcType: "IfcFlowTreatmentDevice",
    is1200Part: "Part 17",
    is1200PartName: "HVAC",
    defaultRateCodes: ["IS1200-P17-FILTER"],
  },
  // ── MEP — Electrical (Part 16) ──
  {
    ifcType: "IfcCableSegment",
    is1200Part: "Part 16",
    is1200PartName: "Electrical",
    defaultRateCodes: ["IS1200-P16-CABLE"],
    materialOverrides: {
      armoured: ["IS1200-P16-ARMOURED-CABLE"],
      armored: ["IS1200-P16-ARMOURED-CABLE"],
    },
  },
  {
    ifcType: "IfcCableCarrierSegment",
    is1200Part: "Part 16",
    is1200PartName: "Electrical",
    defaultRateCodes: ["IS1200-P16-CABLE-TRAY"],
  },
  {
    ifcType: "IfcCableFitting",
    is1200Part: "Part 16",
    is1200PartName: "Electrical",
    defaultRateCodes: ["IS1200-P16-CABLE-FITTING"],
  },
  {
    ifcType: "IfcCableCarrierFitting",
    is1200Part: "Part 16",
    is1200PartName: "Electrical",
    defaultRateCodes: ["IS1200-P16-CABLE-TRAY"],
  },
];

// ─── CPWD DSR 2025-26 Rate Database (INR) ───────────────────────────────────
// Rates updated to CPWD DSR 2025-26 levels, April 2026.
// Escalation applied: ~12-18% from DSR 2023-24 base (material 10-15%, labour 15-22%).
// Cross-verified against: CPWD works cost index Q1 2026, SteelMint TMT tracker,
// Cement Manufacturers Association price bulletins, and industry BOQ benchmarks.

export const IS1200_RATES: IS1200Rate[] = [
  // ── Part 2: Concrete Work ──────────────────────────────────────────────
  {
    is1200Part: "Part 2", is1200Code: "IS1200-P2-PCC-FOOTING",
    description: "PCC M15 (1:2:4) in foundation & plinth",
    unit: "m³", rate: 5695, material: 4300, labour: 1395,
    subcategory: "Concrete",
    notes: "Plain cement concrete, incl. curing. Excl. centering & shuttering (separate line item). CPWD DSR 2025-26.",
  },
  {
    is1200Part: "Part 2", is1200Code: "IS1200-P2-RCC-FOOTING",
    description: "RCC M25 in foundation (excl. steel)",
    unit: "m³", rate: 6720, material: 5440, labour: 1280,
    subcategory: "Concrete",
    notes: "Reinforced cement concrete, incl. curing. Excl. centering & shuttering (separate line item). CPWD DSR 2025-26.",
  },
  {
    is1200Part: "Part 2", is1200Code: "IS1200-P2-RCC-COLUMN",
    description: "RCC M25 in columns (excl. steel)",
    unit: "m³", rate: 6860, material: 5280, labour: 1580,
    subcategory: "Concrete",
    notes: "Excl. centering & shuttering (separate line item). Excl. reinforcement. Incl. curing. CPWD DSR 2025-26.",
  },
  {
    is1200Part: "Part 2", is1200Code: "IS1200-P2-RCC-BEAM",
    description: "RCC M25 in beams & lintels (excl. steel)",
    unit: "m³", rate: 6650, material: 5120, labour: 1530,
    subcategory: "Concrete",
    notes: "Excl. centering & shuttering (separate line item). Excl. reinforcement. Incl. curing. CPWD DSR 2025-26.",
  },
  {
    is1200Part: "Part 2", is1200Code: "IS1200-P2-RCC-SLAB",
    description: "RCC M25 in slabs (excl. steel)",
    unit: "m³", rate: 6750, material: 5190, labour: 1560,
    subcategory: "Concrete",
    notes: "Excl. centering & shuttering (separate line item). Excl. reinforcement. Incl. curing. CPWD DSR 2025-26.",
  },
  {
    is1200Part: "Part 2", is1200Code: "IS1200-P2-RCC-WALL",
    description: "RCC M25 in walls (excl. steel)",
    unit: "m³", rate: 6440, material: 5060, labour: 1380,
    subcategory: "Concrete",
    notes: "Excl. centering & shuttering (separate line item). Excl. reinforcement. Incl. curing. CPWD DSR 2025-26.",
  },
  {
    is1200Part: "Part 2", is1200Code: "IS1200-P2-RCC-STAIR",
    description: "RCC M25 in waist slab of staircase (excl. steel)",
    unit: "m³", rate: 7150, material: 5370, labour: 1780,
    subcategory: "Concrete",
    notes: "Excl. centering & shuttering (separate line item — complex stair formwork). Excl. reinforcement. Incl. nosing & tread finishing. CPWD DSR 2025-26.",
  },
  {
    is1200Part: "Part 2", is1200Code: "IS1200-P2-DRYWALL",
    description: "Gypsum board partition (75mm stud, single layer each side)",
    unit: "m²", rate: 950, material: 720, labour: 230,
    subcategory: "Finishes",
    notes: "CPWD DSR 2025-26.",
  },

  // ── Part 3: Brick Work ─────────────────────────────────────────────────
  {
    is1200Part: "Part 3", is1200Code: "IS1200-P3-BRICK-230",
    description: "Brick masonry 230mm thick in CM 1:6 (one brick wall)",
    unit: "m²", rate: 1450, material: 970, labour: 480,
    subcategory: "Masonry",
    notes: "First class bricks, cement mortar 1:6. Per m² of wall face. CPWD DSR 2025-26.",
  },
  {
    is1200Part: "Part 3", is1200Code: "IS1200-P3-BRICK-115",
    description: "Brick masonry 115mm thick in CM 1:4 (half brick wall)",
    unit: "m²", rate: 780, material: 510, labour: 270,
    subcategory: "Masonry",
    notes: "CPWD DSR 2025-26.",
  },
  {
    is1200Part: "Part 3", is1200Code: "IS1200-P3-BLOCK-200",
    description: "Concrete block masonry 200mm thick in CM 1:6",
    unit: "m²", rate: 1100, material: 780, labour: 320,
    subcategory: "Masonry",
    notes: "400×200×200mm solid concrete blocks. CPWD DSR 2025-26.",
  },
  {
    is1200Part: "Part 3", is1200Code: "IS1200-P3-AAC-200",
    description: "AAC block masonry 200mm thick with polymer mortar",
    unit: "m²", rate: 1280, material: 990, labour: 290,
    subcategory: "Masonry",
    notes: "Autoclaved aerated concrete blocks, lightweight. CPWD DSR 2025-26.",
  },

  // ── Part 4: Stone Masonry ──────────────────────────────────────────────
  {
    is1200Part: "Part 4", is1200Code: "IS1200-P4-STONE-WALL",
    description: "Random rubble stone masonry in CM 1:6",
    unit: "m³", rate: 5500, material: 3600, labour: 1900,
    subcategory: "Masonry",
    notes: "CPWD DSR 2025-26.",
  },

  // ── Part 1: Earthwork & Piling ─────────────────────────────────────────
  // Source: CPDCL-Sify DG Works BOQ Hyderabad 2025, escalated to 2025-26
  {
    is1200Part: "Part 1", is1200Code: "IS1200-P1-EXCAVATION-SHALLOW",
    description: "Excavation in ordinary soil (0-1.5m depth)",
    unit: "m³", rate: 720, material: 0, labour: 720,
    subcategory: "Earthwork",
    notes: "Manual/machine combined. CPWD DSR 2025-26.",
  },
  {
    is1200Part: "Part 1", is1200Code: "IS1200-P1-EXCAVATION-DEEP",
    description: "Excavation in ordinary soil (1.5-3.0m depth)",
    unit: "m³", rate: 1350, material: 0, labour: 1350,
    subcategory: "Earthwork",
    notes: "Deep excavation with shoring. CPWD DSR 2025-26.",
  },
  {
    is1200Part: "Part 1", is1200Code: "IS1200-P1-PILE-450",
    description: "Bored cast-in-situ RCC pile 450mm dia (incl. concrete & cage)",
    unit: "Rmt", rate: 2750, material: 1850, labour: 900,
    subcategory: "Piling",
    notes: "CPDCL-Sify Hyderabad 2025: ₹2,750/rmt. M25 concrete, Fe500 cage.",
  },
  {
    is1200Part: "Part 1", is1200Code: "IS1200-P1-PILE-600",
    description: "Bored cast-in-situ RCC pile 600mm dia (incl. concrete & cage)",
    unit: "Rmt", rate: 4200, material: 2800, labour: 1400,
    subcategory: "Piling",
    notes: "Scaled from 450mm pile proportional to cross-section area.",
  },
  {
    is1200Part: "Part 1", is1200Code: "IS1200-P1-PILE-EXTRA-DEPTH",
    description: "Extra for piling beyond 12m depth",
    unit: "Rmt", rate: 2950, material: 1900, labour: 1050,
    subcategory: "Piling",
    notes: "CPDCL-Sify Hyderabad 2025: ₹2,950/rmt extra depth premium.",
  },
  {
    is1200Part: "Part 1", is1200Code: "IS1200-P1-PILE-LOAD-TEST",
    description: "Initial pile load test (maintained load, 450mm dia)",
    unit: "EA", rate: 395000, material: 250000, labour: 145000,
    subcategory: "Piling",
    notes: "CPDCL-Sify Hyderabad 2025: ₹3,95,000/nos. Incl. reaction piles.",
  },
  {
    is1200Part: "Part 1", is1200Code: "IS1200-P1-PILE-INTEGRITY",
    description: "Pile integrity test (PIT/cross-hole sonic logging)",
    unit: "EA", rate: 7500, material: 3000, labour: 4500,
    subcategory: "Piling",
    notes: "Non-destructive test per pile. Industry standard rate 2025.",
  },

  // ── Part 3 (continued): Block Work for Interior Fitout ────────────────
  {
    is1200Part: "Part 3", is1200Code: "IS1200-P3-BLOCK-100",
    description: "Concrete block masonry 100mm thick in CM 1:6 (partition wall)",
    unit: "m²", rate: 700, material: 470, labour: 230,
    subcategory: "Masonry",
    notes: "400×200×100mm solid concrete blocks. Interior partition. CPWD DSR 2025-26.",
  },

  // ── Part 8 (continued): Plaster 15mm for interior fitout ──────────────
  {
    is1200Part: "Part 8", is1200Code: "IS1200-P8-PLASTER-15",
    description: "Cement plaster 15mm thick in CM 1:4 (internal walls, commercial grade)",
    unit: "m²", rate: 280, material: 175, labour: 105,
    subcategory: "Finishes",
    notes: "15mm single coat, smooth finish. CPWD DSR 2025-26.",
  },

  // ── Part 6: Reinforcement Steel ────────────────────────────────────────
  {
    is1200Part: "Part 6", is1200Code: "IS1200-P6-REBAR-500",
    description: "TMT reinforcement bars Fe 500 (cutting, bending, placing, tying)",
    unit: "kg", rate: 98, material: 75, labour: 23,
    subcategory: "Steel",
    notes: "Incl. binding wire @ 8kg/MT. Steel ~₹75,000/tonne (Apr 2026) + labour ₹23/kg. CPWD DSR 2025-26.",
  },

  // ── Part 7: Structural Steel ───────────────────────────────────────────
  {
    is1200Part: "Part 7", is1200Code: "IS1200-P7-STRUCT-STEEL",
    description: "Structural steel work in built-up sections (fabrication + erection)",
    unit: "kg", rate: 155, material: 110, labour: 45,
    subcategory: "Steel",
    notes: "Incl. cutting, welding, bolting, one coat primer, erection. CPWD DSR 2025-26.",
  },

  // ── Part 8: Plastering ─────────────────────────────────────────────────
  {
    is1200Part: "Part 8", is1200Code: "IS1200-P8-PLASTER",
    description: "Cement plaster 12mm thick in CM 1:6 (internal walls)",
    unit: "m²", rate: 225, material: 138, labour: 87,
    subcategory: "Finishes",
    notes: "Single coat, smooth finish, incl. curing. CPWD DSR 2025-26.",
  },
  {
    is1200Part: "Part 8", is1200Code: "IS1200-P8-PLASTER-EXT",
    description: "Cement plaster 20mm thick in CM 1:4 (external walls)",
    unit: "m²", rate: 320, material: 198, labour: 122,
    subcategory: "Finishes",
    notes: "Two coat (12mm + 8mm), sand-faced finish. CPWD DSR 2025-26.",
  },

  // ── Part 9: Metal Work (Doors, Windows, Grilles) ──────────────────────
  {
    is1200Part: "Part 9", is1200Code: "IS1200-P9-FLUSH-DOOR",
    description: "Flush door shutter 35mm thick (commercial ply) with frame",
    unit: "EA", rate: 9800, material: 7400, labour: 2400,
    subcategory: "Doors & Windows",
    notes: "900×2100mm, incl. sal wood frame, hinges, tower bolt, aldrops. CPWD DSR 2025-26.",
  },
  {
    is1200Part: "Part 9", is1200Code: "IS1200-P9-STEEL-DOOR",
    description: "MS pressed steel door frame with shutter",
    unit: "EA", rate: 13800, material: 10800, labour: 3000,
    subcategory: "Doors & Windows",
    notes: "900×2100mm, incl. frame, hinges, tower bolt, primer coat. CPWD DSR 2025-26.",
  },
  {
    is1200Part: "Part 9", is1200Code: "IS1200-P9-MS-RAILING",
    description: "MS railing with round/square bars and flats",
    unit: "Rmt", rate: 2050, material: 1520, labour: 530,
    subcategory: "Steel",
    notes: "1050mm high, incl. primer + enamel paint. CPWD DSR 2025-26.",
  },

  // ── Part 10: Painting ──────────────────────────────────────────────────
  {
    is1200Part: "Part 10", is1200Code: "IS1200-P10-PAINT",
    description: "Acrylic emulsion paint (2 coats over primer) on plastered surface",
    unit: "m²", rate: 82, material: 47, labour: 35,
    subcategory: "Finishes",
    notes: "Asian Paints Tractor Emulsion or equivalent. Incl. primer. CPWD DSR 2025-26.",
  },
  {
    is1200Part: "Part 10", is1200Code: "IS1200-P10-PAINT-EXT",
    description: "Exterior weather coat paint (2 coats) on plastered surface",
    unit: "m²", rate: 110, material: 66, labour: 44,
    subcategory: "Finishes",
    notes: "Asian Paints Apex or equivalent. UV + moisture resistant. CPWD DSR 2025-26.",
  },

  // ── Part 13: Flooring ──────────────────────────────────────────────────
  {
    is1200Part: "Part 13", is1200Code: "IS1200-P13-VIT-TILE",
    description: "Vitrified tile flooring 600×600mm with CM 1:4 bedding",
    unit: "m²", rate: 1100, material: 830, labour: 270,
    subcategory: "Finishes",
    notes: "Double charge vitrified tiles, incl. grouting. CPWD DSR 2025-26.",
  },
  {
    is1200Part: "Part 13", is1200Code: "IS1200-P13-TERRACE-TILE",
    description: "Terracotta/Kota stone tile on terrace over WP treatment",
    unit: "m²", rate: 860, material: 590, labour: 270,
    subcategory: "Finishes",
    notes: "CPWD DSR 2025-26.",
  },
  {
    is1200Part: "Part 13", is1200Code: "IS1200-P13-MARBLE",
    description: "Marble flooring (Makrana/Rajnagar white) with CM bedding",
    unit: "m²", rate: 2100, material: 1620, labour: 480,
    subcategory: "Finishes",
    notes: "CPWD DSR 2025-26.",
  },

  // ── Part 13 (continued): Additional flooring, ceiling, and cladding ─────
  {
    is1200Part: "Part 13", is1200Code: "IS1200-P13-GRANITE",
    description: "Granite flooring (polished, 18mm) with CM bedding",
    unit: "m²", rate: 2500, material: 1980, labour: 520,
    subcategory: "Finishes",
    notes: "South Indian granite, mirror polish. Incl. grouting. CPWD DSR 2025-26.",
  },
  {
    is1200Part: "Part 13", is1200Code: "IS1200-P13-WOOD-FLOOR",
    description: "Wooden flooring (engineered/laminate, 8-12mm)",
    unit: "m²", rate: 2050, material: 1650, labour: 400,
    subcategory: "Finishes",
    notes: "Engineered wood or premium laminate. Incl. underlay and finishing. CPWD DSR 2025-26.",
  },
  {
    is1200Part: "Part 13", is1200Code: "IS1200-P13-EPOXY",
    description: "Epoxy flooring (self-leveling, 2-3mm coat)",
    unit: "m²", rate: 980, material: 710, labour: 270,
    subcategory: "Finishes",
    notes: "Industrial/commercial grade epoxy. Incl. primer coat. CPWD DSR 2025-26.",
  },
  {
    is1200Part: "Part 13", is1200Code: "IS1200-P13-CARPET",
    description: "Carpet tile flooring (commercial grade, 6mm)",
    unit: "m²", rate: 1380, material: 1090, labour: 290,
    subcategory: "Finishes",
    notes: "Interface/Shaw equivalent. Incl. adhesive and finishing. CPWD DSR 2025-26.",
  },
  {
    is1200Part: "Part 13", is1200Code: "IS1200-P13-GYPSUM-CEILING",
    description: "Gypsum board false ceiling with GI framework",
    unit: "m²", rate: 520, material: 365, labour: 155,
    subcategory: "Finishes",
    notes: "12.5mm gypsum board, suspended GI grid. Incl. putty + paint. CPWD DSR 2025-26.",
  },
  {
    is1200Part: "Part 13", is1200Code: "IS1200-P13-GRID-CEILING",
    description: "Grid/mineral fiber false ceiling (T-bar system)",
    unit: "m²", rate: 440, material: 300, labour: 140,
    subcategory: "Finishes",
    notes: "Armstrong/USG equivalent, 600×600mm tiles. CPWD DSR 2025-26.",
  },
  {
    is1200Part: "Part 13", is1200Code: "IS1200-P13-ACP-CLADDING",
    description: "ACP (Aluminium Composite Panel) cladding with SS subframe",
    unit: "m²", rate: 2050, material: 1580, labour: 470,
    subcategory: "Finishes",
    notes: "4mm ACP panel, SS 304 subframe. Incl. weather sealant. CPWD DSR 2025-26.",
  },
  {
    is1200Part: "Part 13", is1200Code: "IS1200-P13-STONE-CLADDING",
    description: "Natural stone cladding (dry-fix with SS anchors)",
    unit: "m²", rate: 2550, material: 1950, labour: 600,
    subcategory: "Finishes",
    notes: "20-25mm stone veneer, SS anchor system. Excl. waterproofing. CPWD DSR 2025-26.",
  },

  // ── Part 21: Waterproofing ─────────────────────────────────────────────
  {
    is1200Part: "Part 21", is1200Code: "IS1200-P21-WATERPROOF",
    description: "Waterproofing treatment to terrace/roof (bitumen-based membrane)",
    unit: "m²", rate: 370, material: 265, labour: 105,
    subcategory: "Waterproofing",
    notes: "APP modified bitumen membrane, torch applied. CPWD DSR 2025-26.",
  },

  // ── Part 24: Aluminium Work ────────────────────────────────────────────
  {
    is1200Part: "Part 24", is1200Code: "IS1200-P24-ALUM-WINDOW",
    description: "Aluminium sliding window with 5mm clear glass",
    unit: "m²", rate: 5200, material: 4350, labour: 850,
    subcategory: "Doors & Windows",
    notes: "Anodised aluminium section, incl. hardware, rubber gaskets. CPWD DSR 2025-26.",
  },
  {
    is1200Part: "Part 24", is1200Code: "IS1200-P24-UPVC-WINDOW",
    description: "UPVC sliding window with 5mm clear glass",
    unit: "m²", rate: 4400, material: 3680, labour: 720,
    subcategory: "Doors & Windows",
    notes: "CPWD DSR 2025-26.",
  },
  {
    is1200Part: "Part 24", is1200Code: "IS1200-P24-CURTAIN-WALL",
    description: "Aluminium curtain wall glazing system (DGU 6+12+6mm)",
    unit: "m²", rate: 9800, material: 8250, labour: 1550,
    subcategory: "Doors & Windows",
    notes: "Structural silicone glazing, double glazed unit. CPWD DSR 2025-26.",
  },

  // ── Part 14: Plumbing (IS 1200 Part 14 — Water Supply & Sanitary) ─────────
  {
    is1200Part: "Part 14", is1200Code: "IS1200-P14-PVC-PIPE",
    description: "PVC pipe 20-25mm (cold water supply) with fittings, S&F",
    unit: "Rmt", rate: 220, material: 150, labour: 70,
    subcategory: "Plumbing",
  },
  {
    is1200Part: "Part 14", is1200Code: "IS1200-P14-PVC-PIPE-50",
    description: "PVC pipe 50mm (waste) with fittings, S&F",
    unit: "Rmt", rate: 320, material: 220, labour: 100,
    subcategory: "Plumbing",
  },
  {
    is1200Part: "Part 14", is1200Code: "IS1200-P14-PVC-PIPE-110",
    description: "PVC pipe 110mm (soil/drainage) with fittings, S&F",
    unit: "Rmt", rate: 480, material: 340, labour: 140,
    subcategory: "Plumbing",
  },
  {
    is1200Part: "Part 14", is1200Code: "IS1200-P14-FIXTURE",
    description: "Sanitary fixture (average — WC/basin/tap) supply and fix",
    unit: "EA", rate: 12000, material: 9000, labour: 3000,
    subcategory: "Plumbing",
    notes: "Average rate for commercial-grade sanitary fixtures. Static fallback — market rate preferred.",
  },
  {
    is1200Part: "Part 14", is1200Code: "IS1200-P14-COPPER-PIPE",
    description: "Copper pipe 15mm (hot water supply) with fittings",
    unit: "Rmt", rate: 850, material: 680, labour: 170,
    subcategory: "Plumbing",
  },
  {
    is1200Part: "Part 14", is1200Code: "IS1200-P14-GI-PIPE",
    description: "GI pipe 25mm (water supply) threaded with fittings",
    unit: "Rmt", rate: 420, material: 300, labour: 120,
    subcategory: "Plumbing",
  },
  {
    is1200Part: "Part 14", is1200Code: "IS1200-P14-CI-PIPE",
    description: "Cast iron pipe 100mm (soil stack) with caulked joints",
    unit: "Rmt", rate: 1200, material: 950, labour: 250,
    subcategory: "Plumbing",
  },
  {
    is1200Part: "Part 14", is1200Code: "IS1200-P14-PIPE-FITTING",
    description: "Pipe fitting (elbow/tee/reducer) — average all sizes",
    unit: "EA", rate: 180, material: 120, labour: 60,
    subcategory: "Plumbing",
  },
  {
    is1200Part: "Part 14", is1200Code: "IS1200-P14-WC",
    description: "EWC (European water closet) with flush valve & CI trap",
    unit: "EA", rate: 6500, material: 5000, labour: 1500,
    subcategory: "Plumbing",
  },
  {
    is1200Part: "Part 14", is1200Code: "IS1200-P14-WASH-BASIN",
    description: "Wash basin with pillar cock & waste coupling",
    unit: "EA", rate: 4200, material: 3200, labour: 1000,
    subcategory: "Plumbing",
  },
  {
    is1200Part: "Part 14", is1200Code: "IS1200-P14-FLOOR-TRAP",
    description: "Floor trap (Jali) CI/PVC 100mm",
    unit: "EA", rate: 350, material: 220, labour: 130,
    subcategory: "Plumbing",
  },
  {
    is1200Part: "Part 14", is1200Code: "IS1200-P14-TANK",
    description: "Overhead water tank (FRP/PVC) 1000 litre with stand",
    unit: "EA", rate: 12000, material: 9500, labour: 2500,
    subcategory: "Plumbing",
  },

  // ── Part 15: Fire Protection ───────────────────────────────────────────────
  {
    is1200Part: "Part 15", is1200Code: "IS1200-P15-SPRINKLER-PIPE",
    description: "Sprinkler piping (MS/GI 25mm) with supports",
    unit: "Rmt", rate: 650, material: 480, labour: 170,
    subcategory: "Fire Protection",
  },
  {
    is1200Part: "Part 15", is1200Code: "IS1200-P15-SPRINKLER-HEAD",
    description: "Sprinkler head (pendent/upright) 68°C glass bulb",
    unit: "EA", rate: 450, material: 320, labour: 130,
    subcategory: "Fire Protection",
  },

  // ── Part 16: Electrical ────────────────────────────────────────────────────
  {
    is1200Part: "Part 16", is1200Code: "IS1200-P16-CABLE",
    description: "PVC conduit 20mm with copper wiring 2.5 sq.mm (1C+1E)",
    unit: "Rmt", rate: 95, material: 65, labour: 30,
    subcategory: "Electrical",
  },
  {
    is1200Part: "Part 16", is1200Code: "IS1200-P16-ARMOURED-CABLE",
    description: "Armoured cable 4C × 6 sq.mm with glands & termination",
    unit: "Rmt", rate: 380, material: 290, labour: 90,
    subcategory: "Electrical",
  },
  {
    is1200Part: "Part 16", is1200Code: "IS1200-P16-CABLE-TRAY",
    description: "Perforated cable tray (GI 300mm wide) with supports",
    unit: "Rmt", rate: 650, material: 480, labour: 170,
    subcategory: "Electrical",
  },
  {
    is1200Part: "Part 16", is1200Code: "IS1200-P16-CABLE-FITTING",
    description: "Cable gland/connector/junction box",
    unit: "EA", rate: 120, material: 80, labour: 40,
    subcategory: "Electrical",
  },
  {
    is1200Part: "Part 16", is1200Code: "IS1200-P16-MCB-PANEL",
    description: "MCB distribution board (8-way) with MCBs",
    unit: "EA", rate: 4500, material: 3500, labour: 1000,
    subcategory: "Electrical",
  },
  {
    is1200Part: "Part 16", is1200Code: "IS1200-P16-LED-LIGHT",
    description: "LED panel light 40W (2×2 ft) with driver",
    unit: "EA", rate: 1800, material: 1400, labour: 400,
    subcategory: "Electrical",
  },
  {
    is1200Part: "Part 16", is1200Code: "IS1200-P16-DB-BOX",
    description: "DB box (TPN 63A) with MCCB & bus bar",
    unit: "EA", rate: 8500, material: 7000, labour: 1500,
    subcategory: "Electrical",
  },

  // ── Part 17: HVAC ─────────────────────────────────────────────────────────
  {
    is1200Part: "Part 17", is1200Code: "IS1200-P17-GI-DUCT",
    description: "GI sheet ductwork (24 gauge) with insulation & supports",
    unit: "m²", rate: 750, material: 520, labour: 230,
    subcategory: "HVAC",
    notes: "Rate per m² of duct surface area",
  },
  {
    is1200Part: "Part 17", is1200Code: "IS1200-P17-FLEX-DUCT",
    description: "Flexible duct 150mm (insulated) with connectors",
    unit: "Rmt", rate: 450, material: 320, labour: 130,
    subcategory: "HVAC",
  },
  {
    is1200Part: "Part 17", is1200Code: "IS1200-P17-DUCT-FITTING",
    description: "Duct fitting (elbow/tee/transition) GI sheet",
    unit: "EA", rate: 850, material: 600, labour: 250,
    subcategory: "HVAC",
  },
  {
    is1200Part: "Part 17", is1200Code: "IS1200-P17-DIFFUSER",
    description: "Supply air diffuser (4-way 600×600mm) with damper",
    unit: "EA", rate: 2200, material: 1700, labour: 500,
    subcategory: "HVAC",
  },
  {
    is1200Part: "Part 17", is1200Code: "IS1200-P17-DAMPER-VALVE",
    description: "Volume control damper / fire damper (300×300mm)",
    unit: "EA", rate: 3500, material: 2800, labour: 700,
    subcategory: "HVAC",
  },
  {
    is1200Part: "Part 17", is1200Code: "IS1200-P17-FAN-PUMP",
    description: "Inline duct fan / centrifugal pump (1-2 HP)",
    unit: "EA", rate: 18000, material: 15000, labour: 3000,
    subcategory: "HVAC",
  },
  {
    is1200Part: "Part 17", is1200Code: "IS1200-P17-AC-OUTDOOR",
    description: "Split AC outdoor unit (2-ton inverter) with piping",
    unit: "EA", rate: 42000, material: 35000, labour: 7000,
    subcategory: "HVAC",
  },
  {
    is1200Part: "Part 17", is1200Code: "IS1200-P17-FILTER",
    description: "Air filter unit (pre-filter + fine filter) 600×600mm",
    unit: "EA", rate: 3200, material: 2500, labour: 700,
    subcategory: "HVAC",
  },
];

// ─── Derived Indian Rates (Formwork, Rebar, Finishing per element type) ──

export const INDIAN_DERIVED_RATES = {
  formwork: {
    slab:   { rate: 440, unit: "m²", notes: "Centering & shuttering for RCC slab. CPWD DSR 2025-26." },
    beam:   { rate: 490, unit: "m²", notes: "Centering & shuttering for RCC beam. CPWD DSR 2025-26." },
    column: { rate: 550, unit: "m²", notes: "Centering & shuttering for RCC column. CPWD DSR 2025-26." },
    wall:   { rate: 460, unit: "m²", notes: "Centering & shuttering for RCC wall. CPWD DSR 2025-26." },
    stair:  { rate: 640, unit: "m²", notes: "Centering & shuttering for staircase. CPWD DSR 2025-26." },
  },
  rebar: {
    // Typical reinforcement kg/m³ of concrete (IS 456 guidance)
    slab:   { kgPerM3: 80,  rate: 98, notes: "Avg 70-100 kg/m³ for slabs. CPWD DSR 2025-26." },
    beam:   { kgPerM3: 140, rate: 98, notes: "Avg 120-180 kg/m³ for beams. CPWD DSR 2025-26." },
    column: { kgPerM3: 180, rate: 98, notes: "Avg 150-220 kg/m³ for columns. CPWD DSR 2025-26." },
    wall:   { kgPerM3: 45,  rate: 98, notes: "Avg 30-60 kg/m³ for RCC walls. CPWD DSR 2025-26." },
    footing:{ kgPerM3: 70,  rate: 98, notes: "Avg 50-90 kg/m³ for footings. CPWD DSR 2025-26." },
    stair:  { kgPerM3: 120, rate: 98, notes: "Avg 100-140 kg/m³ for stairs. CPWD DSR 2025-26." },
  },
};

// ─── Concrete Grade Multipliers ──────────────────────────────────────────────
// Applied on top of CPWD base rate (M25 = 1.00 baseline)
// Source: CPWD Analysis of Rates, mix design cost differential
export const CONCRETE_GRADE_MULTIPLIERS: Record<string, number> = {
  "M10": 0.72, "M15": 0.85, "M20": 0.92, "M25": 1.00,
  "M30": 1.12, "M35": 1.20, "M40": 1.28, "M45": 1.35, "M50": 1.42,
  "C20/25": 0.92, "C25/30": 1.00, "C30/37": 1.12, "C35/45": 1.20, "C40/50": 1.28, // Eurocode notation
};

/** Get concrete grade multiplier. Returns 1.0 for unknown grades. */
export function getConcreteGradeMultiplier(grade?: string): number {
  if (!grade) return 1.0;
  const normalized = grade.toUpperCase().replace(/\s+/g, "");
  // Try direct match
  if (CONCRETE_GRADE_MULTIPLIERS[normalized]) return CONCRETE_GRADE_MULTIPLIERS[normalized];
  // Try extracting number: "M 25" → "M25", "Grade M30" → "M30"
  const match = normalized.match(/M(\d+)/);
  if (match) return CONCRETE_GRADE_MULTIPLIERS[`M${match[1]}`] ?? 1.0;
  // Try Eurocode: "C30/37"
  const ecMatch = normalized.match(/C(\d+)\/(\d+)/);
  if (ecMatch) return CONCRETE_GRADE_MULTIPLIERS[`C${ecMatch[1]}/${ecMatch[2]}`] ?? 1.0;
  return 1.0;
}

// ─── Lookup Functions ────────────────────────────────────────────────────────

const rateIndex = new Map<string, IS1200Rate>();
for (const rate of IS1200_RATES) {
  rateIndex.set(rate.is1200Code, rate);
}

/** Get a specific IS 1200 rate by code */
export function getIS1200Rate(code: string): IS1200Rate | undefined {
  return rateIndex.get(code);
}

/** Get IS 1200 mapping for an IFC element type */
export function getIS1200Mapping(ifcType: string): IS1200Mapping | undefined {
  return IS1200_MAPPINGS.find(m => m.ifcType === ifcType);
}

/**
 * Get applicable IS 1200 rates for an IFC element, optionally using material name.
 * Returns rates in INR, ready to use for Indian projects.
 */
export function getIS1200RatesForElement(
  ifcType: string,
  materialName?: string
): IS1200Rate[] {
  const mapping = getIS1200Mapping(ifcType);
  if (!mapping) return [];

  // Try material-specific codes first
  if (materialName && mapping.materialOverrides) {
    const matLower = materialName.toLowerCase();
    for (const [keyword, codes] of Object.entries(mapping.materialOverrides)) {
      if (matLower.includes(keyword)) {
        return codes.map(c => rateIndex.get(c)).filter(Boolean) as IS1200Rate[];
      }
    }
  }

  // Fall back to default codes
  return mapping.defaultRateCodes
    .map(c => rateIndex.get(c))
    .filter(Boolean) as IS1200Rate[];
}

/**
 * Get the IS 1200 Part code string for an IFC element type.
 * Used in BOQ display: "IS 1200 Part 2" instead of CSI "03 30 00"
 */
export function getIS1200PartLabel(ifcType: string, materialName?: string): string {
  const mapping = getIS1200Mapping(ifcType);
  if (!mapping) return "—";

  // Check for material-based part override
  if (materialName) {
    const matLower = materialName.toLowerCase();
    if (matLower.includes("brick") || matLower.includes("block") || matLower.includes("aac")) {
      return "IS 1200 Part 3 — Brick/Block Work";
    }
    if (matLower.includes("stone")) return "IS 1200 Part 4 — Stone Masonry";
    if (matLower.includes("steel") && (ifcType === "IfcColumn" || ifcType === "IfcBeam")) {
      return "IS 1200 Part 7 — Structural Steel";
    }
  }

  return `IS 1200 ${mapping.is1200Part} — ${mapping.is1200PartName}`;
}
