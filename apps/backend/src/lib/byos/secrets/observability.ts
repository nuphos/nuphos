import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

import { config } from '@/config'
import { AppError } from '@/lib/errors'

import { decodeMasterKey } from './shared'

import type { EncryptedSecret } from './shared'

function betterStackMasterKey(): { key: Buffer; keyId: string } {
  const raw = config.byos.betterStack.encryptionKey

  if (!raw) {
    throw new Error('BETTERSTACK_BYOK_ENCRYPTION_KEY is required to store Better Stack credentials')
  }

  return {
    key: decodeMasterKey(raw, 'BETTERSTACK_BYOK_ENCRYPTION_KEY'),
    keyId: config.byos.betterStack.encryptionKeyId,
  }
}

function uptimeKumaMasterKey(): { key: Buffer; keyId: string } {
  const raw = config.byos.uptimeKuma.encryptionKey

  if (!raw) {
    throw new Error(
      'UPTIME_KUMA_BYOK_ENCRYPTION_KEY (or LINODE_BYOK_ENCRYPTION_KEY / CLOUDFLARE_BYOK_ENCRYPTION_KEY) is required to store Uptime Kuma credentials',
    )
  }

  return {
    key: decodeMasterKey(
      raw,
      'UPTIME_KUMA_BYOK_ENCRYPTION_KEY or LINODE_BYOK_ENCRYPTION_KEY or CLOUDFLARE_BYOK_ENCRYPTION_KEY',
    ),
    keyId: config.byos.uptimeKuma.encryptionKeyId,
  }
}

export function encryptBetterStackToken(token: string): EncryptedSecret {
  const { key, keyId } = betterStackMasterKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])

  return {
    v: 1,
    alg: 'A256GCM',
    keyId,
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }
}

export function encryptUptimeKumaSecret(secret: string): EncryptedSecret {
  const { key, keyId } = uptimeKumaMasterKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])

  return {
    v: 1,
    alg: 'A256GCM',
    keyId,
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }
}

export function decryptBetterStackToken(envelope: EncryptedSecret): string {
  if (envelope.v !== 1 || envelope.alg !== 'A256GCM') {
    throw new AppError(
      422,
      'credential_envelope_unsupported',
      `Unsupported Better Stack credential envelope (v=${String(envelope.v)}, alg=${envelope.alg}). Re-bind the integration.`,
    )
  }
  let key: Buffer
  let configuredKeyId: string

  try {
    const mk = betterStackMasterKey()

    key = mk.key
    configuredKeyId = mk.keyId
  } catch (err) {
    throw new AppError(
      503,
      'credential_key_unavailable',
      err instanceof Error ? err.message : 'BETTERSTACK_BYOK_ENCRYPTION_KEY is missing or invalid.',
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
      `Cannot decrypt the stored Better Stack credentials: the envelope was sealed with key id "${envelope.keyId}" but this backend is configured with "${configuredKeyId}". Re-bind the Better Stack integration.`,
    )
  }
}

export function decryptUptimeKumaSecret(envelope: EncryptedSecret): string {
  if (envelope.v !== 1 || envelope.alg !== 'A256GCM') {
    throw new AppError(
      422,
      'credential_envelope_unsupported',
      `Unsupported Uptime Kuma credential envelope (v=${String(envelope.v)}, alg=${envelope.alg}). Re-bind the Uptime Kuma instance.`,
    )
  }
  let key: Buffer
  let configuredKeyId: string

  try {
    const mk = uptimeKumaMasterKey()

    key = mk.key
    configuredKeyId = mk.keyId
  } catch (err) {
    throw new AppError(
      503,
      'credential_key_unavailable',
      err instanceof Error ? err.message : 'UPTIME_KUMA_BYOK_ENCRYPTION_KEY is missing or invalid.',
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
      `Cannot decrypt the stored Uptime Kuma credentials: the envelope was sealed with key id "${envelope.keyId}" but this backend is configured with "${configuredKeyId}". Re-bind the Uptime Kuma instance.`,
    )
  }
}
