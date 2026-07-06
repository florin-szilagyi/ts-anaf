import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FastbillApiError, FastbillTimeoutError } from '@florinszilagyi/fastbill-sdk';
import { FastbillService, type FastbillClientLike } from '../../src/services';
import { FastbillStore, getXdgPaths } from '../../src/state';
import { CliError } from '../../src/output/errors';

function freshPaths() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anaf-cli-fastbill-'));
  return getXdgPaths({
    configHome: path.join(root, 'config'),
    dataHome: path.join(root, 'data'),
    cacheHome: path.join(root, 'cache'),
  });
}

function stubFactory(): {
  factory: (config: { apiKey: string; baseUrl?: string }) => FastbillClientLike;
  configs: Array<{ apiKey: string; baseUrl?: string }>;
} {
  const configs: Array<{ apiKey: string; baseUrl?: string }> = [];
  const factory = (config: { apiKey: string; baseUrl?: string }): FastbillClientLike => {
    configs.push(config);
    return { mode: config.apiKey.startsWith('sk_live_') ? 'live' : 'test' } as FastbillClientLike;
  };
  return { factory, configs };
}

describe('FastbillService key resolution', () => {
  it('prefers flag > env > stored key', () => {
    const paths = freshPaths();
    const store = new FastbillStore({ paths });
    store.write({ apiKey: 'sk_test_stored', baseUrl: 'http://stored.local' });
    const { factory, configs } = stubFactory();
    const service = new FastbillService({ store, clientFactory: factory, env: { FASTBILL_API_KEY: 'sk_test_env' } });

    service.client({ apiKey: 'sk_test_flag' });
    service.client({});
    expect(configs[0].apiKey).toBe('sk_test_flag');
    expect(configs[1].apiKey).toBe('sk_test_env');

    const noEnv = new FastbillService({ store, clientFactory: factory, env: {} });
    noEnv.client({});
    expect(configs[2]).toEqual({ apiKey: 'sk_test_stored', baseUrl: 'http://stored.local' });
  });

  it('throws FASTBILL_KEY_MISSING (auth) when no key is available', () => {
    const service = new FastbillService({ paths: freshPaths(), env: {} });
    try {
      service.client({});
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(CliError);
      expect((e as CliError).code).toBe('FASTBILL_KEY_MISSING');
      expect((e as CliError).category).toBe('auth');
    }
  });

  it('base URL precedence: flag > env > stored', () => {
    const paths = freshPaths();
    const store = new FastbillStore({ paths });
    store.write({ apiKey: 'sk_test_x', baseUrl: 'http://stored.local' });
    const { factory, configs } = stubFactory();
    const service = new FastbillService({
      store,
      clientFactory: factory,
      env: { FASTBILL_BASE_URL: 'http://env.local' },
    });
    service.client({ baseUrl: 'http://flag.local' });
    service.client({});
    expect(configs[0].baseUrl).toBe('http://flag.local');
    expect(configs[1].baseUrl).toBe('http://env.local');
  });
});

describe('FastbillService key storage', () => {
  it('setKey validates, persists 0600 and round-trips', () => {
    const paths = freshPaths();
    const service = new FastbillService({ paths, env: {} });
    expect(() => service.setKey('not-a-key')).toThrow(CliError);

    expect(service.setKey('sk_live_abc')).toEqual({ mode: 'live' });
    expect(service.hasStoredKey()).toBe(true);
    if (process.platform !== 'win32') {
      const mode = fs.statSync(paths.fastbillCredentialFile).mode & 0o777;
      expect(mode).toBe(0o600);
    }

    service.clearKey();
    expect(service.hasStoredKey()).toBe(false);
  });

  it('rejects tampered store files with INVALID_FASTBILL_FILE', () => {
    const paths = freshPaths();
    fs.mkdirSync(path.dirname(paths.fastbillCredentialFile), { recursive: true });
    fs.writeFileSync(paths.fastbillCredentialFile, '{"apiKey":"pk_wrong_prefix"}');
    const store = new FastbillStore({ paths });
    try {
      store.read();
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as CliError).code).toBe('INVALID_FASTBILL_FILE');
      expect((e as CliError).category).toBe('local_state');
    }
  });
});

describe('FastbillService error mapping', () => {
  function serviceThatThrows(error: unknown): FastbillService {
    return new FastbillService({
      paths: freshPaths(),
      env: { FASTBILL_API_KEY: 'sk_test_x' },
      clientFactory: () =>
        ({
          mode: 'test',
          listCompanies: async () => {
            throw error;
          },
        }) as unknown as FastbillClientLike,
    });
  }

  async function mapped(error: unknown): Promise<CliError> {
    return serviceThatThrows(error)
      .call({}, (c) => c.listCompanies())
      .then(() => {
        throw new Error('should have thrown');
      })
      .catch((e) => e as CliError);
  }

  it('401 UNAUTHORIZED → FASTBILL_AUTH_FAILED (auth)', async () => {
    const e = await mapped(new FastbillApiError({ code: 'UNAUTHORIZED', status: 401, message: 'bad key' }));
    expect(e.code).toBe('FASTBILL_AUTH_FAILED');
    expect(e.category).toBe('auth');
  });

  it('422 validation → INVALID_FASTBILL_INPUT (user_input)', async () => {
    const e = await mapped(
      new FastbillApiError({ code: 'INVALID_INVOICE_INPUT', status: 422, message: 'bad payload', details: { x: 1 } })
    );
    expect(e.code).toBe('INVALID_FASTBILL_INPUT');
    expect(e.category).toBe('user_input');
    expect(e.details).toMatchObject({ fastbillCode: 'INVALID_INVOICE_INPUT', status: 422 });
  });

  it('429/5xx → FASTBILL_API_ERROR (anaf_api)', async () => {
    const e = await mapped(new FastbillApiError({ code: 'RATE_LIMITED', status: 429, message: 'slow down' }));
    expect(e.code).toBe('FASTBILL_API_ERROR');
    expect(e.category).toBe('anaf_api');
  });

  it('wait timeout → FASTBILL_TIMEOUT (anaf_api)', async () => {
    const e = await mapped(new FastbillTimeoutError('inv-1', 'processing', 60_000));
    expect(e.code).toBe('FASTBILL_TIMEOUT');
    expect(e.details).toMatchObject({ invoiceId: 'inv-1', lastStatus: 'processing' });
  });
});
