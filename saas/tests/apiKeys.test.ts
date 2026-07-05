import { describe, expect, it } from 'vitest';
import { displayPrefix, generateApiKey, hashApiKey, parseKeyMode } from '@/lib/apiKeys';

describe('apiKeys', () => {
  it('generates sk_test_ / sk_live_ keys with 256-bit entropy', () => {
    const test = generateApiKey('test');
    const live = generateApiKey('live');
    expect(test.secret).toMatch(/^sk_test_[A-Za-z0-9_-]{43}$/);
    expect(live.secret).toMatch(/^sk_live_[A-Za-z0-9_-]{43}$/);
    expect(test.secret).not.toBe(generateApiKey('test').secret);
  });

  it('stores only the sha256 hash', () => {
    const k = generateApiKey('live');
    expect(k.hash).toBe(hashApiKey(k.secret));
    expect(k.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(k.hash).not.toContain(k.secret.slice(8));
  });

  it('display prefix reveals only mode + 8 chars', () => {
    const k = generateApiKey('test');
    expect(k.prefix).toBe(displayPrefix(k.secret));
    expect(k.prefix).toMatch(/^sk_test_.{8}$/);
  });

  it('parses key mode from the secret', () => {
    expect(parseKeyMode('sk_test_abc')).toBe('test');
    expect(parseKeyMode('sk_live_abc')).toBe('live');
    expect(parseKeyMode('pk_live_abc')).toBeNull();
    expect(parseKeyMode('')).toBeNull();
  });
});
