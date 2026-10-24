// What `nuphos agent --join <token>` leaves on a computer: its own credential,
// which opens only its runtime tunnel and is revoked on its own, so a server
// never has to hold a person's session.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export type DeviceCredential = {
  apiUrl: string
  userId: string
  deviceId: string
  credential: string
  /** The backend joined this computer as a Box; a person's computer never has it. */
  box?: true
}

/** Only a Box is Nuphos's whole computer, so only there may its default agents' logins go. */
export const ownsMachine = (credential: DeviceCredential | null): boolean =>
  credential?.box === true

export type JoinRequest = { token: string; label: string; platform: string }

export const tunnelUrlFor = (apiUrl: string, deviceId: string, reclaim = false) =>
  `${apiUrl}/agent/devices/${encodeURIComponent(deviceId)}/runtime-tunnel${reclaim ? '?reclaim=1' : ''}`

/** A service manager treats this exit as final, so a revoked computer does not restart. */
export const EXIT_REVOKED = 78

export function deviceCredentialStore(dataDir: string) {
  const file = path.join(dataDir, 'device-credential.json')

  return {
    /** Only the credential for this backend. */
    read(apiUrl: string): DeviceCredential | null {
      try {
        const saved = JSON.parse(readFileSync(file, 'utf8')) as DeviceCredential

        return saved.apiUrl === apiUrl ? saved : null
      } catch {
        return null
      }
    },
    /** Whole or absent, never half-written: a crash mid-write must not leave a broken file. */
    write(credential: DeviceCredential): void {
      const partial = `${file}.${String(process.pid)}.tmp`

      mkdirSync(dataDir, { recursive: true, mode: 0o700 })
      writeFileSync(partial, JSON.stringify(credential), { mode: 0o600 })
      renameSync(partial, file)
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
 * Whether the backend refused the credential (401). A computer revoked while it
 * was off would otherwise redial its tunnel forever. Anything else, a network
 * error or a missing route, is not a revocation.
 */
export async function credentialRevoked(
  tunnelUrl: string,
  credential: string,
  headers: Record<string, string>,
): Promise<boolean> {
  const response = await fetch(tunnelUrl, {
    headers: { ...headers, authorization: `Bearer ${credential}` },
  }).catch(() => null)

  return response?.status === 401
}

/** Exits for good: the saved credential stays, so a restart fails the same way. */
export function exitRevoked(): never {
  console.error(
    'This computer was disconnected from Nuphos. Join it again with a new token: `nuphos agent --join -`.',
  )
  process.exit(EXIT_REVOKED)
}

/**
 * This computer's credential, and with it the device id the backend chose for
 * it: the one an earlier join left while the backend
 * still accepts it, which wins over a token passed again so a service can keep
 * it in its environment, or a new one from `joinToken`. Null means the host
 * runs on the signed-in session instead.
 */
export async function deviceCredentialFor(options: {
  dataDir: string
  apiUrl: string
  label: string
  joinToken?: string
  headers: Record<string, string>
}): Promise<DeviceCredential | null> {
  const store = deviceCredentialStore(options.dataDir)
  const saved = store.read(options.apiUrl)
  const revoked =
    saved &&
    (await credentialRevoked(
      tunnelUrlFor(options.apiUrl, saved.deviceId),
      saved.credential,
      options.headers,
    ))

  if (saved && !revoked) return saved
  if (!options.joinToken) {
    if (revoked) exitRevoked()

    return null
  }
  const joined = await joinDevice(
    options.apiUrl,
    { token: options.joinToken, label: options.label, platform: process.platform },
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
