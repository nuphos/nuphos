import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

import { config } from '@/config'
import { AppError } from '@/lib/errors'

import { decodeMasterKey } from './shared'

import type { EncryptedSecret } from './shared'

function githubMasterKey(): { key: Buffer; keyId: string } {
  const raw = config.byos.github.encryptionKey

  if (!raw) {
    throw new AppError(
      503,
      'credential_key_unavailable',
      'GITHUB_TOKEN_ENCRYPTION_KEY is required to store GitHub user tokens',
    )
  }

  return {
    key: decodeMasterKey(raw, 'GITHUB_TOKEN_ENCRYPTION_KEY'),
    keyId: config.byos.github.encryptionKeyId,
  }
}

export function encryptGithubSecret(plaintext: string): EncryptedSecret {
  const { key, keyId } = githubMasterKey()
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

export function decryptGithubSecret(envelope: EncryptedSecret): string {
  const { key } = githubMasterKey()

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'))

    decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'))

    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    throw new AppError(
      422,
      'credential_key_mismatch',
      'Cannot decrypt the stored GitHub user token. Reconnect GitHub under Settings → Personal Credentials.',
    )
  }
}
