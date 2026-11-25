// Vault for Desktop, as the CLI's `nuphos vault` (`apps/cli/src/vault.rs`).
// This app enrolls as a device of its own, and its private key never leaves
// the main process: the renderer gets fingerprints, names and the one value it
// asked for.

import { randomBytes } from 'node:crypto'
import os from 'node:os'

import { call } from '../atlas/client.ts'

import {
  MAX_VALUE,
  fingerprint,
  generateDeviceKey,
  open,
  publicKeyFromPrivate,
  seal,
  unwrap,
  validName,
  wrap,
} from './crypto.ts'
import { fail, forgetDevice, loadDevice, saveDevice } from './device-store.ts'

import type { VaultDevice, VaultItemSummary, VaultStatus } from '../../src/types/vault'

type RemoteDevice = {
  id: string
  name: string
  publicKey: string
  state: 'pending' | 'enrolled'
}
type TeamDevice = Omit<RemoteDevice, 'state'> & { userName: string; shared: boolean }

/**
 * Where a vault's items live: the person's own, or a team's shared vault
 * (nuphos/nuphos#5080), whose items are wrapped for the devices in it instead.
 */
export const base = (teamId?: string) =>
  teamId ? `/vault/teams/${encodeURIComponent(teamId)}` : '/vault'

const devices = async () =>
  (await call<{ devices: RemoteDevice[] }>('GET', '/vault/devices')).devices

export const teamDevices = async (teamId: string) =>
  (await call<{ devices: TeamDevice[] }>('GET', `${base(teamId)}/devices`)).devices
const item = async (name: string, teamId?: string) =>
  (
    await call<{ item: { ciphertext: string; keys: { deviceId: string; wrapped: string }[] } }>(
      'GET',
      `${base(teamId)}/items/${name}`,
    )
  ).item

function checkName(name: string): string {
  if (!validName(name))
    throw fail(
      'A name is up to 128 letters, digits, ".", "_" or "-", starting with a letter or digit.',
    )

  return name
}

/** This device as the vault knows it, or null when it is not in the vault. */
async function thisDevice(remote: RemoteDevice[]) {
  const device = await loadDevice()
  const known = remote.find((d) => d.id === device?.deviceId)

  return device && known
    ? { ...device, privateKey: Buffer.from(device.privateKey, 'base64'), state: known.state }
    : null
}

export async function enrolledKey() {
  const mine = await thisDevice(await devices())

  if (mine?.state !== 'enrolled')
    throw fail('Approve this device from a device already in your vault first.')

  return mine
}

async function itemKey(
  name: string,
  mine: { deviceId: string; privateKey: Buffer },
  teamId?: string,
) {
  const found = await item(name, teamId)
  const wrapped = found.keys.find((k) => k.deviceId === mine.deviceId)

  if (!wrapped) throw fail(`${name} has no key for this device.`)

  return { itemKey: unwrap(wrapped.wrapped, name, mine.privateKey), ciphertext: found.ciphertext }
}

export async function status(): Promise<VaultStatus> {
  const remote = await devices()
  const mine = await thisDevice(remote)

  return {
    thisDeviceId: mine?.deviceId ?? null,
    devices: remote.map((d): VaultDevice => ({
      id: d.id,
      name: d.name,
      state: d.state,
      // This device's print comes from the key it holds, never from what
      // the backend returned, so a swapped key cannot show a matching one.
      fingerprint: fingerprint(
        d.id === mine?.deviceId
          ? publicKeyFromPrivate(mine.privateKey)
          : Buffer.from(d.publicKey, 'base64'),
      ),
    })),
  }
}

/**
 * Adds a computer this person manages to their vault (nuphos/nuphos#5016). It makes
 * its own key and waits for approval. Its key and fingerprint come through Nuphos, so
 * the most sensitive computers enroll over the person's own SSH instead.
 */
export async function addComputer(deviceId: string, teamId: string): Promise<VaultDevice> {
  const { device } = await call<{ device: RemoteDevice }>(
    'POST',
    `/teams/${encodeURIComponent(teamId)}/computers/${encodeURIComponent(deviceId)}/vault`,
    undefined,
    { retry: false },
  )

  return {
    id: device.id,
    name: device.name,
    state: device.state,
    fingerprint: fingerprint(Buffer.from(device.publicKey, 'base64')),
  }
}

