import { describe, it, expect } from "vitest";
import {
  TYPOLOGY_TEMPLATES,
  getTemplateById,
  getTemplatesByBedrooms,
  templateIdealArea,
  templateSlotCount,
  validateTemplate,
  type TypologyTemplate,
  type TemplateSlot,
} from "@/features/floor-plan/lib/typology-templates";
import { ROOM_RULES, getRoomRule } from "@/features/floor-plan/lib/architectural-rules";

// ── Helpers ─────────────────────────────────────────────────────────────────

const BEDROOM_TYPES = new Set([
  "master_bedroom", "bedroom", "guest_bedroom", "children_bedroom",
]);
const BATHROOM_TYPES = new Set([
  "bathroom", "master_bathroom", "toilet", "powder_room",
  "half_bath", "servant_toilet", "commercial_toilet",
]);
const CORRIDOR_TYPES = new Set(["corridor", "hallway", "passage"]);
const PUBLIC_ROOM_TYPES = new Set([
  "living_room", "dining_room", "drawing_room", "foyer",
  "entrance_lobby", "reception", "waiting_area", "corridor",
]);

function bedroomSlots(t: TypologyTemplate): TemplateSlot[] {
  return t.slots.filter(s => BEDROOM_TYPES.has(s.roomType));
}

function bathroomSlots(t: TypologyTemplate): TemplateSlot[] {
  return t.slots.filter(s => BATHROOM_TYPES.has(s.roomType));
}

// ── Global invariants ───────────────────────────────────────────────────────

