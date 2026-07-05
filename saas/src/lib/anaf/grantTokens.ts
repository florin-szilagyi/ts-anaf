import { AnafAuthenticator } from '@florinszilagyi/anaf-ts-sdk';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '@/db';
import { anafGrants } from '@/db/schema';
import { decryptSecret, encryptSecret } from '../crypto';
import { env } from '../env';
import { ApiError } from '../errors';

/**
 * Serialized ANAF token access with atomic refresh-token rotation.
 *
 * ANAF rotates the refresh token on EVERY refresh and invalidates the old one.
 * If a rotated token is not persisted the grant is bricked until the user
 * redoes the certificate OAuth. So:
 *
 *  - fast path (no lock): access token still valid for > 1h → decrypt, return.
 *  - slow path: SELECT ... FOR UPDATE on the grant row serializes refreshers
 *    across all serverless instances; the ANAF HTTP call happens inside the
 *    lock (rare — access tokens live ~90 days) and both tokens are persisted
 *    before commit. Concurrent callers block briefly, then hit the re-check.
 */

const REFRESH_MARGIN_MS = 60 * 60 * 1000; // refresh when < 1h validity left

export interface GrantAccess {
  accessToken: string;
  grantId: string;
}

export function makeAuthenticator(): AnafAuthenticator {
  return new AnafAuthenticator({
    clientId: env.ANAF_CLIENT_ID,
    clientSecret: env.ANAF_CLIENT_SECRET,
    redirectUri: env.ANAF_REDIRECT_URI,
  });
}

type AuthenticatorLike = Pick<AnafAuthenticator, 'refreshAccessToken'>;

export interface GetTokenOptions {
  /** Refresh when less than this validity remains (default 1h). The token
   *  refresh guard passes ~8 days to keep the rotation chain alive. */
  minValidityMs?: number;
}

export async function getGrantAccessToken(
  db: Db,
  grantId: string,
  authenticator: AuthenticatorLike = makeAuthenticator(),
  opts: GetTokenOptions = {}
): Promise<GrantAccess> {
  const margin = opts.minValidityMs ?? REFRESH_MARGIN_MS;
  const [grant] = await db.select().from(anafGrants).where(eq(anafGrants.id, grantId)).limit(1);
  if (!grant) {
    throw new ApiError({ code: 'GRANT_MISSING', message: 'No ANAF connection found. Connect ANAF first.' });
  }
  if (grant.status !== 'active') {
    throw new ApiError({
      code: 'GRANT_EXPIRED',
      message: 'The ANAF connection is no longer active. Reconnect with your certificate.',
    });
  }

  // Fast path — valid access token, no locking.
  if (
    grant.encAccessToken &&
    grant.accessTokenExpiresAt &&
    grant.accessTokenExpiresAt.getTime() > Date.now() + margin
  ) {
    return { accessToken: decryptSecret(grant.encAccessToken), grantId };
  }

  // Slow path — serialize the refresh on the grant row.
  return db.transaction(async (tx) => {
    const rows = await tx.execute(
      sql`select id, enc_refresh_token as "encRefreshToken", enc_access_token as "encAccessToken",
            access_token_expires_at as "accessTokenExpiresAt", status
          from anaf_grants where id = ${grantId} for update`
    );
    const locked = (
      rows as unknown as Array<{
        id: string;
        encRefreshToken: string;
        encAccessToken: string | null;
        accessTokenExpiresAt: Date | string | null;
        status: string;
      }>
    )[0];
    if (!locked || locked.status !== 'active') {
      throw new ApiError({ code: 'GRANT_EXPIRED', message: 'The ANAF connection is no longer active.' });
    }

    // Someone else refreshed while we waited for the lock.
    const expiresAt = locked.accessTokenExpiresAt ? new Date(locked.accessTokenExpiresAt) : null;
    if (locked.encAccessToken && expiresAt && expiresAt.getTime() > Date.now() + margin) {
      return { accessToken: decryptSecret(locked.encAccessToken), grantId };
    }

    try {
      const refreshed = await authenticator.refreshAccessToken(decryptSecret(locked.encRefreshToken));
      const newRefresh = refreshed.refresh_token || decryptSecret(locked.encRefreshToken);
      const newExpiry = new Date(Date.now() + refreshed.expires_in * 1000);
      await tx
        .update(anafGrants)
        .set({
          encAccessToken: encryptSecret(refreshed.access_token),
          encRefreshToken: encryptSecret(newRefresh),
          accessTokenExpiresAt: newExpiry,
          tokenVersion: sql`${anafGrants.tokenVersion} + 1`,
          lastRefreshAt: sql`now()`,
          lastError: null,
          updatedAt: sql`now()`,
        })
        .where(eq(anafGrants.id, grantId));
      return { accessToken: refreshed.access_token, grantId };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      // invalid_grant ⇒ the refresh token is dead; the user must re-auth with the certificate.
      await tx
        .update(anafGrants)
        .set({ status: 'expired', lastError: message, updatedAt: sql`now()` })
        .where(eq(anafGrants.id, grantId));
      throw new ApiError({
        code: 'GRANT_EXPIRED',
        message: 'ANAF token refresh failed — reconnect with your certificate.',
        details: { cause: message },
      });
    }
  });
}