let enrolling: Promise<VaultStatus> | null = null

/** Adds this device. The first one is trusted on first use; a later one waits for approval. */
export function enroll(): Promise<VaultStatus> {
  // A second click while the first is out joins it instead of adding a second device.
  enrolling ??= addThisDevice().finally(() => {
    enrolling = null
  })

  return enrolling
}

async function addThisDevice(): Promise<VaultStatus> {
  if (!(await thisDevice(await devices()))) {
    // Removed from the vault elsewhere: start over with a new key.
    await forgetDevice()
    const key = generateDeviceKey()
    const { device } = await call<{ device: RemoteDevice }>(
      'POST',
      '/vault/devices',
      { name: `${os.hostname()} (Desktop)`, publicKey: key.publicKey.toString('base64') },
      { retry: false },
    )

    // A device whose key was never kept could approve nobody: take it back out.
    await saveDevice({
      deviceId: device.id,
      privateKey: key.privateKey.toString('base64'),
    }).catch(async (err: unknown) => {
      await removeDevice(device.id).catch(() => null)
      throw err
    })
  }

  return status()
}

/**
 * Wraps every item's key for a pending device. Only to the key whose
 * fingerprint the person compared: one swapped in since then is refused.
 */
export async function approve(deviceId: string, confirmed: string): Promise<void> {
  const mine = await enrolledKey()
  const target = (await devices()).find((d) => d.id === deviceId)

  if (target?.state !== 'pending') throw fail('That device is no longer waiting for approval.')
  await call(
    'POST',
    `/vault/devices/${encodeURIComponent(deviceId)}/approve`,
    { keys: await wrapEveryItem(mine, target.publicKey, confirmed) },
    { retry: false },
  )
}

/** Every item's key, wrapped for the key whose fingerprint the person compared. */
export async function wrapEveryItem(
  mine: { deviceId: string; privateKey: Buffer },
  publicKey: string,
  confirmed: string,
  teamId?: string,
) {
  const to = Buffer.from(publicKey, 'base64')

  if (fingerprint(to) !== confirmed)
    throw fail('That device’s key changed since you compared it. Nothing was approved.')
  const keys = []

  for (const { name } of await items(teamId))
    keys.push({
      name,
      wrapped: wrap((await itemKey(checkName(name), mine, teamId)).itemKey, name, to),
    })

  return keys
}

/** Items are not re-keyed: a removed device that kept a copy of a key can still open that copy. */
export async function removeDevice(deviceId: string): Promise<void> {
  await call('DELETE', `/vault/devices/${encodeURIComponent(deviceId)}`, undefined, {
    retry: false,
  })
  if ((await loadDevice())?.deviceId === deviceId) await forgetDevice()
}

export async function items(teamId?: string): Promise<VaultItemSummary[]> {
  return (await call<{ items: VaultItemSummary[] }>('GET', `${base(teamId)}/items`)).items
}

export async function getItem(name: string, teamId?: string): Promise<string> {
  const { itemKey: key, ciphertext } = await itemKey(checkName(name), await enrolledKey(), teamId)

  return open(key, name, ciphertext).toString('utf-8')
}

export async function setItem(name: string, value: string, teamId?: string): Promise<void> {
  checkName(name)
  await enrolledKey()
  const plain = Buffer.from(value, 'utf-8')

  if (plain.length > MAX_VALUE)
    throw fail(`A vault item holds at most ${String(MAX_VALUE / 1024)} KiB.`)
  const key = randomBytes(32)
  // A person's item is wrapped for their enrolled devices, a team's for the team vault's.
  const readers = teamId
    ? (await teamDevices(teamId)).filter((d) => d.shared)
    : (await devices()).filter((d) => d.state === 'enrolled')
  const keys = readers.map((d) => ({
    deviceId: d.id,
    wrapped: wrap(key, name, Buffer.from(d.publicKey, 'base64')),
  }))

  await call(
    'PUT',
    `${base(teamId)}/items/${name}`,
    { ciphertext: seal(key, name, plain), keys },
    { retry: false },
  )
}

export async function deleteItem(name: string, teamId?: string): Promise<void> {
  await call('DELETE', `${base(teamId)}/items/${checkName(name)}`, undefined, { retry: false })
}
