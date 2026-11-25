// Nuphos Vault: a user's secrets, encrypted on their own devices. The backend
// keeps device public keys, item ciphertext and each item's key wrapped for
// every enrolled device; it never sees a private key or a plaintext. What it
// does enforce is that every item stays readable by every enrolled device.
import { randomUUID } from 'node:crypto'

import { db } from '@/lib/db'
import { AppError } from '@/lib/errors'
import { exclusive } from '@/lib/vault-lock'

import type { Collection } from 'mongodb'

export const MAX_DEVICES = 50
export const MAX_ITEMS = 1000

export type VaultDeviceState = 'pending' | 'enrolled'

type VaultDeviceDoc = {
  _id: string
  userId: string
  name: string
  /** X25519, base64. */
  publicKey: string
  state: VaultDeviceState
  createdAt: Date
  enrolledAt?: Date
  /** The computer that added it from afar; it reads with its own device credential. */
  computer?: Computer
}

/** A computer as its device credential names it; matched whole, so in this field order. */
export type Computer = { userId: string; deviceId: string }

/** An item's key, wrapped with HPKE for one device. */
export type VaultKey = { deviceId: string; wrapped: string }

type VaultItemDoc = {
  _id: string
  /** The owner: a user id, or `team:<teamId>` for a team's vault (see vault-team.ts). */
  userId: string
  name: string
  ciphertext: string
  keys: VaultKey[]
  createdAt: Date
  updatedAt: Date
}

export const devices = (): Collection<VaultDeviceDoc> => db().collection('vault_devices')
export const items = (): Collection<VaultItemDoc> => db().collection('vault_items')
export async function setupVaultIndexes(): Promise<void> {
  await Promise.all([
    devices().createIndex({ userId: 1 }),
    items().createIndex({ userId: 1, name: 1 }, { unique: true }),
  ])
}

function deviceView(doc: VaultDeviceDoc) {
  return {
    id: doc._id,
    name: doc.name,
    publicKey: doc.publicKey,
    state: doc.state,
    createdAt: doc.createdAt.toISOString(),
    ...(doc.enrolledAt ? { enrolledAt: doc.enrolledAt.toISOString() } : {}),
  }
}

export function itemView(doc: VaultItemDoc) {
  return {
    name: doc.name,
    ciphertext: doc.ciphertext,
    keys: doc.keys,
    updatedAt: doc.updatedAt.toISOString(),
  }
}

/** Whether `given` names each of `expected` exactly once, and nothing else. */
export function coversExactly(given: string[], expected: string[]): boolean {
  const names = new Set(given)

  return (
    names.size === given.length &&
    names.size === expected.length &&
    expected.every((name) => names.has(name))
  )
}

async function enrolledIds(userId: string): Promise<string[]> {
  const enrolled = await devices().find({ userId, state: 'enrolled' }).toArray()

  return enrolled.map((doc) => doc._id)
}

export async function listVaultDevices(userId: string) {
  const docs = await devices().find({ userId }).sort({ createdAt: 1 }).toArray()

  return docs.map(deviceView)
}

/** The first device is trusted on first use; later ones wait. A computer holds one key. */
export function addVaultDevice(
  userId: string,
  name: string,
  publicKey: string,
  computer?: Computer,
) {
  return exclusive(userId, async () => {
    const linked = computer && (await devices().findOne({ userId, computer }))

    if (linked?.publicKey === publicKey) return deviceView(linked)
    if (linked) throw new AppError(409, 'vault_computer_exists', 'This computer has a key here')
    if ((await devices().countDocuments({ userId })) >= MAX_DEVICES)
      throw new AppError(409, 'vault_device_limit', `A vault holds at most ${MAX_DEVICES} devices`)
    const first = (await enrolledIds(userId)).length === 0

    if (first && computer)
      throw new AppError(409, 'vault_not_enrolled', 'Add this device to your vault first')
    const now = new Date()
    const doc: VaultDeviceDoc = {
      _id: randomUUID(),
      userId,
      name,
      publicKey,
      state: first ? 'enrolled' : 'pending',
      createdAt: now,
      ...(first ? { enrolledAt: now } : {}),
      ...(computer ? { computer } : {}),
    }

    await devices().insertOne(doc)

    return deviceView(doc)
  })
}

/**
 * An enrolled device approves a pending one by wrapping every item's key for
 * it. Without those keys the device could read nothing, so the backend alone
 * can never enroll one.
 */
