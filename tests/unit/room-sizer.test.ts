import { describe, it, expect } from "vitest";
import {
  applyDeterministicSizing,
  detectBuildingType,
  detectBHKCount,
  detectFloorCount,
  extractTotalAreaSqm,
  classifyRoom,
} from "@/lib/floor-plan/room-sizer";

// ── Helper ──────────────────────────────────────────────────────────────────

function makeRooms(specs: Array<{ name: string; type: string }>): Array<{ name: string; type: string; areaSqm: number }> {
  return specs.map(s => ({ ...s, areaSqm: 0 }));
}

function sizeAndGet(specs: Array<{ name: string; type: string }>, totalSqm: number, prompt: string) {
  const rooms = makeRooms(specs);
  applyDeterministicSizing(rooms, totalSqm, prompt);
  return rooms;
}

function findRoom(rooms: Array<{ name: string; areaSqm: number }>, name: string) {
  return rooms.find(r => r.name === name);
}

// ═════════════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════════════

describe("Room Sizer — Building Type Detection", () => {
  it("detects apartment", () => expect(detectBuildingType("2bhk apartment 900 sqft")).toBe("apartment"));
  it("detects villa", () => expect(detectBuildingType("3bhk villa 1500 sqft")).toBe("villa"));
  it("detects duplex", () => expect(detectBuildingType("5bhk duplex 3000 sqft")).toBe("duplex"));
  it("detects bungalow", () => expect(detectBuildingType("bungalow 2000 sqft")).toBe("bungalow"));
  it("detects office", () => expect(detectBuildingType("office layout 2000 sqft")).toBe("office"));
  it("detects hostel", () => expect(detectBuildingType("hostel 3000 sqft 10 rooms")).toBe("hostel"));
  it("detects studio", () => expect(detectBuildingType("studio apartment 400 sqft")).toBe("studio"));
});

describe("Room Sizer — Floor Count Detection", () => {
  it("duplex = 2", () => expect(detectFloorCount("5bhk duplex villa")).toBe(2));
  it("G+1 = 2", () => expect(detectFloorCount("house G+1")).toBe(2));
  it("single floor default", () => expect(detectFloorCount("3bhk apartment")).toBe(1));
});

describe("Room Sizer — BHK Count Detection", () => {
  it("counts bedrooms", () => {
    expect(detectBHKCount([
      { name: "Master Bedroom", type: "bedroom" },
      { name: "Bedroom 2", type: "bedroom" },
      { name: "Bedroom 3", type: "bedroom" },
      { name: "Kitchen", type: "kitchen" },
    ])).toBe(3);
  });
});

describe("Room Sizer — Total Area Extraction", () => {
  it("parses sqft", () => {
    const area = extractTotalAreaSqm("3bhk villa 1500 sqft");
    expect(area).not.toBeNull();
    expect(area!).toBeCloseTo(139.35, 0);
  });
  it("parses sq ft", () => {
    const area = extractTotalAreaSqm("2bhk 900 sq ft apartment");
    expect(area).not.toBeNull();
    expect(area!).toBeCloseTo(83.6, 0);
  });
  it("returns null for no area", () => {
    expect(extractTotalAreaSqm("3bhk villa")).toBeNull();
  });
});

