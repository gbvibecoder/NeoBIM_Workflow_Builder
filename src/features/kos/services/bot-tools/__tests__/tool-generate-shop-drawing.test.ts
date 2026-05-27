/**
 * Unit tests for generate_shop_drawing stub.
 */

import { describe, expect, it } from "vitest";

import { generateShopDrawingTool } from "../tool-generate-shop-drawing";

describe("generateShopDrawingTool (stub)", () => {
  it("returns status='not_implemented' with polite redirect message", async () => {
    const result = await generateShopDrawingTool({ drawing_id: "draw_1" });
    expect(result.status).toBe("not_implemented");
    expect(result.drawing_id).toBe("draw_1");
    expect(result.message).toContain("5J");
    expect(result.message.toLowerCase()).toContain("boq");
    expect(result.message.toLowerCase()).toContain("formwork");
  });

  it("echoes drawing_id even when blank (resilient to malformed model input)", async () => {
    const result = await generateShopDrawingTool({ drawing_id: "" });
    expect(result.status).toBe("not_implemented");
    expect(result.drawing_id).toBe("");
  });
});
