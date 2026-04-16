import { Writable } from 'node:stream';
import { buildProgram } from '../../../src/commands/buildProgram';
import { AuthService } from '../../../src/services';
import { CliError } from '../../../src/output/errors';
import { makeOutputContext } from '../../../src/output';
import {
  authUse,
  authWhoami,
  authLogout,
  authRefresh,
  authLs,
  authRm,
  authToken,
} from '../../../src/commands/groups/auth';
import type { Credential, TokenRecord, Company } from '../../../src/state';
import { getXdgPaths } from '../../../src/state';

function helpFor(group: string): string {
  const program = buildProgram({
    output: makeOutputContext({ format: 'text' }),
    services: {} as never,
    paths: getXdgPaths(),
  });
  const cmd = program.commands.find((c) => c.name() === group);
  if (!cmd) throw new Error(`group ${group} not registered`);
  return cmd.helpInformation();
}

class Cap extends Writable {
  buf = '';
  _write(c: Buffer, _e: BufferEncoding, cb: (e?: Error | null) => void): void {
    this.buf += c.toString('utf8');
    cb();
  }
}

const sampleCredential = (): Credential => ({
  clientId: 'cid',
  redirectUri: 'https://localhost:9002/cb',
});

class StubAuthService {
  buildResult: { credential: Credential; url: string } = {
    credential: sampleCredential(),
    url: 'https://anaf.example/auth?x=1',
  };
  exchangeResult: TokenRecord = {
    refreshToken: 'rt',
    accessToken: 'at',
    expiresAt: '2026-04-11T19:00:00Z',
    obtainedAt: '2026-04-11T18:00:00Z',
  };
  refreshResult: TokenRecord = {
    refreshToken: 'rt2',
    accessToken: 'at2',
    expiresAt: '2026-04-11T20:00:00Z',
    obtainedAt: '2026-04-11T19:00:00Z',
  };
  whoamiResult: {
    company?: Company;
    env: 'test' | 'prod';
    tokenStatus: 'fresh' | 'expired' | 'missing';
    expiresAt?: string;
    obtainedAt?: string;
  } = {
    company: { cui: '12345678', name: 'Acme SRL' },
    env: 'test',
    tokenStatus: 'fresh',
    expiresAt: '2026-04-11T19:00:00Z',
    obtainedAt: '2026-04-11T18:00:00Z',
  };
  logoutCalled = false;

  buildAuthorizationUrl(_scope?: string): StubAuthService['buildResult'] {
    return this.buildResult;
  }
  async exchangeCode(_args: never): Promise<TokenRecord> {
    return this.exchangeResult;
  }
  async refresh(_args: never): Promise<TokenRecord> {
    return this.refreshResult;
  }
  whoami(): StubAuthService['whoamiResult'] {
    return this.whoamiResult;
  }
  getToken(): TokenRecord {
    return sampleTokenRecord();
  }
  logout(): void {
    this.logoutCalled = true;
  }
}

const stubCredentialService = {
  get: () => sampleCredential(),
  exists: () => true,
  set: () => {},
  clear: () => {},
};

class StubCompanyService {
  companies: Company[] = [
    { cui: '12345678', name: 'Acme SRL' },
    { cui: '87654321', name: 'Beta SRL' },
  ];
  removedCuis: string[] = [];

  list(): Company[] {
    return this.companies;
  }
  get(cui: string): Company {
    const found = this.companies.find((c) => c.cui === cui);
    if (!found) {
      throw new CliError({
        code: 'COMPANY_NOT_FOUND',
        message: `Company "${cui}" is not registered`,
        category: 'local_state',
      });
    }
    return found;
  }
  add(company: Company): Company {
    this.companies.push(company);
    return company;
  }
  remove(cui: string): void {
    this.removedCuis.push(cui);
  }
  exists(cui: string): boolean {
    return this.companies.some((c) => c.cui === cui);
  }
}

class StubConfigStore {
  activeCui: string | undefined = '12345678';
  env: 'test' | 'prod' = 'test';

  getActiveCui(): string | undefined {
    return this.activeCui;
  }
  setActiveCui(cui: string | undefined): void {
    this.activeCui = cui;
  }
  getEnv(): 'test' | 'prod' {
    return this.env;
  }
  setEnv(env: 'test' | 'prod'): void {
    this.env = env;
  }
  read() {
    return { activeCui: this.activeCui, env: this.env };
  }
  write() {}
}

const sampleTokenRecord = (): TokenRecord => ({
  refreshToken: 'rt-abc',
  accessToken: 'at-xyz',
  expiresAt: '2026-07-11T20:00:00Z',
  obtainedAt: '2026-04-13T10:00:00Z',
});

const stubTokenStore = {
  _record: sampleTokenRecord() as TokenRecord | undefined,
  read(_name: string) {
    return this._record;
  },
  write(_name: string, record: TokenRecord) {
    this._record = record;
  },
  remove(_name: string) {
    this._record = undefined;
  },
  exists(_name: string) {
    return this._record !== undefined;
  },
  getRefreshToken(_name: string) {
    return this._record?.refreshToken;
  },
  setRefreshToken(_name: string, _rt: string) {},
};

