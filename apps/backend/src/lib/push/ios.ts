import { logError, logEvent } from '@/lib/observability'

import { isDeadToken } from './apns'

import type { ApnsCredentials, ApnsRequest, ApnsResponse } from './apns'
import type { PushDevice, PushDeviceStore } from './devices'

export type IosSender = {
  credentials: () => ApnsCredentials | null
  send: (credentials: ApnsCredentials, request: ApnsRequest) => Promise<ApnsResponse>
  devices: Pick<PushDeviceStore, 'removeToken'>
}

/** One APNs payload to each iOS device; a token APNs calls dead is forgotten. */
export async function sendIos(
  deps: IosSender,
  devices: PushDevice[],
  payload: Record<string, unknown>,
  collapseId: string,
): Promise<void> {
  const credentials = deps.credentials()

  if (!credentials) return
  await Promise.all(
    devices
      .filter((device) => device.platform === 'ios')
      .map(async (device) => {
        try {
          const response = await deps.send(credentials, {
            deviceToken: device.token,
            environment: device.environment,
            payload,
            collapseId,
          })

          if (isDeadToken(response)) {
            await deps.devices.removeToken(device.token)
          } else if (response.status !== 200) {
            logEvent('warn', 'push.apns.rejected', {
              status: response.status,
              reason: response.reason ?? null,
            })
          }
        } catch (error) {
          logError('push.apns.send_failed', error, { collapse_id: collapseId })
        }
      }),
  )
}
