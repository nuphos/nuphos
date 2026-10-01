import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

import { config } from '@/config'
import { AppError } from '@/lib/errors'

import { decodeMasterKey } from './shared'

import type { EncryptedSecret } from './shared'

function slackMasterKey(): { key: Buffer; keyId: string } {
  const raw = config.slack.oauth.encryptionKey

  if (!raw) {
    throw new Error(
      'SLACK_TOKEN_ENCRYPTION_KEY (or LINEAR_TOKEN_ENCRYPTION_KEY) is required to store Slack OAuth tokens',
    )
  }

  return {
    key: decodeMasterKey(raw, 'SLACK_TOKEN_ENCRYPTION_KEY or LINEAR_TOKEN_ENCRYPTION_KEY'),
    keyId: config.slack.oauth.encryptionKeyId,
  }
}

export function encryptSlackSecret(plaintext: string): EncryptedSecret {
  const { key, keyId } = slackMasterKey()
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

export function decryptSlackSecret(envelope: EncryptedSecret): string {
  if (envelope.v !== 1 || envelope.alg !== 'A256GCM') {
    throw new AppError(
      422,
      'credential_envelope_unsupported',
      `Unsupported Slack credential envelope (v=${String(envelope.v)}, alg=${envelope.alg}). Re-install the Slack app.`,
    )
  }
  let key: Buffer
  let configuredKeyId: string

  try {
    const mk = slackMasterKey()

    key = mk.key
    configuredKeyId = mk.keyId
  } catch (err) {
    throw new AppError(
      503,
      'credential_key_unavailable',
      err instanceof Error ? err.message : 'SLACK_TOKEN_ENCRYPTION_KEY is missing or invalid.',
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
      `Cannot decrypt the stored Slack credentials: the envelope was sealed with key id "${envelope.keyId}" but this backend is configured with "${configuredKeyId}". Re-install the Slack app.`,
    )
  }
}

// Lark custom-app secrets (app_secret, Encrypt Key) stored per team binding.
function larkMasterKey(): { key: Buffer; keyId: string } {
  const raw = config.lark.encryptionKey

  if (!raw) {
    throw new Error(
      'LARK_TOKEN_ENCRYPTION_KEY (or LINEAR_TOKEN_ENCRYPTION_KEY) is required to store Lark app credentials',
    )
  }

  return {
    key: decodeMasterKey(raw, 'LARK_TOKEN_ENCRYPTION_KEY or LINEAR_TOKEN_ENCRYPTION_KEY'),
    keyId: config.lark.encryptionKeyId,
  }
}

export function encryptLarkSecret(plaintext: string): EncryptedSecret {
  const { key, keyId } = larkMasterKey()
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

export function decryptLarkSecret(envelope: EncryptedSecret): string {
  if (envelope.v !== 1 || envelope.alg !== 'A256GCM') {
    throw new AppError(
      422,
      'credential_envelope_unsupported',
      `Unsupported Lark credential envelope (v=${String(envelope.v)}, alg=${envelope.alg}). Re-connect the Lark app.`,
    )
  }
  let key: Buffer
  let configuredKeyId: string

  try {
    const mk = larkMasterKey()

    key = mk.key
    configuredKeyId = mk.keyId
  } catch (err) {
    throw new AppError(
      503,
      'credential_key_unavailable',
      err instanceof Error ? err.message : 'LARK_TOKEN_ENCRYPTION_KEY is missing or invalid.',
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
      `Cannot decrypt the stored Lark credentials: the envelope was sealed with key id "${envelope.keyId}" but this backend is configured with "${configuredKeyId}". Re-connect the Lark app.`,
    )
  }
}
