import { logError, logEvent } from '@/lib/observability'

import { createPushAdmitter } from './admit'
import { apnsCredentials, sendApns } from './apns'
import { computerSubscriptions } from './computer-subscriptions'
import { pushDeviceStore } from './devices'
import { fcmProjectId, sendFcmComputerAlert } from './fcm'
import { sendIos } from './ios'

import type { PushDeviceStore } from './devices'
import type { IosSender } from './ios'

export type ComputerChange = { deviceId: string; online: boolean; title: string; body: string }

export type ComputerAlertDeps = IosSender & {
  devices: PushDeviceStore
  subscribed: (userId: string, deviceId: string) => Promise<boolean>
  now: () => number
  fcmProject?: () => string | null
  sendFcm?: typeof sendFcmComputerAlert
}

const defaults: ComputerAlertDeps = {
  credentials: apnsCredentials,
  send: sendApns,
  devices: pushDeviceStore,
  subscribed: (userId, deviceId) => computerSubscriptions.has(userId, deviceId),
  now: Date.now,
  fcmProject: fcmProjectId,
  sendFcm: sendFcmComputerAlert,
}

/** Only explicitly subscribed people hear about a computer; tapping opens the app. */
export function createComputerAlerts(deps: ComputerAlertDeps = defaults) {
  const { admit } = createPushAdmitter(deps.now)

  return async (userId: string, change: ComputerChange): Promise<void> => {
    const hasApns = Boolean(deps.credentials())
    const project = deps.fcmProject?.()
    const sendFcm = deps.sendFcm

    if (!hasApns && (!project || !sendFcm)) return
    if (!(await deps.subscribed(userId, change.deviceId))) return

    const devices = await deps.devices.listForUser(userId)
    const ios = hasApns ? devices.filter((device) => device.platform === 'ios') : []
    const android =
      project && sendFcm
        ? devices.filter((device) => device.platform === 'android' && device.projectId === project)
        : []

    if (
      ios.length + android.length === 0 ||
      !admit(userId, `computer:${change.deviceId}:${change.online ? 'on' : 'off'}`)
    )
      return

    const collapseId = `computer:${change.deviceId}`
    const iosDelivery = sendIos(
      deps,
      ios,
      {
        aps: { alert: { title: change.title, body: change.body }, sound: 'default' },
        accountId: userId,
      },
      collapseId,
    )
    const androidDelivery =
      project && sendFcm
        ? android.map(async (device) => {
            try {
              const result = await sendFcm(project, device.token, userId, change)

              if (result.deadToken) await deps.devices.removeToken(device.token)
              else if (result.status !== 200)
                logEvent('warn', 'push.fcm.rejected', { status: result.status })
            } catch (error) {
              logError('push.fcm.send_failed', error, { kind: 'computer' })
            }
          })
        : []

    await Promise.all([iosDelivery, ...androidDelivery])
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
