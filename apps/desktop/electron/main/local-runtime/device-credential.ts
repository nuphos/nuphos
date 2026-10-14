// What `nuphos agent --join <token>` leaves on a computer: its own credential,
// which opens only its runtime tunnel and is revoked on its own, so a server
// never has to hold a person's session.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export type DeviceCredential = {
  apiUrl: string
  userId: string
  deviceId: string
  credential: string
}

export type JoinRequest = { token: string; deviceId: string; label: string; platform: string }

/** A service manager treats this exit as final, so a revoked computer does not restart. */
export const EXIT_REVOKED = 78

export function deviceCredentialStore(dataDir: string) {
  const file = path.join(dataDir, 'device-credential.json')

  return {
    /** Only the credential for this backend and this computer. */
    read(apiUrl: string, deviceId: string): DeviceCredential | null {
      try {
        const saved = JSON.parse(readFileSync(file, 'utf8')) as DeviceCredential

        return saved.apiUrl === apiUrl && saved.deviceId === deviceId ? saved : null
      } catch {
        return null
      }
    },
    write(credential: DeviceCredential): void {
      mkdirSync(dataDir, { recursive: true })
      writeFileSync(file, JSON.stringify(credential), { mode: 0o600 })
    },
  }
}

/** Uses the join token once; the HTTP status when the backend refuses it. */
export async function joinDevice(
  apiUrl: string,
  request: JoinRequest,
  headers: Record<string, string>,
): Promise<DeviceCredential | number> {
  const response = await fetch(`${apiUrl}/auth/devices/join`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify(request),
  })

  if (!response.ok) return response.status

  return { apiUrl, ...((await response.json()) as Omit<DeviceCredential, 'apiUrl'>) }
}

/**
 * Whether the backend no longer accepts the credential. A computer revoked
 * while it was off would otherwise redial its tunnel forever; a network error
 * is not a revocation.
 */
export async function credentialRevoked(
  tunnelUrl: string,
  credential: string,
  headers: Record<string, string>,
): Promise<boolean> {
  const response = await fetch(tunnelUrl, {
    headers: { ...headers, authorization: `Bearer ${credential}` },
  }).catch(() => null)

  return response?.status === 401 || response?.status === 404
}

/** Exits for good: the saved credential stays, so a restart fails the same way. */
export function exitRevoked(): never {
  console.error(
    'This computer was disconnected from Nuphos. Join it again with a new token: `nuphos agent --join <token>`.',
  )
  process.exit(EXIT_REVOKED)
}

/**
 * This computer's credential: the one an earlier join left while the backend
 * still accepts it, which wins over a token passed again so a service can keep
 * it in its environment, or a new one from `joinToken`. Null means the host
 * runs on the signed-in session instead.
 */
export async function deviceCredentialFor(options: {
  dataDir: string
  apiUrl: string
  tunnelUrl: string
  device: { deviceId: string; label: string }
  joinToken?: string
  headers: Record<string, string>
}): Promise<DeviceCredential | null> {
  const store = deviceCredentialStore(options.dataDir)
  const saved = store.read(options.apiUrl, options.device.deviceId)
  const revoked =
    saved && (await credentialRevoked(options.tunnelUrl, saved.credential, options.headers))

  if (saved && !revoked) return saved
  if (!options.joinToken) {
    if (revoked) exitRevoked()

    return null
  }
  const joined = await joinDevice(
    options.apiUrl,
    { token: options.joinToken, ...options.device, platform: process.platform },
    options.headers,
  )

  if (typeof joined === 'number') {
    if (joined !== 401) throw new Error(`Could not join Nuphos (HTTP ${String(joined)}).`)
    // A used token left in a service's environment must not restart forever either.
    console.error('This join token is invalid, used or expired; create a new one.')
    process.exit(EXIT_REVOKED)
  }
  store.write(joined)

  return joined
}
