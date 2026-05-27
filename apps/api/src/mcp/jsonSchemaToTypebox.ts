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
    return Type.String({ description: stringDesc(schema) });
  }
  if (type === "number" || type === "integer") {
    return Type.Number({ description: stringDesc(schema) });
  }
  if (type === "boolean") {
    return Type.Boolean({ description: stringDesc(schema) });
  }
  if (type === "array") {
    const items = isSchema(schema.items) ? convertSchema(schema.items) : null;
    return Type.Array(items ?? Type.Unknown(), { description: stringDesc(schema) });
  }
  if (type === "object" || schema.properties) {
    const properties = schema.properties;
    if (!isSchema(properties)) {
      return Type.Record(Type.String(), Type.Unknown(), {
        description: stringDesc(schema),
      });
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
      additionalProperties: schema.additionalProperties === true,
      description: stringDesc(schema),
    });
  }
  return null;
}

function stringDesc(schema: JsonSchema): string | undefined {
  return typeof schema.description === "string" ? schema.description : undefined;
}
