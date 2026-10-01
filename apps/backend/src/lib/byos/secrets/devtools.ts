import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

import { config } from '@/config'
import { AppError } from '@/lib/errors'

import { decodeMasterKey } from './shared'

import type { EncryptedSecret } from './shared'

function asanaMasterKey(): { key: Buffer; keyId: string } {
  const raw = config.byos.asana.encryptionKey

  if (!raw) {
    throw new Error('ASANA_TOKEN_ENCRYPTION_KEY is required to store Asana OAuth tokens')
  }

  return {
    key: decodeMasterKey(raw, 'ASANA_TOKEN_ENCRYPTION_KEY'),
    keyId: config.byos.asana.encryptionKeyId,
  }
}

export function encryptAsanaSecret(plaintext: string): EncryptedSecret {
  const { key, keyId } = asanaMasterKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])

  return {
    v: 1,
    alg: 'A256GCM',
    keyId,
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }
}

export function decryptAsanaSecret(envelope: EncryptedSecret): string {
  if (envelope.v !== 1 || envelope.alg !== 'A256GCM') {
    throw new AppError(
      422,
      'credential_envelope_unsupported',
      `Unsupported Asana credential envelope (v=${String(envelope.v)}, alg=${envelope.alg}). Re-bind the Asana account.`,
    )
  }
  let key: Buffer
  let configuredKeyId: string

  try {
    const mk = asanaMasterKey()

    key = mk.key
    configuredKeyId = mk.keyId
  } catch (err) {
    throw new AppError(
      503,
      'credential_key_unavailable',
      err instanceof Error ? err.message : 'ASANA_TOKEN_ENCRYPTION_KEY is missing or invalid.',
    )
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'))

    decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ])

    return plaintext.toString('utf8')
  } catch {
    throw new AppError(
      422,
      'credential_key_mismatch',
      `Cannot decrypt the stored Asana credentials: the envelope was sealed with key id "${envelope.keyId}" but this backend is configured with "${configuredKeyId}". Re-bind the Asana account.`,
    )
  }
}

function sentryMasterKey(): { key: Buffer; keyId: string } {
  const raw = config.byos.sentry.encryptionKey

  if (!raw) {
    throw new Error('SENTRY_TOKEN_ENCRYPTION_KEY is required to store Sentry OAuth tokens')
  }

  return {
    key: decodeMasterKey(raw, 'SENTRY_TOKEN_ENCRYPTION_KEY'),
    keyId: config.byos.sentry.encryptionKeyId,
  }
}

export function encryptSentrySecret(plaintext: string): EncryptedSecret {
  const { key, keyId } = sentryMasterKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])

  return {
    v: 1,
    alg: 'A256GCM',
    keyId,
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }
}

export function decryptSentrySecret(envelope: EncryptedSecret): string {
  if (envelope.v !== 1 || envelope.alg !== 'A256GCM') {
    throw new AppError(
      422,
      'credential_envelope_unsupported',
      `Unsupported Sentry credential envelope (v=${String(envelope.v)}, alg=${envelope.alg}). Re-bind the Sentry account.`,
    )
  }
  let key: Buffer
  let configuredKeyId: string

  try {
    const mk = sentryMasterKey()

    key = mk.key
    configuredKeyId = mk.keyId
  } catch (err) {
    throw new AppError(
      503,
      'credential_key_unavailable',
      err instanceof Error ? err.message : 'SENTRY_TOKEN_ENCRYPTION_KEY is missing or invalid.',
    )
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'))

    decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ])

    return plaintext.toString('utf8')
  } catch {
    throw new AppError(
      422,
      'credential_key_mismatch',
      `Cannot decrypt the stored Sentry credentials: the envelope was sealed with key id "${envelope.keyId}" but this backend is configured with "${configuredKeyId}". Re-bind the Sentry account.`,
    )
  }
}
