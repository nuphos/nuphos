import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import os from 'node:os'

export type DeviceIdentity = {
  deviceId: string
  label: string
  createdAt: string
}

type DeviceKind = 'desktop' | 'cli'

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
    return os.hostname() || 'This computer'
  } catch {
    return 'This computer'
  }
}

export const parseIoregPlatformUuid = (out: string): string | null =>
  /"IOPlatformUUID" = "([^"]+)"/u.exec(out)?.[1] ?? null

export const parseRegMachineGuid = (out: string): string | null =>
  /MachineGuid\s+REG_SZ\s+(\S+)/u.exec(out)?.[1] ?? null

/** The OS's own id for this machine, or null where none can be read. */
export function readMachineKey(platform: NodeJS.Platform = process.platform): string | null {
  const run = (cmd: string, args: string[]) =>
    execFileSync(cmd, args, {
      encoding: 'utf8',
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'ignore'],
    })

  try {
    if (platform === 'darwin')
      return parseIoregPlatformUuid(run('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice']))
    if (platform === 'win32') {
      return parseRegMachineGuid(
        run('reg', [
          'query',
          'HKLM\\SOFTWARE\\Microsoft\\Cryptography',
          '/v',
          'MachineGuid',
          '/reg:64',
        ]),
      )
    }
  } catch {
    return null
  }
  for (const file of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
    try {
      const value = readFileSync(file, 'utf8').trim()

      if (value) return value
    } catch {
      // try the next one
    }
  }

  return null
}

/**
 * One id per machine and client kind, so a reinstall, a new profile or a new
 * agent home registers into the same device instead of adding one. Only a new
 * identity takes it: an existing one keeps its id, which its selections and
 * local-agent conversations already name. Hashed so the hardware id never
 * leaves the machine; the Desktop and the CLI stay two devices because each
 * holds its own runtime tunnel.
 */
export function stableDeviceId(machineKey: string, kind: DeviceKind): string {
  const h = createHash('sha256').update(`nuphos-device-v1\0${kind}\0${machineKey}`).digest('hex')

  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

/**
 * The id this Desktop build runs as. A `bun run dev` build sits on the same
 * machine as the installed app, so the machine's id would let its runtime
 * tunnel supersede the installed app's; it keeps its profile's own id instead,
 * and a saved id that is the machine's is minted afresh.
 */
export function desktopDeviceId(
  saved: string | null,
  machineId: string | null,
  dev: boolean,
  mint: () => string,
): string {
  if (saved && !(dev && saved === machineId)) return saved
  if (machineId && !dev) return machineId

  return mint()
}
