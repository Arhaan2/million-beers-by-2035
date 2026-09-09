import { describe, expect, it } from 'vitest';
import {
  compareCrewCode,
  createSessionToken,
  timingSafeEqual,
  verifySessionToken,
} from '../src/auth';

const secret = 'a-session-signing-secret-that-is-long-enough-for-tests';

describe('session authentication', () => {
  it('creates and verifies a valid signed token', async () => {
    const created = await createSessionToken(secret, 3_600, 1_000);
    const payload = await verifySessionToken(created.token, secret, 1_001);
    expect(payload).toMatchObject({ v: 1, scope: 'editor', iat: 1_000, exp: 4_600 });
  });

  it('rejects expired and modified tokens', async () => {
    const created = await createSessionToken(secret, 10, 1_000);
    expect(await verifySessionToken(created.token, secret, 1_010)).toBeNull();
    const [payload, signature] = created.token.split('.');
    if (!signature) throw new Error('Signed token fixture is missing its signature');
    // Changing the last base64 character can alter padding bits only (or leave
    // it unchanged). Change the first sextet to guarantee different MAC bytes.
    const modifiedSignature = `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
    expect(await verifySessionToken(`${payload}.${modifiedSignature}`, secret, 1_001)).toBeNull();
  });

  it('uses a timing-safe byte comparison helper', () => {
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(timingSafeEqual(new Uint8Array([1]), new Uint8Array([1, 0]))).toBe(false);
  });

  it('compares shared codes without direct string equality', async () => {
    expect(await compareCrewCode('correct-code', 'correct-code')).toBe(true);
    expect(await compareCrewCode('wrong-code', 'correct-code')).toBe(false);
  });
});
