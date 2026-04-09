import { describe, it, expect } from "vitest";
import {
  enforceHardCaps,
  classifyRoom,
  detectBuildingType,
  detectBHKCount,
  detectFloorCount,
  extractTotalAreaSqm,
} from "@/features/floor-plan/lib/room-sizer";

// ── Helper ──────────────────────────────────────────────────────────────────

function makeRooms(specs: Array<{ name: string; type: string; areaSqm: number }>) {
  return specs.map(s => ({ ...s }));
}

// ═══════════════════════════════════════════════════════════════════════════
// BUILDING TYPE DETECTION
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// FUZZY NAME CLASSIFICATION
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

// ═══════════════════════════════════════════════════════════════════════════
// HARD CAPS — the ONLY validation layer
// ═══════════════════════════════════════════════════════════════════════════

describe("Room Sizer — Hard Caps", () => {
  it("bathroom capped at 5.5 sqm", () => {
    const rooms = makeRooms([
      { name: "Bathroom 1", type: "bathroom", areaSqm: 15.0 },
      { name: "Bathroom 2", type: "bathroom", areaSqm: 10.0 },
    ]);
    enforceHardCaps(rooms);
    expect(rooms[0].areaSqm).toBe(5.5);
    expect(rooms[1].areaSqm).toBe(5.5);
  });

  it("master bathroom capped at 7.0 sqm", () => {
    const rooms = makeRooms([{ name: "Master Bathroom", type: "bathroom", areaSqm: 15.3 }]);
    enforceHardCaps(rooms);
    expect(rooms[0].areaSqm).toBe(7.0);
  });

  it("staircase capped at 14 sqm", () => {
    const rooms = makeRooms([{ name: "Staircase", type: "staircase", areaSqm: 28.0 }]);
    enforceHardCaps(rooms);
    expect(rooms[0].areaSqm).toBe(14.0);
  });

  it("servant quarter capped at 12 sqm", () => {
    const rooms = makeRooms([{ name: "Servant Quarter", type: "other", areaSqm: 32.6 }]);
    enforceHardCaps(rooms);
    expect(rooms[0].areaSqm).toBe(12.0);
  });

  it("pooja room capped at 6 sqm", () => {
    const rooms = makeRooms([{ name: "Pooja Room", type: "other", areaSqm: 10.0 }]);
    enforceHardCaps(rooms);
    expect(rooms[0].areaSqm).toBe(6.0);
  });

  it("kitchen raised to at least 5 sqm", () => {
    const rooms = makeRooms([{ name: "Modular Kitchen", type: "kitchen", areaSqm: 2.0 }]);
    enforceHardCaps(rooms);
    expect(rooms[0].areaSqm).toBe(5.0);
  });

  it("bedroom raised to at least 9.5 sqm", () => {
    const rooms = makeRooms([{ name: "Guest Bedroom", type: "bedroom", areaSqm: 4.2 }]);
    enforceHardCaps(rooms);
    expect(rooms[0].areaSqm).toBe(9.5);
  });

  it("shoe rack capped at 3 sqm", () => {
    const rooms = makeRooms([{ name: "Shoe Rack Area", type: "storage", areaSqm: 5.0 }]);
    enforceHardCaps(rooms);
    expect(rooms[0].areaSqm).toBe(3.0);
  });

  it("walk-in closet capped at 7 sqm", () => {
    const rooms = makeRooms([{ name: "Walk-in Closet", type: "storage", areaSqm: 12.0 }]);
    enforceHardCaps(rooms);
    expect(rooms[0].areaSqm).toBe(7.0);
  });

  it("correctly-sized rooms are not modified", () => {
    const rooms = makeRooms([
      { name: "Living Room", type: "living", areaSqm: 20.0 },
      { name: "Kitchen", type: "kitchen", areaSqm: 9.0 },
      { name: "Bathroom 1", type: "bathroom", areaSqm: 4.0 },
    ]);
    enforceHardCaps(rooms);
    expect(rooms[0].areaSqm).toBe(20.0);
    expect(rooms[1].areaSqm).toBe(9.0);
    expect(rooms[2].areaSqm).toBe(4.0);
  });
});
