import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { stringify as stringifyYaml } from 'yaml';
import { AnafAuthenticator, AnafDetailsClient } from '@florinszilagyi/anaf-ts-sdk';
import { waitForCallback } from '../callbackServer.js';
import {
  resolvePaths,
  resolveTlsDir,
  resolveCompaniesDir,
  writeActiveCui,
  writeFullToken,
  type CliStateRoots,
} from '../state.js';
import { McpToolError, formatToolError } from '../errors.js';
import type { ToolResult } from './types.js';

// ── Module-level pending auth state ──────────────────────────────────────────

interface PendingAuth {
  codePromise: Promise<string>;
  cui: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  roots?: CliStateRoots;
}

let pendingAuth: PendingAuth | null = null;

// ── anaf_auth_login ───────────────────────────────────────────────────────────

export const authLoginInputSchema = z.object({
  cui: z
    .string()
    .min(1)
    .describe('Romanian company CUI/CIF (e.g. "12345678"). This company becomes active after anaf_auth_complete.'),
});

export type AuthLoginInput = z.infer<typeof authLoginInputSchema>;

export interface AuthLoginDeps {
  env: {
    ANAF_CLIENT_ID?: string;
    ANAF_CLIENT_SECRET?: string;
    ANAF_REDIRECT_URI?: string;
  };
  roots?: CliStateRoots;
}

export async function handleAuthLogin(input: AuthLoginInput, deps: AuthLoginDeps): Promise<ToolResult> {
  const { ANAF_CLIENT_ID: clientId, ANAF_CLIENT_SECRET: clientSecret, ANAF_REDIRECT_URI: redirectUri } = deps.env;

  if (!clientId || !clientSecret || !redirectUri) {
    const missing = (['ANAF_CLIENT_ID', 'ANAF_CLIENT_SECRET', 'ANAF_REDIRECT_URI'] as const).filter(
      (k) => !deps.env[k]
    );
    return {
      content: [
        {
          type: 'text',
          text: formatToolError(
            new McpToolError({
              code: 'BAD_CONFIG',
              message: `Missing required env vars: ${missing.join(', ')}. Set them in your mcpServers config.`,
              category: 'config_missing',
            })
          ),
        },
      ],
      isError: true,
    };
  }

  let port: number;
  try {
    const portStr = new URL(redirectUri).port;
    port = portStr ? parseInt(portStr, 10) : 0;
    if (!port || isNaN(port)) throw new Error('no explicit port');
  } catch {
    return {
      content: [
        {
          type: 'text',
          text: formatToolError(
            new McpToolError({
              code: 'BAD_CONFIG',
              message: `ANAF_REDIRECT_URI must include an explicit port (e.g. https://localhost:9002/callback). Got: ${redirectUri}`,
              category: 'config_missing',
            })
          ),
        },
      ],
      isError: true,
    };
  }

  const tlsDir = resolveTlsDir(deps.roots);
  const authenticator = new AnafAuthenticator({ clientId, clientSecret, redirectUri });
  const authUrl = authenticator.getAuthorizationUrl();

  // Look up company and write metadata file (enables anaf_switch_company validation)
  try {
    const detailsClient = new AnafDetailsClient();
    const result = await detailsClient.batchGetCompanyData([input.cui]);
    if (result.success && result.data && result.data.length > 0) {
      const companiesDir = resolveCompaniesDir(deps.roots);
      fs.mkdirSync(companiesDir, { recursive: true });
      fs.writeFileSync(
        path.join(companiesDir, `${input.cui}.yaml`),
        stringifyYaml({ cui: input.cui, ...result.data[0] }),
        'utf8'
      );
    }
  } catch {
    // Company lookup failure is non-fatal — auth still proceeds
  }

  // Start callback server in background (non-blocking)
  const callbackPromise = waitForCallback({ port, tlsDir, authUrl });
  const codePromise = callbackPromise.then((r) => r.code);
  // Attach no-op catch to prevent unhandled rejection until anaf_auth_complete awaits it
  codePromise.catch(() => undefined);

  pendingAuth = { codePromise, cui: input.cui, clientId, clientSecret, redirectUri, roots: deps.roots };

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            url: authUrl,
            cui: input.cui,
            message:
              'OAuth flow started. Open the URL in your browser and authenticate with your ANAF digital certificate. ' +
              'After the browser shows "Authentication successful", call anaf_auth_complete to finish.',
          },
          null,
          2
        ),
      },
    ],
  };
}

export const AUTH_LOGIN_TOOL_DEFINITION = {
  name: 'anaf_auth_login',
  description:
    'Start ANAF OAuth authentication for a company (CUI). Returns the authorization URL — the user must open it in a browser. ' +
    'After the user completes browser authentication, call anaf_auth_complete to exchange the code and store the token. ' +
    'Requires ANAF_CLIENT_ID, ANAF_CLIENT_SECRET, and ANAF_REDIRECT_URI in the MCP server env.',
  inputSchema: authLoginInputSchema,
};

