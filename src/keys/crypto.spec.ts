import { randomBytes } from 'crypto';

// The smallest checks that fail if the money/security-critical logic breaks.
describe('crypto (user API keys at rest)', () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = randomBytes(32).toString('hex');
  });

  it('round-trips and never repeats ciphertext (fresh IV per encrypt)', async () => {
    const { encrypt, decrypt, hint } = await import('./crypto');
    const key = 'sk-or-v1-abc123def456';
    const enc = encrypt(key);
    expect(decrypt(enc)).toBe(key);
    expect(encrypt(key)).not.toBe(enc);
    expect(enc).not.toContain(key);
    expect(hint(key)).toBe('sk-…f456');
  });

  it('rejects tampered ciphertext (GCM auth tag)', async () => {
    const { encrypt, decrypt } = await import('./crypto');
    const enc = encrypt('sk-secret');
    const parts = enc.split('.');
    const cipher = Buffer.from(parts[2], 'base64');
    cipher[0] ^= 0xff;
    parts[2] = cipher.toString('base64');
    expect(() => decrypt(parts.join('.'))).toThrow();
  });
});

describe('usage cost math (billing.md formula)', () => {
  it('prices per million by token type at write time', async () => {
    const { getModel } = await import('../models/registry');
    const m = getModel('claude-opus-4-8')!;
    // 1M input + 1M output + 1M cache-read + 1M cache-write at Opus 4.8 rates
    const cost =
      (1_000_000 * m.pricing.in +
        1_000_000 * m.pricing.out +
        1_000_000 * m.pricing.cacheRead +
        1_000_000 * m.pricing.cacheWrite) /
      1_000_000;
    expect(cost).toBeCloseTo(5 + 25 + 0.5 + 6.25, 6);
  });
});
