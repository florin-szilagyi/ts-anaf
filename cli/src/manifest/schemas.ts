import { z } from 'zod';
import type { ManifestDocument, ManifestKind } from './types';

/**
 * Zod schema for a manifest document. The `spec` is intentionally loose
 * (`z.record(z.unknown())`) — the narrower per-kind validation happens inside
 * the action normalizers (`normalizeUblBuildAction`, `normalizeEfacturaUploadAction`)
 * which already own their own zod schemas. This keeps a single source of
 * truth for `UblBuildInput` / `EfacturaUploadInput`.
 *
 * `.strict()` is applied at the top level so that unknown keys fail the
 * envelope validation with `INVALID_MANIFEST_DOCUMENT` rather than silently
 * being ignored.
 */
export const manifestDocumentSchema: z.ZodType<ManifestDocument> = z
  .object({
    apiVersion: z.literal('anaf-cli/v1'),
    kind: z.enum(['UblBuild', 'EFacturaUpload']),
    context: z.string().min(1).optional(),
    spec: z.record(z.unknown()),
    output: z
      .object({
        mode: z.enum(['stdout', 'file']).optional(),
        path: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict() as unknown as z.ZodType<ManifestDocument>;

/**
 * Hand-crafted JSON Schema (draft-07) for each manifest kind. We do NOT pull
 * in `zod-to-json-schema` — the surface is small (two kinds) and pinning the
 * output lets us keep `schema print` stable for AI-agent consumers.
 *
 * This function returns a pretty-printed JSON string (2-space indent) so the
 * caller can pipe it straight into a file or into a schema validator.
 */
export function printJsonSchemaForKind(kind: ManifestKind): string {
  const schema = kind === 'UblBuild' ? ublBuildManifestJsonSchema() : efacturaUploadManifestJsonSchema();
  return JSON.stringify(schema, null, 2);
}

function ublBuildManifestJsonSchema(): Record<string, unknown> {
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: 'https://anaf-cli/manifest/UblBuild.json',
    title: 'UblBuild manifest',
    description: 'Manifest for `anaf-cli run` that builds a UBL invoice XML document.',
    type: 'object',
    required: ['apiVersion', 'kind', 'spec'],
    additionalProperties: false,
    properties: {
      apiVersion: { const: 'anaf-cli/v1' },
      kind: { const: 'UblBuild' },
      context: { type: 'string', minLength: 1 },
      spec: {
        type: 'object',
        required: ['invoiceNumber', 'issueDate', 'customerCui', 'lines'],
        additionalProperties: false,
        properties: {
          context: { type: 'string', minLength: 1 },
          invoiceNumber: { type: 'string', minLength: 1 },
          issueDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          dueDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
          customerCui: { type: 'string', pattern: '^(RO)?\\d{2,10}$' },
          lines: {
            type: 'array',
            minItems: 1,
            items: {
              oneOf: [
                {
                  type: 'string',
                  description: 'Shorthand "description|quantity|unitPrice|taxPercent[|unitCode]"',
                  minLength: 1,
                },
                {
                  type: 'object',
                  required: ['description', 'quantity', 'unitPrice', 'taxPercent'],
                  additionalProperties: false,
                  properties: {
                    description: { type: 'string', minLength: 1 },
                    quantity: { type: 'number', minimum: 0 },
                    unitPrice: { type: 'number', minimum: 0 },
                    taxPercent: { type: 'number', minimum: 0 },
                    unitCode: { type: 'string', minLength: 1 },
                  },
                },
              ],
            },
          },
          currency: { type: 'string', minLength: 1 },
          note: { type: 'string', minLength: 1 },
          paymentIban: { type: 'string', minLength: 1 },
          overrides: {
            type: 'object',
            additionalProperties: false,
            properties: {
              supplier: { $ref: '#/definitions/partyOverride' },
              customer: { $ref: '#/definitions/partyOverride' },
              note: { type: 'string', minLength: 1 },
              paymentIban: { type: 'string', minLength: 1 },
              currency: { type: 'string', minLength: 1 },
              dueDate: { type: 'string', minLength: 1 },
            },
          },
        },
      },
      output: { $ref: '#/definitions/outputTarget' },
    },
    definitions: {
      outputTarget: {
        type: 'object',
        additionalProperties: false,
        properties: {
          mode: { enum: ['stdout', 'file'] },
          path: { type: 'string', minLength: 1 },
        },
      },
      partyOverride: {
        type: 'object',
        additionalProperties: false,
        properties: {
          registrationName: { type: 'string', minLength: 1 },
          companyId: { type: 'string', minLength: 1 },
          vatNumber: { type: 'string', minLength: 1 },
          email: { type: 'string', minLength: 1 },
          telephone: { type: 'string', minLength: 1 },
          partyIdentificationId: { type: 'string', minLength: 1 },
          address: {
            type: 'object',
            additionalProperties: false,
            properties: {
              street: { type: 'string', minLength: 1 },
              city: { type: 'string', minLength: 1 },
              postalZone: { type: 'string', minLength: 1 },
              county: { type: 'string', minLength: 1 },
              countryCode: { type: 'string', minLength: 1 },
            },
          },
        },
      },
    },
  };
}

function efacturaUploadManifestJsonSchema(): Record<string, unknown> {
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    $id: 'https://anaf-cli/manifest/EFacturaUpload.json',
    title: 'EFacturaUpload manifest',
    description: 'Manifest for `anaf-cli run` that uploads a UBL/CN/CII/RASP document to the e-Factura spaţiu privat.',
    type: 'object',
    required: ['apiVersion', 'kind', 'spec'],
    additionalProperties: false,
    properties: {
      apiVersion: { const: 'anaf-cli/v1' },
      kind: { const: 'EFacturaUpload' },
      context: { type: 'string', minLength: 1 },
      spec: {
        type: 'object',
        required: ['source', 'upload'],
        additionalProperties: false,
        properties: {
          context: { type: 'string', minLength: 1 },
          source: {
            type: 'object',
            description: 'Exactly one of xmlFile / xmlStdin / ublBuild must be set.',
            additionalProperties: false,
            properties: {
              xmlFile: { type: 'string', minLength: 1 },
              xmlStdin: { type: 'boolean' },
              ublBuild: { type: 'object' },
            },
          },
          upload: {
            type: 'object',
            additionalProperties: false,
            properties: {
              standard: { enum: ['UBL', 'CN', 'CII', 'RASP'] },
              isB2C: { type: 'boolean' },
              isExecutare: { type: 'boolean' },
            },
          },
        },
      },
      output: { $ref: '#/definitions/outputTarget' },
    },
    definitions: {
      outputTarget: {
        type: 'object',
        additionalProperties: false,
        properties: {
          mode: { enum: ['stdout', 'file'] },
          path: { type: 'string', minLength: 1 },
        },
      },
    },
  };
}
