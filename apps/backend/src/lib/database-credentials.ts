import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

import { config } from '@/config'
import { AppError } from '@/lib/errors'

import type { EncryptedEnvelope } from '@/models'

type DatabaseMasterKey = { raw: string; keyId: string }

function decodeKey(raw: string): Buffer {
  if (/^[a-f0-9]{64}$/i.test(raw)) return Buffer.from(raw, 'hex')
  const key = Buffer.from(raw, 'base64')

  if (key.length !== 32) {
    throw new Error('DATABASE_CREDENTIAL_ENCRYPTION_KEY must decode to 32 bytes')
  }

  return key
}

function configuredKey(): DatabaseMasterKey {
  const raw = config.byos.database.encryptionKey

  if (!raw) {
    throw new AppError(
      503,
      'database_credential_key_unavailable',
      'DATABASE_CREDENTIAL_ENCRYPTION_KEY is required to store database credentials',
    )
  }

  return { raw, keyId: config.byos.database.encryptionKeyId }
}

export function encryptDatabaseCredentialWithKey(
  plaintext: string,
  master: DatabaseMasterKey,
): EncryptedEnvelope {
  const key = decodeKey(master.raw)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])

  return {
    v: 1,
    alg: 'A256GCM',
    keyId: master.keyId,
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }
}

export function decryptDatabaseCredentialWithKey(
  envelope: EncryptedEnvelope,
  master: DatabaseMasterKey,
): string {
  if (envelope.v !== 1 || envelope.alg !== 'A256GCM') {
    throw new AppError(
      422,
      'database_credential_envelope_unsupported',
      'Unsupported database credential envelope. Re-bind the database connection.',
    )
  }
  if (envelope.keyId !== master.keyId) {
    throw new AppError(
      422,
      'database_credential_key_mismatch',
      `The database credential was sealed with key id "${envelope.keyId}" but this backend uses "${master.keyId}". Restore the previous key or re-bind the connection.`,
    )
  }
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      decodeKey(master.raw),
      Buffer.from(envelope.iv, 'base64'),
    )

    decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'))

    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    throw new AppError(
      422,
      'database_credential_key_mismatch',
      'The stored database credential cannot be decrypted with the configured key. Restore the previous key or re-bind the connection.',
    )
  }
}

export function encryptDatabaseCredential(plaintext: string): EncryptedEnvelope {
  return encryptDatabaseCredentialWithKey(plaintext, configuredKey())
}

export function decryptDatabaseCredential(envelope: EncryptedEnvelope): string {
  return decryptDatabaseCredentialWithKey(envelope, configuredKey())
}
