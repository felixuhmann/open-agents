import { Type, type TSchema } from "@earendil-works/pi-ai";
import { z } from "zod";

type JsonSchema = Record<string, unknown>;

function isSchema(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Convert a JSON Schema object (draft 2020-12 subset) into a TypeBox schema
 * for Pi tool parameters. Falls back to a loose object when the schema is
 * too complex for our converter.
 */
export function jsonSchemaToTypebox(schema: JsonSchema): TSchema {
  const converted = convertSchema(schema);
  if (converted) return converted;
  return Type.Object(
    {},
    {
      additionalProperties: true,
      description:
        typeof schema.description === "string" ? schema.description : undefined,
    },
  );
}

/** Build a TypeBox schema from a platform handler's Zod raw shape. */
export function zodShapeToTypebox(shape: z.ZodRawShape): TSchema {
  const jsonSchema = z.toJSONSchema(z.object(shape));
  if (isSchema(jsonSchema)) return jsonSchemaToTypebox(jsonSchema);
  return jsonSchemaToTypebox({ type: "object" });
}

function convertSchema(schema: JsonSchema): TSchema | null {
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    const branches = schema.anyOf.filter(isSchema).map(convertSchema);
    if (branches.every(Boolean)) {
      return Type.Union(branches as TSchema[]);
    }
  }

  const type = schema.type;
  if (type === "string") {
    return Type.String(options(schema, STRING_KEYWORDS));
  }
  if (type === "integer") {
    return Type.Integer(options(schema, NUMERIC_KEYWORDS));
  }
  if (type === "number") {
    return Type.Number(options(schema, NUMERIC_KEYWORDS));
  }
  if (type === "boolean") {
    return Type.Boolean(options(schema));
  }
  if (type === "array") {
    const items = isSchema(schema.items) ? convertSchema(schema.items) : null;
    return Type.Array(items ?? Type.Unknown(), options(schema, ARRAY_KEYWORDS));
  }
  if (type === "object" || schema.properties) {
    const properties = schema.properties;
    if (!isSchema(properties)) {
      return Type.Record(Type.String(), Type.Unknown(), options(schema));
    }
    const required = new Set(
      Array.isArray(schema.required)
        ? schema.required.filter((k): k is string => typeof k === "string")
        : [],
    );
    const props: Record<string, TSchema> = {};
    for (const [key, propSchema] of Object.entries(properties)) {
      if (!isSchema(propSchema)) continue;
      const field = convertSchema(propSchema);
      if (!field) return null;
      props[key] = required.has(key) ? field : Type.Optional(field);
    }
    return Type.Object(props, {
      ...options(schema),
      additionalProperties: schema.additionalProperties === true,
    });
  }
  return null;
}

/** Validation keywords carried through per JSON Schema type. */
const NUMERIC_KEYWORDS = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
] as const;
const STRING_KEYWORDS = ["minLength", "maxLength", "pattern", "format"] as const;
const ARRAY_KEYWORDS = ["minItems", "maxItems", "uniqueItems"] as const;

/**
 * Carry the model-facing annotations and validation constraints from a JSON
 * Schema node into TypeBox options. Without this the model never sees bounds
 * like `maximum`, `enum`, or `default` and can loop retrying rejected args.
 */
function options(
  schema: JsonSchema,
  extraKeys: readonly string[] = [],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (typeof schema.description === "string") out.description = schema.description;
  if (typeof schema.title === "string") out.title = schema.title;
  if ("default" in schema) out.default = schema.default;
  if (Array.isArray(schema.enum)) out.enum = schema.enum;
  if ("const" in schema) out.const = schema.const;
  if (Array.isArray(schema.examples)) out.examples = schema.examples;
  for (const key of extraKeys) {
    if (schema[key] !== undefined) out[key] = schema[key];
  }
  return out;
}
