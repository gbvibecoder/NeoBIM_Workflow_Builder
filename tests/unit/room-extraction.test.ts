import { describe, it, expect } from "vitest";
import { extractMentionedRooms } from "@/features/floor-plan/lib/ai-room-programmer";

describe("extractMentionedRooms", () => {
  it("should extract rooms from a simple prompt", () => {
    const rooms = extractMentionedRooms("3bhk villa with pool");
    expect(rooms).toContain("Swimming Pool");
    // 3BHK implies 3 bedrooms
    expect(rooms.filter(r => r.toLowerCase().includes("bedroom")).length).toBeGreaterThanOrEqual(1);
  });

  it("should extract all rooms from a complex duplex prompt", () => {
    const prompt = `Vastu compliant 4BHK duplex villa on 40x60 feet east-facing plot in Bangalore.
      Ground floor: Main entrance with double-height portico, shoe cabinet in foyer,
      formal living room 20x15 feet, separate family TV lounge, L-shaped open kitchen,
      dining area for 8, one guest bedroom 12x14 feet with attached bathroom,
      pooja room 6x5 feet, powder room near foyer, servant quarter with servant toilet,
      utility room, covered car parking for 2 cars, internal staircase, verandah.
      First floor: Master bedroom suite 16x18 feet, walk-in wardrobe room,
      master bathroom with jacuzzi, private balcony, kids bedroom 1, kids bedroom 2,
      kids bathroom 1, kids bathroom 2, shared study room,
      family lounge with home theater, utility balcony, terrace garden.`;

    const rooms = extractMentionedRooms(prompt);

    // Ground floor rooms
    expect(rooms).toContain("Shoe Rack");
    expect(rooms).toContain("Foyer");
    expect(rooms).toContain("Living Room");
    expect(rooms).toContain("Family Lounge"); // "TV lounge" maps to this
    expect(rooms).toContain("Kitchen");
    expect(rooms).toContain("Dining Room");
    expect(rooms).toContain("Guest Bedroom");
    expect(rooms).toContain("Pooja Room");
    expect(rooms).toContain("Powder Room");
    expect(rooms).toContain("Servant Quarter");
    expect(rooms).toContain("Servant Toilet");
    expect(rooms).toContain("Utility Room");
    expect(rooms).toContain("Car Parking");
    expect(rooms).toContain("Staircase");
    expect(rooms).toContain("Verandah");

    // First floor rooms
    expect(rooms).toContain("Master Bedroom");
    expect(rooms).toContain("Walk-in Wardrobe");
    expect(rooms).toContain("Master Bathroom");
    expect(rooms).toContain("Balcony");
    expect(rooms).toContain("Kids Bedroom 1");
    expect(rooms).toContain("Kids Bedroom 2");
    expect(rooms).toContain("Kids Bathroom 1");
    expect(rooms).toContain("Kids Bathroom 2");
    expect(rooms).toContain("Study Room");
    expect(rooms).toContain("Home Theater");
    expect(rooms).toContain("Utility Balcony");
    expect(rooms).toContain("Terrace Garden");

    // Should have at least 20 rooms extracted
    expect(rooms.length).toBeGreaterThanOrEqual(20);
  });

  it("should extract rooms from a dental clinic prompt", () => {
    const rooms = extractMentionedRooms(
      "dental clinic with 3 treatment rooms, reception, waiting area, and pantry"
    );
    expect(rooms).toContain("Reception");
    expect(rooms).toContain("Waiting Area");
    expect(rooms).toContain("Pantry");
  });

  it("should not duplicate rooms", () => {
    const rooms = extractMentionedRooms("2bhk with kitchen and modern kitchen design");
    const kitchenCount = rooms.filter(r => r === "Kitchen").length;
    expect(kitchenCount).toBe(1);
  });

  it("should handle BHK room count", () => {
    const rooms = extractMentionedRooms("4bhk apartment");
    // Should create at least 4 bedroom entries
    const bedrooms = rooms.filter(r => r.toLowerCase().includes("bedroom"));
    expect(bedrooms.length).toBeGreaterThanOrEqual(4);
  });

  it("should return empty for gibberish", () => {
    const rooms = extractMentionedRooms("asdfghjkl qwerty");
    expect(rooms.length).toBe(0);
  });
});
