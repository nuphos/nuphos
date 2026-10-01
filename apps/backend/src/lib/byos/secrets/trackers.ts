import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

import { config } from '@/config'
import { AppError } from '@/lib/errors'

import { decodeMasterKey } from './shared'

import type { EncryptedSecret } from './shared'

function gitlabMasterKey(): { key: Buffer; keyId: string } {
  const raw = config.byos.gitlab.encryptionKey

  if (!raw) {
    throw new Error('GITLAB_TOKEN_ENCRYPTION_KEY is required to store GitLab OAuth tokens')
  }

  return {
    key: decodeMasterKey(raw, 'GITLAB_TOKEN_ENCRYPTION_KEY'),
    keyId: config.byos.gitlab.encryptionKeyId,
  }
}

export function encryptGitlabSecret(plaintext: string): EncryptedSecret {
  const { key, keyId } = gitlabMasterKey()
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

export function decryptGitlabSecret(envelope: EncryptedSecret): string {
  if (envelope.v !== 1 || envelope.alg !== 'A256GCM') {
    throw new AppError(
      422,
      'credential_envelope_unsupported',
      `Unsupported GitLab credential envelope (v=${String(envelope.v)}, alg=${envelope.alg}). Re-bind the GitLab account.`,
    )
  }
  let key: Buffer
  let configuredKeyId: string

  try {
    const mk = gitlabMasterKey()

    key = mk.key
    configuredKeyId = mk.keyId
  } catch (err) {
    throw new AppError(
      503,
      'credential_key_unavailable',
      err instanceof Error ? err.message : 'GITLAB_TOKEN_ENCRYPTION_KEY is missing or invalid.',
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
      `Cannot decrypt the stored GitLab credentials: the envelope was sealed with key id "${envelope.keyId}" but this backend is configured with "${configuredKeyId}". Re-bind the GitLab account.`,
    )
  }
}

function linearMasterKey(): { key: Buffer; keyId: string } {
  const raw = config.byos.linear.encryptionKey

  if (!raw) {
    throw new Error('LINEAR_TOKEN_ENCRYPTION_KEY is required to store Linear OAuth tokens')
  }

  return {
    key: decodeMasterKey(raw, 'LINEAR_TOKEN_ENCRYPTION_KEY'),
    keyId: config.byos.linear.encryptionKeyId,
  }
}

export function encryptLinearSecret(plaintext: string): EncryptedSecret {
  const { key, keyId } = linearMasterKey()
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

export function decryptLinearSecret(envelope: EncryptedSecret): string {
  if (envelope.v !== 1 || envelope.alg !== 'A256GCM') {
    throw new AppError(
      422,
      'credential_envelope_unsupported',
      `Unsupported Linear credential envelope (v=${String(envelope.v)}, alg=${envelope.alg}). Re-bind the Linear workspace.`,
    )
  }
  let key: Buffer
  let configuredKeyId: string

  try {
    const mk = linearMasterKey()

    key = mk.key
    configuredKeyId = mk.keyId
  } catch (err) {
    throw new AppError(
      503,
      'credential_key_unavailable',
      err instanceof Error ? err.message : 'LINEAR_TOKEN_ENCRYPTION_KEY is missing or invalid.',
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
      `Cannot decrypt the stored Linear credentials: the envelope was sealed with key id "${envelope.keyId}" but this backend is configured with "${configuredKeyId}". Re-bind the Linear workspace.`,
    )
  }
}

function jiraMasterKey(): { key: Buffer; keyId: string } {
  const raw = config.byos.jira.encryptionKey

  if (!raw) {
    throw new Error('JIRA_TOKEN_ENCRYPTION_KEY is required to store Jira OAuth tokens')
  }

  return {
    key: decodeMasterKey(raw, 'JIRA_TOKEN_ENCRYPTION_KEY'),
    keyId: config.byos.jira.encryptionKeyId,
  }
}

export function encryptJiraSecret(plaintext: string): EncryptedSecret {
  const { key, keyId } = jiraMasterKey()
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

export function decryptJiraSecret(envelope: EncryptedSecret): string {
  if (envelope.v !== 1 || envelope.alg !== 'A256GCM') {
    throw new AppError(
      422,
      'credential_envelope_unsupported',
      `Unsupported Jira credential envelope (v=${String(envelope.v)}, alg=${envelope.alg}). Re-bind the Jira site.`,
    )
  }
  let key: Buffer
  let configuredKeyId: string

  try {
    const mk = jiraMasterKey()

    key = mk.key
    configuredKeyId = mk.keyId
  } catch (err) {
    throw new AppError(
      503,
      'credential_key_unavailable',
      err instanceof Error ? err.message : 'JIRA_TOKEN_ENCRYPTION_KEY is missing or invalid.',
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
      `Cannot decrypt the stored Jira credentials: the envelope was sealed with key id "${envelope.keyId}" but this backend is configured with "${configuredKeyId}". Re-bind the Jira site.`,
    )
  }
}
