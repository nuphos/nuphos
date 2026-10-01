import { config } from '@/config'
import {
  decryptDatabaseCredentialWithKey,
  encryptDatabaseCredentialWithKey,
} from '@/lib/database-credentials'
import { db } from '@/lib/db'
import { AppError } from '@/lib/errors'
import { logError } from '@/lib/observability'

import { isValidOpenAbTransportKey } from './gate'
import { deriveRuntimeControlKey } from './runtime-control-key'
import { readRuntimeAuthSecret, readRuntimeControlSecret } from './runtime-credential-secret'

import type { KubeClient } from './kube-client'
import type { EncryptedEnvelope } from '@/models'

const RUNTIME_SECRET_CACHE_TTL_MS = 15_000
const runtimeSecretCache = new Map<string, { authKey: string | null; expiresAt: number }>()

/** One master key seals every runtime key the registry stores. */
export function claudeCodePreviewMasterKey() {
  const raw = config.claudeCodePreview.tokenEncryptionKey

  if (!raw) {
    throw new AppError(
      503,
      'claude_code_token_key_unavailable',
      'OPENAB_RUNTIME_TOKEN_ENCRYPTION_KEY (or CLAUDE_CODE_PREVIEW_TOKEN_ENCRYPTION_KEY) is required to store runtime credentials',
    )
  }

  return { raw, keyId: 'claude-code-preview' }
}

type RuntimeCredentialDoc = {
  _id: string
  teamId: string
  hostedBy?: 'nuphos'
  managedBy?: 'provisioner'
  authKeyEnvelope?: EncryptedEnvelope
  controlKeyEnvelope?: EncryptedEnvelope
  updatedAt: Date
}

function runtimeCredentials() {
  return db().collection<RuntimeCredentialDoc>('claude_code_runtimes')
}

function runtimeSecretCacheKey(teamId: string, runtimeId: string, purpose = 'transport'): string {
  return `${teamId}\0${runtimeId}\0${purpose}`
}

export function invalidateRuntimeSecretCache(teamId: string, runtimeId: string): void {
  runtimeSecretCache.delete(runtimeSecretCacheKey(teamId, runtimeId))
  runtimeSecretCache.delete(runtimeSecretCacheKey(teamId, runtimeId, 'control'))
}

const RUNTIME_KEY_CHARACTERS = "letters, digits and ! # $ % & ' * + - . ^ _ ` | ~"

/** Validates both keys and returns the operator key to store. One equal to the password
 *  is the one-password case: openab would discard it, so store nothing and let the
 *  derived key stand in. */
export function normalizeRuntimeKeys(authKey?: string, controlKey?: string): string | undefined {
  if (authKey !== undefined && !isValidOpenAbTransportKey(authKey)) {
    throw new AppError(
      422,
      'invalid_runtime_key',
      `The admin password can only contain ${RUNTIME_KEY_CHARACTERS} — no spaces, quotes, "/", "=" or ":".`,
    )
  }
  if (controlKey !== undefined && !isValidOpenAbTransportKey(controlKey)) {
    throw new AppError(
      422,
      'invalid_runtime_key',
      `The operator key can only contain ${RUNTIME_KEY_CHARACTERS}.`,
    )
  }

  return controlKey && controlKey !== authKey ? controlKey : undefined
}

/** Rotating the container's credentials must not mint a new runtime id:
 *  conversations pin the one they started on. Provisioned rows derive theirs
 *  and are left alone. */
export async function rotateRuntimeKeys(
  teamId: string,
  runtimeId: string,
  keys: { authKey: string; controlKey?: string },
): Promise<boolean> {
  const authKey = keys.authKey.trim()
  const controlKey = normalizeRuntimeKeys(authKey, keys.controlKey?.trim())
  const result = await runtimeCredentials().updateOne(
    { _id: runtimeId, teamId, managedBy: { $exists: false }, hostedBy: { $exists: false } },
    {
      $set: {
        authKeyEnvelope: sealRuntimeAuthKey(authKey),
        updatedAt: new Date(),
        ...(controlKey ? { controlKeyEnvelope: sealRuntimeAuthKey(controlKey) } : {}),
      },
      ...(controlKey ? {} : { $unset: { controlKeyEnvelope: '' } }),
    },
  )

  invalidateRuntimeSecretCache(teamId, runtimeId)

  return result.modifiedCount === 1
}

export function sealRuntimeAuthKey(authKey: string): EncryptedEnvelope {
  return encryptDatabaseCredentialWithKey(authKey, claudeCodePreviewMasterKey())
}

export function openRuntimeAuthKey(envelope: EncryptedEnvelope): string {
  return decryptDatabaseCredentialWithKey(envelope, claudeCodePreviewMasterKey())
}

