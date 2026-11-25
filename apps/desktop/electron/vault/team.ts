// A team's shared vault (nuphos/nuphos#5080), as this app's own vault: the same
// items, wrapped for the members' devices in the team vault, and a device joins
// it only when one already in it wraps every key for the key compared on screen.

import { call } from '../atlas/client.ts'

import { fingerprint, publicKeyFromPrivate } from './crypto.ts'
import { fail, loadDevice } from './device-store.ts'
import { base, enrolledKey, teamDevices, wrapEveryItem } from './vault.ts'

import type { TeamVaultStatus } from '../../src/types/vault'

/**
 * The team vault's devices: every enrolled device of the team's members, and
 * whether it is in the team vault. This app's print comes from its own key.
 */
export async function teamStatus(teamId: string): Promise<TeamVaultStatus> {
  const remote = await teamDevices(teamId)
  const mine = await loadDevice()

  return {
    thisDeviceId: mine?.deviceId ?? null,
    devices: remote.map((d) => ({
      id: d.id,
      name: d.name,
      userName: d.userName,
      shared: d.shared,
      fingerprint: fingerprint(
        d.id === mine?.deviceId
          ? publicKeyFromPrivate(Buffer.from(mine.privateKey, 'base64'))
          : Buffer.from(d.publicKey, 'base64'),
      ),
    })),
  }
}

/**
 * Adds a member's device to the team vault, wrapping every team item's key for
 * it. The first device of a new team vault is this one, with nothing to wrap.
 */
export async function addTeamDevice(
  teamId: string,
  deviceId: string,
  confirmed: string,
): Promise<void> {
  const mine = await enrolledKey()
  const target = (await teamDevices(teamId)).find((d) => d.id === deviceId)

  if (!target || target.shared) throw fail('That device can no longer be added.')
  await call(
    'POST',
    `${base(teamId)}/devices/${encodeURIComponent(deviceId)}/add`,
    { keys: await wrapEveryItem(mine, target.publicKey, confirmed, teamId) },
    { retry: false },
  )
}

/** Items are not re-keyed: whatever that device already read stays with it. Rotate it. */
export async function removeTeamDevice(teamId: string, deviceId: string): Promise<void> {
  await call('DELETE', `${base(teamId)}/devices/${encodeURIComponent(deviceId)}`, undefined, {
    retry: false,
  })
}
