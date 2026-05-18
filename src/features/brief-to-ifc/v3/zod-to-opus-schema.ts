/**
 * Minimal zod v4 -> JSON-Schema converter for Anthropic tool_use.
 *
 * Covers the subset of zod constructs used by `briefSpecSchema`:
 * z.object, z.string, z.number, z.boolean, z.array, z.enum, z.literal,
 * z.tuple, z.optional, z.nullable, z.default, z.discriminatedUnion.
 *
 * Targets zod 4.x internal structure (_def.type, _def.shape, etc.).
 * No external dependencies — replaces the hand-written JSON schema in
 * `brief-enrichment.ts` so schema drift (H11) can't happen again.
 */

import { type ZodTypeAny } from "zod";

type JsonSchema = Record<string, unknown>;

// Zod v4 check internal structure
interface ZodCheckDef {
  check: string;
  minimum?: number;
  maximum?: number;
  value?: number;
  inclusive?: boolean;
}

interface ZodCheck {
  _zod?: { def: ZodCheckDef };
}

/**
 * Convert a zod schema to the JSON-Schema subset that Anthropic tool_use
 * accepts. The output is suitable for `tool.input_schema`.
 */
export function zodToOpusToolSchema(schema: ZodTypeAny): JsonSchema {
  return convert(schema);
}

function def(schema: ZodTypeAny): Record<string, unknown> {
  return (schema as unknown as { _def: Record<string, unknown> })._def;
}

function convert(schema: ZodTypeAny): JsonSchema {
  const d = def(schema);
  const type = d.type as string;

  switch (type) {
    case "string": {
      const result: JsonSchema = { type: "string" };
      applyChecks(d, result);
      return result;
    }

    case "number": {
      const result: JsonSchema = { type: "number" };
      applyChecks(d, result);
      return result;
    }

    case "boolean":
      return { type: "boolean" };

    case "literal": {
      const values = d.values as unknown[];
      if (values.length === 1) {
        return convertLiteral(values[0]);
      }
      // Multi-value literal → enum
      return { enum: values };
    }

    case "enum": {
      const entries = d.entries as Record<string, string>;
      return { type: "string", enum: Object.values(entries) };
    }

    case "array": {
      const result: JsonSchema = {
        type: "array",
        items: convert(d.element as ZodTypeAny),
      };
      applyChecks(d, result);
      return result;
    }

    case "tuple": {
      const items = (d.items as ZodTypeAny[]) ?? [];
      return {
        type: "array",
        items: items.map(convert),
        minItems: items.length,
        maxItems: items.length,
      };
    }

    case "object": {
      const shape = d.shape as Record<string, ZodTypeAny>;
      const properties: Record<string, JsonSchema> = {};
      const required: string[] = [];

      for (const [key, value] of Object.entries(shape)) {
        properties[key] = convert(value);
        if (!isOptional(value)) {
          required.push(key);
        }
      }

      const result: JsonSchema = { type: "object", properties };
      if (required.length > 0) {
        result.required = required;
      }
      return result;
    }

    case "optional":
      return convert(d.innerType as ZodTypeAny);

    case "nullable": {
      const inner = convert(d.innerType as ZodTypeAny);
      return { anyOf: [inner, { type: "null" }] };
    }

    case "default":
      return convert(d.innerType as ZodTypeAny);

    case "union": {
      const options = (d.options as ZodTypeAny[]) ?? [];
      // If there's a discriminator, emit oneOf (for discriminatedUnion)
      if (d.discriminator) {
        return { oneOf: options.map(convert) };
      }
      return { anyOf: options.map(convert) };
    }

    case "record": {
      const valueSchema = d.valueType as ZodTypeAny;
      return {
        type: "object",
        additionalProperties: convert(valueSchema),
      };
    }

    case "lazy": {
      const getter = d.getter as () => ZodTypeAny;
      return convert(getter());
    }

    default:
      // Fallback — emit a permissive schema rather than crash.
      return {};
  }
}

function convertLiteral(value: unknown): JsonSchema {
  if (typeof value === "string") {
    return { type: "string", enum: [value] };
  }
  if (typeof value === "number") {
    return { type: "number", enum: [value] };
  }
  if (typeof value === "boolean") {
    return { type: "boolean", enum: [value] };
  }
  return {};
}

function isOptional(schema: ZodTypeAny): boolean {
  const d = def(schema);
  const type = d.type as string;
  return type === "optional" || type === "default";
}

function applyChecks(d: Record<string, unknown>, result: JsonSchema): void {
  const checks = (d.checks as ZodCheck[]) ?? [];
  for (const check of checks) {
    const cd = check._zod?.def;
    if (!cd) continue;

    switch (cd.check) {
      case "min_length":
        if (result.type === "string") result.minLength = cd.minimum;
        else if (result.type === "array") result.minItems = cd.minimum;
        break;
      case "max_length":
        if (result.type === "string") result.maxLength = cd.maximum;
        else if (result.type === "array") result.maxItems = cd.maximum;
        break;
      case "greater_than":
        if (cd.inclusive === false) {
          result.exclusiveMinimum = cd.value;
        } else {
          result.minimum = cd.value;
        }
        break;
      case "less_than":
        if (cd.inclusive === false) {
          result.exclusiveMaximum = cd.value;
        } else {
          result.maximum = cd.value;
        }
        break;
    }
  }
}
