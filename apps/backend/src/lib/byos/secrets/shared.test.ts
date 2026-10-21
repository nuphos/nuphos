import { createCipheriv, randomBytes } from 'node:crypto'

import { afterEach, describe, expect, test } from 'bun:test'

import { createSealer } from './shared'

import type { EncryptedSecret } from './shared'

const OLD = 'aa'.repeat(32)
const NEW = Buffer.alloc(32, 7).toString('base64')
const ENVS = [
  'TEST_SEALER_KEY',
  'TEST_SEALER_KEY_PREVIOUS',
  'TEST_SEALER_FALLBACK',
  'TEST_SEALER_FALLBACK_PREVIOUS',
]

const sealer = createSealer({
  subject: 'test credentials',
  keyEnvs: ['TEST_SEALER_KEY', 'TEST_SEALER_FALLBACK'],
  keyId: () => 'default',
  recovery: 'Re-bind it.',
})

function useKeys(env: Record<string, string>) {
  for (const name of ENVS) Reflect.deleteProperty(process.env, name)
  Object.assign(process.env, env)
}

afterEach(() => useKeys({}))

// An envelope exactly as the per-provider helpers this replaced wrote it.
function legacyEnvelope(hexKey: string, plaintext: string): EncryptedSecret {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(hexKey, 'hex'), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])

  return {
    v: 1,
    alg: 'A256GCM',
    keyId: 'default',
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }
}

describe('createSealer', () => {
  test('round-trips in the existing envelope format', () => {
    useKeys({ TEST_SEALER_KEY: OLD })
    const envelope = sealer.seal('s3cret')

    expect(Object.keys(envelope).toSorted((a, b) => a.localeCompare(b))).toEqual([
      'alg',
      'authTag',
      'ciphertext',
      'iv',
      'keyId',
      'v',
    ])
    expect(envelope).toMatchObject({ v: 1, alg: 'A256GCM', keyId: 'default' })
    expect(envelope.ciphertext).not.toContain('s3cret')
    expect(sealer.open(envelope)).toBe('s3cret')
  })

  test('opens envelopes written before the sealer existed', () => {
    useKeys({ TEST_SEALER_KEY: OLD })

    expect(sealer.open(legacyEnvelope(OLD, 'legacy'))).toBe('legacy')
  })

  test('the previous key keeps old envelopes readable until they are rewrapped', () => {
    useKeys({ TEST_SEALER_KEY: OLD })
    const old = sealer.seal('rotated')

    useKeys({ TEST_SEALER_KEY: NEW, TEST_SEALER_KEY_PREVIOUS: OLD })
    expect(sealer.open(old)).toBe('rotated')
    const rewrapped = sealer.rewrap(old)!

    expect(rewrapped.ciphertext).not.toBe(old.ciphertext)
    expect(sealer.rewrap(rewrapped)).toBeNull()

    useKeys({ TEST_SEALER_KEY: NEW })
    expect(sealer.open(rewrapped)).toBe('rotated')
    expect(() => sealer.open(old)).toThrow(/Re-bind it/)
  })

  test('the previous key pairs with the env var that supplies the current one', () => {
    useKeys({ TEST_SEALER_FALLBACK: OLD })
    const old = sealer.seal('fallback')

    // An unrelated _PREVIOUS is ignored: the key in use comes from the fallback.
    useKeys({ TEST_SEALER_FALLBACK: NEW, TEST_SEALER_KEY_PREVIOUS: OLD })
    expect(() => sealer.open(old)).toThrow(/sealed with key id/)

    useKeys({ TEST_SEALER_FALLBACK: NEW, TEST_SEALER_FALLBACK_PREVIOUS: OLD })
    expect(sealer.open(old)).toBe('fallback')
  })

  test('a tampered envelope is rejected with the recovery hint', () => {
    useKeys({ TEST_SEALER_KEY: NEW, TEST_SEALER_KEY_PREVIOUS: OLD })
    const envelope = sealer.seal('x')

    expect(() =>
      sealer.open({ ...envelope, authTag: Buffer.alloc(16).toString('base64') }),
    ).toThrow(expect.objectContaining({ status: 422, code: 'credential_key_mismatch' }))
  })

  test('a missing or malformed key is a 503', () => {
    expect(() => sealer.seal('x')).toThrow(
      expect.objectContaining({ status: 503, code: 'credential_key_unavailable' }),
    )
    useKeys({ TEST_SEALER_KEY: 'short' })
    expect(() => sealer.seal('x')).toThrow(/TEST_SEALER_KEY must decode to 32 bytes/)
  })
})