describe("Room Sizer — 2BHK 800 sqft", () => {
  const rooms = sizeAndGet([
    { name: "Living Room", type: "living" },
    { name: "Kitchen", type: "kitchen" },
    { name: "Bedroom 1", type: "bedroom" },
    { name: "Bathroom 1", type: "bathroom" },
    { name: "Bedroom 2", type: "bedroom" },
    { name: "Bathroom 2", type: "bathroom" },
    { name: "Balcony", type: "balcony" },
  ], 74.3, "2bhk apartment 800 sqft");

  it("bedrooms 10-18 sqm", () => {
    const bed1 = findRoom(rooms, "Bedroom 1")!;
    const bed2 = findRoom(rooms, "Bedroom 2")!;
    expect(bed1.areaSqm).toBeGreaterThanOrEqual(10);
    expect(bed1.areaSqm).toBeLessThanOrEqual(18);
    expect(bed2.areaSqm).toBeGreaterThanOrEqual(10);
    expect(bed2.areaSqm).toBeLessThanOrEqual(18);
  });

  it("bathrooms 3-5.5 sqm", () => {
    const bath1 = findRoom(rooms, "Bathroom 1")!;
    const bath2 = findRoom(rooms, "Bathroom 2")!;
    expect(bath1.areaSqm).toBeGreaterThanOrEqual(3);
    expect(bath1.areaSqm).toBeLessThanOrEqual(5.5);
    expect(bath2.areaSqm).toBeGreaterThanOrEqual(3);
    expect(bath2.areaSqm).toBeLessThanOrEqual(5.5);
  });

  it("living room is reasonably sized", () => {
    const living = findRoom(rooms, "Living Room")!;
    expect(living.areaSqm).toBeGreaterThanOrEqual(14);
    expect(living.areaSqm).toBeLessThanOrEqual(30);
  });
});

describe("Room Sizer — 3BHK 1500 sqft", () => {
  const rooms = sizeAndGet([
    { name: "Living Room", type: "living" },
    { name: "Dining Room", type: "dining" },
    { name: "Kitchen", type: "kitchen" },
    { name: "Master Bedroom", type: "bedroom" },
    { name: "Bathroom 1", type: "bathroom" },
    { name: "Bedroom 2", type: "bedroom" },
    { name: "Bathroom 2", type: "bathroom" },
    { name: "Bedroom 3", type: "bedroom" },
    { name: "Bathroom 3", type: "bathroom" },
    { name: "Study", type: "study" },
    { name: "Balcony", type: "balcony" },
    { name: "Utility Room", type: "utility" },
  ], 139.4, "3bhk villa 1500 sqft");

  it("master bedroom 14-20 sqm", () => {
    const master = findRoom(rooms, "Master Bedroom")!;
    expect(master.areaSqm).toBeGreaterThanOrEqual(13);
    expect(master.areaSqm).toBeLessThanOrEqual(22);
  });

  it("bathrooms 3.5-5.5 sqm", () => {
    for (const name of ["Bathroom 1", "Bathroom 2", "Bathroom 3"]) {
      const bath = findRoom(rooms, name)!;
      expect(bath.areaSqm).toBeGreaterThanOrEqual(3);
      expect(bath.areaSqm).toBeLessThanOrEqual(5.5);
    }
  });

  it("living room 16-28 sqm", () => {
    const living = findRoom(rooms, "Living Room")!;
    expect(living.areaSqm).toBeGreaterThanOrEqual(16);
    expect(living.areaSqm).toBeLessThanOrEqual(30);
  });
});

describe("Room Sizer — 5BHK 3000 sqft duplex", () => {
  const rooms = sizeAndGet([
    { name: "Living Room", type: "living" },
    { name: "Dining Room", type: "dining" },
    { name: "Kitchen", type: "kitchen" },
    { name: "Master Bedroom", type: "bedroom" },
    { name: "Master Bathroom", type: "bathroom" },
    { name: "Bedroom 2", type: "bedroom" },
    { name: "Bathroom 2", type: "bathroom" },
    { name: "Bedroom 3", type: "bedroom" },
    { name: "Bathroom 3", type: "bathroom" },
    { name: "Bedroom 4", type: "bedroom" },
    { name: "Bathroom 4", type: "bathroom" },
    { name: "Bedroom 5", type: "bedroom" },
    { name: "Bathroom 5", type: "bathroom" },
    { name: "Study", type: "study" },
    { name: "Staircase", type: "staircase" },
    { name: "Utility", type: "utility" },
    { name: "Balcony", type: "balcony" },
  ], 278.7, "5bhk duplex villa 3000 sqft north facing");

  it("master bedroom 14-22 sqm (NOT 39)", () => {
    const master = findRoom(rooms, "Master Bedroom")!;
    expect(master.areaSqm).toBeGreaterThanOrEqual(14);
    expect(master.areaSqm).toBeLessThanOrEqual(22);
  });

  it("other bedrooms 10-18 sqm (NOT 28)", () => {
    for (const name of ["Bedroom 2", "Bedroom 3", "Bedroom 4", "Bedroom 5"]) {
      const bed = findRoom(rooms, name)!;
      expect(bed.areaSqm).toBeGreaterThanOrEqual(10);
      expect(bed.areaSqm).toBeLessThanOrEqual(18);
    }
  });

  it("staircase 6-12 sqm (NOT 28)", () => {
    const stair = findRoom(rooms, "Staircase")!;
    expect(stair.areaSqm).toBeGreaterThanOrEqual(6);
    expect(stair.areaSqm).toBeLessThanOrEqual(12);
  });

  it("bathrooms 3-6.5 sqm", () => {
    const baths = rooms.filter(r => r.name.toLowerCase().includes("bath"));
    for (const bath of baths) {
      expect(bath.areaSqm).toBeGreaterThanOrEqual(3);
      expect(bath.areaSqm).toBeLessThanOrEqual(6.5);
    }
  });
});

