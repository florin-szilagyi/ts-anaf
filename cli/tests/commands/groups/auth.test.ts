import { Writable } from 'node:stream';
import { buildProgram } from '../../../src/commands/buildProgram';
import { AuthService } from '../../../src/services';
import { CliError } from '../../../src/output/errors';
import { makeOutputContext } from '../../../src/output';
import { authLogin, authCode, authRefresh, authWhoami, authLogout } from '../../../src/commands/groups/auth';
import type { Context, TokenRecord } from '../../../src/state';

function helpFor(group: string): string {
  const program = buildProgram({
    output: makeOutputContext({ format: 'text' }),
    services: {} as never,
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

const sampleCtx = (): Context => ({
  name: 'acme-prod',
  companyCui: 'RO12345678',
  environment: 'prod',
  auth: { clientId: 'cid', redirectUri: 'https://localhost/cb' },
});

class StubAuthService {
  buildResult: { context: Context; url: string } = {
    context: sampleCtx(),
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
    context: Context;
    tokenStatus: 'fresh' | 'expired' | 'missing';
    expiresAt?: string;
    obtainedAt?: string;
  } = {
    context: sampleCtx(),
    tokenStatus: 'fresh',
    expiresAt: '2026-04-11T19:00:00Z',
    obtainedAt: '2026-04-11T18:00:00Z',
  };
  logoutCalls: Array<string | undefined> = [];
  shouldFailExchange = false;

  buildAuthorizationUrl(_context?: string, _scope?: string): StubAuthService['buildResult'] {
    return this.buildResult;
  }
  async exchangeCode(_args: never): Promise<TokenRecord> {
    if (this.shouldFailExchange) {
      throw new CliError({ code: 'AUTH_FAILED', message: 'fail', category: 'auth' });
    }
    return this.exchangeResult;
  }
  async refresh(_args: never): Promise<TokenRecord> {
    return this.refreshResult;
  }
  whoami(_context?: string): StubAuthService['whoamiResult'] {
    return this.whoamiResult;
  }
  logout(context?: string): void {
    this.logoutCalls.push(context);
  }
}

function harness(): {
  stdout: Cap;
  stderr: Cap;
  authService: StubAuthService;
  text: ReturnType<typeof makeOutputContext>;
  json: ReturnType<typeof makeOutputContext>;
  services: { authService: AuthService };
} {
  const stdout = new Cap();
  const stderr = new Cap();
  const authService = new StubAuthService();
  const text = makeOutputContext({ format: 'text', streams: { stdout, stderr } });
  const json = makeOutputContext({ format: 'json', streams: { stdout, stderr } });
  const services = {
    authService: authService as unknown as AuthService,
  };
  return { stdout, stderr, authService, text, json, services };
}

describe('auth group', () => {
  it('registers login, code, refresh, whoami, logout', () => {
    const program = buildProgram({
      output: makeOutputContext({ format: 'text' }),
      services: {} as never,
    });
    const auth = program.commands.find((c) => c.name() === 'auth')!;
    expect(auth.commands.map((c) => c.name()).sort()).toEqual(['code', 'login', 'logout', 'refresh', 'whoami']);
  });

  it('--help renders all five subcommands', () => {
    const help = helpFor('auth');
    for (const sub of ['login', 'code', 'refresh', 'whoami', 'logout']) {
      expect(help).toContain(sub);
    }
  });
});

describe('authLogin', () => {
  it('text mode prints the URL to stderr (not stdout)', async () => {
    const h = harness();
    await authLogin({ output: h.text, services: h.services as never }, { context: undefined });
    expect(h.stderr.buf).toContain('https://anaf.example/auth?x=1');
    expect(h.stdout.buf).not.toContain('https://anaf.example/auth?x=1');
    expect(h.stdout.buf).toContain('acme-prod');
  });

  it('json mode emits the envelope on stdout', async () => {
    const h = harness();
    await authLogin({ output: h.json, services: h.services as never }, { context: undefined });
    const parsed = JSON.parse(h.stdout.buf);
    expect(parsed.success).toBe(true);
    expect(parsed.data.url).toContain('anaf.example');
    expect(parsed.data.context).toBe('acme-prod');
  });
});

describe('authCode', () => {
  it('exchanges and prints success', async () => {
    const h = harness();
    await authCode({ output: h.text, services: h.services as never }, { code: 'auth-code-1' });
    expect(h.stdout.buf).toContain('token persisted');
  });

  it('throws when --code is missing', async () => {
    const h = harness();
    await expect(authCode({ output: h.text, services: h.services as never }, {})).rejects.toBeInstanceOf(CliError);
  });

  it('propagates AUTH_FAILED from the service', async () => {
    const h = harness();
    h.authService.shouldFailExchange = true;
    await expect(authCode({ output: h.text, services: h.services as never }, { code: 'c' })).rejects.toBeInstanceOf(
      CliError
    );
  });
});

describe('authRefresh', () => {
  it('refreshes and prints success', async () => {
    const h = harness();
    await authRefresh({ output: h.text, services: h.services as never }, {});
    expect(h.stdout.buf).toContain('refreshed');
  });
});

describe('authWhoami', () => {
  it('text mode prints "<context>: <status>"', async () => {
    const h = harness();
    await authWhoami({ output: h.text, services: h.services as never }, {});
    expect(h.stdout.buf).toContain('acme-prod');
    expect(h.stdout.buf).toContain('fresh');
  });

  it('json mode emits the envelope', async () => {
    const h = harness();
    await authWhoami({ output: h.json, services: h.services as never }, {});
    const parsed = JSON.parse(h.stdout.buf);
    expect(parsed.data.tokenStatus).toBe('fresh');
  });
});

describe('authLogout', () => {
  it('calls AuthService.logout with the resolved context name', async () => {
    const h = harness();
    await authLogout({ output: h.text, services: h.services as never }, { context: 'acme-test' });
    expect(h.authService.logoutCalls).toEqual(['acme-test']);
  });
});
