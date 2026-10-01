import { callJson } from '../agent/http.ts'
import { logLocalTool, normalizeToolError } from '../agent/local-exec.ts'

import { readDeviceIdentity, setDeviceLabel } from './device-identity.ts'

import type { DeviceIdentity } from './device-identity-core.ts'

// Local exec is available on every signed-in device while Desktop is open.
async function syncRegistration(identity: DeviceIdentity): Promise<void> {
  try {
    await callJson(
      'PUT',
      '/agent/devices',
      {
        deviceId: identity.deviceId,
        label: identity.label,
        platform: process.platform,
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

export async function updateDeviceLabel(label: string): Promise<DeviceIdentity> {
  const identity = setDeviceLabel(label)

  await syncRegistration(identity)

  return identity
}

const DEVICE_AUDIT_PAGE_SIZE = 20

export function listDeviceAudit(before?: string): Promise<unknown> {
  const { deviceId } = readDeviceIdentity()
  const query = new URLSearchParams({ limit: String(DEVICE_AUDIT_PAGE_SIZE) })

  if (before) query.set('before', before)

  return callJson('GET', `/agent/devices/${encodeURIComponent(deviceId)}/audit?${query.toString()}`)
}

export async function setLocalAgentDefaults(runtimeId: string, defaults: unknown): Promise<void> {
  await callJson('PUT', `/agent/local-agents/${encodeURIComponent(runtimeId)}/defaults`, defaults)
}
