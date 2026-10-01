import { randomUUID } from 'node:crypto'

import { AppError } from '@/lib/errors'
import { getNuphosUserById, getTeamsByIds } from '@/lib/identity'
import { logError } from '@/lib/observability'

import {
  isInternalRuntimeUrl,
  publicBackendUrl,
  requirePublicBackendUrl,
  runtimeBackendUrl,
} from './runtime-backend-url'
import {
  bindingStatus,
  exchangePairingCode,
  normalizePairingRuntimeUrl,
  revokeBinding,
  revokePairedBinding,
} from './runtime-pairing-client'
import { runtimeProvider } from './runtime-provider'
import { probeExternalRuntimeProvider } from './runtime-provider-probe'
import { registerTeamRuntime, runtimes } from './runtime-registry'
import {
  invalidateRuntimeSecretCache,
  normalizeRuntimeKeys,
  sealRuntimeAuthKey,
  storedAuthKey,
} from './runtime-registry-credentials'

import type { PairingExchange, RuntimePairing } from './runtime-pairing-client'
import type { OpenAbProvider } from './runtime-provider'
import type { ClaudeCodeRuntime, ClaudeCodeRuntimeDoc } from './runtime-registry'

type Fetch = typeof fetch

export type PairRuntimeArgs = {
  teamId: string
  userId: string
  url: string
  code: string
  label?: string
  replaceRuntimeId?: string
  fetchImpl?: Fetch
  probe?: (url: string, authKey: string) => Promise<OpenAbProvider | undefined>
}

function sameHost(a: string, b: string): boolean {
  try {
    return new URL(a).host === new URL(b).host
  } catch {
    return false
  }
}

function alreadyConnected(runtimeId: string): AppError {
  return new AppError(
    409,
    'runtime_already_connected',
    'This agent is already connected to this team. Update the existing connection instead.',
    { runtimeId },
  )
}

async function pairingClientMetadata(args: PairRuntimeArgs, runtimeRecordId: string) {
  const [team] = await getTeamsByIds([args.teamId])
  const user = await getNuphosUserById(args.userId)

  return {
    backendOrigin: (publicBackendUrl() ?? runtimeBackendUrl(false) ?? '').replace(/\/$/u, ''),
    teamId: args.teamId,
    teamName: team?.name ?? '',
    pairedBy: user?.name || user?.email || args.userId,
    runtimeRecordId,
  }
}

async function replacementTarget(teamId: string, runtimeId: string) {
  const doc = await runtimes().findOne({ _id: runtimeId, teamId })

  if (!doc || doc.managedBy) throw new AppError(404, 'runtime_not_found', 'Agent not found')

  return doc
}

async function rejectDuplicate(teamId: string, url: string, runtimeInstanceId?: string) {
  const docs = await runtimes().find({ teamId }).sort({ createdAt: 1, _id: 1 }).toArray()
  const duplicate = docs.find(
    (doc) =>
      !doc.managedBy &&
      (runtimeInstanceId
        ? doc.pairing?.runtimeInstanceId === runtimeInstanceId
        : sameHost(doc.url, url)),
  )

  if (duplicate) throw alreadyConnected(duplicate._id)
}

async function replaceInPlace(
  previous: ClaudeCodeRuntimeDoc,
  url: string,
  exchange: PairingExchange,
  pairing: RuntimePairing,
  label?: string,
): Promise<ClaudeCodeRuntime> {
  const controlKey = normalizeRuntimeKeys(exchange.transportKey, exchange.controlKey)
  const replaced = {
    url: previous.url,
    pairing: previous.pairing,
    controlKeyEnvelope: previous.controlKeyEnvelope,
  }

  await runtimes().updateOne(
    { _id: previous._id, teamId: previous.teamId, managedBy: { $exists: false } },
    {
      $set: {
        url,
        pairing,
        authKeyEnvelope: sealRuntimeAuthKey(exchange.transportKey),
        ...(controlKey ? { controlKeyEnvelope: sealRuntimeAuthKey(controlKey) } : {}),
        ...(label ? { label } : {}),
        updatedAt: new Date(),
      },
      ...(controlKey ? {} : { $unset: { controlKeyEnvelope: '' as const } }),
    },
  )
  invalidateRuntimeSecretCache(previous.teamId, previous._id)
  if (replaced.pairing && replaced.pairing.bindingId !== pairing.bindingId)
    await revokePairedBinding(replaced)
  const nextLabel = label || previous.label

  return {
    id: previous._id,
    url,
    provider: runtimeProvider(previous.provider),
    connection: 'paired',
    ...(nextLabel ? { label: nextLabel } : {}),
    status: previous.status,
    createdByUserId: previous.createdByUserId,
    createdAt: previous.createdAt.toISOString(),
  }
}

