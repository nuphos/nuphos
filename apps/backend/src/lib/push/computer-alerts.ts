import { logError } from '@/lib/observability'

import { createPushAdmitter } from './admit'
import { apnsCredentials, sendApns } from './apns'
import { pushDeviceStore } from './devices'
import { sendIos } from './ios'

import type { PushDeviceStore } from './devices'
import type { IosSender } from './ios'

export type ComputerChange = { deviceId: string; online: boolean; title: string; body: string }

export type ComputerAlertDeps = IosSender & { devices: PushDeviceStore; now: () => number }

const defaults: ComputerAlertDeps = {
  credentials: apnsCredentials,
  send: sendApns,
  devices: pushDeviceStore,
  now: Date.now,
}

/** One alert per person's iPhones that did not turn these off; with no conversation, it opens the app. */
export function createComputerAlerts(deps: ComputerAlertDeps = defaults) {
  const { admit } = createPushAdmitter(deps.now)

  return async (userId: string, change: ComputerChange): Promise<void> => {
    if (!deps.credentials()) return
    const devices = (await deps.devices.listForUser(userId)).filter(
      (device) => device.platform === 'ios' && device.computerAlerts !== false,
    )

    if (devices.length === 0 || !admit(userId, `computer:${change.deviceId}:${change.online ? 'on' : 'off'}`))
      return
    // Back online replaces the offline alert still on the phone.
    await sendIos(
      deps,
      devices,
      {
        aps: { alert: { title: change.title, body: change.body }, sound: 'default' },
        accountId: userId,
      },
      `computer:${change.deviceId}`,
    )
  }
}

let alert: ReturnType<typeof createComputerAlerts> | null = null

export function notifyComputerChanged(userIds: string[], change: ComputerChange): void {
  alert ??= createComputerAlerts()
  for (const userId of userIds)
    void alert(userId, change).catch((error: unknown) => {
      logError('push.computer_changed_failed', error)
    })
}
