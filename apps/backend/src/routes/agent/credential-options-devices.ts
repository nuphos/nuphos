import { isDevicePresent } from '@/lib/agent/devices/presence'
import { isActiveTeamMember, listAgentDevicesForUser } from '@/lib/agent/devices/store'

import type { AgentCredentialOptions } from './types'
import type { AgentDevice } from '@/lib/agent/devices/store'

// The user's own devices, in a team they belong to; no team means no devices.
// Offline ones are listed too, so a selection is what the user ticked, not what
// happened to be online when it was saved. Use checks `available`.
export async function resolveDeviceOptions(
  userId: string,
  teamId: string | undefined,
): Promise<AgentCredentialOptions['devices']> {
  if (!teamId || !(await isActiveTeamMember(userId, teamId))) return []
  const devices = await Promise.all(
    (await listAgentDevicesForUser(userId)).map(async (device) => ({
      device,
      available: device.allowLocalExec && (await isDevicePresent(userId, device.deviceId)),
    })),
  )

  return withoutDeadDuplicates(devices).map(({ device, available }) => ({
    deviceId: device.deviceId,
    label: device.label,
    platform: device.platform,
    available,
  }))
}

// Each Desktop profile and CLI agent home registers its own id, so one computer
// piles up registrations that will never connect again. Of those sharing a label
// and platform, keep the ones online now, or else the most recently registered.
function withoutDeadDuplicates<T extends { device: AgentDevice; available: boolean }>(
  devices: T[],
): T[] {
  const machine = (entry: T) => `${entry.device.platform}\0${entry.device.label}`
  const kept = new Map<string, T[]>()

  for (const entry of devices)
    kept.set(machine(entry), [...(kept.get(machine(entry)) ?? []), entry])

  return [...kept.values()].flatMap((same) => {
    const online = same.filter((entry) => entry.available)

    if (online.length) return online

    return same
      .toSorted((a, b) => b.device.updatedAt.getTime() - a.device.updatedAt.getTime())
      .slice(0, 1)
  })
}
