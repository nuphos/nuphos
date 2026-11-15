import { callJson } from '../agent/http.ts'
import { logLocalTool, normalizeToolError } from '../agent/local-exec.ts'
import { deviceRegistrationAllowed } from '../api-endpoint.ts'

import { machineModel } from './device-identity-core.ts'
import { readDeviceIdentity, setDeviceLabel } from './device-identity.ts'
import { isDev } from './env.ts'

import type { DeviceIdentity } from './device-identity-core.ts'

// Local exec is available on every signed-in device while Desktop is open.
async function syncRegistration(identity: DeviceIdentity): Promise<void> {
  if (!deviceRegistrationAllowed(isDev)) return
  const machine = await machineModel()

  if (!deviceRegistrationAllowed(isDev)) return
  try {
    await callJson(
      'PUT',
      '/agent/devices',
      {
        deviceId: identity.deviceId,
        label: identity.label,
        platform: process.platform,
        ...(machine ? { model: machine } : {}),
        // Older backends still require this capability flag in registration.
        allowLocalExec: true,
      },
      10_000,
    )
  } catch (err) {
    logLocalTool('failed to sync device registration', { error: normalizeToolError(err) })
  }
}

export function syncDeviceRegistration(): Promise<void> {
  return syncRegistration(readDeviceIdentity())
}

export function getDeviceIdentity(): DeviceIdentity {
  return readDeviceIdentity()
}

// A rename is the person's choice, so it goes through PATCH: registration (PUT) only
// names a device the backend has never seen, and never overwrites a chosen label.
export async function updateDeviceLabel(label: string): Promise<DeviceIdentity> {
  const identity = setDeviceLabel(label)

  await callJson(
    'PATCH',
    `/agent/devices/${encodeURIComponent(identity.deviceId)}`,
    { label: identity.label },
    10_000,
  )

  return identity
}

const DEVICE_AUDIT_PAGE_SIZE = 20

export function listDeviceAudit(before?: string): Promise<unknown> {
  const { deviceId } = readDeviceIdentity()
  const query = new URLSearchParams({ limit: String(DEVICE_AUDIT_PAGE_SIZE) })

  if (before) query.set('before', before)

  return callJson(
    'GET',
    `/agent/devices/${encodeURIComponent(deviceId)}/audit?includeUnfinished=true&${query.toString()}`,
  )
}
