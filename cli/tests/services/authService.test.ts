import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AuthService, type AuthServiceOptions, type SecretSource } from '../../src/services/authService';
import { ContextService, TokenStore } from '../../src/state';
import { getXdgPaths } from '../../src/state/paths';
import { CliError } from '../../src/output/errors';
import type { Context } from '../../src/state';
import type { AnafAuthenticator, TokenResponse } from 'anaf-ts-sdk';

class FakeAuthenticator {
  authUrl = 'https://logincert.anaf.ro/oauth/authorize?fake=1';
  exchangeResponse: TokenResponse = {
    access_token: 'at-1',
    refresh_token: 'rt-1',
    expires_in: 3600,
    token_type: 'Bearer',
  };
  refreshResponse: TokenResponse = {
    access_token: 'at-2',
    refresh_token: 'rt-2',
    expires_in: 3600,
    token_type: 'Bearer',
  };
  exchangeCalls: string[] = [];
  refreshCalls: string[] = [];
  shouldFailExchange = false;
  shouldFailRefresh = false;

  getAuthorizationUrl(_scope?: string): string {
    return this.authUrl;
  }
  async exchangeCodeForToken(code: string): Promise<TokenResponse> {
    this.exchangeCalls.push(code);
    if (this.shouldFailExchange) throw new Error('exchange failed');
    return this.exchangeResponse;
  }
  async refreshAccessToken(rt: string): Promise<TokenResponse> {
    this.refreshCalls.push(rt);
    if (this.shouldFailRefresh) throw new Error('refresh failed');
    return this.refreshResponse;
  }
}

function harness(opts?: { authenticator?: Partial<FakeAuthenticator>; now?: () => Date }): {
  dir: string;
  paths: ReturnType<typeof getXdgPaths>;
  contextService: ContextService;
  tokenStore: TokenStore;
  fake: FakeAuthenticator;
  auth: AuthService;
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anaf-cli-auth-'));
  const paths = getXdgPaths({
    configHome: path.join(dir, 'config'),
    dataHome: path.join(dir, 'data'),
    cacheHome: path.join(dir, 'cache'),
  });
  const contextService = new ContextService({ paths });
  const tokenStore = new TokenStore({ paths });
  const fake = new FakeAuthenticator();
  if (opts?.authenticator) Object.assign(fake, opts.authenticator);
  const factory: AuthServiceOptions['authenticatorFactory'] = () => fake as unknown as AnafAuthenticator;
  const auth = new AuthService({
    contextService,
    tokenStore,
    authenticatorFactory: factory,
    now: opts?.now,
  });
  return { dir, paths, contextService, tokenStore, fake, auth };
}

const sample = (name = 'acme-prod'): Context => ({
  name,
  companyCui: 'RO12345678',
  environment: 'prod',
  auth: { clientId: 'cid', redirectUri: 'https://localhost/cb' },
});

