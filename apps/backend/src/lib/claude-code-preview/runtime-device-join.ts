// A hosted runtime whose pod joins Nuphos as a device, the way a Box does: its endpoint is
// that device's tunnel (runtime-registry) and its pod runs the CLI host (runtime-start.sh).

import { randomUUID } from 'node:crypto'

import {
  DEVICE_JOIN_TOKEN_MAX_TTL_SEC,
  deleteDeviceJoinTokens,
  isDeviceJoinTokenLive,
  issueDeviceJoinToken,
} from '@/lib/agent/devices/join-tokens'
import {
  deleteAgentDevice,
  getAgentDevice,
  insertManagedRuntimeDevice,
} from '@/lib/agent/devices/store'
import { AppError } from '@/lib/errors'

import { runtimeProvider } from './runtime-provider'
import { runtimes } from './runtime-registry'
import { sealRuntimeAuthKey, storedAuthKey } from './runtime-registry-credentials'

import type { ClaudeCodeRuntimeDoc } from './runtime-registry'
import type { LocalRuntimeRef } from '@/lib/agent/devices/local-runtime/address'

async function mintJoinToken(runtime: ClaudeCodeRuntimeDoc, device: LocalRuntimeRef) {
  const { token } = await issueDeviceJoinToken(device.userId, {
    deviceId: device.deviceId,
    ...(runtime.label ? { label: runtime.label } : {}),
    expiresInSec: DEVICE_JOIN_TOKEN_MAX_TTL_SEC,
  })

  await runtimes().updateOne(
    { _id: runtime._id, teamId: runtime.teamId },
    { $set: { joinTokenEnvelope: sealRuntimeAuthKey(token), updatedAt: new Date() } },
  )

  return token
}

/**
 * Makes the team's device the pod joins as, and the token it joins with; the provisioner
 * then restarts the pod as that device. The device belongs to whoever created the runtime.
 */
export async function joinHostedRuntimeAsDevice(
  teamId: string,
  runtimeId: string,
): Promise<LocalRuntimeRef> {
  const runtime = await runtimes().findOne({ _id: runtimeId, teamId, hostedBy: 'nuphos' })

  if (!runtime) throw new AppError(404, 'runtime_not_found', 'No runtime Nuphos hosts by that id')
  const provider = runtimeProvider(runtime.provider)

  if (provider !== 'claude-code' && provider !== 'codex')
    throw new AppError(409, 'runtime_provider_unsupported', `A ${provider} runtime cannot join`)
  if (runtime.device) return runtime.device
  const device = { userId: runtime.createdByUserId, deviceId: randomUUID() }

  await insertManagedRuntimeDevice(device.userId, {
    deviceId: device.deviceId,
    label: runtime.label ?? 'Managed runtime',
    teamId,
  })
  await mintJoinToken(runtime, device)
  await runtimes().updateOne({ _id: runtimeId, teamId }, { $set: { device } })

  return device
}

/** Back to the direct connection: the provisioner restarts the pod as it ran before joining. */
export async function detachHostedRuntimeDevice(
  teamId: string,
  runtimeId: string,
): Promise<boolean> {
  const device = (await runtimes().findOne({ _id: runtimeId, teamId }))?.device

  if (!device) return false
  await runtimes().updateOne(
    { _id: runtimeId, teamId },
    { $unset: { device: '', joinTokenEnvelope: '' }, $set: { updatedAt: new Date() } },
  )
  await forgetHostedRuntimeDevice(device)

  return true
}

export async function forgetHostedRuntimeDevice(device: LocalRuntimeRef): Promise<void> {
  await deleteDeviceJoinTokens(device.deviceId)
  await deleteAgentDevice(device.userId, device.deviceId)
}

/**
 * The token the pod joins with. It stays in the pod's Secret after use, which keeps the pod
 * on the CLI host across restarts; the host then uses its saved credential. A token that
 * died unused, before the device joined, is replaced.
 */
export async function hostedRuntimeJoinToken(
  runtime: ClaudeCodeRuntimeDoc,
): Promise<string | undefined> {
  if (!runtime.device) return undefined
  const token = storedAuthKey(runtime.joinTokenEnvelope)
  const joined = Boolean(
    (await getAgentDevice(runtime.device.userId, runtime.device.deviceId))?.credentialHash,
  )

  if (token && (joined || (await isDeviceJoinTokenLive(token)))) return token

  return mintJoinToken(runtime, runtime.device)
}