export function approveVaultDevice(
  userId: string,
  deviceId: string,
  keys: { name: string; wrapped: string }[],
) {
  return exclusive(userId, async () => {
    const device = await devices().findOne({ _id: deviceId, userId })

    if (!device) throw new AppError(404, 'not_found', 'Device not found')
    if (device.state !== 'pending') {
      throw new AppError(409, 'vault_device_enrolled', 'Device is already enrolled')
    }
    await wrapEveryItemFor(userId, deviceId, keys)
    const enrolledAt = new Date()

    await devices().updateOne(
      { _id: deviceId, userId },
      { $set: { state: 'enrolled', enrolledAt } },
    )

    return deviceView({ ...device, state: 'enrolled', enrolledAt })
  })
}

/** Adds a device's key to every item of `owner`'s vault; the caller holds its lock. */
export async function wrapEveryItemFor(
  owner: string,
  deviceId: string,
  keys: { name: string; wrapped: string }[],
) {
  const names = await items().distinct('name', { userId: owner })

  if (
    !coversExactly(
      keys.map((key) => key.name),
      names,
    )
  ) {
    throw new AppError(409, 'vault_items_changed', 'Wrap the key of every vault item, once each')
  }
  for (const key of keys) {
    await items().updateOne(
      { userId: owner, name: key.name, 'keys.deviceId': { $ne: deviceId } },
      { $push: { keys: { deviceId, wrapped: key.wrapped } } },
    )
  }
}

/**
 * Drops the device and its wrapped keys. Items are not re-keyed. The last
 * enrolled device stays while items exist: without it nothing could read them,
 * and the next device would be trusted on first use.
 */
export function removeVaultDevice(userId: string, deviceId: string): Promise<void> {
  return exclusive(userId, async () => {
    const device = await devices().findOne({ _id: deviceId, userId })

    if (!device) throw new AppError(404, 'not_found', 'Device not found')
    if (
      device.state === 'enrolled' &&
      (await enrolledIds(userId)).length === 1 &&
      (await items().countDocuments({ userId }, { limit: 1 })) > 0
    ) {
      throw new AppError(
        409,
        'vault_last_device',
        'Remove the vault items first: this is the only device that can read them',
      )
    }
    await devices().deleteOne({ _id: deviceId, userId })
    await items().updateMany({ userId }, { $pull: { keys: { deviceId } } })
  })
}

export async function listVaultItems(userId: string) {
  const docs = await items()
    .find({ userId })
    .project<{ name: string; updatedAt: Date }>({ name: 1, updatedAt: 1 })
    .sort({ name: 1 })
    .toArray()

  return docs.map((doc) => ({ name: doc.name, updatedAt: doc.updatedAt.toISOString() }))
}

export async function getVaultItem(userId: string, name: string) {
  const doc = await items().findOne({ userId, name })

  if (!doc) throw new AppError(404, 'not_found', 'Item not found')

  return itemView(doc)
}

export function putVaultItem(userId: string, name: string, ciphertext: string, keys: VaultKey[]) {
  return exclusive(userId, async () =>
    writeVaultItem(userId, name, ciphertext, keys, await enrolledIds(userId)),
  )
}

/**
 * Writes an item of `owner`'s vault, a user's or a team's, wrapped for exactly
 * `readers`. The caller holds the vault's lock.
 */
export async function writeVaultItem(
  owner: string,
  name: string,
  ciphertext: string,
  keys: VaultKey[],
  readers: string[],
) {
  if (
    !coversExactly(
      keys.map((key) => key.deviceId),
      readers,
    )
  ) {
    throw new AppError(
      409,
      'vault_devices_changed',
      'Wrap the item key for every enrolled device, once each',
    )
  }
  if (
    !(await items().countDocuments({ userId: owner, name }, { limit: 1 })) &&
    (await items().countDocuments({ userId: owner })) >= MAX_ITEMS
  ) {
    throw new AppError(409, 'vault_item_limit', `A vault holds at most ${MAX_ITEMS} items`)
  }
  const now = new Date()
  const doc = await items().findOneAndUpdate(
    { userId: owner, name },
    {
      $set: { ciphertext, keys, updatedAt: now },
      $setOnInsert: { _id: randomUUID(), createdAt: now },
    },
    { upsert: true, returnDocument: 'after' },
  )

  return itemView(doc as VaultItemDoc)
}

export function deleteVaultItem(userId: string, name: string): Promise<void> {
  return exclusive(userId, async () => {
    const { deletedCount } = await items().deleteOne({ userId, name })

    if (!deletedCount) throw new AppError(404, 'not_found', 'Item not found')
  })
}
