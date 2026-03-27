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
];

// ─── CPWD DSR 2023-24 Rate Database (INR) ───────────────────────────────────

export const IS1200_RATES: IS1200Rate[] = [
  // ── Part 2: Concrete Work ──────────────────────────────────────────────
  {
    is1200Part: "Part 2", is1200Code: "IS1200-P2-PCC-FOOTING",
    description: "PCC M15 (1:2:4) in foundation & plinth",
    unit: "m³", rate: 5800, material: 4200, labour: 1600,
    subcategory: "Concrete",
    notes: "Plain cement concrete, incl. curing",
  },
  {
    is1200Part: "Part 2", is1200Code: "IS1200-P2-RCC-FOOTING",
    description: "RCC M25 in foundation (excl. steel)",
    unit: "m³", rate: 7200, material: 5400, labour: 1800,
    subcategory: "Concrete",
    notes: "Reinforced cement concrete, incl. centering & shuttering",
  },
  {
    is1200Part: "Part 2", is1200Code: "IS1200-P2-RCC-COLUMN",
    description: "RCC M25 in columns (excl. steel)",
    unit: "m³", rate: 8500, material: 5800, labour: 2700,
    subcategory: "Concrete",
    notes: "Incl. centering, shuttering, curing. Excl. reinforcement.",
  },
  {
    is1200Part: "Part 2", is1200Code: "IS1200-P2-RCC-BEAM",
    description: "RCC M25 in beams & lintels (excl. steel)",
    unit: "m³", rate: 8200, material: 5600, labour: 2600,
    subcategory: "Concrete",
    notes: "Incl. centering, shuttering, curing. Excl. reinforcement.",
  },
  {
    is1200Part: "Part 2", is1200Code: "IS1200-P2-RCC-SLAB",
    description: "RCC M25 in slabs (excl. steel)",
    unit: "m³", rate: 7800, material: 5500, labour: 2300,
    subcategory: "Concrete",
    notes: "Incl. centering, shuttering, curing. Excl. reinforcement.",
  },
  {
    is1200Part: "Part 2", is1200Code: "IS1200-P2-RCC-WALL",
    description: "RCC M25 in walls (excl. steel)",
    unit: "m³", rate: 8000, material: 5600, labour: 2400,
    subcategory: "Concrete",
    notes: "Incl. centering, shuttering, curing. Excl. reinforcement.",
  },
  {
    is1200Part: "Part 2", is1200Code: "IS1200-P2-RCC-STAIR",
    description: "RCC M25 in waist slab of staircase (excl. steel)",
    unit: "m³", rate: 9500, material: 6200, labour: 3300,
    subcategory: "Concrete",
    notes: "Complex formwork, incl. nosing & tread finishing",
  },
  {
    is1200Part: "Part 2", is1200Code: "IS1200-P2-DRYWALL",
    description: "Gypsum board partition (75mm stud, single layer each side)",
    unit: "m²", rate: 850, material: 650, labour: 200,
    subcategory: "Finishes",
  },

  // ── Part 3: Brick Work ─────────────────────────────────────────────────
  {
    is1200Part: "Part 3", is1200Code: "IS1200-P3-BRICK-230",
    description: "Brick masonry 230mm thick in CM 1:6 (one brick wall)",
    unit: "m²", rate: 1250, material: 850, labour: 400,
    subcategory: "Masonry",
    notes: "First class bricks, cement mortar 1:6. Per m² of wall face.",
  },
  {
    is1200Part: "Part 3", is1200Code: "IS1200-P3-BRICK-115",
    description: "Brick masonry 115mm thick in CM 1:4 (half brick wall)",
    unit: "m²", rate: 680, material: 450, labour: 230,
    subcategory: "Masonry",
  },
  {
    is1200Part: "Part 3", is1200Code: "IS1200-P3-BLOCK-200",
    description: "Concrete block masonry 200mm thick in CM 1:6",
    unit: "m²", rate: 950, material: 680, labour: 270,
    subcategory: "Masonry",
    notes: "400×200×200mm solid concrete blocks",
  },
  {
    is1200Part: "Part 3", is1200Code: "IS1200-P3-AAC-200",
    description: "AAC block masonry 200mm thick with polymer mortar",
    unit: "m²", rate: 1100, material: 850, labour: 250,
    subcategory: "Masonry",
    notes: "Autoclaved aerated concrete blocks, lightweight",
  },

  // ── Part 4: Stone Masonry ──────────────────────────────────────────────
  {
    is1200Part: "Part 4", is1200Code: "IS1200-P4-STONE-WALL",
    description: "Random rubble stone masonry in CM 1:6",
    unit: "m³", rate: 4800, material: 3200, labour: 1600,
    subcategory: "Masonry",
  },

  // ── Part 1: Earthwork & Piling ─────────────────────────────────────────
  // Source: CPDCL-Sify DG Works BOQ, Hyderabad 2025
  {
    is1200Part: "Part 1", is1200Code: "IS1200-P1-EXCAVATION-SHALLOW",
    description: "Excavation in ordinary soil (0-1.5m depth)",
    unit: "m³", rate: 650, material: 0, labour: 650,
    subcategory: "Earthwork",
    notes: "CPDCL-Sify Hyderabad 2025: ₹650/cum. Manual/machine combined.",
  },
  {
    is1200Part: "Part 1", is1200Code: "IS1200-P1-EXCAVATION-DEEP",
    description: "Excavation in ordinary soil (1.5-3.0m depth)",
    unit: "m³", rate: 1200, material: 0, labour: 1200,
    subcategory: "Earthwork",
    notes: "Deep excavation with shoring. CPDCL reference ₹6,500/cum is hard rock; ₹1,200 for ordinary soil.",
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
  // Source: Siemens Energy Pune Interior BOQ Nov 2025, market verification
  {
    is1200Part: "Part 3", is1200Code: "IS1200-P3-BLOCK-100",
    description: "Concrete block masonry 100mm thick in CM 1:6 (partition wall)",
    unit: "m²", rate: 620, material: 420, labour: 200,
    subcategory: "Masonry",
    notes: "400×200×100mm solid concrete blocks. Interior partition. Pune market 2025.",
  },

  // ── Part 8 (continued): Plaster 15mm for interior fitout ──────────────
  {
    is1200Part: "Part 8", is1200Code: "IS1200-P8-PLASTER-15",
    description: "Cement plaster 15mm thick in CM 1:4 (internal walls, commercial grade)",
    unit: "m²", rate: 245, material: 155, labour: 90,
    subcategory: "Finishes",
    notes: "15mm single coat, smooth finish. Siemens Pune fitout reference. Intermediate between 12mm and 20mm.",
  },

  // ── Part 6: Reinforcement Steel ────────────────────────────────────────
  {
    is1200Part: "Part 6", is1200Code: "IS1200-P6-REBAR-500",
    description: "TMT reinforcement bars Fe 500 (cutting, bending, placing, tying)",
    unit: "kg", rate: 88, material: 68, labour: 20,
    subcategory: "Steel",
    notes: "Incl. binding wire @ 8kg/MT. Calibrated: CPDCL-Sify Hyderabad 2025 Fe550 ₹138/kg → Fe500 ≈ ₹88/kg all-in.",
  },

  // ── Part 7: Structural Steel ───────────────────────────────────────────
  {
    is1200Part: "Part 7", is1200Code: "IS1200-P7-STRUCT-STEEL",
    description: "Structural steel work in built-up sections (fabrication + erection)",
    unit: "kg", rate: 140, material: 100, labour: 40,
    subcategory: "Steel",
    notes: "Incl. cutting, welding, bolting, one coat primer, erection. Calibrated: 2025 market ₹135-145/kg.",
  },

  // ── Part 8: Plastering ─────────────────────────────────────────────────
  {
    is1200Part: "Part 8", is1200Code: "IS1200-P8-PLASTER",
    description: "Cement plaster 12mm thick in CM 1:6 (internal walls)",
    unit: "m²", rate: 195, material: 120, labour: 75,
    subcategory: "Finishes",
    notes: "Single coat, smooth finish, incl. curing",
  },
  {
    is1200Part: "Part 8", is1200Code: "IS1200-P8-PLASTER-EXT",
    description: "Cement plaster 20mm thick in CM 1:4 (external walls)",
    unit: "m²", rate: 280, material: 175, labour: 105,
    subcategory: "Finishes",
    notes: "Two coat (12mm + 8mm), sand-faced finish",
  },

  // ── Part 9: Metal Work (Doors, Windows, Grilles) ──────────────────────
  {
    is1200Part: "Part 9", is1200Code: "IS1200-P9-FLUSH-DOOR",
    description: "Flush door shutter 35mm thick (commercial ply) with frame",
    unit: "EA", rate: 8500, material: 6500, labour: 2000,
    subcategory: "Doors & Windows",
    notes: "900×2100mm, incl. sal wood frame, hinges, tower bolt, aldrops",
  },
  {
    is1200Part: "Part 9", is1200Code: "IS1200-P9-STEEL-DOOR",
    description: "MS pressed steel door frame with shutter",
    unit: "EA", rate: 12000, material: 9500, labour: 2500,
    subcategory: "Doors & Windows",
    notes: "900×2100mm, incl. frame, hinges, tower bolt, primer coat",
  },
  {
    is1200Part: "Part 9", is1200Code: "IS1200-P9-MS-RAILING",
    description: "MS railing with round/square bars and flats",
    unit: "Rmt", rate: 1800, material: 1350, labour: 450,
    subcategory: "Steel",
    notes: "1050mm high, incl. primer + enamel paint",
  },

  // ── Part 10: Painting ──────────────────────────────────────────────────
  {
    is1200Part: "Part 10", is1200Code: "IS1200-P10-PAINT",
    description: "Acrylic emulsion paint (2 coats over primer) on plastered surface",
    unit: "m²", rate: 72, material: 42, labour: 30,
    subcategory: "Finishes",
    notes: "Asian Paints Tractor Emulsion or equivalent. Incl. primer.",
  },
  {
    is1200Part: "Part 10", is1200Code: "IS1200-P10-PAINT-EXT",
    description: "Exterior weather coat paint (2 coats) on plastered surface",
    unit: "m²", rate: 95, material: 58, labour: 37,
    subcategory: "Finishes",
    notes: "Asian Paints Apex or equivalent. UV + moisture resistant.",
  },

  // ── Part 13: Flooring ──────────────────────────────────────────────────
  {
    is1200Part: "Part 13", is1200Code: "IS1200-P13-VIT-TILE",
    description: "Vitrified tile flooring 600×600mm with CM 1:4 bedding",
    unit: "m²", rate: 950, material: 720, labour: 230,
    subcategory: "Finishes",
    notes: "Double charge vitrified tiles, incl. grouting",
  },
  {
    is1200Part: "Part 13", is1200Code: "IS1200-P13-TERRACE-TILE",
    description: "Terracotta/Kota stone tile on terrace over WP treatment",
    unit: "m²", rate: 750, material: 520, labour: 230,
    subcategory: "Finishes",
  },
  {
    is1200Part: "Part 13", is1200Code: "IS1200-P13-MARBLE",
    description: "Marble flooring (Makrana/Rajnagar white) with CM bedding",
    unit: "m²", rate: 1800, material: 1400, labour: 400,
    subcategory: "Finishes",
  },

  // ── Part 13 (continued): Additional flooring, ceiling, and cladding ─────
  {
    is1200Part: "Part 13", is1200Code: "IS1200-P13-GRANITE",
    description: "Granite flooring (polished, 18mm) with CM bedding",
    unit: "m²", rate: 2200, material: 1750, labour: 450,
    subcategory: "Finishes",
    notes: "South Indian granite, mirror polish. Incl. grouting.",
  },
  {
    is1200Part: "Part 13", is1200Code: "IS1200-P13-WOOD-FLOOR",
    description: "Wooden flooring (engineered/laminate, 8-12mm)",
    unit: "m²", rate: 1800, material: 1450, labour: 350,
    subcategory: "Finishes",
    notes: "Engineered wood or premium laminate. Incl. underlay and finishing.",
  },
  {
    is1200Part: "Part 13", is1200Code: "IS1200-P13-EPOXY",
    description: "Epoxy flooring (self-leveling, 2-3mm coat)",
    unit: "m²", rate: 850, material: 620, labour: 230,
    subcategory: "Finishes",
    notes: "Industrial/commercial grade epoxy. Incl. primer coat.",
  },
  {
    is1200Part: "Part 13", is1200Code: "IS1200-P13-CARPET",
    description: "Carpet tile flooring (commercial grade, 6mm)",
    unit: "m²", rate: 1200, material: 950, labour: 250,
    subcategory: "Finishes",
    notes: "Interface/Shaw equivalent. Incl. adhesive and finishing.",
  },
  {
    is1200Part: "Part 13", is1200Code: "IS1200-P13-GYPSUM-CEILING",
    description: "Gypsum board false ceiling with GI framework",
    unit: "m²", rate: 450, material: 320, labour: 130,
    subcategory: "Finishes",
    notes: "12.5mm gypsum board, suspended GI grid. Incl. putty + paint.",
  },
  {
    is1200Part: "Part 13", is1200Code: "IS1200-P13-GRID-CEILING",
    description: "Grid/mineral fiber false ceiling (T-bar system)",
    unit: "m²", rate: 380, material: 260, labour: 120,
    subcategory: "Finishes",
    notes: "Armstrong/USG equivalent, 600×600mm tiles.",
  },
  {
    is1200Part: "Part 13", is1200Code: "IS1200-P13-ACP-CLADDING",
    description: "ACP (Aluminium Composite Panel) cladding with SS subframe",
    unit: "m²", rate: 1800, material: 1400, labour: 400,
    subcategory: "Finishes",
    notes: "4mm ACP panel, SS 304 subframe. Incl. weather sealant.",
  },
  {
    is1200Part: "Part 13", is1200Code: "IS1200-P13-STONE-CLADDING",
    description: "Natural stone cladding (dry-fix with SS anchors)",
    unit: "m²", rate: 2200, material: 1700, labour: 500,
    subcategory: "Finishes",
    notes: "20-25mm stone veneer, SS anchor system. Excl. waterproofing.",
  },

  // ── Part 21: Waterproofing ─────────────────────────────────────────────
  {
    is1200Part: "Part 21", is1200Code: "IS1200-P21-WATERPROOF",
    description: "Waterproofing treatment to terrace/roof (bitumen-based membrane)",
    unit: "m²", rate: 320, material: 230, labour: 90,
    subcategory: "Waterproofing",
    notes: "APP modified bitumen membrane, torch applied",
  },

  // ── Part 24: Aluminium Work ────────────────────────────────────────────
  {
    is1200Part: "Part 24", is1200Code: "IS1200-P24-ALUM-WINDOW",
    description: "Aluminium sliding window with 5mm clear glass",
    unit: "m²", rate: 4500, material: 3800, labour: 700,
    subcategory: "Doors & Windows",
    notes: "Anodised aluminium section, incl. hardware, rubber gaskets",
  },
  {
    is1200Part: "Part 24", is1200Code: "IS1200-P24-UPVC-WINDOW",
    description: "UPVC sliding window with 5mm clear glass",
    unit: "m²", rate: 3800, material: 3200, labour: 600,
    subcategory: "Doors & Windows",
  },
  {
    is1200Part: "Part 24", is1200Code: "IS1200-P24-CURTAIN-WALL",
    description: "Aluminium curtain wall glazing system (DGU 6+12+6mm)",
    unit: "m²", rate: 8500, material: 7200, labour: 1300,
    subcategory: "Doors & Windows",
    notes: "Structural silicone glazing, double glazed unit",
  },
];

// ─── Derived Indian Rates (Formwork, Rebar, Finishing per element type) ──

export const INDIAN_DERIVED_RATES = {
  formwork: {
    slab:   { rate: 380, unit: "m²", notes: "Centering & shuttering for RCC slab" },
    beam:   { rate: 420, unit: "m²", notes: "Centering & shuttering for RCC beam" },
    column: { rate: 480, unit: "m²", notes: "Centering & shuttering for RCC column" },
    wall:   { rate: 400, unit: "m²", notes: "Centering & shuttering for RCC wall" },
    stair:  { rate: 550, unit: "m²", notes: "Centering & shuttering for staircase" },
  },
  rebar: {
    // Typical reinforcement kg/m³ of concrete (IS 456 guidance)
    // Calibrated: 1BHK structural BOQ → 1.8 MT / 101 sqm = 17.8 kg/sqm, avg 96 kg/m³
    slab:   { kgPerM3: 80,  rate: 88, notes: "Avg 70-100 kg/m³ for slabs. Calibrated from 1BHK BOQ 2024." },
    beam:   { kgPerM3: 140, rate: 88, notes: "Avg 120-180 kg/m³ for beams. Calibrated from 1BHK BOQ 2024." },
    column: { kgPerM3: 180, rate: 88, notes: "Avg 150-220 kg/m³ for columns. Calibrated from 1BHK BOQ 2024." },
    wall:   { kgPerM3: 45,  rate: 88, notes: "Avg 30-60 kg/m³ for RCC walls" },
    footing:{ kgPerM3: 70,  rate: 88, notes: "Avg 50-90 kg/m³ for footings" },
    stair:  { kgPerM3: 120, rate: 88, notes: "Avg 100-140 kg/m³ for stairs" },
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
