// Vault for Desktop, as the CLI's `nuphos vault` (`apps/cli/src/vault.rs`).
// This app enrolls as a device of its own, and its private key never leaves
// the main process: the renderer gets fingerprints, names and the one value it
// asked for.

import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { signedIn } from '../account-request.ts'
import { call } from '../atlas/client.ts'
import { buildAtlasError } from '../atlas/error.ts'
import { keychainFor, secureStorageEnabled } from '../auth/token-store.ts'
import { readYaml, writeYaml } from '../auth/yaml-file.ts'
import { DESKTOP_CONFIG_PATH } from '../cli-config-path.ts'

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

import type { VaultDevice, VaultItemSummary, VaultStatus } from '../../src/types/vault'

type RemoteDevice = {
  id: string
  name: string
  publicKey: string
  state: 'pending' | 'enrolled'
  computer: boolean
}
type Item = { ciphertext: string; keys: { deviceId: string; wrapped: string }[] }
type Device = { deviceId: string; privateKey: string }

/** This app's own item: the CLI's is `ai.nuphos.vault.device`, so neither asks for the other's. */
const keychain = keychainFor('ai.nuphos.desktop.vault')

/** A failure worth showing as written: the toast shows only errors with a code. */
const fail = (message: string) => buildAtlasError(message, 'vault_desktop')

async function account() {
  const { api, userId } = await signedIn()

  if (!userId) throw fail('Sign in again to use the vault.')

  return {
    item: `${userId}@${api}`,
    file: path.join(path.dirname(DESKTOP_CONFIG_PATH), `vault-${userId}.yaml`),
  }
}

// Where the packaged app keeps the session token, it keeps the key; a dev
// build keeps it in a file only this user can read.
async function loadDevice(): Promise<Device | null> {
  const { item, file } = await account()

  if (secureStorageEnabled()) {
    const stored = await keychain.get(item)

    return stored ? (JSON.parse(stored) as Device) : null
  }
  const stored = await readYaml<Partial<Device>>(file)

  return stored?.deviceId && stored.privateKey ? (stored as Device) : null
}

async function saveDevice(device: Device): Promise<void> {
  const { item, file } = await account()

  if (secureStorageEnabled()) await keychain.set(item, JSON.stringify(device))
  else await writeYaml(file, device)
}

async function forgetDevice(): Promise<void> {
  const { item, file } = await account()

  if (secureStorageEnabled()) await keychain.delete(item).catch(() => null)
  else await fs.rm(file, { force: true })
}

const devices = async () =>
  (await call<{ devices: RemoteDevice[] }>('GET', '/vault/devices')).devices
const item = async (name: string) =>
  (await call<{ item: Item }>('GET', `/vault/items/${name}`)).item

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

async function enrolledKey() {
  const mine = await thisDevice(await devices())

  if (mine?.state !== 'enrolled')
    throw fail('Approve this device from a device already in your vault first.')

  return mine
}

function itemKey(name: string, found: Item, mine: { deviceId: string; privateKey: Buffer }) {
  const wrapped = found.keys.find((k) => k.deviceId === mine.deviceId)

  if (!wrapped) throw fail(`${name} is not shared with this device.`)

  return unwrap(wrapped.wrapped, name, mine.privateKey)
}

/** Wraps `key` for each of `deviceIds` that is enrolled, reusing the wraps `kept` has. */
async function wrapFor(name: string, key: () => Buffer, deviceIds: string[], kept: Item['keys']) {
  const fresh = (d: RemoteDevice) => wrap(key(), name, Buffer.from(d.publicKey, 'base64'))

  return (await devices())
    .filter((d) => d.state === 'enrolled' && deviceIds.includes(d.id))
    .map((d) => kept.find((k) => k.deviceId === d.id) ?? { deviceId: d.id, wrapped: fresh(d) })
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
      computer: d.computer,
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
    computer: device.computer,
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
 * Wraps for a pending device the key of every item this device can open; for a computer,
 * none: it gets items shared with it one by one (nuphos/nuphos#5088). Only to the key
 * whose fingerprint the person compared: one swapped in since then is refused.
 */
export async function approve(deviceId: string, confirmed: string): Promise<void> {
  const mine = await enrolledKey()
  const target = (await devices()).find((d) => d.id === deviceId)

  if (target?.state !== 'pending') throw fail('That device is no longer waiting for approval.')
  const to = Buffer.from(target.publicKey, 'base64')

  if (fingerprint(to) !== confirmed)
    throw fail('That device’s key changed since you compared it. Nothing was approved.')
  const keys = []

  for (const { name, deviceIds } of target.computer ? [] : await items())
    if (deviceIds.includes(mine.deviceId))
      keys.push({ name, wrapped: wrap(itemKey(checkName(name), await item(name), mine), name, to) })
  await call(
    'POST',
    `/vault/devices/${encodeURIComponent(deviceId)}/approve`,
    { keys },
    { retry: false },
  )
}

/** Items are not re-keyed: a removed device that kept a copy of a key can still open that copy. */
export async function removeDevice(deviceId: string): Promise<void> {
  await call('DELETE', `/vault/devices/${encodeURIComponent(deviceId)}`, undefined, {
    retry: false,
  })
  if ((await loadDevice())?.deviceId === deviceId) await forgetDevice()
}

export async function items(): Promise<VaultItemSummary[]> {
  return (await call<{ items: VaultItemSummary[] }>('GET', '/vault/items')).items
}

export async function getItem(name: string): Promise<string> {
  const mine = await enrolledKey()
  const found = await item(checkName(name))

  return open(itemKey(name, found, mine), name, found.ciphertext).toString('utf-8')
}

/** Saves a value under a new key for `ids`, also how one is rotated; `seen` as in `putItem`. */
export async function setItem(
  name: string,
  value: string,
  ids: string[],
  seen: string | null,
): Promise<void> {
  checkName(name)
  await enrolledKey()
  const plain = Buffer.from(value, 'utf-8')

  if (plain.length > MAX_VALUE)
    throw fail(`A vault item holds at most ${String(MAX_VALUE / 1024)} KiB.`)
  const key = randomBytes(32)

  await putItem(name, seal(key, name, plain), await wrapFor(name, () => key, ids, []), seen)
}

/** `seen` is the item's `updatedAt` as last read, null for a new one: a changed item is refused. */
const putItem = (name: string, ciphertext: string, keys: Item['keys'], seen: string | null) =>
  call('PUT', `/vault/items/${name}`, { ciphertext, keys, updatedAt: seen }, { retry: false })

/** Shares an item with exactly `ids`; one left out keeps what it read until `setItem`. */
export async function shareItem(name: string, ids: string[], seen: string): Promise<void> {
  const mine = await enrolledKey()
  const found = await item(checkName(name))
  const keys = await wrapFor(name, () => itemKey(name, found, mine), ids, found.keys)

  await putItem(name, found.ciphertext, keys, seen)
}

export async function deleteItem(name: string): Promise<void> {
  await call('DELETE', `/vault/items/${checkName(name)}`, undefined, { retry: false })
}
