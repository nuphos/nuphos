// A device as its clients see it: never its credential hash, and for a Box what instabox says of it.

import { deviceOwner } from '@/lib/agent/devices/box-access'
import { boxUpdatingSince } from '@/lib/agent/devices/box-updating'
import { teamUse } from '@/lib/agent/devices/device-grants'

import type { AgentDeviceRouteDependencies } from './routes-devices'
import type { DeviceAccessLevel } from '@/lib/agent/devices/box-access'
import type { AgentDevice } from '@/lib/agent/devices/store'

/** A device as a client sees it, never its credential hash; null once its Box's machine is gone. */
export async function deviceView(
  deps: AgentDeviceRouteDependencies,
  device: AgentDevice,
  /** What the viewer may do with it; a manager also sees who may use it. */
  level: DeviceAccessLevel,
  /** Right after a pause the frozen tunnel still looks alive; the caller knows better. */
  online?: boolean,
) {
  online ??= await deps.isOnline(device.userId, device.deviceId)
  const updating = boxUpdatingSince(device)
  const state = device.box && deps.box ? await deps.box.state(device, online) : undefined
  const pausedBy = state === 'paused' ? await deps.box?.pausedBy(device) : undefined

  if (state === 'gone') {
    await deps.deleteDevice(device.userId, device.deviceId)

    return null
  }

  return {
    deviceId: device.deviceId,
    label: device.label,
    platform: device.platform,
    ...(device.model ? { model: device.model } : {}),
    allowLocalExec: device.allowLocalExec,
    online,
    access: level,
    ownerUserId: deviceOwner(device),
    createdAt: device.createdAt.toISOString(),
    // The IP is personal data: only for those who manage the machine.
    ...(level !== 'use' && device.lastSeenAt
      ? { lastSeenAt: device.lastSeenAt.toISOString(), lastSeen: device.lastSeen ?? null }
      : {}),
    ...(device.box && state
      ? {
          box: {
            provider: device.box.provider,
            ...(level !== 'use' ? { access: teamUse(device, device.box.teamId) } : {}),
            ...(device.box.sandboxId ? { sandboxId: device.box.sandboxId } : {}),
            ...(device.box.accountId ? { instaboxAccountId: device.box.accountId } : {}),
            ...(device.box.useTerminal ? { useTerminal: true } : {}),
            state,
            ...(pausedBy ? { pausedBy } : {}),
            // Its host restarting for an update: offline on purpose, and back on its own.
            ...(updating ? { updateStartedAt: updating.toISOString() } : {}),
          },
        }
      : {}),
  }
}
