export interface UnitRate {
  csi: string;
  division: string;
  description: string;
  unit: string;
  material: number;
  labor: number;
  equipment: number;
  total: number;
}

// Real construction unit rates (CSI MasterFormat, USD, National Average)
export const UNIT_RATES: UnitRate[] = [
  // DIVISION 03 - CONCRETE
  { csi: "03-11-13.25", division: "03", description: "Concrete Column Formwork", unit: "SFCA", material: 3.50, labor: 12.80, equipment: 0.70, total: 17.00 },
  { csi: "03-30-53.40", division: "03", description: "Concrete Slab 4\" Thick", unit: "SF", material: 2.85, labor: 3.20, equipment: 0.95, total: 7.00 },
  { csi: "03-30-53.45", division: "03", description: "Concrete Slab 6\" Thick", unit: "SF", material: 4.25, labor: 3.50, equipment: 1.15, total: 8.90 },
  { csi: "03-15-13.10", division: "03", description: "Concrete Footing 12\"x24\"", unit: "LF", material: 18.50, labor: 12.30, equipment: 3.20, total: 34.00 },
  { csi: "03-21-11.10", division: "03", description: "Reinforcing Steel #4 Bars", unit: "LB", material: 0.85, labor: 0.65, equipment: 0.05, total: 1.55 },

  // DIVISION 04 - MASONRY
  { csi: "04-22-10.15", division: "04", description: "Concrete Block 8\" Standard", unit: "SF", material: 4.20, labor: 8.50, equipment: 0.30, total: 13.00 },
  { csi: "04-21-13.13", division: "04", description: "Brick Veneer Running Bond", unit: "SF", material: 8.50, labor: 15.20, equipment: 0.80, total: 24.50 },

  // DIVISION 05 - METALS
  { csi: "05-12-23.10", division: "05", description: "Structural Steel W12x26", unit: "LB", material: 1.25, labor: 0.85, equipment: 0.40, total: 2.50 },
  { csi: "05-31-13.25", division: "05", description: "Metal Deck 20 Gauge", unit: "SF", material: 3.20, labor: 2.80, equipment: 0.50, total: 6.50 },

  // DIVISION 06 - WOOD & PLASTICS
  { csi: "06-11-10.10", division: "06", description: "Wood Framing 2x4 Studs 16\" OC", unit: "LF", material: 2.40, labor: 3.80, equipment: 0.20, total: 6.40 },
  { csi: "06-16-23.10", division: "06", description: "Plywood Sheathing 1/2\"", unit: "SF", material: 1.85, labor: 1.40, equipment: 0.15, total: 3.40 },

  // DIVISION 07 - THERMAL & MOISTURE
  { csi: "07-21-13.10", division: "07", description: "Batt Insulation R-19", unit: "SF", material: 0.85, labor: 0.65, equipment: 0.05, total: 1.55 },
  { csi: "07-51-13.10", division: "07", description: "TPO Roofing 60 mil", unit: "SF", material: 3.20, labor: 2.80, equipment: 0.50, total: 6.50 },

  // DIVISION 08 - OPENINGS
  { csi: "08-11-13.10", division: "08", description: "Steel Door 3070 Hollow Metal", unit: "EA", material: 450.00, labor: 180.00, equipment: 20.00, total: 650.00 },
  { csi: "08-51-13.10", division: "08", description: "Vinyl Window 3x4 Double Hung", unit: "EA", material: 320.00, labor: 140.00, equipment: 15.00, total: 475.00 },

  // DIVISION 09 - FINISHES
  { csi: "09-22-16.13", division: "09", description: "Gypsum Board 1/2\" Regular", unit: "SF", material: 0.65, labor: 1.85, equipment: 0.10, total: 2.60 },
  { csi: "09-91-13.10", division: "09", description: "Interior Paint 2 Coats", unit: "SF", material: 0.45, labor: 1.20, equipment: 0.05, total: 1.70 },
  { csi: "09-65-13.10", division: "09", description: "Resilient Flooring", unit: "SF", material: 3.80, labor: 2.40, equipment: 0.10, total: 6.30 },

  // DIVISION 22 - PLUMBING (simplified)
  { csi: "22-11-13.10", division: "22", description: "Plumbing Rough-In per Fixture", unit: "EA", material: 850.00, labor: 1200.00, equipment: 50.00, total: 2100.00 },

  // DIVISION 26 - ELECTRICAL (simplified)
  { csi: "26-05-13.10", division: "26", description: "Electrical Rough-In per 1000SF", unit: "MSF", material: 3500.00, labor: 4800.00, equipment: 200.00, total: 8500.00 },
];

