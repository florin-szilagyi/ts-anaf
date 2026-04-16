import { credentialFileSchema, companyFileSchema, cliConfigSchema, tokenRecordSchema } from '../../src/state/schemas';

describe('credentialFileSchema', () => {
  it('parses a minimal valid credential body', () => {
    const parsed = credentialFileSchema.parse({
      clientId: 'cid',
      redirectUri: 'https://localhost:9002/cb',
    });
    expect(parsed.clientId).toBe('cid');
  });

  it('accepts 127.0.0.1 as localhost', () => {
    const parsed = credentialFileSchema.parse({
      clientId: 'cid',
      redirectUri: 'https://127.0.0.1:9002/cb',
    });
    expect(parsed.redirectUri).toBe('https://127.0.0.1:9002/cb');
  });

  it('accepts optional clientSecret', () => {
    const parsed = credentialFileSchema.parse({
      clientId: 'cid',
      clientSecret: 'sec',
      redirectUri: 'https://localhost:9002/cb',
    });
    expect(parsed.clientSecret).toBe('sec');
  });

  it('rejects non-localhost redirectUri', () => {
    expect(() =>
      credentialFileSchema.parse({
        clientId: 'cid',
        redirectUri: 'https://example.com/callback',
      })
    ).toThrow(/localhost/);
  });

  it('rejects http (non-https) redirectUri', () => {
    expect(() =>
      credentialFileSchema.parse({
        clientId: 'cid',
        redirectUri: 'http://localhost:9002/callback',
      })
    ).toThrow(/localhost/);
  });

  it('rejects extra properties', () => {
    expect(() =>
      credentialFileSchema.parse({
        clientId: 'cid',
        redirectUri: 'https://localhost:9002/cb',
        extra: 'nope',
      })
    ).toThrow();
  });
});

describe('companyFileSchema', () => {
  it('parses a minimal valid company body', () => {
    const parsed = companyFileSchema.parse({
      cui: '12345678',
      name: 'Acme SRL',
    });
    expect(parsed.cui).toBe('12345678');
    expect(parsed.name).toBe('Acme SRL');
  });

  it('accepts optional registrationNumber and address', () => {
    const parsed = companyFileSchema.parse({
      cui: '12345678',
      name: 'Acme SRL',
      registrationNumber: 'J40/1/2020',
      address: 'Bucuresti, Strada A',
    });
    expect(parsed.registrationNumber).toBe('J40/1/2020');
    expect(parsed.address).toBe('Bucuresti, Strada A');
  });

  it('rejects extra properties', () => {
    expect(() =>
      companyFileSchema.parse({
        cui: '12345678',
        name: 'Acme SRL',
        extra: 'nope',
      })
    ).toThrow();
  });

  it('rejects empty cui', () => {
    expect(() =>
      companyFileSchema.parse({
        cui: '',
        name: 'Acme SRL',
      })
    ).toThrow();
  });
});

describe('cliConfigSchema', () => {
  it('accepts an empty config', () => {
    expect(cliConfigSchema.parse({})).toEqual({});
  });

  it('parses activeCui and env', () => {
    const parsed = cliConfigSchema.parse({
      activeCui: '12345678',
      env: 'prod',
    });
    expect(parsed.activeCui).toBe('12345678');
    expect(parsed.env).toBe('prod');
  });

  it('rejects unknown env values', () => {
    expect(() =>
      cliConfigSchema.parse({
        env: 'staging',
      })
    ).toThrow();
  });

  it('strips unknown keys (forward-compat with old config.yaml)', () => {
    const parsed = cliConfigSchema.parse({
      activeCui: '12345678',
      currentContext: 'acme-prod', // old key — silently dropped
    });
    expect(parsed).toEqual({ activeCui: '12345678' });
    expect((parsed as Record<string, unknown>).currentContext).toBeUndefined();
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