describe('AuthService.resolveSecret', () => {
  it('prefers flag, then stdin, then env', () => {
    expect(AuthService.resolveSecret({ flag: 'a', stdin: 'b', env: 'c' })).toBe('a');
    expect(AuthService.resolveSecret({ stdin: 'b', env: 'c' })).toBe('b');
    expect(AuthService.resolveSecret({ env: 'c' })).toBe('c');
  });
  it('throws CLIENT_SECRET_MISSING when none provided', () => {
    let err: unknown;
    try {
      AuthService.resolveSecret({});
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe('CLIENT_SECRET_MISSING');
    expect((err as CliError).category).toBe('auth');
  });
  it('throws on empty strings', () => {
    const src: SecretSource = { flag: '', stdin: '', env: '' };
    expect(() => AuthService.resolveSecret(src)).toThrow(CliError);
  });
});

describe('AuthService.buildAuthorizationUrl', () => {
  it('returns the SDK URL bound to the active context', () => {
    const h = harness();
    h.contextService.add(sample());
    h.contextService.setCurrent('acme-prod');
    const result = h.auth.buildAuthorizationUrl();
    expect(result.context.name).toBe('acme-prod');
    expect(result.url).toContain('logincert.anaf.ro');
  });

  it('honors an explicit context name', () => {
    const h = harness();
    h.contextService.add(sample('acme-prod'));
    h.contextService.add(sample('acme-test'));
    const result = h.auth.buildAuthorizationUrl('acme-test');
    expect(result.context.name).toBe('acme-test');
  });

  it('throws CONTEXT_NOT_FOUND for unknown name', () => {
    const h = harness();
    expect(() => h.auth.buildAuthorizationUrl('nope')).toThrow(CliError);
  });
});

describe('AuthService.exchangeCode', () => {
  it('exchanges and persists the token with expiry metadata', async () => {
    const fixedNow = new Date('2026-04-11T18:00:00Z');
    const h = harness({ now: () => fixedNow });
    h.contextService.add(sample());
    h.contextService.setCurrent('acme-prod');
    const result = await h.auth.exchangeCode({
      code: 'auth-code-1',
      secret: { env: 'secret-1' },
    });
    expect(result.refreshToken).toBe('rt-1');
    expect(result.accessToken).toBe('at-1');
    expect(result.obtainedAt).toBe('2026-04-11T18:00:00.000Z');
    expect(result.expiresAt).toBe('2026-04-11T19:00:00.000Z');
    // persisted
    const stored = h.tokenStore.read('acme-prod');
    expect(stored?.refreshToken).toBe('rt-1');
    expect(h.fake.exchangeCalls).toEqual(['auth-code-1']);
  });

  it('wraps SDK failures as AUTH_FAILED', async () => {
    const h = harness({ authenticator: { shouldFailExchange: true } });
    h.contextService.add(sample());
    h.contextService.setCurrent('acme-prod');
    let err: unknown;
    try {
      await h.auth.exchangeCode({ code: 'c', secret: { env: 's' } });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe('AUTH_FAILED');
    expect((err as CliError).category).toBe('auth');
  });

  it('throws CLIENT_SECRET_MISSING when no secret is given', async () => {
    const h = harness();
    h.contextService.add(sample());
    h.contextService.setCurrent('acme-prod');
    await expect(h.auth.exchangeCode({ code: 'c', secret: {} })).rejects.toBeInstanceOf(CliError);
  });
});

describe('AuthService.refresh', () => {
  it('uses the persisted refresh token, persists the rotated one, and updates expiry', async () => {
    const fixedNow = new Date('2026-04-11T20:00:00Z');
    const h = harness({ now: () => fixedNow });
    h.contextService.add(sample());
    h.contextService.setCurrent('acme-prod');
    h.tokenStore.write('acme-prod', { refreshToken: 'rt-1' });
    const result = await h.auth.refresh({ secret: { env: 's' } });
    expect(result.refreshToken).toBe('rt-2');
    expect(result.accessToken).toBe('at-2');
    expect(result.expiresAt).toBe('2026-04-11T21:00:00.000Z');
    expect(h.tokenStore.read('acme-prod')?.refreshToken).toBe('rt-2');
  });

  it('throws NO_REFRESH_TOKEN when no token is persisted', async () => {
    const h = harness();
    h.contextService.add(sample());
    h.contextService.setCurrent('acme-prod');
    let err: unknown;
    try {
      await h.auth.refresh({ secret: { env: 's' } });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).code).toBe('NO_REFRESH_TOKEN');
  });

  it('wraps SDK refresh failures as AUTH_FAILED', async () => {
    const h = harness({ authenticator: { shouldFailRefresh: true } });
    h.contextService.add(sample());
    h.contextService.setCurrent('acme-prod');
    h.tokenStore.write('acme-prod', { refreshToken: 'rt-1' });
    await expect(h.auth.refresh({ secret: { env: 's' } })).rejects.toBeInstanceOf(CliError);
  });
});

describe('AuthService.whoami', () => {
  it('returns missing when no token file', () => {
    const h = harness();
    h.contextService.add(sample());
    h.contextService.setCurrent('acme-prod');
    const result = h.auth.whoami();
    expect(result.context.name).toBe('acme-prod');
    expect(result.tokenStatus).toBe('missing');
  });

  it('returns fresh when expiresAt > now', () => {
    const h = harness({ now: () => new Date('2026-04-11T18:00:00Z') });
    h.contextService.add(sample());
    h.contextService.setCurrent('acme-prod');
    h.tokenStore.write('acme-prod', {
      refreshToken: 'rt',
      accessToken: 'at',
      expiresAt: '2026-04-11T19:00:00Z',
      obtainedAt: '2026-04-11T18:00:00Z',
    });
    expect(h.auth.whoami().tokenStatus).toBe('fresh');
  });

  it('returns expired when expiresAt <= now', () => {
    const h = harness({ now: () => new Date('2026-04-11T20:00:00Z') });
    h.contextService.add(sample());
    h.contextService.setCurrent('acme-prod');
    h.tokenStore.write('acme-prod', {
      refreshToken: 'rt',
      accessToken: 'at',
      expiresAt: '2026-04-11T19:00:00Z',
      obtainedAt: '2026-04-11T18:00:00Z',
    });
    expect(h.auth.whoami().tokenStatus).toBe('expired');
  });

  it('returns missing when expiresAt absent (no access token persisted)', () => {
    const h = harness();
    h.contextService.add(sample());
    h.contextService.setCurrent('acme-prod');
    h.tokenStore.write('acme-prod', { refreshToken: 'rt' });
    // a refresh-token-only record means we have a session but no access token —
    // treat as missing for whoami purposes (the user must run `auth refresh` next)
    expect(h.auth.whoami().tokenStatus).toBe('missing');
  });
});

describe('AuthService.logout', () => {
  it('removes the token file', () => {
    const h = harness();
    h.contextService.add(sample());
    h.contextService.setCurrent('acme-prod');
    h.tokenStore.write('acme-prod', { refreshToken: 'rt' });
    h.auth.logout();
    expect(h.tokenStore.exists('acme-prod')).toBe(false);
  });

  it('is idempotent (no error if no token)', () => {
    const h = harness();
    h.contextService.add(sample());
    h.contextService.setCurrent('acme-prod');
    expect(() => h.auth.logout()).not.toThrow();
  });
});
