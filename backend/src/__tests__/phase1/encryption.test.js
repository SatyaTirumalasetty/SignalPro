// Pure unit tests — no DB or network needed
process.env.ENCRYPTION_KEY = 'test_key_32_bytes_padding_here!!';

const { encryptCredentials, decryptCredentials } = require('../../config/brokerEncryption');

describe('Broker Encryption (AES-256-GCM)', () => {
  const sample = { api_key: 'key123', api_secret: 'secret456', access_token: 'tok789' };

  test('round-trip: encrypt then decrypt returns original object', () => {
    const enc = encryptCredentials(sample);
    const dec = decryptCredentials(enc);
    expect(dec).toEqual(sample);
  });

  test('produces different ciphertext each call (random IV)', () => {
    const a = encryptCredentials(sample);
    const b = encryptCredentials(sample);
    expect(a).not.toBe(b);
  });

  test('encrypted string has iv:tag:ciphertext format', () => {
    const enc = encryptCredentials(sample);
    const parts = enc.split(':');
    expect(parts.length).toBeGreaterThanOrEqual(3);
    expect(parts[0]).toHaveLength(32); // 16 bytes hex
    expect(parts[1]).toHaveLength(32); // 16 bytes hex
  });

  test('decrypting tampered ciphertext throws', () => {
    const enc = encryptCredentials(sample);
    const tampered = enc.slice(0, -4) + 'XXXX';
    expect(() => decryptCredentials(tampered)).toThrow();
  });

  test('decrypting malformed string throws', () => {
    expect(() => decryptCredentials('not-valid-format')).toThrow();
  });

  test('encrypts nested objects correctly', () => {
    const nested = { a: { b: { c: 42 } }, arr: [1, 2, 3] };
    expect(decryptCredentials(encryptCredentials(nested))).toEqual(nested);
  });
});
