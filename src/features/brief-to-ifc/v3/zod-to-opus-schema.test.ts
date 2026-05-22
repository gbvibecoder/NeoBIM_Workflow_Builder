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
      additionalProperties: false,
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
              additionalProperties: false,
            },
          },
          required: ["id", "profile"],
          additionalProperties: false,
        },
      },
      required: ["user"],
      additionalProperties: false,
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
            additionalProperties: false,
          },
        },
      },
      required: ["items"],
      additionalProperties: false,
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
      additionalProperties: false,
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
      additionalProperties: false,
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
      additionalProperties: false,
    });
  });

  it("converts tuple using prefixItems (draft 2020-12)", () => {
    const schema = z.object({
      point: z.tuple([z.number(), z.number()]),
    });
    const result = zodToOpusToolSchema(schema);
    expect(result).toEqual({
      type: "object",
      properties: {
        point: {
          type: "array",
          prefixItems: [{ type: "number" }, { type: "number" }],
          items: false,
          minItems: 2,
          maxItems: 2,
        },
      },
      required: ["point"],
      additionalProperties: false,
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
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            type: { type: "string", enum: ["rect"] },
            width: { type: "number" },
          },
          required: ["type", "width"],
          additionalProperties: false,
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
      additionalProperties: false,
    });
  });

  it("handles number constraints (min/max)", () => {
    const schema = z.object({
      height: z.number().positive(),
      value: z.number().min(0).max(1),
    });
    const result = zodToOpusToolSchema(schema);
    const props = result.properties as Record<string, Record<string, unknown>>;
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

    expect(result.type).toBe("object");
    expect(result.additionalProperties).toBe(false);
    const props = result.properties as Record<string, Record<string, unknown>>;
    expect(props.project).toBeDefined();
    expect(props.site).toBeDefined();
    expect(props.spaces).toBeDefined();
    expect(props.elements).toBeDefined();
    expect(props.materials).toBeDefined();
    expect(props.brand_language).toBeDefined();
    expect(result.required).toEqual(
      expect.arrayContaining(["project", "site", "spaces", "elements", "materials"]),
    );
    // brand_language is optional — residential briefs have no branding
    expect(result.required).not.toEqual(
      expect.arrayContaining(["brand_language"]),
    );

    const elemItems = (props.elements as Record<string, unknown>).items as Record<string, unknown>;
    const elemProps = elemItems.properties as Record<string, Record<string, unknown>>;
    expect(elemProps.type.enum).toEqual(
      expect.arrayContaining(["slab", "wall", "door", "window", "furniture", "lighting"]),
    );
    expect(elemProps.polygon_local_m).toBeDefined();
    expect(elemProps.contained_in_space_id).toBeDefined();

    const matItems = (props.materials as Record<string, unknown>).items as Record<string, unknown>;
    const matProps = matItems.properties as Record<string, Record<string, unknown>>;
    expect(matProps.specular_rgb).toBeDefined();

    const siteProps = props.site.properties as Record<string, Record<string, unknown>>;
    expect(siteProps.coordinate_origin.enum).toEqual(["sw_corner"]);
  });

  it("full briefSpecSchema has no draft-2020-12-forbidden keywords", () => {
    const schema = zodToOpusToolSchema(briefSpecSchema);

    function walk(node: unknown, path = ""): void {
      if (typeof node !== "object" || node === null) return;
      const obj = node as Record<string, unknown>;

      // No pre-2020-12 keywords
      expect(obj).not.toHaveProperty("definitions");
      expect(obj).not.toHaveProperty("nullable");
      expect(obj).not.toHaveProperty("discriminator");

      // Tuple arrays must use prefixItems, not items-as-array
      if (obj.type === "array" && Array.isArray(obj.items)) {
        throw new Error(
          `at ${path}: 'items' is an array — use 'prefixItems' for draft 2020-12`,
        );
      }

      // Objects must have additionalProperties
      if (obj.type === "object" && obj.properties && !("additionalProperties" in obj)) {
        throw new Error(
          `at ${path}: object missing 'additionalProperties'`,
        );
      }

      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === "object" && v !== null) {
          walk(v, `${path}.${k}`);
        }
      }
    }

    walk(schema);
  });
});
