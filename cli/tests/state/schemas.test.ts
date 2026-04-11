import { contextNameSchema, contextFileSchema, cliConfigSchema, tokenRecordSchema } from '../../src/state/schemas';

describe('contextNameSchema', () => {
  it.each(['acme', 'acme-prod', 'a1', 'a.b_c-1'])('accepts %s', (name) => {
    expect(() => contextNameSchema.parse(name)).not.toThrow();
  });
  it.each(['', 'A', 'acme/prod', '../etc/passwd', 'acme prod', '-acme', '.acme'])('rejects %s', (name) => {
    expect(() => contextNameSchema.parse(name)).toThrow();
  });
});

describe('contextFileSchema', () => {
  it('parses a minimal valid context body', () => {
    const parsed = contextFileSchema.parse({
      companyCui: 'RO12345678',
      environment: 'prod',
      auth: { clientId: 'cid', redirectUri: 'https://localhost/cb' },
    });
    expect(parsed.environment).toBe('prod');
  });

  it('rejects unknown environment', () => {
    expect(() =>
      contextFileSchema.parse({
        companyCui: 'RO1',
        environment: 'staging',
        auth: { clientId: 'c', redirectUri: 'https://x' },
      })
    ).toThrow();
  });

  it('passes through optional defaults', () => {
    const parsed = contextFileSchema.parse({
      companyCui: 'RO1',
      environment: 'test',
      auth: { clientId: 'c', redirectUri: 'https://x' },
      defaults: { currency: 'RON', output: 'stdout' },
    });
    expect(parsed.defaults?.currency).toBe('RON');
  });
});

describe('cliConfigSchema', () => {
  it('accepts an empty config', () => {
    expect(cliConfigSchema.parse({})).toEqual({});
  });

  it('parses currentContext + defaults', () => {
    const parsed = cliConfigSchema.parse({
      currentContext: 'acme-prod',
      defaults: { output: 'stdout', format: 'json' },
    });
    expect(parsed.currentContext).toBe('acme-prod');
    expect(parsed.defaults?.format).toBe('json');
  });
});

describe('tokenRecordSchema', () => {
  it('requires a refreshToken', () => {
    expect(() => tokenRecordSchema.parse({})).toThrow();
  });

  it('accepts the minimum and the full record', () => {
    expect(tokenRecordSchema.parse({ refreshToken: 'rt' })).toEqual({ refreshToken: 'rt' });
    const full = {
      refreshToken: 'rt',
      accessToken: 'at',
      expiresAt: '2026-04-11T20:00:00Z',
      obtainedAt: '2026-04-11T18:00:00Z',
    };
    expect(tokenRecordSchema.parse(full)).toEqual(full);
  });
});