// ── anaf_auth_complete ────────────────────────────────────────────────────────

export const authCompleteInputSchema = z.object({});

export type AuthCompleteInput = z.infer<typeof authCompleteInputSchema>;

export async function handleAuthComplete(_input: AuthCompleteInput): Promise<ToolResult> {
  if (!pendingAuth) {
    return {
      content: [
        {
          type: 'text',
          text: formatToolError(
            new McpToolError({
              code: 'NO_PENDING_AUTH',
              message: 'No pending authentication. Call anaf_auth_login first to start the OAuth flow.',
              category: 'user_input',
            })
          ),
        },
      ],
      isError: true,
    };
  }

  const { codePromise, cui, clientId, clientSecret, redirectUri, roots } = pendingAuth;

  let code: string;
  try {
    code = await codePromise;
  } catch (err) {
    pendingAuth = null;
    return {
      content: [
        {
          type: 'text',
          text: formatToolError(
            new McpToolError({
              code: 'AUTH_FAILED',
              message: `OAuth callback failed: ${err instanceof Error ? err.message : String(err)}`,
              category: 'auth',
            })
          ),
        },
      ],
      isError: true,
    };
  }

  pendingAuth = null;

  const authenticator = new AnafAuthenticator({ clientId, clientSecret, redirectUri });
  let tokenResponse: { access_token: string; refresh_token: string; expires_in: number };
  try {
    tokenResponse = await authenticator.exchangeCodeForToken(code);
  } catch (err) {
    return {
      content: [
        {
          type: 'text',
          text: formatToolError(
            new McpToolError({
              code: 'TOKEN_EXCHANGE_FAILED',
              message: `Token exchange failed: ${err instanceof Error ? err.message : String(err)}`,
              category: 'auth',
            })
          ),
        },
      ],
      isError: true,
    };
  }

  const paths = resolvePaths(roots);
  writeFullToken(paths, tokenResponse);
  writeActiveCui(paths, cui);

  const expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString();
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            activeCui: cui,
            expiresAt,
            message: `Authenticated successfully. Active company set to ${cui}. Token expires at ${expiresAt}.`,
          },
          null,
          2
        ),
      },
    ],
  };
}

export const AUTH_COMPLETE_TOOL_DEFINITION = {
  name: 'anaf_auth_complete',
  description:
    'Complete ANAF OAuth authentication after the user has authenticated in the browser. ' +
    'Must be called after anaf_auth_login. Waits up to 120 seconds for the OAuth callback, ' +
    'exchanges the code for tokens, and stores them for use by other tools.',
  inputSchema: authCompleteInputSchema,
};

// ── anaf_switch_company ───────────────────────────────────────────────────────

export const switchCompanyInputSchema = z.object({
  cui: z.string().min(1).describe('CUI/CIF of the company to activate.'),
  force: z
    .boolean()
    .optional()
    .default(false)
    .describe('If true, switch even if the company was not previously registered via anaf_auth_login.'),
});

export type SwitchCompanyInput = z.infer<typeof switchCompanyInputSchema>;

export interface SwitchCompanyDeps {
  roots?: CliStateRoots;
}

export async function handleSwitchCompany(input: SwitchCompanyInput, deps: SwitchCompanyDeps): Promise<ToolResult> {
  if (!input.force) {
    const companiesDir = resolveCompaniesDir(deps.roots);
    const companyFile = path.join(companiesDir, `${input.cui}.yaml`);
    if (!fs.existsSync(companyFile)) {
      return {
        content: [
          {
            type: 'text',
            text: formatToolError(
              new McpToolError({
                code: 'COMPANY_NOT_FOUND',
                message: `Company ${input.cui} not registered. Run anaf_auth_login for this CUI first, or pass force: true to override.`,
                category: 'user_input',
                details: { cui: input.cui },
              })
            ),
          },
        ],
        isError: true,
      };
    }
  }

  const paths = resolvePaths(deps.roots);
  writeActiveCui(paths, input.cui);

  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(
          {
            success: true,
            activeCui: input.cui,
            message: `Active company switched to ${input.cui}. All subsequent ANAF operations will use this CUI.`,
          },
          null,
          2
        ),
      },
    ],
  };
}

export const SWITCH_COMPANY_TOOL_DEFINITION = {
  name: 'anaf_switch_company',
  description:
    'Switch the active ANAF company. The new company will be used for all subsequent e-Factura operations. ' +
    'No re-authentication is needed — the OAuth token is shared across companies. ' +
    'The company must have been previously authenticated via anaf_auth_login (unless force: true).',
  inputSchema: switchCompanyInputSchema,
};
