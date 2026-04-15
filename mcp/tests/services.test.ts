import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  buildServices,
  withServices,
  type ServiceDeps,
  type TokenManagerFactory,
  type TokenManagerLike,
} from '../src/services.js';
import type { CliState } from '../src/state.js';

function mkTokenFile(): { tokenFile: string; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anaf-mcp-services-'));
  const tokenFile = path.join(root, '_default.json');
  fs.writeFileSync(
    tokenFile,
    JSON.stringify({ refreshToken: 'r-token', accessToken: 'a-token', expiresAt: 'e', obtainedAt: 'o' })
  );
  return { tokenFile, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function makeState(overrides: Partial<CliState> = {}, tokenFile = '/tmp/token.json'): CliState {
  return {
    activeCui: '12345678',
    env: 'test',
    credential: {
      clientId: 'cid',
      clientSecret: undefined,
      redirectUri: 'https://localhost:3000/callback',
    },
    token: {
      refreshToken: 'r-token',
      accessToken: 'a-token',
      expiresAt: '2099-01-01T00:00:00.000Z',
      obtainedAt: '2026-04-01T00:00:00.000Z',
    },
    paths: {
      configFile: '/tmp/config.yaml',
      credentialFile: '/tmp/credential.yaml',
      tokenFile,
    },
    ...overrides,
  };
}

class FakeTokenManager implements TokenManagerLike {
  calls = { getValidAccessToken: 0, getRefreshToken: 0 };
  constructor(
    private readonly access: string,
    private currentRefresh: string
  ) {}
  async getValidAccessToken(): Promise<string> {
    this.calls.getValidAccessToken += 1;
    return this.access;
  }
  getRefreshToken(): string {
    this.calls.getRefreshToken += 1;
    return this.currentRefresh;
  }
  rotate(next: string): void {
    this.currentRefresh = next;
  }
}

describe('buildServices', () => {
  it('builds an AnafDetailsClient with no token dependency', async () => {
    const services = buildServices({ state: makeState(), clientSecret: 'secret' });
    expect(services.details).toBeDefined();
    expect(typeof services.details.batchGetCompanyData).toBe('function');
  });

  it('builds an EfacturaClient using the active CUI with RO prefix stripped', () => {
    const services = buildServices({
      state: makeState({ activeCui: 'RO12345678' }),
      clientSecret: 'secret',
    });
    expect(services.efactura).toBeDefined();
    expect(services.vatNumber).toBe('12345678');
  });

  it('uses CachedTokenManager when accessToken is fresh (>1 day to expiry)', async () => {
    const services = buildServices({ state: makeState(), clientSecret: 'secret' });
    const token = await services.tokenManager.getValidAccessToken();
    expect(token).toBe('a-token');
  });

  it('testMode is true when env is test', () => {
    expect(buildServices({ state: makeState({ env: 'test' }), clientSecret: 'secret' }).testMode).toBe(true);
  });

  it('testMode is false when env is prod', () => {
    expect(buildServices({ state: makeState({ env: 'prod' }), clientSecret: 'secret' }).testMode).toBe(false);
  });
});

describe('buildServices token manager selection', () => {
  it('delegates to the real TokenManager factory when accessToken is missing', async () => {
    const fake = new FakeTokenManager('fresh-access', 'r-token');
    const factory: TokenManagerFactory = () => fake;
    const services = buildServices({
      state: makeState({
        token: {
          refreshToken: 'r-token',
          accessToken: undefined,
          expiresAt: '2099-01-01T00:00:00.000Z',
          obtainedAt: '2026-04-01T00:00:00.000Z',
        },
      }),
      clientSecret: 'secret',
      tokenManagerFactory: factory,
    });
    await expect(services.tokenManager.getValidAccessToken()).resolves.toBe('fresh-access');
    expect(fake.calls.getValidAccessToken).toBe(1);
  });

  it('delegates when accessToken expires within the proactive refresh window', async () => {
    const fake = new FakeTokenManager('fresh-access', 'r-token');
    const now = (): number => Date.parse('2026-04-16T00:00:00.000Z');
    // expires in 12h — inside the 24h proactive window
    const expiresAt = '2026-04-16T12:00:00.000Z';
    const services = buildServices({
      state: makeState({
        token: {
          refreshToken: 'r-token',
          accessToken: 'a-token',
          expiresAt,
          obtainedAt: '2026-04-15T00:00:00.000Z',
        },
      }),
      clientSecret: 'secret',
      now,
      tokenManagerFactory: () => fake,
    });
    await expect(services.tokenManager.getValidAccessToken()).resolves.toBe('fresh-access');
  });

  it('delegates when accessToken is already expired', async () => {
    const fake = new FakeTokenManager('fresh-access', 'r-token');
    const services = buildServices({
      state: makeState({
        token: {
          refreshToken: 'r-token',
          accessToken: 'a-token',
          expiresAt: '2020-01-01T00:00:00.000Z',
          obtainedAt: '2019-01-01T00:00:00.000Z',
        },
      }),
      clientSecret: 'secret',
      tokenManagerFactory: () => fake,
    });
    await expect(services.tokenManager.getValidAccessToken()).resolves.toBe('fresh-access');
  });

  it('treats malformed expiresAt as stale (Number.isNaN guard)', async () => {
    const fake = new FakeTokenManager('fresh-access', 'r-token');
    const services = buildServices({
      state: makeState({
        token: {
          refreshToken: 'r-token',
          accessToken: 'a-token',
          expiresAt: 'not-a-date',
          obtainedAt: '2026-04-01T00:00:00.000Z',
        },
      }),
      clientSecret: 'secret',
      tokenManagerFactory: () => fake,
    });
    await expect(services.tokenManager.getValidAccessToken()).resolves.toBe('fresh-access');
  });
});

describe('persistRotation', () => {
  it('is a no-op when refresh token has not changed', () => {
    const scratch = mkTokenFile();
    try {
      const fake = new FakeTokenManager('a-token', 'r-token');
      const services = buildServices({
        state: makeState(
          {
            token: {
              refreshToken: 'r-token',
              accessToken: undefined,
              expiresAt: undefined,
              obtainedAt: undefined,
            },
          },
          scratch.tokenFile
        ),
        clientSecret: 'secret',
        tokenManagerFactory: () => fake,
      });
      const before = fs.readFileSync(scratch.tokenFile, 'utf8');
      services.persistRotation();
      expect(fs.readFileSync(scratch.tokenFile, 'utf8')).toBe(before);
    } finally {
      scratch.cleanup();
    }
  });

  it('writes the new refresh token when it has rotated', () => {
    const scratch = mkTokenFile();
    try {
      const fake = new FakeTokenManager('a-token', 'r-token');
      const services = buildServices({
        state: makeState(
          {
            token: {
              refreshToken: 'r-token',
              accessToken: undefined,
              expiresAt: undefined,
              obtainedAt: undefined,
            },
          },
          scratch.tokenFile
        ),
        clientSecret: 'secret',
        tokenManagerFactory: () => fake,
      });
      fake.rotate('rotated-token');
      services.persistRotation();
      const after = JSON.parse(fs.readFileSync(scratch.tokenFile, 'utf8'));
      expect(after.refreshToken).toBe('rotated-token');
    } finally {
      scratch.cleanup();
    }
  });
});

describe('withServices', () => {
  it('returns fn result and persists rotation on success', async () => {
    const scratch = mkTokenFile();
    try {
      const fake = new FakeTokenManager('a-token', 'r-token');
      const result = await withServices(
        {
          state: makeState(
            {
              token: {
                refreshToken: 'r-token',
                accessToken: undefined,
                expiresAt: undefined,
                obtainedAt: undefined,
              },
            },
            scratch.tokenFile
          ),
          clientSecret: 'secret',
          tokenManagerFactory: () => fake,
        },
        async (_services) => {
          fake.rotate('rotated-token');
          return 42;
        }
      );
      expect(result).toBe(42);
      const after = JSON.parse(fs.readFileSync(scratch.tokenFile, 'utf8'));
      expect(after.refreshToken).toBe('rotated-token');
    } finally {
      scratch.cleanup();
    }
  });

  it('persists rotation even when fn throws', async () => {
    const scratch = mkTokenFile();
    try {
      const fake = new FakeTokenManager('a-token', 'r-token');
      await expect(
        withServices(
          {
            state: makeState(
              {
                token: {
                  refreshToken: 'r-token',
                  accessToken: undefined,
                  expiresAt: undefined,
                  obtainedAt: undefined,
                },
              },
              scratch.tokenFile
            ),
            clientSecret: 'secret',
            tokenManagerFactory: () => fake,
          },
          async (_services) => {
            fake.rotate('rotated-token');
            throw new Error('boom');
          }
        )
      ).rejects.toThrow('boom');
      const after = JSON.parse(fs.readFileSync(scratch.tokenFile, 'utf8'));
      expect(after.refreshToken).toBe('rotated-token');
    } finally {
      scratch.cleanup();
    }
  });
});
