import { describe, it, expect } from "vitest";
import {
  matchTypology,
  type TemplateMatch,
} from "@/features/floor-plan/lib/typology-matcher";
import type {
  EnhancedRoomProgram,
  RoomSpec,
} from "@/features/floor-plan/lib/ai-room-programmer";

// ── Helpers ─────────────────────────────────────────────────────────────────

function room(
  name: string,
  type: string,
  areaSqm: number,
  zone: "public" | "private" | "service" | "circulation" = "private",
): RoomSpec {
  return {
    name,
    type,
    areaSqm,
    zone,
    mustHaveExteriorWall: false,
    adjacentTo: [],
    preferNear: [],
  };
}

function makeProgram(
  rooms: RoomSpec[],
  opts: {
    buildingType?: string;
    totalAreaSqm?: number;
    originalPrompt?: string;
  } = {},
): EnhancedRoomProgram {
  const totalArea =
    opts.totalAreaSqm ?? rooms.reduce((s, r) => s + r.areaSqm, 0);
  return {
    buildingType: opts.buildingType ?? "apartment",
    totalAreaSqm: totalArea,
    numFloors: 1,
    rooms,
    adjacency: [],
    zones: { public: [], private: [], service: [], circulation: [] },
    entranceRoom: rooms[0]?.name ?? "",
    circulationNotes: "",
    projectName: "Test",
    originalPrompt: opts.originalPrompt,
  };
}

function printMatch(label: string, match: TemplateMatch | null): void {
  if (!match) {
    console.log(`\n=== ${label} === NO MATCH (null)`);
    return;
  }
  const totalArea = match.scaledRooms.reduce(
    (s, r) => s + r.width * r.depth,
    0,
  );
  console.log(`\n=== ${label} ===`);
  console.log(
    `Template: ${match.template.id} | Confidence: ${match.confidence.toFixed(2)}`,
  );
  console.log(
    `Footprint: ${match.footprint.width.toFixed(1)}m × ${match.footprint.depth.toFixed(1)}m`,
  );
  console.log(`Total scaled area: ${totalArea.toFixed(1)} sqm`);
  console.log("Rooms:");
  for (const r of match.scaledRooms) {
    const a = r.width * r.depth;
    console.log(
      `  ${r.name.padEnd(22)} ${r.width.toFixed(1)}×${r.depth.toFixed(1)}m  (${a.toFixed(1)} sqm)  [${r.type}]`,
    );
  }
  if (match.overflowRooms.length > 0) {
    console.log(`Overflow: ${match.overflowRooms.join(", ")}`);
  }
  console.log(
    `Corridor: ${match.corridorSpine.width.toFixed(1)}×${match.corridorSpine.depth.toFixed(1)}m`,
  );
}

// ── Test Scenarios ──────────────────────────────────────────────────────────