// Map IFC element types to CSI codes
export const IFC_TO_CSI_MAP: Record<string, string[]> = {
  IfcWall: ["04-22-10.15", "09-22-16.13", "09-91-13.10", "07-21-13.10"],
  IfcSlab: ["03-30-53.40", "09-65-13.10"],
  IfcColumn: ["03-11-13.25", "05-12-23.10"],
  IfcBeam: ["05-12-23.10"],
  IfcWindow: ["08-51-13.10"],
  IfcDoor: ["08-11-13.10"],
  IfcRoof: ["07-51-13.10", "07-21-13.10"],
  IfcStair: ["03-30-53.45"],
  IfcFooting: ["03-15-13.10", "03-21-11.10"],
  IfcCurtainWall: ["08-51-13.10", "05-31-13.25"],
  IfcRailing: ["05-12-23.10"],
  IfcSpace: ["09-91-13.10", "09-65-13.10"],
};

export function getUnitRate(csi: string): UnitRate | undefined {
  return UNIT_RATES.find(r => r.csi === csi);
}

export function getRatesForElement(ifcType: string): UnitRate[] {
  const csiCodes = IFC_TO_CSI_MAP[ifcType] || [];
  return csiCodes.map(code => getUnitRate(code)).filter(Boolean) as UnitRate[];
}

export interface BOQLine {
  division: string;
  csiCode: string;
  description: string;
  unit: string;
  quantity: number;
  materialRate: number;
  laborRate: number;
  equipmentRate: number;
  unitRate: number;
  materialCost: number;
  laborCost: number;
  equipmentCost: number;
  totalCost: number;
}

export function calculateBOQ(elements: Array<{ type: string; count: number; area?: number }>): {
  lines: BOQLine[];
  subtotalMaterial: number;
  subtotalLabor: number;
  subtotalEquipment: number;
  grandTotal: number;
} {
  const lines: BOQLine[] = [];
  let subtotalMaterial = 0;
  let subtotalLabor = 0;
  let subtotalEquipment = 0;

  for (const element of elements) {
    const rates = getRatesForElement(element.type);

    for (const rate of rates) {
      // Use area if available, otherwise use count
      const qty = rate.unit === "EA" ? element.count : (element.area || element.count * 50);
      const wasteFactor = 1.05; // 5% waste
      const adjustedQty = Math.round(qty * wasteFactor * 100) / 100;

      const matCost = Math.round(adjustedQty * rate.material * 100) / 100;
      const labCost = Math.round(adjustedQty * rate.labor * 100) / 100;
      const equipCost = Math.round(adjustedQty * rate.equipment * 100) / 100;
      const totalCost = Math.round((matCost + labCost + equipCost) * 100) / 100;

      lines.push({
        division: rate.division,
        csiCode: rate.csi,
        description: rate.description,
        unit: rate.unit,
        quantity: adjustedQty,
        materialRate: rate.material,
        laborRate: rate.labor,
        equipmentRate: rate.equipment,
        unitRate: rate.total,
        materialCost: matCost,
        laborCost: labCost,
        equipmentCost: equipCost,
        totalCost,
      });

      subtotalMaterial += matCost;
      subtotalLabor += labCost;
      subtotalEquipment += equipCost;
    }
  }

  // Sort by division then CSI code
  lines.sort((a, b) => a.csiCode.localeCompare(b.csiCode));

  return {
    lines,
    subtotalMaterial: Math.round(subtotalMaterial * 100) / 100,
    subtotalLabor: Math.round(subtotalLabor * 100) / 100,
    subtotalEquipment: Math.round(subtotalEquipment * 100) / 100,
    grandTotal: Math.round((subtotalMaterial + subtotalLabor + subtotalEquipment) * 100) / 100,
  };
}
