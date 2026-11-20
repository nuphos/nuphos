import { logError } from '@/lib/observability'

import { createPushAdmitter } from './admit'
import { apnsCredentials, sendApns } from './apns'
import { pushDeviceStore } from './devices'
import { fcmProjectId, sendFcmComputerAlert } from './fcm'
import { sendIos } from './ios'

import type { PushDeviceStore } from './devices'
import type { IosSender } from './ios'

export type ComputerChange = { deviceId: string; online: boolean; title: string; body: string }

export type ComputerAlertDeps = IosSender & {
  devices: PushDeviceStore
  now: () => number
  fcmProject?: () => string | null
  sendFcm?: typeof sendFcmComputerAlert
}

const defaults: ComputerAlertDeps = {
  credentials: apnsCredentials,
  send: sendApns,
  devices: pushDeviceStore,
  now: Date.now,
  fcmProject: fcmProjectId,
  sendFcm: sendFcmComputerAlert,
}

/** Computer alerts open the app without routing to a conversation. */
export function createComputerAlerts(deps: ComputerAlertDeps = defaults) {
  const { admit } = createPushAdmitter(deps.now)

  return async (userId: string, change: ComputerChange): Promise<void> => {
    const hasApns = Boolean(deps.credentials())
    const project = deps.fcmProject?.()
    const sendFcm = deps.sendFcm

    if (!hasApns && (!project || !sendFcm)) return
    const devices = await deps.devices.listForUser(userId)
    const ios = hasApns
      ? devices.filter((d) => d.platform === 'ios' && d.computerAlerts !== false)
      : []
    const android =
      project && sendFcm
        ? devices.filter(
            (d) => d.platform === 'android' && d.projectId === project && d.computerAlerts === true,
          )
        : []

    if (
      ios.length + android.length === 0 ||
      !admit(userId, `computer:${change.deviceId}:${change.online ? 'on' : 'off'}`)
    )
      return
    if (project && sendFcm) {
      await Promise.all(
        android.map(async (device) => {
          try {
            const result = await sendFcm(project, device.token, userId, change)

            if (result.deadToken) await deps.devices.removeToken(device.token)
          } catch {
            logError('push.computer_fcm_send_failed', new Error('FCM computer alert failed'))
          }
        }),
      )
    }
    // Back online replaces the offline alert still on the phone.
    await sendIos(
      deps,
      ios,
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
