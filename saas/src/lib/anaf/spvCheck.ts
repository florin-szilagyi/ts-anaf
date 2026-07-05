import type { Db } from '@/db';
import { getEfacturaClient, type GatewayDeps } from './gateway';

/**
 * Probe whether the grant's certificate holder has SPV rights over a CIF by
 * listing 1 day of messages for it on the production environment. An empty
 * list still succeeds; ANAF returns an explicit error when the OAuth identity
 * has no rights for the CIF.
 */
export async function verifySpvRights(
  db: Db,
  opts: { grantId: string; cif: string },
  deps: GatewayDeps = {}
): Promise<{ verified: boolean; reason?: string }> {
  try {
    const client = await getEfacturaClient(db, { grantId: opts.grantId, cif: opts.cif, mode: 'live' }, deps);
    const res = await client.getMessages({ zile: 1 });
    // "no messages in interval" style responses still mean the rights exist;
    // rights errors surface as thrown errors or an explicit `eroare`.
    const eroare = (res as { eroare?: string }).eroare;
    if (eroare && /drept|drepturi|neautorizat|nu exista drepturi/i.test(eroare)) {
      return { verified: false, reason: eroare };
    }
    return { verified: true };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    // "Nu exista mesaje in intervalul selectat" arrives as an API error on some
    // deployments — that still proves rights (the query executed for the CIF).
    if (/nu exista mesaje/i.test(message)) {
      return { verified: true };
    }
    return { verified: false, reason: message };
  }
}
