import { eq } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { db } from '@/db';
import { anafGrants, companies } from '@/db/schema';
import { makeAuthenticator } from '@/lib/anaf/grantTokens';
import { encryptSecret, verifySignature } from '@/lib/crypto';
import { ensureUser } from '@/lib/users';

/**
 * ANAF OAuth callback. The auth code is only valid for ~60 seconds, so the
 * code exchange happens FIRST — before any DB work — and this route stays
 * outside Clerk middleware (identity comes from the signed state param).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = req.nextUrl;
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');

  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/dashboard/companies?connect_error=${encodeURIComponent(reason)}`, url.origin));

  if (!code || !state) return fail('missing_code_or_state');

  const verified = verifyState(state, req.cookies.get('anaf_oauth_nonce')?.value);
  if (!verified) return fail('invalid_state');

  // Exchange immediately — the 60s window is unforgiving.
  let tokens;
  try {
    tokens = await makeAuthenticator().exchangeCodeForToken(code);
  } catch (cause) {
    console.error('[fastbill] ANAF code exchange failed:', cause);
    return fail('exchange_failed');
  }

  const now = new Date();
  await ensureUser(db, verified.userId);
  await db.transaction(async (tx) => {
    // Replace any previous grant: revoke old rows, repoint companies to the new grant.
    const old = await tx
      .update(anafGrants)
      .set({ status: 'revoked', updatedAt: now })
      .where(eq(anafGrants.userId, verified.userId))
      .returning({ id: anafGrants.id });

    const [grant] = await tx
      .insert(anafGrants)
      .values({
        userId: verified.userId,
        encRefreshToken: encryptSecret(tokens.refresh_token),
        encAccessToken: encryptSecret(tokens.access_token),
        accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
        refreshTokenObtainedAt: now,
      })
      .returning({ id: anafGrants.id });

    if (old.length > 0) {
      await tx.update(companies).set({ grantId: grant.id }).where(eq(companies.userId, verified.userId));
    }
  });

  const res = NextResponse.redirect(new URL('/dashboard/companies?connected=1', url.origin));
  res.cookies.delete('anaf_oauth_nonce');
  return res;
}

function verifyState(state: string, cookieNonce: string | undefined): { userId: string } | null {
  const dot = state.lastIndexOf('.');
  if (dot < 0) return null;
  const payload = state.slice(0, dot);
  const signature = state.slice(dot + 1);
  if (!verifySignature(payload, signature)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      userId?: string;
      nonce?: string;
      iat?: number;
    };
    if (!parsed.userId || !parsed.nonce || !parsed.iat) return null;
    if (Date.now() - parsed.iat > 10 * 60 * 1000) return null; // 10 min state validity
    if (!cookieNonce || cookieNonce !== parsed.nonce) return null;
    return { userId: parsed.userId };
  } catch {
    return null;
  }
}
