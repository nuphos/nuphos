import os from 'node:os'

export type DeviceIdentity = {
  deviceId: string
  label: string
  createdAt: string
}

export function parseDeviceIdentity(raw: string): DeviceIdentity | null {
  try {
    const parsed = JSON.parse(raw) as Partial<DeviceIdentity>

    if (
      typeof parsed.deviceId === 'string' &&
      parsed.deviceId.length > 0 &&
      typeof parsed.label === 'string' &&
      parsed.label.length > 0 &&
      typeof parsed.createdAt === 'string'
    ) {
      return {
        deviceId: parsed.deviceId,
        label: parsed.label,
        createdAt: parsed.createdAt,
      }
    }
  } catch {
    // fall through to null
  }

  return null
}

export function defaultDeviceLabel(): string {
  try {
    return os.hostname() || 'This device'
  } catch {
    return 'This device'
  }
}
