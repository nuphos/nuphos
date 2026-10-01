import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

import { config } from '@/config'
import { AppError } from '@/lib/errors'

import { decodeMasterKey } from './shared'

import type { EncryptedSecret } from './shared'

function posthogMasterKey(): { key: Buffer; keyId: string } {
  const raw = config.byos.posthog.encryptionKey

  if (!raw) {
    throw new Error(
      'POSTHOG_BYOK_ENCRYPTION_KEY (or LINODE_BYOK_ENCRYPTION_KEY / CLOUDFLARE_BYOK_ENCRYPTION_KEY) is required to store PostHog credentials',
    )
  }

  return {
    key: decodeMasterKey(
      raw,
      'POSTHOG_BYOK_ENCRYPTION_KEY or LINODE_BYOK_ENCRYPTION_KEY or CLOUDFLARE_BYOK_ENCRYPTION_KEY',
    ),
    keyId: config.byos.posthog.encryptionKeyId,
  }
}

export function encryptPosthogSecret(plaintext: string): EncryptedSecret {
  let key: Buffer
  let keyId: string

  try {
    const mk = posthogMasterKey()

    key = mk.key
    keyId = mk.keyId
  } catch (err) {
    // The bind route verifies the key against PostHog before this, so a missing
    // BYOK key must not become an opaque 500.
    throw new AppError(
      503,
      'credential_key_unavailable',
      err instanceof Error ? err.message : 'POSTHOG_BYOK_ENCRYPTION_KEY is missing or invalid.',
    )
  }
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

export function decryptPosthogSecret(envelope: EncryptedSecret): string {
  if (envelope.v !== 1 || envelope.alg !== 'A256GCM') {
    throw new AppError(
      422,
      'credential_envelope_unsupported',
      `Unsupported PostHog credential envelope (v=${String(envelope.v)}, alg=${envelope.alg}). Re-bind the PostHog integration.`,
    )
  }
  let key: Buffer
  let configuredKeyId: string

  try {
    const mk = posthogMasterKey()

    key = mk.key
    configuredKeyId = mk.keyId
  } catch (err) {
    throw new AppError(
      503,
      'credential_key_unavailable',
      err instanceof Error ? err.message : 'POSTHOG_BYOK_ENCRYPTION_KEY is missing or invalid.',
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
    if (configuredKeyId !== envelope.keyId) {
      throw new AppError(
        422,
        'credential_key_mismatch',
        `Cannot decrypt the stored PostHog credentials: the envelope was sealed with key id "${envelope.keyId}" but this backend is configured with "${configuredKeyId}". Re-bind the PostHog integration.`,
      )
    }
    throw new AppError(
      422,
      'credential_decrypt_failed',
      'Failed to decrypt the stored PostHog credentials. Re-bind the PostHog integration.',
    )
  }
}
