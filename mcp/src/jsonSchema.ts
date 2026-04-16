import type { ZodTypeAny } from 'zod';

/**
 * Minimal Zod→JSON Schema converter for MCP tool input schemas.
 * We avoid the `zod-to-json-schema` package dependency by walking only
 * the shapes we actually use (objects, strings, numbers, booleans, enums,
 * arrays, unions, optionals).
 */
export function zodToJsonSchema(schema: ZodTypeAny): Record<string, unknown> {
  const def = (schema._def ?? {}) as { typeName?: string };
  switch (def.typeName) {
    case 'ZodObject': {
      const shape =
        (schema as unknown as { shape: Record<string, ZodTypeAny> }).shape ??
        (schema as unknown as { _def: { shape: () => Record<string, ZodTypeAny> } })._def.shape?.() ??
        {};
      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      for (const [key, value] of Object.entries(shape)) {
        properties[key] = zodToJsonSchema(value);
        if (!isOptional(value)) required.push(key);
      }
      return {
        type: 'object',
        properties,
        ...(required.length > 0 ? { required } : {}),
      };
    }
    case 'ZodString':
      return withDescription(schema, { type: 'string' });
    case 'ZodNumber':
      return withDescription(schema, { type: 'number' });
    case 'ZodBoolean':
      return withDescription(schema, { type: 'boolean' });
    case 'ZodEnum':
      return withDescription(schema, {
        type: 'string',
        enum: (schema as unknown as { _def: { values: string[] } })._def.values,
      });
    case 'ZodArray':
      return withDescription(schema, {
        type: 'array',
        items: zodToJsonSchema((schema as unknown as { _def: { type: ZodTypeAny } })._def.type),
      });
    case 'ZodUnion':
      return {
        anyOf: (schema as unknown as { _def: { options: ZodTypeAny[] } })._def.options.map(zodToJsonSchema),
      };
    case 'ZodOptional':
    case 'ZodDefault':
      return zodToJsonSchema((schema as unknown as { _def: { innerType: ZodTypeAny } })._def.innerType);
    default:
      return {};
  }
}

function isOptional(schema: ZodTypeAny): boolean {
  const tn = (schema._def as { typeName?: string }).typeName;
  return tn === 'ZodOptional' || tn === 'ZodDefault';
}

function withDescription(schema: ZodTypeAny, base: Record<string, unknown>): Record<string, unknown> {
  const desc = (schema._def as { description?: string }).description;
  return desc ? { ...base, description: desc } : base;
}
