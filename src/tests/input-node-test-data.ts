/**
 * AEC Test Data Suite for all 7 Input Nodes
 * Realistic Indian AEC project data for NeoBIM Workflow Builder
 */

// ─── IN-001: Text Prompt ────────────────────────────────────────────────────

export const testTextPrompt = {
  simple:
    "Design a 5 storey residential apartment building in Mumbai with ground floor parking, 4 flats per floor, total GFA 3200 sqm, contemporary style with large balconies",

  intermediate:
    "Mixed-use development in Pune, Hinjewadi IT Park area. Ground floor: 800 sqm retail + lobby. Floors 1-3: 2400 sqm Grade A office space. Floors 4-8: 40 residential flats (2BHK and 3BHK mix). Rooftop: amenity deck with swimming pool. Total GFA: 12000 sqm. Style: modern glass facade with terracotta fins for solar shading. IGBC Green certification target.",

  complex:
    "High-rise residential tower, Bandra Kurla Complex Mumbai. B+G+32 floors. Basement: 200 car parking. Ground: double-height lobby, leasing office, 3 retail units. Floors 1-5: podium with amenities — gym, pool, clubhouse, co-working space, children play area. Floors 6-32: 270 apartments (studio, 1BHK, 2BHK, 3BHK, 4BHK penthouses on top 2 floors). Total GFA: 48000 sqm. Structural system: RC shear wall core with flat plate slabs. Facade: unitised curtain wall with double glazing, SHGC 0.25. Target: LEED Gold, 4-star GRIHA rating.",
} as const;

// ─── IN-002: PDF Upload ─────────────────────────────────────────────────────

export interface TestPDFContent {
  fileName: string;
  fileSizeKB: number;
  pageCount: number;
  mockExtractedText: string;
  expectedParserOutput: {
    sections: string[];
    detectedBuildingType: string;
    detectedFloors: number;
    detectedGFA: number;
  };
}

export const testPDFContent: TestPDFContent = {
  fileName: "BKC_Residential_Tower_Client_Brief_v3.pdf",
  fileSizeKB: 847,
  pageCount: 12,
  mockExtractedText: `PROJECT BRIEF — BKC RESIDENTIAL TOWER

1. PROJECT OVERVIEW
The client, Horizon Realty Pvt. Ltd., intends to develop a premium residential tower on Plot C-42, Bandra Kurla Complex, Mumbai, Maharashtra. The project aims to deliver 270 luxury apartments across 32 floors above ground, with 2 basement levels for parking. The target market is HNI buyers and NRI investors seeking a signature address in Mumbai's most prestigious business district.

2. SITE INFORMATION
Address: Plot C-42, G Block, Bandra Kurla Complex, Mumbai 400051
Plot Area: 3,200 sqm (34,445 sq ft)
Road Frontage: 60m along main arterial road (north), 40m service road (east)
Existing Condition: Vacant, previously cleared, soil bearing capacity 25 T/sqm
Zoning: Commercial/Residential Mixed-Use (CRZ-II clearance obtained)
Permissible FSI: 15.0 (including premium FSI under DC Regulation 33(7))
Maximum Height: No restriction (subject to aviation clearance above 120m)
Setbacks: Front 6m, Rear 3m, Side 3m each

3. BUILDING PROGRAM
The development shall comprise the following program areas:

Basement 1 & 2: 200 car parking stalls, EV charging for 20% stalls, water tanks, STP
Ground Floor: Double-height lobby (8m ceiling), leasing office (120 sqm), 3 retail units (total 450 sqm), security and services
Floors 1-5 (Podium): Amenity deck including gymnasium (400 sqm), 25m lap pool with deck, clubhouse and party hall (600 sqm), co-working lounge (200 sqm), children's play area (150 sqm), yoga and meditation room (80 sqm), landscaped terrace gardens
Floors 6-30 (Tower): Typical floors with mix of apartments — studio (45 sqm), 1BHK (65 sqm), 2BHK (95 sqm), 3BHK (140 sqm)
Floors 31-32 (Crown): 4BHK penthouses (280 sqm each) with private terraces and panoramic views

AREA STATEMENT:
Total GFA: 48,000 sqm
Carpet Area: ~32,640 sqm (68% efficiency)
Saleable Area: ~38,400 sqm (80% loading)
Common Areas: ~9,600 sqm

4. DESIGN GUIDELINES
Architectural Style: Contemporary international with Indian contextual references
Facade: Unitised curtain wall system with high-performance double glazing (SHGC < 0.25), vertical aluminium fins for solar shading on west and south elevations
Ground Level: Stone cladding (Kota stone or equivalent) with landscaped arrival court
Crown/Top: Distinctive architectural crown visible from Western Express Highway
Lobby: Double-height space with marble flooring, designer chandelier, water feature
Each apartment to have minimum 1 balcony with clear glass railing

5. SUSTAINABILITY TARGETS
Primary Target: LEED Gold certification (minimum 60 points)
Secondary Target: 4-star GRIHA rating
Energy: 30% reduction vs ECBC baseline, rooftop solar (50 kWp minimum)
Water: Rainwater harvesting, STP with tertiary treatment, 40% potable water reduction
Materials: Minimum 20% recycled content, AAC blocks for internal walls
Indoor Environment: Low-VOC finishes, MERV-13 filtration, daylight autonomy > 55%

6. BUDGET AND TIMELINE
Estimated Construction Cost: INR 425 Crore (approximately USD 51 million)
Project Duration: 36 months from foundation to OC
Design Phase: 6 months (concept to GFC drawings)
Target Handover: Q4 2028
Sales Launch: Q2 2026 (off-plan sales with show flat)

Client Preferences: The client favours clean, contemporary lines with warm material accents. References include Lodha Park (Mumbai), Oberoi 360 West, and international projects like One57 (New York). The development should convey exclusivity while maintaining warmth and livability. Vastu compliance is required for all apartment layouts.`,
  expectedParserOutput: {
    sections: [
      "Project Overview",
      "Site Information",
      "Building Program",
      "Design Guidelines",
      "Sustainability",
      "Budget & Timeline",
    ],
    detectedBuildingType: "residential",
    detectedFloors: 32,
    detectedGFA: 48000,
  },
};