describe("typology-templates — registry", () => {
  it("has exactly 12 templates", () => {
    expect(TYPOLOGY_TEMPLATES).toHaveLength(12);
  });

  it("has unique IDs across all templates", () => {
    const ids = TYPOLOGY_TEMPLATES.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("getTemplateById returns correct template", () => {
    const t = getTemplateById("3bhk-double-loaded");
    expect(t).toBeDefined();
    expect(t!.name).toBe("3BHK Double-Loaded Corridor");
  });

  it("getTemplateById returns undefined for unknown ID", () => {
    expect(getTemplateById("nonexistent")).toBeUndefined();
  });

  it("getTemplatesByBedrooms returns matching templates", () => {
    const twoB = getTemplatesByBedrooms(2);
    expect(twoB.length).toBeGreaterThanOrEqual(2);
    for (const t of twoB) {
      expect(t.applicability.minBedrooms).toBeLessThanOrEqual(2);
      expect(t.applicability.maxBedrooms).toBeGreaterThanOrEqual(2);
    }
  });

  it("getTemplatesByBedrooms(0) returns the office template", () => {
    const zero = getTemplatesByBedrooms(0);
    expect(zero.some(t => t.id === "office-open-plan")).toBe(true);
  });
});

// ── Per-template structural validation ──────────────────────────────────────

describe.each(TYPOLOGY_TEMPLATES)(
  "template: $id",
  (template) => {

    it("passes validateTemplate() with no errors", () => {
      const errors = validateTemplate(template);
      expect(errors).toEqual([]);
    });

    it("has at least 1 bedroom slot (residential) or 0 (commercial)", () => {
      const beds = bedroomSlots(template);
      if (template.applicability.buildingTypes.some(bt =>
        ["office", "commercial", "coworking"].includes(bt)
      )) {
        // Commercial templates may have 0 bedrooms
        expect(beds.length).toBeGreaterThanOrEqual(0);
      } else {
        expect(beds.length).toBeGreaterThanOrEqual(1);
      }
    });

    it("has at least 1 bathroom slot", () => {
      const baths = bathroomSlots(template);
      expect(baths.length).toBeGreaterThanOrEqual(1);
    });

    it("every connection references valid slot IDs", () => {
      const slotIds = new Set(template.slots.map(s => s.id));
      for (const conn of template.connections) {
        expect(slotIds.has(conn.from)).toBe(true);
        expect(slotIds.has(conn.to)).toBe(true);
      }
    });

    it("entrance connectsTo references a valid slot", () => {
      const slotIds = new Set(template.slots.map(s => s.id));
      expect(slotIds.has(template.entrance.connectsTo)).toBe(true);
    });

    it("entrance connectsTo a public or circulation room", () => {
      const slot = template.slots.find(s => s.id === template.entrance.connectsTo);
      expect(slot).toBeDefined();
      const isPublicish = slot!.zone === "public" || slot!.zone === "circulation"
        || PUBLIC_ROOM_TYPES.has(slot!.roomType);
      expect(isPublicish).toBe(true);
    });

    it("ideal area sum is within the applicability range (with 25% tolerance)", () => {
      const idealArea = templateIdealArea(template);
      // Ideal area can slightly exceed applicability range because of corridors / circulation overhead
      expect(idealArea).toBeGreaterThanOrEqual(template.applicability.minAreaSqm * 0.75);
      expect(idealArea).toBeLessThanOrEqual(template.applicability.maxAreaSqm * 1.25);
    });

    it("corridor slots are in the circulation zone", () => {
      for (const slot of template.slots) {
        if (CORRIDOR_TYPES.has(slot.roomType)) {
          expect(slot.zone).toBe("circulation");
        }
      }
    });

    it("no slot has ideal aspect ratio exceeding its maxAspectRatio", () => {
      for (const slot of template.slots) {
        const longer = Math.max(slot.idealWidth, slot.idealDepth);
        const shorter = Math.min(slot.idealWidth, slot.idealDepth);
        const ar = shorter > 0 ? longer / shorter : Infinity;
        expect(ar).toBeLessThanOrEqual(slot.maxAspectRatio + 0.01);
      }
    });

    it("no slot has idealWidth < minWidth", () => {
      for (const slot of template.slots) {
        expect(slot.idealWidth).toBeGreaterThanOrEqual(slot.minWidth - 0.01);
      }
    });

    it("no slot has idealDepth < minDepth", () => {
      for (const slot of template.slots) {
        expect(slot.idealDepth).toBeGreaterThanOrEqual(slot.minDepth - 0.01);
      }
    });

    it("slot minWidth matches architectural-rules.ts where rule exists", () => {
      for (const slot of template.slots) {
        const rule = ROOM_RULES[slot.roomType];
        if (rule) {
          expect(slot.minWidth).toBeGreaterThanOrEqual(rule.width.min - 0.01);
        }
      }
    });

    it("slot minDepth matches architectural-rules.ts where rule exists", () => {
      for (const slot of template.slots) {
        const rule = ROOM_RULES[slot.roomType];
        if (rule) {
          expect(slot.minDepth).toBeGreaterThanOrEqual(rule.depth.min - 0.01);
        }
      }
    });

    it("has unique slot IDs", () => {
      const ids = template.slots.map(s => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("applicability minAreaSqm < maxAreaSqm", () => {
      expect(template.applicability.minAreaSqm).toBeLessThan(
        template.applicability.maxAreaSqm,
      );
    });

    it("applicability minBedrooms <= maxBedrooms", () => {
      expect(template.applicability.minBedrooms).toBeLessThanOrEqual(
        template.applicability.maxBedrooms,
      );
    });

    it("has at least 1 required connection", () => {
      const requiredConns = template.connections.filter(c => c.required);
      expect(requiredConns.length).toBeGreaterThanOrEqual(1);
    });

    it("every required slot is reachable via connections from entrance", () => {
      // BFS from entrance slot through connections
      const visited = new Set<string>();
      const queue: string[] = [template.entrance.connectsTo];
      visited.add(template.entrance.connectsTo);

      while (queue.length > 0) {
        const current = queue.shift()!;
        for (const conn of template.connections) {
          const neighbor = conn.from === current ? conn.to
            : conn.to === current ? conn.from
            : null;
          if (neighbor && !visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }

      for (const slot of template.slots) {
        if (slot.required) {
          expect(visited.has(slot.id)).toBe(true);
        }
      }
    });
  },
);

// ── Summary statistics ──────────────────────────────────────────────────────

describe("template statistics", () => {
  it("prints ideal area and slot count for each template", () => {
    const stats: string[] = [];
    for (const t of TYPOLOGY_TEMPLATES) {
      const area = templateIdealArea(t);
      const count = templateSlotCount(t);
      stats.push(
        `${t.id.padEnd(24)} | slots: ${String(count).padStart(2)} | ideal area: ${area.toFixed(1).padStart(7)} sqm`,
      );
    }
    // Print to test output for visibility
    console.log("\n=== TEMPLATE SUMMARY ===");
    for (const line of stats) {
      console.log(line);
    }
    console.log("========================\n");

    // Sanity: every template has at least 3 slots
    for (const t of TYPOLOGY_TEMPLATES) {
      expect(templateSlotCount(t)).toBeGreaterThanOrEqual(3);
    }
  });
});

// ── Specific template spot-checks ───────────────────────────────────────────

describe("spot-checks", () => {
  it("3bhk-double-loaded has 3 bedrooms and 3+ bathrooms", () => {
    const t = getTemplateById("3bhk-double-loaded")!;
    expect(bedroomSlots(t).length).toBe(3);
    expect(bathroomSlots(t).length).toBeGreaterThanOrEqual(3);
  });

  it("3bhk-double-loaded has kitchen→dining adjacency", () => {
    const t = getTemplateById("3bhk-double-loaded")!;
    const kitchenDining = t.connections.find(
      c => (c.from === "dining" && c.to === "kitchen") ||
           (c.from === "kitchen" && c.to === "dining"),
    );
    expect(kitchenDining).toBeDefined();
  });

  it("3bhk-double-loaded has living→dining open connection", () => {
    const t = getTemplateById("3bhk-double-loaded")!;
    const livingDining = t.connections.find(
      c => (c.from === "living" && c.to === "dining") ||
           (c.from === "dining" && c.to === "living"),
    );
    expect(livingDining).toBeDefined();
    expect(livingDining!.type).toBe("open");
  });

  it("1bhk-studio has no corridor", () => {
    const t = getTemplateById("1bhk-studio")!;
    expect(t.corridorType).toBe("none");
    expect(t.slots.some(s => CORRIDOR_TYPES.has(s.roomType))).toBe(false);
  });

  it("4bhk-duplex-ground has staircase", () => {
    const t = getTemplateById("4bhk-duplex-ground")!;
    expect(t.slots.some(s => s.roomType === "staircase")).toBe(true);
  });

  it("4bhk-duplex-upper has staircase", () => {
    const t = getTemplateById("4bhk-duplex-upper")!;
    expect(t.slots.some(s => s.roomType === "staircase")).toBe(true);
  });

  it("5bhk-villa has servant quarter and servant toilet", () => {
    const t = getTemplateById("5bhk-villa")!;
    expect(t.slots.some(s => s.roomType === "servant_quarter")).toBe(true);
    expect(t.slots.some(s => s.roomType === "servant_toilet")).toBe(true);
  });

  it("5bhk-villa has drawing room", () => {
    const t = getTemplateById("5bhk-villa")!;
    expect(t.slots.some(s => s.roomType === "drawing_room")).toBe(true);
  });

  it("office-open-plan has 0 bedrooms in applicability", () => {
    const t = getTemplateById("office-open-plan")!;
    expect(t.applicability.minBedrooms).toBe(0);
    expect(t.applicability.maxBedrooms).toBe(0);
  });

  it("office-open-plan has conference room and open workspace", () => {
    const t = getTemplateById("office-open-plan")!;
    expect(t.slots.some(s => s.roomType === "conference_room")).toBe(true);
    expect(t.slots.some(s => s.roomType === "open_workspace")).toBe(true);
  });

  it("bedroom-bath pairs that ARE connected use door type", () => {
    for (const t of TYPOLOGY_TEMPLATES) {
      for (const slot of t.slots) {
        const match = slot.id.match(/^bedroom(\d+)$/);
        if (!match) continue;
        const bathId = `bath${match[1]}`;
        const bathSlot = t.slots.find(s => s.id === bathId);
        if (!bathSlot) continue;

        // Only check pairs that have a direct connection (attached bathrooms).
        // Common bathrooms are accessed via corridor and won't have a direct link.
        const conn = t.connections.find(
          c => (c.from === slot.id && c.to === bathId) ||
               (c.from === bathId && c.to === slot.id),
        );
        if (conn) {
          expect(conn.type).toBe("door");
        }
      }
    }
  });

  it("every master bedroom has an attached master bathroom via door", () => {
    for (const t of TYPOLOGY_TEMPLATES) {
      const masterBed = t.slots.find(s => s.roomType === "master_bedroom");
      const masterBath = t.slots.find(s => s.roomType === "master_bathroom");
      if (!masterBed || !masterBath) continue;

      const conn = t.connections.find(
        c => (c.from === masterBed.id && c.to === masterBath.id) ||
             (c.from === masterBath.id && c.to === masterBed.id),
      );
      expect(conn).toBeDefined();
      expect(conn!.type).toBe("door");
    }
  });

  it("master bedroom is the largest bedroom in templates with multiple bedrooms", () => {
    for (const t of TYPOLOGY_TEMPLATES) {
      const beds = bedroomSlots(t);
      if (beds.length < 2) continue;
      const master = beds.find(b => b.roomType === "master_bedroom");
      if (!master) continue;
      const masterArea = master.idealWidth * master.idealDepth;
      for (const bed of beds) {
        if (bed.id === master.id) continue;
        const area = bed.idealWidth * bed.idealDepth;
        expect(masterArea).toBeGreaterThanOrEqual(area - 0.1);
      }
    }
  });
});
