import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

import { config } from '@/config'
import { AppError } from '@/lib/errors'

import { decodeMasterKey } from './shared'

import type { EncryptedSecret } from './shared'

function tailscaleMasterKey(): { key: Buffer; keyId: string } {
  const raw = config.byos.tailscale.encryptionKey

  if (!raw) {
    throw new Error(
      'TAILSCALE_BYOK_ENCRYPTION_KEY (or LINODE_BYOK_ENCRYPTION_KEY / CLOUDFLARE_BYOK_ENCRYPTION_KEY) is required to store Tailscale credentials',
    )
  }

  return {
    key: decodeMasterKey(
      raw,
      'TAILSCALE_BYOK_ENCRYPTION_KEY or LINODE_BYOK_ENCRYPTION_KEY or CLOUDFLARE_BYOK_ENCRYPTION_KEY',
    ),
    keyId: config.byos.tailscale.encryptionKeyId,
  }
}

function zeaburMasterKey(): { key: Buffer; keyId: string } {
  const raw = config.byos.zeabur.encryptionKey

  if (!raw) {
    throw new Error(
      'ZEABUR_PROVIDER_ENCRYPTION_KEY (or LINODE_BYOK_ENCRYPTION_KEY / CLOUDFLARE_BYOK_ENCRYPTION_KEY) is required to store Zeabur credentials',
    )
  }

  return {
    key: decodeMasterKey(
      raw,
      'ZEABUR_PROVIDER_ENCRYPTION_KEY or LINODE_BYOK_ENCRYPTION_KEY or CLOUDFLARE_BYOK_ENCRYPTION_KEY',
    ),
    keyId: config.byos.zeabur.encryptionKeyId,
  }
}

export function encryptTailscaleClientSecret(secret: string): EncryptedSecret {
  const { key, keyId } = tailscaleMasterKey()
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

export function encryptZeaburToken(token: string): EncryptedSecret {
  const { key, keyId } = zeaburMasterKey()
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

export function decryptZeaburToken(envelope: EncryptedSecret): string {
  if (envelope.v !== 1 || envelope.alg !== 'A256GCM') {
    throw new AppError(
      422,
      'credential_envelope_unsupported',
      `Unsupported Zeabur credential envelope (v=${String(envelope.v)}, alg=${envelope.alg}). Re-bind the provider.`,
    )
  }
  let key: Buffer
  let configuredKeyId: string

  try {
    const mk = zeaburMasterKey()

    key = mk.key
    configuredKeyId = mk.keyId
  } catch (err) {
    throw new AppError(
      503,
      'credential_key_unavailable',
      err instanceof Error ? err.message : 'ZEABUR_PROVIDER_ENCRYPTION_KEY is missing or invalid.',
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
      `Cannot decrypt the stored Zeabur credentials: the envelope was sealed with key id "${envelope.keyId}" but this backend is configured with "${configuredKeyId}". Re-bind the Zeabur provider.`,
    )
  }
}

export function decryptTailscaleClientSecret(envelope: EncryptedSecret): string {
  if (envelope.v !== 1 || envelope.alg !== 'A256GCM') {
    throw new AppError(
      422,
      'credential_envelope_unsupported',
      `Unsupported Tailscale credential envelope (v=${String(envelope.v)}, alg=${envelope.alg}). Re-bind the OAuth client.`,
    )
  }
  let key: Buffer
  let configuredKeyId: string

  try {
    const mk = tailscaleMasterKey()

    key = mk.key
    configuredKeyId = mk.keyId
  } catch (err) {
    throw new AppError(
      503,
      'credential_key_unavailable',
      err instanceof Error ? err.message : 'TAILSCALE_BYOK_ENCRYPTION_KEY is missing or invalid.',
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
      `Cannot decrypt the stored Tailscale credentials: the envelope was sealed with key id "${envelope.keyId}" but this backend is configured with "${configuredKeyId}". Re-bind the OAuth client.`,
    )
  }
}
