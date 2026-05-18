import { describe, expect, it } from "vitest";
import { z } from "zod";

import { zodToOpusToolSchema } from "./zod-to-opus-schema";
import { briefSpecSchema } from "./types";

describe("zodToOpusToolSchema", () => {
  it("converts simple object with primitives", () => {
    const schema = z.object({
      name: z.string(),
      age: z.number(),
      active: z.boolean(),
    });
    const result = zodToOpusToolSchema(schema);
    expect(result).toEqual({
      type: "object",
      properties: {
        name: { type: "string" },
        age: { type: "number" },
        active: { type: "boolean" },
      },
      required: ["name", "age", "active"],
    });
  });

  it("converts nested objects", () => {
    const schema = z.object({
      user: z.object({
        id: z.string(),
        profile: z.object({
          bio: z.string(),
        }),
      }),
    });
    const result = zodToOpusToolSchema(schema);
    expect(result).toEqual({
      type: "object",
      properties: {
        user: {
          type: "object",
          properties: {
            id: { type: "string" },
            profile: {
              type: "object",
              properties: {
                bio: { type: "string" },
              },
              required: ["bio"],
            },
          },
          required: ["id", "profile"],
        },
      },
      required: ["user"],
    });
  });

  it("converts array of objects", () => {
    const schema = z.object({
      items: z.array(z.object({ name: z.string() })),
    });
    const result = zodToOpusToolSchema(schema);
    expect(result).toEqual({
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" } },
            required: ["name"],
          },
        },
      },
      required: ["items"],
    });
  });

  it("handles optional + nullable + default", () => {
    const schema = z.object({
      a: z.string().optional(),
      b: z.string().nullable(),
      c: z.string().default("hello"),
    });
    const result = zodToOpusToolSchema(schema);
    expect(result).toEqual({
      type: "object",
      properties: {
        a: { type: "string" },
        b: { anyOf: [{ type: "string" }, { type: "null" }] },
        c: { type: "string" },
      },
      required: ["b"],
    });
  });

  it("converts enum", () => {
    const schema = z.object({
      color: z.enum(["red", "green", "blue"]),
    });
    const result = zodToOpusToolSchema(schema);
    expect(result).toEqual({
      type: "object",
      properties: {
        color: { type: "string", enum: ["red", "green", "blue"] },
      },
      required: ["color"],
    });
  });

  it("converts literal", () => {
    const schema = z.object({
      origin: z.literal("sw_corner"),
    });
    const result = zodToOpusToolSchema(schema);
    expect(result).toEqual({
      type: "object",
      properties: {
        origin: { type: "string", enum: ["sw_corner"] },
      },
      required: ["origin"],
    });
  });

  it("converts tuple", () => {
    const schema = z.object({
      point: z.tuple([z.number(), z.number()]),
    });
    const result = zodToOpusToolSchema(schema);
    expect(result).toEqual({
      type: "object",
      properties: {
        point: {
          type: "array",
          items: [{ type: "number" }, { type: "number" }],
          minItems: 2,
          maxItems: 2,
        },
      },
      required: ["point"],
    });
  });

  it("converts discriminated union", () => {
    const schema = z.discriminatedUnion("type", [
      z.object({ type: z.literal("circle"), radius: z.number() }),
      z.object({ type: z.literal("rect"), width: z.number() }),
    ]);
    const result = zodToOpusToolSchema(schema);
    expect(result).toEqual({
      oneOf: [
        {
          type: "object",
          properties: {
            type: { type: "string", enum: ["circle"] },
            radius: { type: "number" },
          },
          required: ["type", "radius"],
        },
        {
          type: "object",
          properties: {
            type: { type: "string", enum: ["rect"] },
            width: { type: "number" },
          },
          required: ["type", "width"],
        },
      ],
    });
  });

  it("handles string constraints (min/max)", () => {
    const schema = z.object({
      name: z.string().min(1).max(200),
    });
    const result = zodToOpusToolSchema(schema);
    expect(result).toEqual({
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, maxLength: 200 },
      },
      required: ["name"],
    });
  });

  it("handles number constraints (min/max)", () => {
    const schema = z.object({
      height: z.number().positive(),
      value: z.number().min(0).max(1),
    });
    const result = zodToOpusToolSchema(schema);
    const props = result.properties as Record<string, Record<string, unknown>>;
    // z.number().positive() uses exclusiveMinimum: 0
    expect(props.height.exclusiveMinimum).toBe(0);
    expect(props.value.minimum).toBe(0);
    expect(props.value.maximum).toBe(1);
  });

  it("handles array constraints (min/max)", () => {
    const schema = z.object({
      items: z.array(z.string()).min(3).max(64),
    });
    const result = zodToOpusToolSchema(schema);
    const items = (result.properties as Record<string, Record<string, unknown>>).items;
    expect(items.minItems).toBe(3);
    expect(items.maxItems).toBe(64);
  });

  it("round-trips the full briefSpecSchema with all current fields", () => {
    const result = zodToOpusToolSchema(briefSpecSchema);

    // Top-level shape
    expect(result.type).toBe("object");
    const props = result.properties as Record<string, Record<string, unknown>>;
    expect(props.project).toBeDefined();
    expect(props.site).toBeDefined();
    expect(props.spaces).toBeDefined();
    expect(props.elements).toBeDefined();
    expect(props.materials).toBeDefined();
    expect(props.brand_language).toBeDefined();
    expect(result.required).toEqual(
      expect.arrayContaining(["project", "site", "spaces", "elements", "materials", "brand_language"]),
    );

    // Elements array has the right type enum including door/window
    const elemItems = (props.elements as Record<string, unknown>).items as Record<string, unknown>;
    const elemProps = elemItems.properties as Record<string, Record<string, unknown>>;
    expect(elemProps.type.enum).toEqual(
      expect.arrayContaining(["slab", "wall", "door", "window", "furniture", "lighting"]),
    );

    // polygon_local_m field is present and optional
    expect(elemProps.polygon_local_m).toBeDefined();

    // contained_in_space_id is present and optional
    expect(elemProps.contained_in_space_id).toBeDefined();

    // Materials have specular_rgb (optional)
    const matItems = (props.materials as Record<string, unknown>).items as Record<string, unknown>;
    const matProps = matItems.properties as Record<string, Record<string, unknown>>;
    expect(matProps.specular_rgb).toBeDefined();

    // Site has coordinate_origin as literal
    const siteProps = props.site.properties as Record<string, Record<string, unknown>>;
    expect(siteProps.coordinate_origin.enum).toEqual(["sw_corner"]);
  });
});
