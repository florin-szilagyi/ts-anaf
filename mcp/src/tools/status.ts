import { z } from 'zod';
import type { EfacturaClient } from '@florinszilagyi/anaf-ts-sdk';
import { McpToolError, formatToolError } from '../errors.js';
import type { ToolResult } from './types.js';

export const invoiceStatusInputSchema = z.object({
  upload_id: z.string().min(1).describe('The indexIncarcare returned from anaf_upload_invoice'),
});

export type InvoiceStatusInput = z.infer<typeof invoiceStatusInputSchema>;

export interface StatusDeps {
  efactura: Pick<EfacturaClient, 'getUploadStatus'>;
}

export async function handleInvoiceStatus(input: InvoiceStatusInput, deps: StatusDeps): Promise<ToolResult> {
  try {
    const status = await deps.efactura.getUploadStatus(input.upload_id);
    return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
  } catch (err) {
    const wrapped = new McpToolError({
      code: 'STATUS_FAILED',
      message: err instanceof Error ? err.message : String(err),
      category: 'anaf_api',
    });
    return {
      content: [{ type: 'text', text: formatToolError(wrapped) }],
      isError: true,
    };
  }
}

export const INVOICE_STATUS_TOOL_DEFINITION = {
  name: 'anaf_invoice_status',
  description:
    'Check the processing status of a previously uploaded invoice. Returns `stare` (ok/nok/in prelucrare) and `idDescarcare` (used with anaf_download_invoice) when complete. Requires ANAF auth.',
  inputSchema: invoiceStatusInputSchema,
};
