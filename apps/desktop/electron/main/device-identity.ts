import { randomUUID } from 'node:crypto'
import fsSync from 'node:fs'
import path from 'node:path'

import { app } from 'electron'

import { defaultDeviceLabel, parseDeviceIdentity } from './device-identity-core.ts'

import type { DeviceIdentity } from './device-identity-core.ts'

export type { DeviceIdentity } from './device-identity-core.ts'

const FILE_NAME = 'device-identity.json'

function filePath(): string {
  return path.join(app.getPath('userData'), FILE_NAME)
}

function freshIdentity(): DeviceIdentity {
  return {
    deviceId: randomUUID(),
    label: defaultDeviceLabel(),
    createdAt: new Date().toISOString(),
  }
}

let cached: DeviceIdentity | undefined

function persist(identity: DeviceIdentity): void {
  try {
    fsSync.writeFileSync(filePath(), JSON.stringify(identity), 'utf8')
  } catch {
    // Best-effort — a write failure just means the id is re-minted next launch.
  }
}

/** Reads (or mints and persists) this install's stable device identity. Cached
 *  after the first read for the life of the process. */
export function readDeviceIdentity(): DeviceIdentity {
  if (cached) return cached
  try {
    const raw = fsSync.readFileSync(filePath(), 'utf8')
    const parsed = parseDeviceIdentity(raw)

    if (parsed) {
      cached = parsed

      return cached
    }
  } catch {
    // No file yet, or unreadable — mint a fresh identity below.
  }
  cached = freshIdentity()
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
