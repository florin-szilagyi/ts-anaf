import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { EfacturaClient } from '@florinszilagyi/anaf-ts-sdk';
import { McpToolError, formatToolError } from '../errors.js';
import type { ToolResult } from './types.js';

export const downloadInvoiceInputSchema = z.object({
  download_id: z.string().min(1).describe('The idDescarcare returned from anaf_invoice_status (when stare=ok)'),
  output_path: z.string().min(1).describe('Absolute or relative path where the ZIP file should be written'),
});

export type DownloadInvoiceInput = z.infer<typeof downloadInvoiceInputSchema>;

export interface DownloadDeps {
  efactura: Pick<EfacturaClient, 'downloadDocument'>;
}

export async function handleDownloadInvoice(input: DownloadInvoiceInput, deps: DownloadDeps): Promise<ToolResult> {
  try {
    const base64 = await deps.efactura.downloadDocument(input.download_id);
    const buf = Buffer.from(base64, 'base64');
    const abs = path.resolve(input.output_path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buf);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ path: abs, bytes: buf.length, downloadId: input.download_id }, null, 2),
        },
      ],
    };
  } catch (err) {
    const wrapped = new McpToolError({
      code: 'DOWNLOAD_FAILED',
      message: err instanceof Error ? err.message : String(err),
      category: 'anaf_api',
    });
    return {
      content: [{ type: 'text', text: formatToolError(wrapped) }],
      isError: true,
    };
  }
}

export const DOWNLOAD_INVOICE_TOOL_DEFINITION = {
  name: 'anaf_download_invoice',
  description:
    'Download the processed invoice ZIP archive for a completed upload. Writes bytes to output_path and returns { path, bytes, downloadId }. Requires ANAF auth.',
  inputSchema: downloadInvoiceInputSchema,
};