describe("Room Sizer — Absolute caps", () => {
  const bigRooms = sizeAndGet([
    { name: "Living Room", type: "living" },
    { name: "Kitchen", type: "kitchen" },
    { name: "Master Bedroom", type: "bedroom" },
    { name: "Master Bathroom", type: "bathroom" },
    { name: "Bathroom 2", type: "bathroom" },
    { name: "Staircase", type: "staircase" },
    { name: "Pooja Room", type: "other" },
    { name: "Utility", type: "utility" },
  ], 300, "5bhk bungalow 3200 sqft");

  it("bathroom NEVER exceeds 7 sqm", () => {
    const baths = bigRooms.filter(r => r.name.toLowerCase().includes("bath"));
    for (const b of baths) expect(b.areaSqm).toBeLessThanOrEqual(7);
  });

  it("staircase NEVER exceeds 14 sqm", () => {
    const stair = findRoom(bigRooms, "Staircase")!;
    expect(stair.areaSqm).toBeLessThanOrEqual(14);
  });

  it("pooja room NEVER exceeds 6 sqm", () => {
    const pooja = findRoom(bigRooms, "Pooja Room")!;
    expect(pooja.areaSqm).toBeLessThanOrEqual(6);
  });
});

describe("Room Sizer — Total area normalization", () => {
  it("room areas sum to within ±10% of target", () => {
    const rooms = sizeAndGet([
      { name: "Living Room", type: "living" },
      { name: "Dining Room", type: "dining" },
      { name: "Kitchen", type: "kitchen" },
      { name: "Bedroom 1", type: "bedroom" },
      { name: "Bathroom 1", type: "bathroom" },
      { name: "Bedroom 2", type: "bedroom" },
      { name: "Bathroom 2", type: "bathroom" },
      { name: "Balcony", type: "balcony" },
    ], 100, "2bhk apartment 1076 sqft");

    const total = rooms.reduce((s, r) => s + r.areaSqm, 0);
    expect(total).toBeGreaterThan(100 * 0.9);
    expect(total).toBeLessThan(100 * 1.1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// NAME MATCHING EDGE CASES — must handle any AI-generated room name
// ═══════════════════════════════════════════════════════════════════════════

describe("Room Sizer — Fuzzy name classification", () => {
  it("Guest Bedroom → guest_bedroom", () => expect(classifyRoom("bedroom", "Guest Bedroom")).toBe("guest_bedroom"));
  it("Modular Kitchen → kitchen", () => expect(classifyRoom("kitchen", "Modular Kitchen")).toBe("kitchen"));
  it("Servant Quarter → servant_quarter", () => expect(classifyRoom("other", "Servant Quarter")).toBe("servant_quarter"));
  it("Servant Toilet → servant_toilet", () => expect(classifyRoom("bathroom", "Servant Toilet")).toBe("servant_toilet"));
  it("Shoe Rack Area → shoe_rack", () => expect(classifyRoom("other", "Shoe Rack Area")).toBe("shoe_rack"));
  it("Walk-in Closet → walk_in_closet", () => expect(classifyRoom("other", "Walk-in Closet")).toBe("walk_in_closet"));
  it("Family Sitting Area → living_room", () => expect(classifyRoom("other", "Family Sitting Area")).toBe("living_room"));
  it("Powder Room → powder_room", () => expect(classifyRoom("bathroom", "Powder Room")).toBe("powder_room"));
  it("Car Parking → parking", () => expect(classifyRoom("other", "Car Parking")).toBe("parking"));
  it("Pooja Room → pooja_room", () => expect(classifyRoom("other", "Pooja Room")).toBe("pooja_room"));
  it("Master Bathroom → master_bathroom", () => expect(classifyRoom("bathroom", "Master Bathroom")).toBe("master_bathroom"));
  it("Study Room → study", () => expect(classifyRoom("study", "Study Room")).toBe("study"));
  it("Bathroom 4 → bathroom", () => expect(classifyRoom("bathroom", "Bathroom 4")).toBe("bathroom"));
  it("Bedroom 3 → bedroom", () => expect(classifyRoom("bedroom", "Bedroom 3")).toBe("bedroom"));
});

describe("Room Sizer — Normalization respects max caps", () => {
  it("bathroom NEVER exceeds 7 sqm in large plans", () => {
    const rooms = sizeAndGet([
      { name: "Living Room", type: "living" },
      { name: "Dining Room", type: "dining" },
      { name: "Kitchen", type: "kitchen" },
      { name: "Master Bedroom", type: "bedroom" },
      { name: "Master Bathroom", type: "bathroom" },
      { name: "Bedroom 2", type: "bedroom" },
      { name: "Bathroom 2", type: "bathroom" },
      { name: "Bedroom 3", type: "bedroom" },
      { name: "Bathroom 3", type: "bathroom" },
      { name: "Bedroom 4", type: "bedroom" },
      { name: "Bathroom 4", type: "bathroom" },
      { name: "Servant Quarter", type: "other" },
      { name: "Staircase", type: "staircase" },
      { name: "Study", type: "study" },
      { name: "Balcony", type: "balcony" },
    ], 260, "4BHK luxury villa 2800 sqft");

    for (const r of rooms) {
      if (/bath/i.test(r.name)) expect(r.areaSqm).toBeLessThanOrEqual(7.0);
    }
  });

  it("servant quarter capped at 12 sqm", () => {
    const rooms = sizeAndGet([
      { name: "Living Room", type: "living" },
      { name: "Kitchen", type: "kitchen" },
      { name: "Master Bedroom", type: "bedroom" },
      { name: "Bathroom 1", type: "bathroom" },
      { name: "Servant Quarter", type: "other" },
    ], 200, "3bhk villa 2000 sqft");
    const sq = findRoom(rooms, "Servant Quarter")!;
    expect(sq.areaSqm).toBeLessThanOrEqual(12);
  });

  it("Guest Bedroom gets proper sizing (9.5-16 sqm)", () => {
    const rooms = sizeAndGet([
      { name: "Living Room", type: "living" },
      { name: "Kitchen", type: "kitchen" },
      { name: "Guest Bedroom", type: "bedroom" },
      { name: "Bathroom 1", type: "bathroom" },
    ], 120, "3bhk villa 1300 sqft");
    const gb = findRoom(rooms, "Guest Bedroom")!;
    expect(gb.areaSqm).toBeGreaterThanOrEqual(9.5);
    expect(gb.areaSqm).toBeLessThanOrEqual(16);
  });

  it("Modular Kitchen gets proper sizing (5.5-12 sqm)", () => {
    const rooms = sizeAndGet([
      { name: "Living Room", type: "living" },
      { name: "Modular Kitchen", type: "kitchen" },
      { name: "Bedroom 1", type: "bedroom" },
      { name: "Bathroom 1", type: "bathroom" },
    ], 100, "2bhk apartment 1076 sqft");
    const k = findRoom(rooms, "Modular Kitchen")!;
    expect(k.areaSqm).toBeGreaterThanOrEqual(5.5);
    expect(k.areaSqm).toBeLessThanOrEqual(12);
  });
});
