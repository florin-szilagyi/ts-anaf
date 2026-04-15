import { buildServices, type ServiceDeps } from '../src/services.js';
import type { CliState } from '../src/state.js';

function makeState(overrides: Partial<CliState> = {}): CliState {
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
      tokenFile: '/tmp/token.json',
    },
    ...overrides,
  };
}

describe('buildServices', () => {
  it('builds an AnafDetailsClient with no token dependency', async () => {
    const deps: ServiceDeps = {
      state: makeState(),
      clientSecret: 'secret',
    };
    const services = buildServices(deps);
    expect(services.details).toBeDefined();
    expect(typeof services.details.batchGetCompanyData).toBe('function');
  });

  it('builds an EfacturaClient using the active CUI with RO prefix stripped', () => {
    const deps: ServiceDeps = {
      state: makeState({ activeCui: 'RO12345678' }),
      clientSecret: 'secret',
    };
    const services = buildServices(deps);
    expect(services.efactura).toBeDefined();
    expect(services.vatNumber).toBe('12345678');
  });

  it('uses CachedTokenManager when accessToken is fresh (>1 day to expiry)', async () => {
    const deps: ServiceDeps = {
      state: makeState(),
      clientSecret: 'secret',
    };
    const services = buildServices(deps);
    const token = await services.tokenManager.getValidAccessToken();
    expect(token).toBe('a-token');
  });

  it('testMode is true when env is test', () => {
    const deps: ServiceDeps = {
      state: makeState({ env: 'test' }),
      clientSecret: 'secret',
    };
    expect(buildServices(deps).testMode).toBe(true);
  });

  it('testMode is false when env is prod', () => {
    const deps: ServiceDeps = {
      state: makeState({ env: 'prod' }),
      clientSecret: 'secret',
    };
    expect(buildServices(deps).testMode).toBe(false);
  });
});
