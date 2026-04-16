import { z } from 'zod';
import type { EfacturaToolsClient } from '@florinszilagyi/anaf-ts-sdk';
import { McpToolError, formatToolError } from '../errors.js';
import type { ToolResult } from './types.js';

export const validateXmlInputSchema = z.object({
  xml: z.string().min(1).describe('Full UBL XML document as string'),
  standard: z.enum(['FACT1', 'FCN']).optional().default('FACT1'),
});

export type ValidateXmlInput = z.input<typeof validateXmlInputSchema>;

export interface ValidateDeps {
  tools: Pick<EfacturaToolsClient, 'validateXml'>;
}

export async function handleValidateXml(input: ValidateXmlInput, deps: ValidateDeps): Promise<ToolResult> {
  try {
    const parsed = validateXmlInputSchema.parse(input);
    const result = await deps.tools.validateXml(parsed.xml, parsed.standard);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    const wrapped = new McpToolError({
      code: 'VALIDATION_FAILED',
      message: err instanceof Error ? err.message : String(err),
      category: 'anaf_api',
    });
    return {
      content: [{ type: 'text', text: formatToolError(wrapped) }],
      isError: true,
    };
  }
}

export const VALIDATE_XML_TOOL_DEFINITION = {
  name: 'anaf_validate_xml',
  description:
    'Validate a UBL invoice XML against ANAF schema and business rules (CIUS-RO). Returns a JSON object with `valid` (boolean) and `details`. Requires ANAF auth.',
  inputSchema: validateXmlInputSchema,
};