// ─── IN-003: Image Upload ───────────────────────────────────────────────────

export interface TestImageInput {
  fileName: string;
  fileSizeMB: number;
  dimensions: string;
  type: "site_photograph" | "reference_image" | "hand_sketch";
  description: string;
  expectedUnderstandingOutput: {
    sceneType: string;
    detectedElements?: string[];
    suggestedBuildingType?: string;
    detectedStyle?: string;
    detectedMaterials?: string[];
    detectedMassingType?: string;
    detectedFeatures?: string[];
  };
}

export const testImageInputs: TestImageInput[] = [
  {
    fileName: "site_photo_bkc_plot.jpg",
    fileSizeMB: 2.4,
    dimensions: "3840x2160",
    type: "site_photograph",
    description:
      "Aerial photograph of vacant plot, BKC Mumbai, showing site boundary, adjacent buildings, road access from two sides, existing trees",
    expectedUnderstandingOutput: {
      sceneType: "site_photograph",
      detectedElements: [
        "vacant_plot",
        "road_access",
        "adjacent_buildings",
        "vegetation",
      ],
      suggestedBuildingType: "mixed_use_highrise",
    },
  },
  {
    fileName: "reference_facade_style.jpg",
    fileSizeMB: 1.8,
    dimensions: "2560x1440",
    type: "reference_image",
    description:
      "Contemporary residential tower with terracotta brise soleil and floor to ceiling glazing, similar to desired style",
    expectedUnderstandingOutput: {
      sceneType: "architectural_reference",
      detectedStyle: "contemporary",
      detectedMaterials: ["glass", "terracotta", "concrete"],
    },
  },
  {
    fileName: "sketch_concept.jpg",
    fileSizeMB: 0.9,
    dimensions: "1920x1080",
    type: "hand_sketch",
    description:
      "Hand-drawn concept sketch showing L-shaped massing with stepped terraces",
    expectedUnderstandingOutput: {
      sceneType: "hand_sketch",
      detectedMassingType: "L-shaped",
      detectedFeatures: ["stepped_terraces", "podium"],
    },
  },
];

// ─── IN-004: IFC Upload ─────────────────────────────────────────────────────

export interface TestIFCQuantity {
  count: number;
  totalArea?: number;
  totalVolume?: number;
  totalLength?: number;
  count_types?: number;
  area?: number;
  unit?: string;
}

export interface TestIFCElement {
  type: string;
  name: string;
  thickness?: number;
  area?: number;
  height?: number;
  length?: number;
  width?: number;
  depth?: number;
  level?: string;
}

export interface TestIFCData {
  fileName: string;
  fileSizeMB: number;
  ifcSchema: string;
  mockQuantities: Record<string, TestIFCQuantity>;
  mockElements: TestIFCElement[];
  expectedExtractorOutput: {
    totalElements: number;
    dominantStructuralSystem: string;
    estimatedConcreteVolume: number;
    estimatedRebarTonnage: number;
  };
}

