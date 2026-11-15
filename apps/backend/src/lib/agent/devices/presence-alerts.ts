import { getTeamMembers } from '@/lib/identity'
import { notifyComputerChanged } from '@/lib/push/computer-alerts'
import { redisEnabled, withRedis } from '@/lib/redis'

import { deviceOwner } from './box-access'
import { isDevicePresent } from './presence'
import { getAgentDevice } from './store'

import type { AgentDevice } from './store'

/** How long a computer stays disconnected before it counts as offline: a blip or a restart is not. */
export const OFFLINE_GRACE_MS = 2 * 60_000
const MARK_TTL_SEC = 30 * 24 * 60 * 60

export type PresenceAlertDeps = {
  online: (userId: string, deviceId: string) => Promise<boolean>
  getDevice: (userId: string, deviceId: string) => Promise<AgentDevice | null>
  memberIds: (teamId: string) => Promise<string[]>
  /** Notes the computer as announced offline; false when it already was, by any replica. */
  markOffline: (userId: string, deviceId: string) => Promise<boolean>
  /** Clears that note; true only for the call that cleared it. */
  clearOffline: (userId: string, deviceId: string) => Promise<boolean>
  notify: typeof notifyComputerChanged
  schedule: (work: () => void, delayMs: number) => void
}

/** Its owner, and in each team it is shared in, the members it is shared with while the owner is one. */
export async function alertRecipients(
  device: AgentDevice,
  memberIds: PresenceAlertDeps['memberIds'],
): Promise<string[]> {
  const owner = deviceOwner(device)
  const recipients = new Set([owner])

  for (const grant of device.access ?? []) {
    if (device.box && grant.teamId !== device.box.teamId) continue
    const members = await memberIds(grant.teamId)

    if (!device.box && !members.includes(owner)) continue
    const shared = grant.everyone ? members : [...grant.userIds, ...grant.managerIds]

    for (const id of shared) if (members.includes(id)) recipients.add(id)
  }

  return [...recipients]
}

async function announce(device: AgentDevice, online: boolean, deps: PresenceAlertDeps) {
  deps.notify(await alertRecipients(device, deps.memberIds), {
    deviceId: device.deviceId,
    online,
    title: online ? `${device.label} is back online` : `${device.label} is offline`,
    body: online
      ? 'Agents can run on it again.'
      : "Agents can't run on it until it reconnects to Nuphos.",
  })
}

/**
 * A tunnel opened or ended. Offline is announced once the computer has stayed away for the grace
 * period; back online only after that, so an ordinary start or a blip sends nothing.
 */
export async function presenceChanged(
  userId: string,
  deviceId: string,
  online: boolean,
  deps: PresenceAlertDeps = presenceAlertDeps,
): Promise<void> {
  if (online) {
    if (!(await deps.clearOffline(userId, deviceId))) return
    const device = await deps.getDevice(userId, deviceId)

    if (device) await announce(device, true, deps)

    return
  }
  deps.schedule(() => {
    void (async () => {
      if (await deps.online(userId, deviceId)) return
      const device = await deps.getDevice(userId, deviceId)

      if (device && (await deps.markOffline(userId, deviceId))) await announce(device, false, deps)
    })().catch(() => {})
  }, OFFLINE_GRACE_MS)
}

const markKey = (userId: string, deviceId: string) =>
  `agent:device:offline-announced:${userId}:${deviceId}`
const marks = new Set<string>() // Without Redis: one process, so its memory is enough.

export const presenceAlertDeps: PresenceAlertDeps = {
  online: isDevicePresent,
  getDevice: getAgentDevice,
  memberIds: async (teamId) => (await getTeamMembers(teamId)).map((member) => member.id),
  markOffline: async (userId, deviceId) => {
    const key = markKey(userId, deviceId)

    if (!redisEnabled()) return !marks.has(key) && Boolean(marks.add(key))

    return (await withRedis((c) => c.set(key, '1', 'EX', MARK_TTL_SEC, 'NX'))) === 'OK'
  },
  clearOffline: async (userId, deviceId) => {
    const key = markKey(userId, deviceId)

    if (!redisEnabled()) return marks.delete(key)

    return (await withRedis((c) => c.del(key))) === 1
  },
  notify: notifyComputerChanged,
  schedule: (work, delayMs) => {
    setTimeout(work, delayMs).unref()
  },
}