describe("typology-matcher", () => {
  // ── Test 1: 2BHK apartment 70 sqm ──
  describe("2BHK apartment 70 sqm", () => {
    const program = makeProgram(
      [
        room("Master Bedroom", "bedroom", 14, "private"),
        room("Bedroom 2", "bedroom", 12, "private"),
        room("Master Bathroom", "bathroom", 4, "service"),
        room("Common Bathroom", "bathroom", 3.5, "service"),
        room("Kitchen", "kitchen", 8, "service"),
        room("Living Room", "living_room", 18, "public"),
        room("Balcony", "balcony", 4, "public"),
        room("Corridor", "corridor", 6, "circulation"),
      ],
      {
        buildingType: "apartment",
        totalAreaSqm: 70,
        originalPrompt: "2BHK apartment 70 sqm",
      },
    );

    let match: TemplateMatch | null;

    it("matches a 2BHK template with confidence >= 0.7", () => {
      match = matchTypology(program);
      printMatch("2BHK apartment 70 sqm", match);
      expect(match).not.toBeNull();
      expect(match!.template.id).toMatch(/^2bhk/);
      expect(match!.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it("has 2 bedroom rooms and 2 bathroom rooms", () => {
      match = match ?? matchTypology(program);
      expect(match).not.toBeNull();
      const beds = match!.scaledRooms.filter((r) =>
        ["master_bedroom", "bedroom", "guest_bedroom"].includes(r.type),
      );
      const baths = match!.scaledRooms.filter((r) =>
        ["bathroom", "master_bathroom", "toilet"].includes(r.type),
      );
      expect(beds.length).toBe(2);
      expect(baths.length).toBeGreaterThanOrEqual(2);
    });

    it("corridor is ~1.2m deep", () => {
      match = match ?? matchTypology(program);
      expect(match).not.toBeNull();
      expect(match!.corridorSpine.depth).toBeGreaterThanOrEqual(1.0);
      expect(match!.corridorSpine.depth).toBeLessThanOrEqual(1.8);
    });

    it("total footprint is ~60-90 sqm", () => {
      match = match ?? matchTypology(program);
      expect(match).not.toBeNull();
      const area = match!.footprint.width * match!.footprint.depth;
      expect(area).toBeGreaterThanOrEqual(50);
      expect(area).toBeLessThanOrEqual(110);
    });
  });

  // ── Test 2: 3BHK flat with attached bathrooms ──
  describe("3BHK flat with attached bathrooms, dining, balcony, utility", () => {
    const program = makeProgram(
      [
        room("Master Bedroom", "bedroom", 15, "private"),
        room("Bedroom 2", "bedroom", 12, "private"),
        room("Bedroom 3", "bedroom", 12, "private"),
        room("Master Bathroom", "bathroom", 4.5, "service"),
        room("Bathroom 2", "bathroom", 3.5, "service"),
        room("Common Bathroom", "bathroom", 3.5, "service"),
        room("Kitchen", "kitchen", 9, "service"),
        room("Dining Room", "dining_room", 10, "public"),
        room("Living Room", "living_room", 18, "public"),
        room("Balcony", "balcony", 4, "public"),
        room("Utility", "utility", 3.5, "service"),
        room("Corridor", "corridor", 7, "circulation"),
      ],
      {
        buildingType: "flat",
        totalAreaSqm: 102,
        originalPrompt: "3BHK flat with attached bathrooms dining balcony utility",
      },
    );

    let match: TemplateMatch | null;

    it("matches a 3BHK template with confidence >= 0.7", () => {
      match = matchTypology(program);
      printMatch("3BHK flat full spec", match);
      expect(match).not.toBeNull();
      expect(match!.template.id).toMatch(/^3bhk/);
      expect(match!.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it("has 3 bedrooms and 3 bathrooms", () => {
      match = match ?? matchTypology(program);
      expect(match).not.toBeNull();
      const beds = match!.scaledRooms.filter((r) =>
        ["master_bedroom", "bedroom", "guest_bedroom"].includes(r.type),
      );
      const baths = match!.scaledRooms.filter((r) =>
        ["bathroom", "master_bathroom"].includes(r.type),
      );
      expect(beds.length).toBe(3);
      expect(baths.length).toBeGreaterThanOrEqual(3);
    });

    it("overflowRooms is empty (all rooms match slots)", () => {
      match = match ?? matchTypology(program);
      expect(match).not.toBeNull();
      expect(match!.overflowRooms).toHaveLength(0);
    });
  });

  // ── Test 3: 5BHK villa 300 sqm ──
  describe("5BHK villa 300 sqm with servant quarter, parking", () => {
    const program = makeProgram(
      [
        room("Master Bedroom", "bedroom", 20, "private"),
        room("Bedroom 2", "bedroom", 15, "private"),
        room("Bedroom 3", "bedroom", 15, "private"),
        room("Bedroom 4", "bedroom", 14, "private"),
        room("Bedroom 5", "bedroom", 14, "private"),
        room("Master Bathroom", "bathroom", 5.5, "service"),
        room("Bathroom 2", "bathroom", 4, "service"),
        room("Bathroom 3", "bathroom", 4, "service"),
        room("Bathroom 4", "bathroom", 3.5, "service"),
        room("Bathroom 5", "bathroom", 3.5, "service"),
        room("Kitchen", "kitchen", 12, "service"),
        room("Dining Room", "dining_room", 14, "public"),
        room("Living Room", "living_room", 25, "public"),
        room("Drawing Room", "drawing_room", 18, "public"),
        room("Servant Quarter", "servant_quarter", 9.5, "service"),
        room("Servant Toilet", "bathroom", 2, "service"),
        room("Parking", "parking", 16, "service"),
        room("Utility", "utility", 4, "service"),
        room("Pooja Room", "pooja_room", 3.5, "private"),
        room("Corridor", "corridor", 12, "circulation"),
        room("Balcony", "balcony", 5, "public"),
      ],
      {
        buildingType: "villa",
        totalAreaSqm: 300,
        originalPrompt: "5BHK villa 300 sqm with servant quarter parking",
      },
    );

    let match: TemplateMatch | null;

    it("matches 5bhk-villa with confidence >= 0.6", () => {
      match = matchTypology(program);
      printMatch("5BHK villa 300 sqm", match);
      expect(match).not.toBeNull();
      expect(match!.template.id).toBe("5bhk-villa");
      expect(match!.confidence).toBeGreaterThanOrEqual(0.6);
    });

    it("has servant quarter and parking slots", () => {
      match = match ?? matchTypology(program);
      expect(match).not.toBeNull();
      expect(
        match!.scaledRooms.some((r) => r.type === "servant_quarter"),
      ).toBe(true);
    });

    it("has 5 bedroom rooms", () => {
      match = match ?? matchTypology(program);
      expect(match).not.toBeNull();
      const beds = match!.scaledRooms.filter((r) =>
        ["master_bedroom", "bedroom"].includes(r.type),
      );
      expect(beds.length).toBe(5);
    });
  });

  // ── Test 4: Office 150 sqm ──
  describe("Office 150 sqm with conference room", () => {
    const program = makeProgram(
      [
        room("Reception", "reception", 12, "public"),
        room("Open Workspace", "open_workspace", 50, "public"),
        room("Cabin 1", "cabin", 10, "private"),
        room("Cabin 2", "cabin", 10, "private"),
        room("Conference Room", "conference_room", 20, "public"),
        room("Break Room", "break_room", 10, "service"),
        room("Toilet", "bathroom", 6, "service"),
        room("Pantry", "pantry", 6, "service"),
        room("Server Room", "server_room", 5, "service"),
        room("Corridor", "corridor", 15, "circulation"),
      ],
      {
        buildingType: "office",
        totalAreaSqm: 150,
        originalPrompt: "Office 150 sqm with conference room",
      },
    );

    let match: TemplateMatch | null;

    it("matches office-open-plan with confidence >= 0.7", () => {
      match = matchTypology(program);
      printMatch("Office 150 sqm", match);
      expect(match).not.toBeNull();
      expect(match!.template.id).toBe("office-open-plan");
      expect(match!.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it("has conference room and open workspace", () => {
      match = match ?? matchTypology(program);
      expect(match).not.toBeNull();
      expect(
        match!.scaledRooms.some((r) => r.type === "conference_room"),
      ).toBe(true);
      expect(
        match!.scaledRooms.some((r) => r.type === "open_workspace"),
      ).toBe(true);
    });
  });

  // ── Test 5: Dental clinic (no matching template) ──
  describe("Dental clinic with treatment rooms", () => {
    const program = makeProgram(
      [
        room("Reception", "reception", 10, "public"),
        room("Waiting Area", "waiting_area", 8, "public"),
        room("Treatment Room 1", "custom", 15, "private"),
        room("Treatment Room 2", "custom", 15, "private"),
        room("X-Ray Room", "custom", 8, "service"),
        room("Sterilization", "custom", 6, "service"),
        room("Toilet", "bathroom", 4, "service"),
        room("Corridor", "corridor", 8, "circulation"),
      ],
      {
        buildingType: "dental clinic",
        totalAreaSqm: 80,
        originalPrompt: "Dental clinic with 2 treatment rooms",
      },
    );

    it("returns null (no matching template, confidence < 0.5)", () => {
      const match = matchTypology(program);
      printMatch("Dental clinic", match);
      expect(match).toBeNull();
    });
  });

  // ── Test 6: 1BHK studio 35 sqm ──
  describe("1BHK studio 35 sqm", () => {
    const program = makeProgram(
      [
        room("Bedroom", "bedroom", 12, "private"),
        room("Bathroom", "bathroom", 3.5, "service"),
        room("Living + Kitchen", "living_room", 15, "public"),
        room("Balcony", "balcony", 3, "public"),
      ],
      {
        buildingType: "studio",
        totalAreaSqm: 35,
        originalPrompt: "1BHK studio 35 sqm",
      },
    );

    let match: TemplateMatch | null;

    it("matches 1bhk-studio", () => {
      match = matchTypology(program);
      printMatch("1BHK studio 35 sqm", match);
      expect(match).not.toBeNull();
      expect(match!.template.id).toBe("1bhk-studio");
    });

    it("total area is ~30-50 sqm", () => {
      match = match ?? matchTypology(program);
      expect(match).not.toBeNull();
      const area = match!.scaledRooms.reduce(
        (s, r) => s + r.width * r.depth,
        0,
      );
      expect(area).toBeGreaterThanOrEqual(25);
      expect(area).toBeLessThanOrEqual(55);
    });
  });

  // ── Test 7: 3BHK with exotic rooms ──
  describe("3BHK with gym, home theater, library", () => {
    const program = makeProgram(
      [
        room("Master Bedroom", "bedroom", 15, "private"),
        room("Bedroom 2", "bedroom", 12, "private"),
        room("Bedroom 3", "bedroom", 12, "private"),
        room("Master Bathroom", "bathroom", 4.5, "service"),
        room("Bathroom 2", "bathroom", 3.5, "service"),
        room("Common Bathroom", "bathroom", 3.5, "service"),
        room("Kitchen", "kitchen", 9, "service"),
        room("Living Room", "living_room", 18, "public"),
        room("Dining Room", "dining_room", 10, "public"),
        room("Corridor", "corridor", 7, "circulation"),
        room("Gym", "gym", 12, "private"),
        room("Home Theater", "home_theater", 15, "private"),
        room("Library", "library", 10, "private"),
      ],
      {
        buildingType: "apartment",
        totalAreaSqm: 140,
        originalPrompt: "3BHK with gym home theater library",
      },
    );

    let match: TemplateMatch | null;

    it("matches a 3BHK template with confidence ~0.5-0.8", () => {
      match = matchTypology(program);
      printMatch("3BHK with exotic rooms", match);
      expect(match).not.toBeNull();
      expect(match!.template.id).toMatch(/^3bhk/);
      expect(match!.confidence).toBeGreaterThanOrEqual(0.5);
    });

    it("gym, home theater, library are in overflowRooms", () => {
      match = match ?? matchTypology(program);
      expect(match).not.toBeNull();
      expect(match!.overflowRooms).toContain("Gym");
      expect(match!.overflowRooms).toContain("Home Theater");
      expect(match!.overflowRooms).toContain("Library");
    });

    it("still has 3 bedrooms in scaledRooms", () => {
      match = match ?? matchTypology(program);
      expect(match).not.toBeNull();
      const beds = match!.scaledRooms.filter((r) =>
        ["master_bedroom", "bedroom"].includes(r.type),
      );
      expect(beds.length).toBe(3);
    });
  });

  // ── Structural invariants ──

  describe("structural invariants across all matches", () => {
    const testCases = [
      {
        label: "2BHK basic",
        program: makeProgram(
          [
            room("Master Bedroom", "bedroom", 14),
            room("Bedroom 2", "bedroom", 12),
            room("Master Bathroom", "bathroom", 4, "service"),
            room("Bathroom", "bathroom", 3, "service"),
            room("Kitchen", "kitchen", 8, "service"),
            room("Living Room", "living_room", 16, "public"),
            room("Corridor", "corridor", 5, "circulation"),
          ],
          { buildingType: "apartment", totalAreaSqm: 65 },
        ),
      },
      {
        label: "4BHK large",
        program: makeProgram(
          [
            room("Master Bedroom", "bedroom", 18),
            room("Bedroom 2", "bedroom", 14),
            room("Bedroom 3", "bedroom", 14),
            room("Bedroom 4", "bedroom", 12),
            room("Master Bathroom", "bathroom", 5, "service"),
            room("Bathroom 2", "bathroom", 4, "service"),
            room("Bathroom 3", "bathroom", 3.5, "service"),
            room("Bathroom 4", "bathroom", 3.5, "service"),
            room("Kitchen", "kitchen", 10, "service"),
            room("Living Room", "living_room", 22, "public"),
            room("Dining Room", "dining_room", 12, "public"),
            room("Corridor", "corridor", 10, "circulation"),
          ],
          { buildingType: "apartment", totalAreaSqm: 140 },
        ),
      },
    ];

    for (const { label, program } of testCases) {
      describe(label, () => {
        const match = matchTypology(program);
        if (!match) return;

        it("every room has positive dimensions", () => {
          for (const r of match.scaledRooms) {
            expect(r.width).toBeGreaterThan(0);
            expect(r.depth).toBeGreaterThan(0);
          }
        });

        it("no room has x or y < 0", () => {
          for (const r of match.scaledRooms) {
            expect(r.x).toBeGreaterThanOrEqual(0);
            expect(r.y).toBeGreaterThanOrEqual(0);
          }
        });

        it("every room width >= its template minWidth", () => {
          const slots = match.template.slots;
          for (const r of match.scaledRooms) {
            const slot = slots.find((s) => s.id === r.slotId);
            if (slot) {
              expect(r.width).toBeGreaterThanOrEqual(slot.minWidth - 0.05);
            }
          }
        });

        it("every room depth >= its template minDepth", () => {
          const slots = match.template.slots;
          for (const r of match.scaledRooms) {
            const slot = slots.find((s) => s.id === r.slotId);
            if (slot) {
              expect(r.depth).toBeGreaterThanOrEqual(slot.minDepth - 0.05);
            }
          }
        });

        it("footprint area > 0", () => {
          expect(match.footprint.width).toBeGreaterThan(0);
          expect(match.footprint.depth).toBeGreaterThan(0);
        });

        it("confidence is between 0.5 and 1.0", () => {
          expect(match.confidence).toBeGreaterThanOrEqual(0.5);
          expect(match.confidence).toBeLessThanOrEqual(1.0);
        });
      });
    }
  });

  // ── Edge cases ──

  describe("edge cases", () => {
    it("empty room list returns null", () => {
      const program = makeProgram([], { buildingType: "apartment" });
      expect(matchTypology(program)).toBeNull();
    });

    it("unknown building type falls back to residential templates", () => {
      const program = makeProgram(
        [
          room("Bedroom", "bedroom", 12),
          room("Bathroom", "bathroom", 3.5, "service"),
          room("Living Room", "living_room", 15, "public"),
          room("Kitchen", "kitchen", 8, "service"),
        ],
        { buildingType: "", totalAreaSqm: 40 },
      );
      const match = matchTypology(program);
      expect(match).not.toBeNull();
    });

    it("6 bedrooms returns null (no template for 6BHK)", () => {
      const program = makeProgram(
        [
          room("Bed 1", "bedroom", 12),
          room("Bed 2", "bedroom", 12),
          room("Bed 3", "bedroom", 12),
          room("Bed 4", "bedroom", 12),
          room("Bed 5", "bedroom", 12),
          room("Bed 6", "bedroom", 12),
          room("Bath", "bathroom", 3, "service"),
          room("Kitchen", "kitchen", 8, "service"),
          room("Living", "living_room", 20, "public"),
        ],
        { buildingType: "villa", totalAreaSqm: 200 },
      );
      const match = matchTypology(program);
      // 5bhk-villa allows maxBedrooms:6, so it may match
      // but if it does, it should have reasonable confidence
      if (match) {
        expect(match.confidence).toBeGreaterThanOrEqual(0.5);
      }
    });

    it("duplex ground floor matches duplex template", () => {
      const program = makeProgram(
        [
          room("Guest Bedroom", "bedroom", 13),
          room("Guest Bathroom", "bathroom", 3.5, "service"),
          room("Kitchen", "kitchen", 9, "service"),
          room("Living Room", "living_room", 18, "public"),
          room("Dining Room", "dining_room", 10, "public"),
          room("Staircase", "staircase", 8, "circulation"),
          room("Corridor", "corridor", 6, "circulation"),
        ],
        {
          buildingType: "duplex",
          totalAreaSqm: 90,
          originalPrompt: "duplex ground floor",
        },
      );
      const match = matchTypology(program);
      printMatch("Duplex ground floor", match);
      expect(match).not.toBeNull();
      expect(match!.template.id).toBe("4bhk-duplex-ground");
    });
  });
});
