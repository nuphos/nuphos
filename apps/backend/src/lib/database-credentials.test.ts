import { describe, expect, test } from 'bun:test'

import {
  decryptDatabaseCredentialWithKey,
  encryptDatabaseCredentialWithKey,
} from '@/lib/database-credentials'
import { AppError } from '@/lib/errors'

const KEY_A = Buffer.alloc(32, 0x11).toString('base64')
const KEY_B = Buffer.alloc(32, 0x22).toString('base64')
const URI = 'postgresql://readonly:unit-test-password@db.example.test/app?sslmode=require'

describe('database credential envelope', () => {
  test('round-trips with AES-256-GCM without retaining plaintext', () => {
    const envelope = encryptDatabaseCredentialWithKey(URI, { raw: KEY_A, keyId: 'key-a' })

    expect(JSON.stringify(envelope)).not.toContain('unit-test-password')
    expect(envelope).toMatchObject({ v: 1, alg: 'A256GCM', keyId: 'key-a' })
    expect(decryptDatabaseCredentialWithKey(envelope, { raw: KEY_A, keyId: 'key-a' })).toBe(URI)
  })

  test('fails closed before decrypting when key ids differ', () => {
    const envelope = encryptDatabaseCredentialWithKey(URI, { raw: KEY_A, keyId: 'key-a' })

    expect(() =>
      decryptDatabaseCredentialWithKey(envelope, { raw: KEY_A, keyId: 'key-b' }),
    ).toThrow('sealed with key id')
  })

  test('fails closed when key material does not match', () => {
    const envelope = encryptDatabaseCredentialWithKey(URI, { raw: KEY_A, keyId: 'key-a' })

    try {
      decryptDatabaseCredentialWithKey(envelope, { raw: KEY_B, keyId: 'key-a' })
      throw new Error('expected decrypt to fail')
    } catch (error) {
      expect(error).toBeInstanceOf(AppError)
      expect((error as AppError).code).toBe('database_credential_key_mismatch')
      expect((error as Error).message).not.toContain('unit-test-password')
    }
  })

  test('rejects malformed key material', () => {
    expect(() => encryptDatabaseCredentialWithKey(URI, { raw: 'too-short', keyId: 'bad' })).toThrow(
      'must decode to 32 bytes',
    )
  })
})
