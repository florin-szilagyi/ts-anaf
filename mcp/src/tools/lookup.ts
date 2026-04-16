import { z } from 'zod';
import type { AnafDetailsClient } from '@florinszilagyi/anaf-ts-sdk';
import { McpToolError, formatToolError } from '../errors.js';
import type { ToolResult } from './types.js';

export type { ToolResult };

export const lookupCompanyInputSchema = z.object({
  cui: z.string().min(1).describe('Romanian company CUI/CIF (with or without RO prefix)'),
});

export type LookupCompanyInput = z.infer<typeof lookupCompanyInputSchema>;

export interface LookupDeps {
  details: Pick<AnafDetailsClient, 'batchGetCompanyData'>;
}

export async function handleLookupCompany(input: LookupCompanyInput, deps: LookupDeps): Promise<ToolResult> {
  try {
    const result = await deps.details.batchGetCompanyData([input.cui]);
    if (!result.success) {
      throw new McpToolError({
        code: 'LOOKUP_FAILED',
        message: result.error ?? 'Unknown ANAF lookup failure',
        category: 'anaf_api',
        details: { cui: input.cui },
      });
    }
    const rows = result.data ?? [];
    if (rows.length === 0) {
      throw new McpToolError({
        code: 'LOOKUP_NOT_FOUND',
        message: `No company data returned for ${input.cui}`,
        category: 'anaf_api',
        details: { cui: input.cui },
      });
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(rows[0], null, 2) }],
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: formatToolError(err) }],
      isError: true,
    };
  }
}

export const LOOKUP_TOOL_DEFINITION = {
  name: 'anaf_lookup_company',
  description:
    'Look up a Romanian company by CUI/CIF via the public ANAF registry. Returns company name, address, VAT registration status, and registration number.',
  inputSchema: lookupCompanyInputSchema,
};
