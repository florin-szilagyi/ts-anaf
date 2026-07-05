import { AnafDetailsClient, EfacturaClient, EfacturaToolsClient, type TokenManager } from '@florinszilagyi/anaf-ts-sdk';
import type { Db } from '@/db';
import type { ApiKeyMode } from '@/db/schema';
import { getGrantAccessToken } from './grantTokens';

/**
 * The ONLY place SDK clients get built. Clients receive a static token shim
 * (never the real TokenManager) so the SDK can never refresh implicitly —
 * refresh-token rotation happens exclusively inside grantTokens' locked
 * transaction. Same trick as the CLI's CachedTokenManager.
 */

function staticTokenManager(accessToken: string): TokenManager {
  const shim = {
    getValidAccessToken: async () => accessToken,
    getRefreshToken: () => '',
  };
  return shim as unknown as TokenManager;
}

export interface GatewayDeps {
  efacturaFactory?: typeof buildEfacturaClient;
  toolsFactory?: typeof buildToolsClient;
}

function buildEfacturaClient(accessToken: string, cif: string, mode: ApiKeyMode): EfacturaClient {
  return new EfacturaClient({ vatNumber: cif, testMode: mode === 'test' }, staticTokenManager(accessToken));
}

function buildToolsClient(accessToken: string): EfacturaToolsClient {
  return new EfacturaToolsClient({}, staticTokenManager(accessToken));
}

export async function getEfacturaClient(
  db: Db,
  opts: { grantId: string; cif: string; mode: ApiKeyMode },
  deps: GatewayDeps = {}
): Promise<EfacturaClient> {
  const { accessToken } = await getGrantAccessToken(db, opts.grantId);
  return (deps.efacturaFactory ?? buildEfacturaClient)(accessToken, opts.cif, opts.mode);
}

export async function getToolsClient(
  db: Db,
  opts: { grantId: string },
  deps: GatewayDeps = {}
): Promise<EfacturaToolsClient> {
  const { accessToken } = await getGrantAccessToken(db, opts.grantId);
  return (deps.toolsFactory ?? buildToolsClient)(accessToken);
}

/** Public company lookup — no auth, shared instance. */
const globalForDetails = globalThis as unknown as { __fastbillDetails?: AnafDetailsClient };
export function getDetailsClient(): AnafDetailsClient {
  globalForDetails.__fastbillDetails ??= new AnafDetailsClient();
  return globalForDetails.__fastbillDetails;
}