/** Decrypts a stored envelope, or null when it was sealed under a key this
 *  process no longer holds — the caller then falls back to the Secret. */
export function storedAuthKey(envelope: EncryptedEnvelope | undefined): string | null {
  if (!envelope) return null
  try {
    return openRuntimeAuthKey(envelope)
  } catch {
    return null
  }
}

/** Mongo owns the transport key. Callers that mint one — the provisioner, and
 *  registration — record it here before anything derives a Secret from it. */
export async function storeRuntimeAuthKey(
  teamId: string,
  runtimeId: string,
  authKey: string,
): Promise<void> {
  // Reconciliation replays the same key every minute; only a change is written.
  const stored = await runtimeCredentials().findOne({ _id: runtimeId, teamId })

  if (storedAuthKey(stored?.authKeyEnvelope) === authKey) return
  await runtimeCredentials().updateOne(
    { _id: runtimeId, teamId },
    { $set: { authKeyEnvelope: sealRuntimeAuthKey(authKey), updatedAt: new Date() } },
  )
  invalidateRuntimeSecretCache(teamId, runtimeId)
}

/** The pod and its key are gone; drop the row's credential with them. */
export async function clearRuntimeAuthKey(teamId: string, runtimeId: string): Promise<void> {
  await runtimeCredentials().updateOne(
    { _id: runtimeId, teamId },
    { $set: { updatedAt: new Date() }, $unset: { authKeyEnvelope: '' } },
  )
  invalidateRuntimeSecretCache(teamId, runtimeId)
}

/** Read-through for runtimes registered before Mongo owned the key: the Secret
 *  still holds it, so adopt it on first touch instead of migrating in bulk. */
async function adoptSecretAuthKey(
  teamId: string,
  runtimeId: string,
  kube?: KubeClient,
): Promise<string | null> {
  const authKey = await readRuntimeAuthSecret(teamId, runtimeId, kube)

  if (!authKey) return null
  try {
    await runtimeCredentials().updateOne(
      { _id: runtimeId, teamId, authKeyEnvelope: { $exists: false } },
      { $set: { authKeyEnvelope: sealRuntimeAuthKey(authKey), updatedAt: new Date() } },
    )
  } catch (err) {
    logError('openab.runtime_credential.adopt_failed', err, {
      team_id: teamId,
      runtime_id: runtimeId,
    })
  }

  return authKey
}

/** The key stored with the row, then a Secret, which is where a provisioned row
 *  and an older external one keep theirs. Only a runtime connected with nothing but
 *  its password falls through to the key its image derives from that password. */
async function readControlKey(
  teamId: string,
  runtimeId: string,
  kube?: KubeClient,
): Promise<string | null> {
  const doc = await runtimeCredentials().findOne({ _id: runtimeId, teamId })
  const stored = storedAuthKey(doc?.controlKeyEnvelope)

  if (stored) return stored
  const fromSecret = await readRuntimeControlSecret(teamId, runtimeId, kube)

  if (fromSecret) return fromSecret
  if (!doc || doc.managedBy) return null
  const password = storedAuthKey(doc.authKeyEnvelope)

  return password ? deriveRuntimeControlKey(password) : null
}

async function readTransportKey(
  teamId: string,
  runtimeId: string,
  kube?: KubeClient,
): Promise<string | null> {
  const doc = await runtimeCredentials().findOne({ _id: runtimeId, teamId })
  const stored = storedAuthKey(doc?.authKeyEnvelope)

  return stored ?? adoptSecretAuthKey(teamId, runtimeId, kube)
}

function readKey(
  teamId: string,
  runtimeId: string,
  purpose: 'transport' | 'control',
  kube?: KubeClient,
): Promise<string | null> {
  return purpose === 'control'
    ? readControlKey(teamId, runtimeId, kube)
    : readTransportKey(teamId, runtimeId, kube)
}

export async function resolvedRuntimeAuthKey(
  teamId: string,
  runtimeId: string,
  kube?: KubeClient,
  purpose: 'transport' | 'control' = 'transport',
): Promise<string | null> {
  // Injected clients are used by reconciliation and tests, where callers need
  // an immediate view. The normal chat path uses a short cache so every turn
  // does not add a database round trip.
  if (kube) return readKey(teamId, runtimeId, purpose, kube)

  const key = runtimeSecretCacheKey(teamId, runtimeId, purpose)
  const cached = runtimeSecretCache.get(key)

  if (cached && cached.expiresAt > Date.now()) return cached.authKey

  const authKey = await readKey(teamId, runtimeId, purpose)

  runtimeSecretCache.set(key, { authKey, expiresAt: Date.now() + RUNTIME_SECRET_CACHE_TTL_MS })

  return authKey
}