async function compensate(url: string, exchange: PairingExchange, fetchImpl?: Fetch) {
  const revoked = await revokeBinding(url, exchange.controlKey, fetchImpl)

  if (!revoked)
    logError('openab.runtime_pairing.compensation_failed', new Error('revoke failed'), {
      binding_id: exchange.bindingId,
    })
}

export async function pairTeamRuntime(
  args: PairRuntimeArgs,
): Promise<ClaudeCodeRuntime & { replaced: boolean }> {
  const url = normalizePairingRuntimeUrl(args.url)

  if (!url)
    throw new AppError(
      422,
      'invalid_runtime_url',
      'Agent URL must be https:// or wss://, or a cluster-internal ws:// address.',
    )
  if (!isInternalRuntimeUrl(url)) requirePublicBackendUrl()
  const previous = args.replaceRuntimeId
    ? await replacementTarget(args.teamId, args.replaceRuntimeId)
    : undefined

  if (!previous) await rejectDuplicate(args.teamId, url)
  const id = previous?._id ?? randomUUID()
  const exchange = await exchangePairingCode(
    url,
    args.code,
    await pairingClientMetadata(args, id),
    args.fetchImpl,
  )

  try {
    if (!previous) await rejectDuplicate(args.teamId, url, exchange.runtimeInstanceId)
    const pairing: RuntimePairing = {
      bindingId: exchange.bindingId,
      runtimeInstanceId: exchange.runtimeInstanceId,
      pairedAt: new Date(),
      pairedByUserId: args.userId,
    }

    const provider =
      exchange.provider ??
      (await (args.probe ?? probeExternalRuntimeProvider)(url, exchange.transportKey))

    if (previous) {
      if (provider && provider !== runtimeProvider(previous.provider))
        throw new AppError(
          409,
          'runtime_provider_mismatch',
          'This agent now runs a different agent type than the connection it would replace. Remove the old connection and connect the agent as a new one.',
        )
      const runtime = await replaceInPlace(previous, url, exchange, pairing, args.label)

      return { ...runtime, replaced: true }
    }
    if (!provider)
      throw new AppError(
        422,
        'runtime_provider_undetected',
        'Nuphos connected to this agent but could not tell whether it runs Claude Code or Codex. Make sure the agent image is up to date.',
      )
    const label = args.label || new URL(url).hostname.slice(0, 120)
    const runtime = await registerTeamRuntime({
      id,
      teamId: args.teamId,
      userId: args.userId,
      url,
      provider,
      authKey: exchange.transportKey,
      controlKey: exchange.controlKey,
      pairing,
      ...(label ? { label } : {}),
    })

    return { ...runtime, replaced: false }
  } catch (err) {
    await compensate(url, exchange, args.fetchImpl)
    throw err
  }
}

/** Tells a revoked binding apart from an unreachable runtime, which the ACP handshake cannot. */
export async function pairedBindingRevoked(
  teamId: string,
  runtimeId: string,
  fetchImpl?: Fetch,
): Promise<boolean> {
  const doc = await runtimes().findOne({ _id: runtimeId, teamId })
  const key = doc?.pairing ? storedAuthKey(doc.controlKeyEnvelope) : null

  if (!doc || !key) return false

  return (await bindingStatus(doc.url, key, fetchImpl)) === 'revoked'
}
