/**
 * Professional BOQ Generator with CSI Division Grouping
 * Generates industry-standard Bill of Quantities spreadsheets
 */

import * as XLSX from "xlsx";

export interface BOQLineItem {
  item: string;
  description: string;
  unit: string;
  quantity: number;
  unitRate: number;
  csiDivision?: string;
}

export interface BOQProjectInfo {
  projectName?: string;
  projectNumber?: string;
  location?: string;
  date?: string;
  preparedBy?: string;
}

// CSI MasterFormat Division Mapping
const CSI_DIVISIONS = {
  "01": "General Requirements",
  "02": "Existing Conditions",
  "03": "Concrete",
  "04": "Masonry",
  "05": "Metals",
  "06": "Wood, Plastics, and Composites",
  "07": "Thermal and Moisture Protection",
  "08": "Openings",
  "09": "Finishes",
  "10": "Specialties",
  "11": "Equipment",
  "12": "Furnishings",
  "13": "Special Construction",
  "14": "Conveying Equipment",
  "21": "Fire Suppression",
  "22": "Plumbing",
  "23": "HVAC",
  "26": "Electrical",
  "27": "Communications",
  "28": "Electronic Safety and Security",
  "31": "Earthwork",
  "32": "Exterior Improvements",
  "33": "Utilities",
};

/**
 * Infer CSI division from description keywords
 */
function inferCSIDivision(description: string): string {
  const desc = description.toLowerCase();
  
  if (desc.includes("concrete") || desc.includes("slab") || desc.includes("rc ")) return "03";
  if (desc.includes("masonry") || desc.includes("brick") || desc.includes("block")) return "04";
  if (desc.includes("steel") || desc.includes("column") || desc.includes("beam")) return "05";
  if (desc.includes("timber") || desc.includes("wood") || desc.includes("carpentry")) return "06";
  if (desc.includes("roof") || desc.includes("insulation") || desc.includes("waterproof")) return "07";
  if (desc.includes("window") || desc.includes("door") || desc.includes("glazing")) return "08";
  if (desc.includes("wall") && !desc.includes("external")) return "09";
  if (desc.includes("paint") || desc.includes("render") || desc.includes("finish")) return "09";
  if (desc.includes("plumbing") || desc.includes("sanitary") || desc.includes("drainage")) return "22";
  if (desc.includes("hvac") || desc.includes("ventilation") || desc.includes("heating")) return "23";
  if (desc.includes("electrical") || desc.includes("lighting") || desc.includes("power")) return "26";
  if (desc.includes("excavation") || desc.includes("earthwork") || desc.includes("foundation")) return "31";
  
  return "01"; // Default to General Requirements
}

/**
 * Generate professional BOQ Excel file
 */
export function generateProfessionalBOQ(
  items: BOQLineItem[],
  projectInfo: BOQProjectInfo = {},
  currency: string = "USD"
): Buffer {
  const wb = XLSX.utils.book_new();
  
  // Assign CSI divisions if missing
  const processedItems = items.map(item => ({
    ...item,
    csiDivision: item.csiDivision || inferCSIDivision(item.description),
    amount: item.quantity * item.unitRate,
  }));

  // Group items by CSI division
  const groupedItems = processedItems.reduce((acc, item) => {
    const div = item.csiDivision || "01";
    if (!acc[div]) acc[div] = [];
    acc[div].push(item);
    return acc;
  }, {} as Record<string, typeof processedItems>);

  // Sort divisions numerically
  const sortedDivisions = Object.keys(groupedItems).sort();

  // Build worksheet data
  const wsData: any[][] = [];

  // Header section with project info
  wsData.push([`BILL OF QUANTITIES`], []);
  
  if (projectInfo.projectName) {
    wsData.push([`Project:`, projectInfo.projectName]);
  }
  if (projectInfo.projectNumber) {
    wsData.push([`Project No.:`, projectInfo.projectNumber]);
  }
  if (projectInfo.location) {
    wsData.push([`Location:`, projectInfo.location]);
  }
  if (projectInfo.date) {
    wsData.push([`Date:`, projectInfo.date]);
  }
  if (projectInfo.preparedBy) {
    wsData.push([`Prepared By:`, projectInfo.preparedBy]);
  }
  
  wsData.push([], []); // Spacing

  let grandTotal = 0;
  let itemNumber = 1;

  // Generate BOQ by division
  sortedDivisions.forEach((divisionCode) => {
    const divisionName = CSI_DIVISIONS[divisionCode as keyof typeof CSI_DIVISIONS] || "Other";
    const divisionItems = groupedItems[divisionCode];

    // Division header
    wsData.push([`DIVISION ${divisionCode} - ${divisionName.toUpperCase()}`]);
    wsData.push([]);

    // Column headers
    wsData.push([
      "Item",
      "Description",
      "Unit",
      "Quantity",
      `Unit Rate (${currency})`,
      `Amount (${currency})`,
    ]);

    let divisionSubtotal = 0;

    // Add items
    divisionItems.forEach((item) => {
      wsData.push([
        `${divisionCode}.${itemNumber.toString().padStart(3, "0")}`,
        item.description,
        item.unit,
        item.quantity,
        item.unitRate,
        item.amount,
      ]);
      divisionSubtotal += item.amount;
      itemNumber++;
    });

    // Division subtotal
    wsData.push([]);
    wsData.push(["", "", "", "", `Division ${divisionCode} Subtotal:`, divisionSubtotal]);
    wsData.push([], []); // Spacing between divisions

    grandTotal += divisionSubtotal;
  });

  // Grand total
  wsData.push([]);
  wsData.push(["", "", "", "", "GRAND TOTAL:", grandTotal]);

  // Create worksheet
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Column widths
  ws["!cols"] = [
    { wch: 12 }, // Item
    { wch: 50 }, // Description
    { wch: 10 }, // Unit
    { wch: 12 }, // Quantity
    { wch: 15 }, // Unit Rate
    { wch: 18 }, // Amount
  ];

  // Style the header rows (bold)
  const range = XLSX.utils.decode_range(ws["!ref"] || "A1");
  for (let R = 0; R <= range.e.r; R++) {
    for (let C = 0; C <= range.e.c; C++) {
      const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = ws[cellAddress];
      
      if (!cell) continue;

      // Bold for headers and totals
      if (
        R === 0 || // Main title
        (typeof cell.v === "string" && (
          cell.v.includes("DIVISION") ||
          cell.v.includes("Subtotal") ||
          cell.v.includes("GRAND TOTAL") ||
          cell.v === "Item" ||
          cell.v === "Description"
        ))
      ) {
        cell.s = { font: { bold: true } };
      }

      // Number formatting for currency columns
      if (C === 4 || C === 5) { // Unit Rate and Amount columns
        if (typeof cell.v === "number") {
          cell.z = "#,##0.00";
        }
      }
    }
  }

  XLSX.utils.book_append_sheet(wb, ws, "Bill of Quantities");

  // Generate buffer
  return XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer;
}

/**
 * Convert legacy row format to BOQLineItem
 */
export function convertLegacyRowsToBOQ(
  rows: string[][],
  headers: string[]
): BOQLineItem[] {
  const items: BOQLineItem[] = [];

  rows.forEach((row) => {
    // Try to map common header patterns
    const description = row[0] || "";
    const unit = row[1] || "No.";
    const quantity = parseFloat(row[2]) || 0;
    const unitRate = parseFloat(row[3]?.replace(/[^0-9.-]/g, "")) || 0;

    if (description) {
      items.push({
        item: "",
        description,
        unit,
        quantity,
        unitRate,
      });
    }
  });

  return items;
}
