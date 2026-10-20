import { randomUUID } from 'node:crypto'
import fsSync from 'node:fs'
import path from 'node:path'

import { app } from 'electron'

import {
  defaultDeviceLabel,
  desktopDeviceId,
  parseDeviceIdentity,
  readMachineKey,
  stableDeviceId,
} from './device-identity-core.ts'
import { isDev } from './env'

import type { DeviceIdentity } from './device-identity-core.ts'

export type { DeviceIdentity } from './device-identity-core.ts'

const FILE_NAME = 'device-identity.json'

function filePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME)
}

function stableId(): string | null {
  const key = readMachineKey()

  return key ? stableDeviceId(key, 'desktop') : null
}

let cached: DeviceIdentity | undefined

function persist(identity: DeviceIdentity): void {
  try {
    fsSync.writeFileSync(filePath(), JSON.stringify(identity), 'utf8')
  } catch {
    // Best-effort — a write failure just means the id is re-minted next launch.
  }
}

/** Reads (or mints and persists) this machine's Desktop device identity. Cached
 *  after the first read for the life of the process. */
export function readDeviceIdentity(): DeviceIdentity {
  if (cached) return cached
  let saved: DeviceIdentity | null = null

  try {
    saved = parseDeviceIdentity(fsSync.readFileSync(filePath(), 'utf8'))
  } catch {
    // No file yet, or unreadable — mint a fresh identity below.
  }
  const deviceId = desktopDeviceId(
    saved?.deviceId ?? null,
    !saved || isDev ? stableId() : null,
    isDev,
    randomUUID,
  )

  if (saved?.deviceId === deviceId) {
    cached = saved

    return cached
  }
  cached = {
    deviceId,
    label: saved?.label ?? defaultDeviceLabel(),
    createdAt: new Date().toISOString(),
  }
  persist(cached)

  return cached
}

export function setDeviceLabel(label: string): DeviceIdentity {
  const trimmed = label.trim()
  const current = readDeviceIdentity()
  const next: DeviceIdentity = { ...current, label: trimmed || current.label }

  cached = next
  persist(next)

  return next
}