export const testIFCData: TestIFCData = {
  fileName: "BKC_Tower_Structural_Model_v5.ifc",
  fileSizeMB: 34.7,
  ifcSchema: "IFC2X3",
  mockQuantities: {
    IfcSlab: { count: 34, totalArea: 16320, unit: "sqm" },
    IfcWall: { count: 847, totalArea: 28450, unit: "sqm" },
    IfcColumn: { count: 312, totalVolume: 624, unit: "cum" },
    IfcBeam: { count: 1240, totalLength: 4960, unit: "m" },
    IfcDoor: { count: 540, count_types: 3 },
    IfcWindow: { count: 1080, totalArea: 6480, unit: "sqm" },
    IfcStair: { count: 4 },
    IfcRoof: { count: 1, area: 510, unit: "sqm" },
  },
  mockElements: [
    {
      type: "IfcSlab",
      name: "Floor Slab FL-01",
      thickness: 200,
      area: 480,
      level: "Level 1",
    },
    {
      type: "IfcWall",
      name: "Shear Wall SW-01",
      thickness: 300,
      height: 3200,
      length: 8500,
    },
    {
      type: "IfcColumn",
      name: "RC Column C-01",
      width: 750,
      depth: 750,
      height: 3200,
    },
  ],
  expectedExtractorOutput: {
    totalElements: 4058,
    dominantStructuralSystem: "RC shear wall with flat plate",
    estimatedConcreteVolume: 8420,
    estimatedRebarTonnage: 1264,
  },
};

// ─── IN-005: Parameter Input ────────────────────────────────────────────────

export interface TestParameterSet {
  floors: number;
  gfa: number;
  height: number;
  style: string;
  buildingType: string;
  plotArea: number;
  fsi: number;
  unitMix?: string;
  groundFloorUse?: string;
  upperFloorUse?: string;
  parking?: string;
  amenities?: string[];
  basement?: number;
  podiumFloors?: number;
  towerFloors?: number;
  unitCount?: number;
  parkingCount?: number;
  sustainabilityTarget?: string;
  structuralSystem?: string;
}

export const testParameterSets: Record<string, TestParameterSet> = {
  residential_simple: {
    floors: 5,
    gfa: 3200,
    height: 17.5,
    style: "contemporary",
    buildingType: "residential",
    plotArea: 800,
    fsi: 4.0,
    unitMix: "2BHK",
  },

  mixedUse_intermediate: {
    floors: 12,
    gfa: 14400,
    height: 42.0,
    style: "modern",
    buildingType: "mixed_use",
    plotArea: 1800,
    fsi: 8.0,
    groundFloorUse: "retail",
    upperFloorUse: "residential",
    unitMix: "1BHK:2BHK:3BHK = 40:40:20",
    parking: "basement_2_levels",
    amenities: ["gym", "pool", "clubhouse"],
  },

  highrise_complex: {
    floors: 32,
    gfa: 48000,
    height: 112.0,
    style: "contemporary_glass",
    buildingType: "highrise_residential",
    plotArea: 3200,
    fsi: 15.0,
    basement: 2,
    podiumFloors: 5,
    towerFloors: 27,
    unitCount: 270,
    unitMix: "studio:1BHK:2BHK:3BHK:4BHK = 10:20:40:20:10",
    parkingCount: 350,
    sustainabilityTarget: "LEED_Gold",
    structuralSystem: "RC_shear_wall",
  },
};

// ─── IN-006: Location Input ─────────────────────────────────────────────────

export interface TestLocationExpectedGIS {
  lat?: number;
  lng?: number;
  city: string;
  zone?: string;
  fsi?: number;
  climate: string;
  seismicZone: string;
  floodRisk?: string;
  nearestMetro?: string;
}

export interface TestLocation {
  input: string;
  expectedGISOutput: TestLocationExpectedGIS;
}

