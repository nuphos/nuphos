// A Box whose disk is almost full gives back what its tools rebuild on their own
// (BOX_CLEAR_CACHES_COMMAND). Whoever manages the Box asks. A Box that is away is never
// started for it: runOnBox does not resume a paused machine. One whose agent is mid-turn
// keeps its caches until the turn ends, since a build running in that turn reads them.
// Nothing is stored: the disk reading the host reports is the result.

import { requireDeviceAccess } from '@/lib/agent/devices/box-access'
import { runOnBox } from '@/lib/agent/devices/box-instabox'
import { BOX_CLEAR_CACHES_COMMAND } from '@/lib/agent/devices/box-instabox-client'
import { runtimePresenceStore } from '@/lib/agent/devices/local-runtime/presence'
import { AppError } from '@/lib/errors'

import { boxAgentBusy, hostAgents } from './box-update'

import type { LocalRuntimeRef } from '@/lib/agent/devices/local-runtime/address'
import type { LocalRuntimeStatus } from '@/lib/agent/devices/local-runtime/protocol'

export type BoxCacheClearDeps = {
  /** The computer as `actorId` may manage it in this team; throws when they may not. */
  device: (
    actorId: string,
    teamId: string,
    deviceId: string,
  ) => Promise<LocalRuntimeRef & { box: boolean }>
  status: (ref: LocalRuntimeRef) => Promise<LocalRuntimeStatus | undefined>
  busy: typeof boxAgentBusy
  clear: (ref: LocalRuntimeRef) => Promise<unknown>
}

const defaultDeps: BoxCacheClearDeps = {
  device: async (actorId, teamId, deviceId) => {
    const device = await requireDeviceAccess(actorId, teamId, deviceId, 'manage')

    return { userId: device.userId, deviceId: device.deviceId, box: Boolean(device.box) }
  },
  status: async ({ userId, deviceId }) =>
    (await runtimePresenceStore().get(userId, deviceId))?.status,
  busy: boxAgentBusy,
  clear: ({ userId, deviceId }) => runOnBox(userId, deviceId, BOX_CLEAR_CACHES_COMMAND),
}

export async function requestBoxCacheClear(
  teamId: string,
  deviceId: string,
  actorId: string,
  deps = defaultDeps,
): Promise<{ ok: true }> {
  const { box, ...ref } = await deps.device(actorId, teamId, deviceId)

  // A person's own computer is theirs to tidy: nothing is deleted on it from afar.
  if (!box) throw new AppError(404, 'device_not_found', 'Device is not available')
  const status = await deps.status(ref)

  if (!status)
    throw new AppError(
      409,
      'runtime_offline',
      'The Box is offline. Open it, then clear its caches.',
    )
  for (const id of hostAgents(ref, status))
    if (await deps.busy(teamId, id, actorId))
      throw new AppError(
        409,
        'runtime_busy',
        'Caches are cleared once active conversations on this computer finish.',
      )
  await deps.clear(ref)

  return { ok: true }
}
