import { randomUUID } from 'node:crypto'

import { config } from '@/config'
import { db } from '@/lib/db'
import { AppError } from '@/lib/errors'
import { logError } from '@/lib/observability'

import { isValidOpenAbTransportKey } from './gate'
import { isAllowedRemoteOpenAbUrl, isInternalRuntimeUrl } from './runtime-backend-url'
import { placementNamespace } from './runtime-controllers'
import { deleteRuntimeAuthSecret } from './runtime-credential-secret'
import { revokePairedBinding } from './runtime-pairing-client'
import { runtimeDeletions } from './runtime-portability-store'
import { runtimeProvider } from './runtime-provider'
import {
  invalidateRuntimeSecretCache,
  normalizeRuntimeKeys,
  resolvedRuntimeAuthKey,
  sealRuntimeAuthKey,
  storedAuthKey,
} from './runtime-registry-credentials'

import type { KubeClient } from './kube-client'
import type { RuntimePairing } from './runtime-pairing-client'
import type { OpenAbProvider } from './runtime-provider'
import type { TeamRuntimeEndpoint } from './team-openab-runtime'
import type { EncryptedEnvelope } from '@/models'

export type ClaudeCodeRuntimeStatus = 'active' | 'disabled'

export type ClaudeCodeRuntimeDoc = {
  _id: string
  teamId: string
  url: string
  provider?: OpenAbProvider
  label?: string
  status: ClaudeCodeRuntimeStatus
  /** Selected at creation or by an explicit Update; never follows the release feed. */
  deploymentImage?: string
  requestedRuntimeVersion?: string
  runtimeUpdateError?: string
  hostedBy?: 'nuphos'
  /** A row of the retired provisioner model, which nothing resolves any more. */
  managedBy?: 'provisioner'
  /** Envelope-encrypted ACP transport key. Mongo owns it; the Kubernetes
   *  Secret a hosted pod reads is derived from it. */
  authKeyEnvelope?: EncryptedEnvelope
  /** Envelope-encrypted operator credential, when it is not derived from the password. */
  controlKeyEnvelope?: EncryptedEnvelope
  /** Set when the runtime issued this row its own binding through a pairing code. */
  pairing?: RuntimePairing
  createdByUserId: string
  createdAt: Date
  updatedAt: Date
}

/** Public view — the transport key never leaves the resolver. */
export type ClaudeCodeRuntime = {
  /** Selected at creation or by an explicit Update; never follows the release feed. */
  deploymentImage?: string
  requestedRuntimeVersion?: string
  id: string
  url: string
  provider?: OpenAbProvider
  hostedBy?: 'nuphos'
  connection?: 'paired' | 'password'
  label?: string
  status: ClaudeCodeRuntimeStatus
  createdByUserId: string
  createdAt: string
}

export function runtimes() {
  return db().collection<ClaudeCodeRuntimeDoc>('claude_code_runtimes')
}

const CURRENT = { managedBy: { $exists: false } } as const

function toPublic(doc: ClaudeCodeRuntimeDoc): ClaudeCodeRuntime {
  return {
    id: doc._id,
    ...(doc.deploymentImage ? { deploymentImage: doc.deploymentImage } : {}),
    ...(doc.requestedRuntimeVersion
      ? { requestedRuntimeVersion: doc.requestedRuntimeVersion }
      : {}),
    url: doc.url,
    provider: runtimeProvider(doc.provider),
    ...(doc.label ? { label: doc.label } : {}),
    ...(doc.hostedBy
      ? { hostedBy: doc.hostedBy }
      : { connection: doc.pairing ? 'paired' : 'password' }),
    status: doc.status,
    createdByUserId: doc.createdByUserId,
    createdAt: doc.createdAt.toISOString(),
  }
}

export async function listTeamRuntimes(
  teamId: string,
  provider: OpenAbProvider = 'claude-code',
): Promise<ClaudeCodeRuntime[]> {
  const docs = await runtimes()
    .find({ teamId, ...CURRENT })
    .sort({ createdAt: 1, _id: 1 })
    .toArray()

  return docs.filter((doc) => runtimeProvider(doc.provider) === provider).map(toPublic)
}