function harness(): {
  stdout: Cap;
  stderr: Cap;
  authService: StubAuthService;
  companyService: StubCompanyService;
  configStore: StubConfigStore;
  text: ReturnType<typeof makeOutputContext>;
  json: ReturnType<typeof makeOutputContext>;
  services: Record<string, unknown>;
} {
  const stdout = new Cap();
  const stderr = new Cap();
  const authService = new StubAuthService();
  const companyService = new StubCompanyService();
  const configStore = new StubConfigStore();
  const text = makeOutputContext({ format: 'text', streams: { stdout, stderr } });
  const json = makeOutputContext({ format: 'json', streams: { stdout, stderr } });
  const tokenStore = { ...stubTokenStore };
  const services = {
    authService: authService as unknown as AuthService,
    companyService,
    credentialService: stubCredentialService,
    configStore,
    lookupService: {} as never,
    tokenStore,
    efacturaService: {} as never,
    ublService: {} as never,
  };
  return { stdout, stderr, authService, companyService, configStore, text, json, services };
}

describe('auth group', () => {
  it('registers login, use, whoami, ls, rm, logout, refresh', () => {
    const program = buildProgram({
      output: makeOutputContext({ format: 'text' }),
      services: {} as never,
      paths: getXdgPaths(),
    });
    const auth = program.commands.find((c) => c.name() === 'auth')!;
    expect(auth.commands.map((c) => c.name()).sort()).toEqual([
      'login',
      'logout',
      'ls',
      'refresh',
      'rm',
      'token',
      'use',
      'whoami',
    ]);
  });

  it('--help renders all subcommands', () => {
    const help = helpFor('auth');
    for (const sub of ['login', 'use', 'whoami', 'ls', 'rm', 'logout', 'refresh', 'token']) {
      expect(help).toContain(sub);
    }
  });
});

describe('authUse', () => {
  it('sets the active CUI and prints success', async () => {
    const h = harness();
    await authUse({ output: h.text, services: h.services as never, paths: getXdgPaths() }, '12345678');
    expect(h.configStore.activeCui).toBe('12345678');
    expect(h.stdout.buf).toContain('Acme SRL');
  });
});

describe('authWhoami', () => {
  it('text mode prints company and token status', async () => {
    const h = harness();
    await authWhoami({ output: h.text, services: h.services as never, paths: getXdgPaths() });
    expect(h.stdout.buf).toContain('Acme SRL');
    expect(h.stdout.buf).toContain('fresh');
  });

  it('json mode emits the envelope', async () => {
    const h = harness();
    await authWhoami({ output: h.json, services: h.services as never, paths: getXdgPaths() });
    const parsed = JSON.parse(h.stdout.buf);
    expect(parsed.data.tokenStatus).toBe('fresh');
    expect(parsed.data.cui).toBe('12345678');
  });
});

describe('authLs', () => {
  it('lists companies with active marker', async () => {
    const h = harness();
    await authLs({ output: h.text, services: h.services as never, paths: getXdgPaths() });
    expect(h.stdout.buf).toContain('12345678');
    expect(h.stdout.buf).toContain('Acme SRL');
    expect(h.stdout.buf).toContain('Beta SRL');
  });

  it('json mode includes companies array', async () => {
    const h = harness();
    await authLs({ output: h.json, services: h.services as never, paths: getXdgPaths() });
    const parsed = JSON.parse(h.stdout.buf);
    expect(parsed.data.companies).toHaveLength(2);
    expect(parsed.data.activeCui).toBe('12345678');
  });
});

describe('authRm', () => {
  it('removes a company and clears active if it was active', async () => {
    const h = harness();
    await authRm({ output: h.text, services: h.services as never, paths: getXdgPaths() }, '12345678');
    expect(h.companyService.removedCuis).toEqual(['12345678']);
    expect(h.configStore.activeCui).toBeUndefined();
  });
});

describe('authLogout', () => {
  it('calls AuthService.logout', async () => {
    const h = harness();
    await authLogout({ output: h.text, services: h.services as never, paths: getXdgPaths() });
    expect(h.authService.logoutCalled).toBe(true);
  });
});

describe('authRefresh', () => {
  it('refreshes and prints success', async () => {
    const h = harness();
    await authRefresh({ output: h.text, services: h.services as never, paths: getXdgPaths() }, {});
    expect(h.stdout.buf).toContain('refreshed');
  });
});

describe('authToken', () => {
  it('text mode prints accessToken and refreshToken', async () => {
    const h = harness();
    await authToken({ output: h.text, services: h.services as never, paths: getXdgPaths() }, {});
    expect(h.stdout.buf).toContain('at-xyz');
    expect(h.stdout.buf).toContain('rt-abc');
  });

  it('json mode emits the full token record', async () => {
    const h = harness();
    await authToken({ output: h.json, services: h.services as never, paths: getXdgPaths() }, {});
    const parsed = JSON.parse(h.stdout.buf);
    expect(parsed.data.accessToken).toBe('at-xyz');
    expect(parsed.data.refreshToken).toBe('rt-abc');
  });
});