export const testLocations: TestLocation[] = [
  {
    input: "Bandra Kurla Complex, Mumbai, Maharashtra",
    expectedGISOutput: {
      lat: 19.0596,
      lng: 72.8656,
      city: "Mumbai",
      zone: "commercial",
      fsi: 5.0,
      climate: "hot_humid",
      seismicZone: "Zone III",
      floodRisk: "moderate",
      nearestMetro: "BKC Metro Station - 0.3km",
    },
  },
  {
    input: "Hinjewadi IT Park Phase 2, Pune, Maharashtra",
    expectedGISOutput: {
      lat: 18.5912,
      lng: 73.7382,
      city: "Pune",
      zone: "it_special_economic_zone",
      climate: "semi_arid",
      seismicZone: "Zone III",
    },
  },
  {
    input: "Whitefield, Bengaluru, Karnataka",
    expectedGISOutput: {
      city: "Bengaluru",
      zone: "residential_commercial_mix",
      climate: "tropical_savanna",
      seismicZone: "Zone II",
    },
  },
  {
    input: "Sector 62, Noida, Uttar Pradesh",
    expectedGISOutput: {
      city: "Noida",
      zone: "mixed_use",
      climate: "semi_arid_hot",
      seismicZone: "Zone IV",
    },
  },
  {
    input: "Newtown Action Area 2, Kolkata, West Bengal",
    expectedGISOutput: {
      city: "Kolkata",
      zone: "planned_township",
      climate: "hot_humid",
      seismicZone: "Zone III",
    },
  },
];

// ─── IN-007: DXF/DWG Upload ────────────────────────────────────────────────

export interface TestCADLayer {
  name: string;
  color?: string;
  entityCount: number;
}

export interface TestCADFile {
  fileName: string;
  fileSizeKB: number;
  format: "DXF" | "DWG";
  acVersion?: string;
  mockLayers: TestCADLayer[];
  mockExtractedData: {
    plotArea?: number;
    buildingFootprint?: number;
    fsi?: number;
    setbacks?: { front: number; rear: number; left: number; right: number };
    accessRoads?: string[];
    floorArea?: number;
    unitCount?: number;
    unitTypes?: string[];
    corridorArea?: number;
    coreArea?: number;
  };
}

export const testCADFiles: TestCADFile[] = [
  {
    fileName: "BKC_Site_Plan_Layout.dxf",
    fileSizeKB: 1240,
    format: "DXF",
    acVersion: "AC1027",
    mockLayers: [
      { name: "SITE-BOUNDARY", color: "red", entityCount: 4 },
      { name: "BUILDING-FOOTPRINT", color: "blue", entityCount: 1 },
      { name: "ROAD-ACCESS", color: "yellow", entityCount: 3 },
      { name: "SETBACK-LINES", color: "green", entityCount: 4 },
      { name: "VEGETATION", color: "green", entityCount: 12 },
      { name: "DIMENSIONS", color: "white", entityCount: 24 },
    ],
    mockExtractedData: {
      plotArea: 3200,
      buildingFootprint: 1600,
      fsi: 15.0,
      setbacks: { front: 6, rear: 3, left: 3, right: 3 },
      accessRoads: ["north_60ft_road", "east_40ft_road"],
    },
  },
  {
    fileName: "Floor_Plan_Typical_Floor_L06.dwg",
    fileSizeKB: 2840,
    format: "DWG",
    mockLayers: [
      { name: "WALLS", entityCount: 234 },
      { name: "DOORS", entityCount: 18 },
      { name: "WINDOWS", entityCount: 42 },
      { name: "ROOMS", entityCount: 10 },
      { name: "DIMENSIONS", entityCount: 86 },
      { name: "TEXT", entityCount: 32 },
    ],
    mockExtractedData: {
      floorArea: 1480,
      unitCount: 10,
      unitTypes: ["2BHK", "3BHK"],
      corridorArea: 120,
      coreArea: 180,
    },
  },
];

// ─── Edge Case Test Inputs ──────────────────────────────────────────────────

export const edgeCaseInputs = {
  emptyText: "",
  nullText: null as string | null,
  shortText: "Hi",
  whitespaceOnly: "   \n\t  ",
  invalidFloors: -1,
  zeroGFA: 0,
  oversizedPDFMB: 25,
  oversizedIFCMB: 55,
  wrongFileType: "document.docx",
  unknownLocation: "Xyzzyville, Nowhere, Mars",
  noAECLayersDXF: [
    { name: "Layer1", entityCount: 5 },
    { name: "Layer2", entityCount: 3 },
  ],
};

// ─── Validation Thresholds ──────────────────────────────────────────────────

export const VALIDATION_THRESHOLDS = {
  minTextLength: 10,
  maxTextLength: 10000,
  maxPDFSizeMB: 20,
  maxIFCSizeMB: 50,
  maxImageSizeMB: 10,
  maxDXFSizeMB: 30,
  maxExecutionTimeMs: 30000,
  minFloors: 1,
  maxFloors: 200,
  minGFA: 1,
} as const;
