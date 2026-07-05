import { auth } from '@clerk/nextjs/server';
import { randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { signPayload } from '@/lib/crypto';
import { makeAuthenticator } from '@/lib/anaf/grantTokens';

/**
 * Kick off the ANAF certificate OAuth. The state param is an HMAC-signed
 * {userId, nonce, iat} so the (Clerk-middleware-free) callback can trust it;
 * the nonce is mirrored in an httpOnly cookie to bind state to this browser.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.redirect(new URL('/sign-in', req.nextUrl.origin));
  }

  const nonce = randomBytes(16).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ userId, nonce, iat: Date.now() })).toString('base64url');
  const state = `${payload}.${signPayload(payload)}`;

  const authUrl = new URL(makeAuthenticator().getAuthorizationUrl());
  authUrl.searchParams.set('state', state);

  const res = NextResponse.redirect(authUrl);
  res.cookies.set('anaf_oauth_nonce', nonce, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 600,
    path: '/api/anaf',
  });
  return res;
}
