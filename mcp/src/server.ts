#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { UblBuilder, AnafDetailsClient } from '@florinszilagyi/anaf-ts-sdk';

import { readCliState, resolveClientSecret } from './state.js';
import { buildServices } from './services.js';
import { McpToolError, formatToolError } from './errors.js';

import { LOOKUP_TOOL_DEFINITION, handleLookupCompany, lookupCompanyInputSchema } from './tools/lookup.js';
import { BUILD_UBL_TOOL_DEFINITION, handleBuildUbl, buildUblInputSchema } from './tools/ubl.js';
import { VALIDATE_XML_TOOL_DEFINITION, handleValidateXml, validateXmlInputSchema } from './tools/validate.js';
import { UPLOAD_INVOICE_TOOL_DEFINITION, handleUploadInvoice, uploadInvoiceInputSchema } from './tools/upload.js';
import { INVOICE_STATUS_TOOL_DEFINITION, handleInvoiceStatus, invoiceStatusInputSchema } from './tools/status.js';
import {
  DOWNLOAD_INVOICE_TOOL_DEFINITION,
  handleDownloadInvoice,
  downloadInvoiceInputSchema,
} from './tools/download.js';
import { LIST_MESSAGES_TOOL_DEFINITION, handleListMessages, listMessagesInputSchema } from './tools/messages.js';
import { zodToJsonSchema } from './jsonSchema.js';

const SERVER_INFO = {
  name: 'anaf-mcp',
  version: '0.1.0',
};

const TOOL_DEFINITIONS = [
  LOOKUP_TOOL_DEFINITION,
  BUILD_UBL_TOOL_DEFINITION,
  VALIDATE_XML_TOOL_DEFINITION,
  UPLOAD_INVOICE_TOOL_DEFINITION,
  INVOICE_STATUS_TOOL_DEFINITION,
  DOWNLOAD_INVOICE_TOOL_DEFINITION,
  LIST_MESSAGES_TOOL_DEFINITION,
];

type AnyToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

async function runAuthedTool<T>(fn: (services: ReturnType<typeof buildServices>) => Promise<T>): Promise<T> {
  const state = readCliState();
  const clientSecret = resolveClientSecret(
    { ANAF_CLIENT_SECRET: process.env.ANAF_CLIENT_SECRET },
    state.credential.clientSecret
  );
  const services = buildServices({ state, clientSecret });
  try {
    return await fn(services);
  } finally {
    services.persistRotation();
  }
}

export async function handleToolCall(name: string, args: unknown): Promise<AnyToolResult> {
  try {
    switch (name) {
      case LOOKUP_TOOL_DEFINITION.name: {
        const input = lookupCompanyInputSchema.parse(args);
        return handleLookupCompany(input, { details: new AnafDetailsClient() });
      }
      case BUILD_UBL_TOOL_DEFINITION.name: {
        const input = buildUblInputSchema.parse(args);
        return handleBuildUbl(input, { builder: new UblBuilder() });
      }
      case VALIDATE_XML_TOOL_DEFINITION.name: {
        const input = validateXmlInputSchema.parse(args);
        return runAuthedTool((s) => handleValidateXml(input, { tools: s.tools }));
      }
      case UPLOAD_INVOICE_TOOL_DEFINITION.name: {
        const input = uploadInvoiceInputSchema.parse(args);
        return runAuthedTool((s) => handleUploadInvoice(input, { efactura: s.efactura }));
      }
      case INVOICE_STATUS_TOOL_DEFINITION.name: {
        const input = invoiceStatusInputSchema.parse(args);
        return runAuthedTool((s) => handleInvoiceStatus(input, { efactura: s.efactura }));
      }
      case DOWNLOAD_INVOICE_TOOL_DEFINITION.name: {
        const input = downloadInvoiceInputSchema.parse(args);
        return runAuthedTool((s) => handleDownloadInvoice(input, { efactura: s.efactura }));
      }
      case LIST_MESSAGES_TOOL_DEFINITION.name: {
        const input = listMessagesInputSchema.parse(args);
        return runAuthedTool((s) => handleListMessages(input, { efactura: s.efactura }));
      }
      default:
        throw new McpToolError({
          code: 'UNKNOWN_TOOL',
          message: `Unknown tool: ${name}`,
          category: 'user_input',
        });
    }
  } catch (err) {
    return {
      content: [{ type: 'text', text: formatToolError(err) }],
      isError: true,
    };
  }
}

export async function main(): Promise<void> {
  const server = new Server(SERVER_INFO, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.inputSchema),
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    return handleToolCall(name, args ?? {});
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
