import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { EfacturaClient, EfacturaToolsClient } from '@florinszilagyi/anaf-ts-sdk';
import { McpToolError, formatToolError } from '../errors.js';
import type { ToolResult } from './types.js';

/**
 * Write bytes to `outputPath`, reporting a local filesystem failure as such
 * instead of folding it into whatever ANAF call preceded it.
 */
function writeOutput(outputPath: string, bytes: Buffer): string {
  const abs = path.resolve(outputPath);
  try {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, bytes);
  } catch (err) {
    throw new McpToolError({
      code: 'WRITE_FAILED',
      message: `Could not write to output_path "${abs}": ${err instanceof Error ? err.message : String(err)}`,
      category: 'user_input',
    });
  }
  return abs;
}

/** Wrap a non-McpToolError as `code`; errors already typed are passed through. */
function asToolError(err: unknown, code: string): McpToolError {
  if (err instanceof McpToolError) return err;
  return new McpToolError({
    code,
    message: err instanceof Error ? err.message : String(err),
    category: 'anaf_api',
  });
}

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
    const buf = await deps.efactura.downloadDocument(input.download_id);
    const abs = writeOutput(input.output_path, buf);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ path: abs, bytes: buf.length, downloadId: input.download_id }, null, 2),
        },
      ],
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: formatToolError(asToolError(err, 'DOWNLOAD_FAILED')) }],
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

export const downloadInvoicePdfInputSchema = z.object({
  download_id: z.string().min(1).describe('The idDescarcare returned from anaf_invoice_status (when stare=ok)'),
  output_path: z.string().min(1).describe('Absolute or relative path where the PDF file should be written'),
  standard: z
    .enum(['FACT1', 'FCN'])
    .describe('Rendering standard: FACT1 for invoices (default), FCN for credit notes')
    .optional()
    .default('FACT1'),
  no_validation: z
    .boolean()
    .describe('Skip ANAF schema validation before rendering — use when a valid invoice is rejected by the validator')
    .optional()
    .default(false),
});

export type DownloadInvoicePdfInput = z.input<typeof downloadInvoicePdfInputSchema>;

export interface DownloadPdfDeps {
  efactura: Pick<EfacturaClient, 'downloadDocumentXml'>;
  tools: Pick<EfacturaToolsClient, 'convertXmlToPdf' | 'convertXmlToPdfNoValidation'>;
}

export async function handleDownloadInvoicePdf(
  input: DownloadInvoicePdfInput,
  deps: DownloadPdfDeps
): Promise<ToolResult> {
  try {
    const parsed = parseInput(input);
    const xml = await deps.efactura.downloadDocumentXml(parsed.download_id);
    const pdf = parsed.no_validation
      ? await deps.tools.convertXmlToPdfNoValidation(xml, parsed.standard)
      : await deps.tools.convertXmlToPdf(xml, parsed.standard);

    const abs = writeOutput(parsed.output_path, pdf);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            { path: abs, bytes: pdf.length, downloadId: parsed.download_id, standard: parsed.standard },
            null,
            2
          ),
        },
      ],
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: formatToolError(asToolError(err, 'DOWNLOAD_PDF_FAILED')) }],
      isError: true,
    };
  }
}

/** Re-validate defensively: the handler is exported and callable on its own. */
function parseInput(input: DownloadInvoicePdfInput): z.infer<typeof downloadInvoicePdfInputSchema> {
  const result = downloadInvoicePdfInputSchema.safeParse(input);
  if (!result.success) {
    throw new McpToolError({
      code: 'INVALID_INPUT',
      message: result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
      category: 'user_input',
    });
  }
  return result.data;
}

export const DOWNLOAD_INVOICE_PDF_TOOL_DEFINITION = {
  name: 'anaf_download_invoice_pdf',
  description:
    'Download an invoice and save it as a PDF. Fetches the ZIP for download_id, unwraps the invoice XML, renders it through the ANAF transform service, and writes the PDF to output_path. Returns { path, bytes, downloadId, standard }. Requires ANAF auth.',
  inputSchema: downloadInvoicePdfInputSchema,
};
