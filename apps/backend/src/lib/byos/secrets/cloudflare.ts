import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

import { config } from '@/config'
import { AppError } from '@/lib/errors'

import { decodeMasterKey } from './shared'

import type { EncryptedSecret } from './shared'

function masterKey(): { key: Buffer; keyId: string } {
  const raw = config.byos.cloudflare.encryptionKey

  if (!raw) {
    throw new Error('CLOUDFLARE_BYOK_ENCRYPTION_KEY is required to store Cloudflare credentials')
  }

  return {
    key: decodeMasterKey(raw, 'CLOUDFLARE_BYOK_ENCRYPTION_KEY'),
    keyId: config.byos.cloudflare.encryptionKeyId,
  }
}

export function encryptCloudflareApiKey(apiKey: string): EncryptedSecret {
  const { key, keyId } = masterKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(apiKey, 'utf8'), cipher.final()])

  return {
    v: 1,
    alg: 'A256GCM',
    keyId,
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  }
}

export function decryptCloudflareApiKey(envelope: EncryptedSecret): string {
  if (envelope.v !== 1 || envelope.alg !== 'A256GCM') {
    throw new AppError(
      422,
      'credential_envelope_unsupported',
      `Unsupported Cloudflare credential envelope (v=${String(envelope.v)}, alg=${envelope.alg}). ` +
        "The stored binding was written with a format this backend doesn't know how to read. Re-bind the account.",
    )
  }
  let key: Buffer
  let configuredKeyId: string

  try {
    const mk = masterKey()

    key = mk.key
    configuredKeyId = mk.keyId
  } catch (err) {
    throw new AppError(
      503,
      'credential_key_unavailable',
      err instanceof Error ? err.message : 'CLOUDFLARE_BYOK_ENCRYPTION_KEY is missing or invalid.',
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
    // GCM auth-tag mismatch means key/keyId divergence. The agent uses this
    // code to suggest re-binding rather than retrying.
    throw new AppError(
      422,
      'credential_key_mismatch',
      `Cannot decrypt the stored Cloudflare credentials: the envelope was sealed with key id "${envelope.keyId}" but this backend is configured with "${configuredKeyId}". Re-bind the Cloudflare account so it's encrypted with the current key.`,
    )
  }
}
