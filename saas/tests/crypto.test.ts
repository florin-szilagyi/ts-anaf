import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, signPayload, verifySignature } from '@/lib/crypto';

describe('crypto', () => {
  it('round-trips a secret', () => {
    const secret = 'anaf-refresh-token-' + 'x'.repeat(200);
    const ct = encryptSecret(secret);
    expect(ct.startsWith('v1.')).toBe(true);
    expect(ct).not.toContain(secret);
    expect(decryptSecret(ct)).toBe(secret);
  });

  it('produces distinct ciphertexts for the same plaintext (fresh IV)', () => {
    expect(encryptSecret('same')).not.toBe(encryptSecret('same'));
  });

  it('rejects tampered ciphertext', () => {
    const ct = encryptSecret('secret');
    const parts = ct.split('.');
    // flip a character in the ciphertext part
    const tampered = [parts[0], parts[1], parts[2].slice(0, -1) + (parts[2].endsWith('A') ? 'B' : 'A'), parts[3]].join(
      '.'
    );
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it('rejects unknown format versions', () => {
    expect(() => decryptSecret('v9.a.b.c')).toThrow(/unsupported/);
    expect(() => decryptSecret('garbage')).toThrow(/unsupported/);
  });

  it('signs and verifies state payloads', () => {
    const payload = Buffer.from(JSON.stringify({ userId: 'user_1', nonce: 'n' })).toString('base64url');
    const sig = signPayload(payload);
    expect(verifySignature(payload, sig)).toBe(true);
    expect(verifySignature(payload + 'x', sig)).toBe(false);
    expect(verifySignature(payload, sig.slice(0, -2) + 'zz')).toBe(false);
  });
});