export async function registerTeamRuntime(args: {
  id?: string
  teamId: string
  userId: string
  url: string
  provider?: OpenAbProvider
  authKey: string
  controlKey?: string
  label?: string
  hostedBy?: 'nuphos'
  deploymentImage?: string
  pairing?: RuntimePairing
  kube?: KubeClient
}): Promise<ClaudeCodeRuntime> {
  const url = args.url.trim()
  const authKey = args.authKey.trim()

  if (!isAllowedRemoteOpenAbUrl(url)) {
    throw new AppError(
      422,
      'invalid_runtime_url',
      'Runtime URL must be wss://, or ws:// on a *.svc cluster-internal host.',
    )
  }
  const controlKey = normalizeRuntimeKeys(authKey, args.controlKey?.trim())
  const now = new Date()
  const id = args.id ?? randomUUID()
  const doc: ClaudeCodeRuntimeDoc = {
    _id: id,
    teamId: args.teamId,
    url,
    provider: args.provider ?? 'claude-code',
    ...(args.label?.trim() ? { label: args.label.trim() } : {}),
    ...(args.hostedBy ? { hostedBy: args.hostedBy } : {}),
    ...(args.deploymentImage ? { deploymentImage: args.deploymentImage } : {}),
    ...(args.pairing ? { pairing: args.pairing } : {}),
    status: 'active',
    authKeyEnvelope: sealRuntimeAuthKey(authKey),
    ...(controlKey !== undefined ? { controlKeyEnvelope: sealRuntimeAuthKey(controlKey) } : {}),
    createdByUserId: args.userId,
    createdAt: now,
    updatedAt: now,
  }

  await runtimes().insertOne(doc)
  invalidateRuntimeSecretCache(args.teamId, id)

  return toPublic(doc)
}

export async function setTeamRuntimeStatus(
  teamId: string,
  id: string,
  status: ClaudeCodeRuntimeStatus,
): Promise<ClaudeCodeRuntime | null> {
  const doc = await runtimes().findOneAndUpdate(
    { _id: id, teamId },
    { $set: { status, updatedAt: new Date() } },
    { returnDocument: 'after' },
  )

  return doc ? toPublic(doc) : null
}

export async function removeTeamRuntime(
  teamId: string,
  id: string,
  kube?: KubeClient,
): Promise<boolean> {
  const doc = await runtimes().findOne({ _id: id, teamId })

  if (!doc) return false

  const result = await runtimes().deleteOne({ _id: id, teamId })

  invalidateRuntimeSecretCache(teamId, id)
  await revokePairedBinding(doc)
  // Removing the row revokes the key; the Secret is only a leftover artifact.
  await deleteRuntimeAuthSecret(teamId, id, kube).catch((err: unknown) => {
    logError('openab.runtime_credential.secret_cleanup_failed', err, {
      team_id: teamId,
      runtime_id: id,
    })
  })

  return result.deletedCount === 1
}

/** Every runtime Nuphos deploys, across teams, for the provisioner. */
export async function listHostedRuntimes(
  provider: OpenAbProvider,
): Promise<ClaudeCodeRuntimeDoc[]> {
  const docs = await runtimes()
    .find({ hostedBy: 'nuphos', ...CURRENT })
    .sort({ createdAt: 1, _id: 1 })
    .toArray()

  return docs.filter((doc) => runtimeProvider(doc.provider) === provider)
}

/** The hosted runtime a team reaches at `url`, if Nuphos deploys one there. */
export async function findHostedRuntime(
  teamId: string,
  url: string,
): Promise<ClaudeCodeRuntimeDoc | null> {
  return runtimes().findOne({ teamId, url, hostedBy: 'nuphos', ...CURRENT })
}

export async function renameTeamRuntime(teamId: string, id: string, label: string): Promise<void> {
  await runtimes().updateOne({ _id: id, teamId }, { $set: { label, updatedAt: new Date() } })
}

/** Eligible endpoints, oldest first. Callers select an explicit instance or the first endpoint. */
export async function resolveTeamRuntimeEndpoints(
  teamId: string,
  kube?: KubeClient,
  provider: OpenAbProvider = 'claude-code',
  purpose: 'transport' | 'control' = 'transport',
): Promise<TeamRuntimeEndpoint[]> {
  const docs = await runtimes()
    .find({ teamId, status: 'active', ...CURRENT })
    .sort({ createdAt: 1, _id: 1 })
    .toArray()
  const deleting = new Set(
    (
      await runtimeDeletions()
        .find({ teamId, completedAt: { $exists: false } }, { projection: { _id: 1 } })
        .toArray()
    ).map((job) => job._id),
  )
  const endpoints: TeamRuntimeEndpoint[] = []

  for (const doc of docs) {
    if (runtimeProvider(doc.provider) !== provider || deleting.has(doc._id)) continue
    // The registry is shared across environments; a hosted runtime is reachable only
    // from the one that deploys it.
    if (
      doc.hostedBy &&
      placementNamespace(doc.url) !== config.claudeCodeRuntimeProvisioner.namespace
    )
      continue
    const stored =
      purpose === 'transport'
        ? storedAuthKey(doc.authKeyEnvelope)
        : storedAuthKey(doc.controlKeyEnvelope)
    const authKey = stored ?? (await resolvedRuntimeAuthKey(doc.teamId, doc._id, kube, purpose))

    if (authKey && isValidOpenAbTransportKey(authKey))
      endpoints.push({
        url: doc.url,
        authKey,
        runtimeId: doc._id,
        ...(provider === 'codex' ? { provider } : {}),
        // Reachability decides the backend address a runtime is handed, not who runs it.
        ...(isInternalRuntimeUrl(doc.url) ? {} : { external: true }),
      })
  }

  return endpoints
}
