import { z } from 'zod';
import type { EfacturaClient, StandardType } from '@florinszilagyi/anaf-ts-sdk';
import { McpToolError, formatToolError } from '../errors.js';
import type { ToolResult } from './types.js';

export const uploadInvoiceInputSchema = z.object({
  xml: z.string().min(1).describe('UBL XML document to upload'),
  b2c: z.boolean().optional().default(false).describe('Upload via B2C endpoint (default: B2B)'),
  standard: z.enum(['UBL', 'CN', 'CII', 'RASP']).optional().describe('Document standard (default: UBL)'),
  extern: z.boolean().optional(),
  autofactura: z.boolean().optional(),
});

export type UploadInvoiceInput = z.input<typeof uploadInvoiceInputSchema>;

export interface UploadDeps {
  efactura: Pick<EfacturaClient, 'uploadDocument' | 'uploadB2CDocument'>;
}

export async function handleUploadInvoice(input: UploadInvoiceInput, deps: UploadDeps): Promise<ToolResult> {
  try {
    const parsed = uploadInvoiceInputSchema.parse(input);
    const options = {
      standard: parsed.standard as StandardType | undefined,
      extern: parsed.extern,
      autofactura: parsed.autofactura,
    };
    const response = parsed.b2c
      ? await deps.efactura.uploadB2CDocument(parsed.xml, options)
      : await deps.efactura.uploadDocument(parsed.xml, options);
    return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
  } catch (err) {
    const wrapped = new McpToolError({
      code: 'UPLOAD_FAILED',
      message: err instanceof Error ? err.message : String(err),
      category: 'anaf_api',
    });
    return {
      content: [{ type: 'text', text: formatToolError(wrapped) }],
      isError: true,
    };
  }
}

export const UPLOAD_INVOICE_TOOL_DEFINITION = {
  name: 'anaf_upload_invoice',
  description:
    'Upload a UBL invoice XML to ANAF e-Factura. Returns execution status and upload ID (indexIncarcare) for later status polling. Defaults to B2B — pass b2c=true for B2C uploads. Requires ANAF auth.',
  inputSchema: uploadInvoiceInputSchema,
};
