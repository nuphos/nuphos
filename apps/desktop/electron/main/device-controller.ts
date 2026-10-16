import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { callJson } from '../agent/http.ts'
import { logLocalTool, normalizeToolError } from '../agent/local-exec.ts'

import { readDeviceIdentity, setDeviceLabel } from './device-identity.ts'

import type { DeviceIdentity } from './device-identity-core.ts'

let model: Promise<string | undefined> | undefined

/** "MacBook Pro", "Mac mini"…: what the Boxes list draws this computer as. Read once, off the main thread. */
function machineModel(): Promise<string | undefined> {
  model ??=
    process.platform === 'darwin'
      ? promisify(execFile)('/usr/sbin/system_profiler', ['SPHardwareDataType'], {
          timeout: 5_000,
        }).then(
          ({ stdout }) => /Model Name:\s*(.+)/u.exec(stdout)?.[1]?.trim() || undefined,
          () => undefined,
        )
      : Promise.resolve(undefined)

  return model
}

// Local exec is available on every signed-in device while Desktop is open.
async function syncRegistration(identity: DeviceIdentity): Promise<void> {
  const machine = await machineModel()

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

  return callJson('GET', `/agent/devices/${encodeURIComponent(deviceId)}/audit?${query.toString()}`)
}
