import { logEvent } from '@/lib/observability'

import type { PushDevice } from './devices'
import type { FcmRequest, FcmResponse, sendFcmBadge } from './fcm'

export async function sendAndroidBadge(
  devices: PushDevice[],
  project: string,
  userId: string,
  badge: number,
  send: typeof sendFcmBadge,
  remove: (token: string) => Promise<void>,
): Promise<void> {
  await Promise.all(
    devices
      .filter((device) => device.platform === 'android' && device.projectId === project)
      .map(async (device) => {
        try {
          const response = await send(project, device.token, userId, badge)

          if (response.deadToken) await remove(device.token)
          else if (response.status !== 200)
            logEvent('warn', 'push.fcm.rejected', { status: response.status })
        } catch {
          logEvent('warn', 'push.fcm.send_failed', { kind: 'badge' })
        }
      }),
  )
}

export async function sendAndroidAlert(
  devices: PushDevice[],
  project: string,
  request: Omit<FcmRequest, 'token'>,
  send: (projectId: string, request: FcmRequest) => Promise<FcmResponse>,
  remove: (token: string) => Promise<void>,
): Promise<void> {
  await Promise.all(
    devices
      .filter((device) => device.platform === 'android')
      .map(async (device) => {
        try {
          const response = await send(project, { ...request, token: device.token })

          if (response.deadToken) await remove(device.token)
          else if (response.status !== 200)
            logEvent('warn', 'push.fcm.rejected', { status: response.status })
        } catch {
          // Authentication/transport errors can contain credentials: never log raw provider errors.
          logEvent('warn', 'push.fcm.send_failed', { session_id: request.sessionId })
        }
      }),
  )
}
