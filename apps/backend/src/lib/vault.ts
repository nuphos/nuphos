// Nuphos Vault: a user's secrets, encrypted on their own devices. The backend
// keeps device public keys, item ciphertext and each item's key wrapped for the
// devices it is shared with (nuphos/nuphos#5088); it never sees a private key or
// a plaintext. What it does enforce is that every item stays readable by at least
// one personal device, so it can always be shared again or rotated.
import { randomUUID } from 'node:crypto'

import { MongoServerError } from 'mongodb'

import { db } from '@/lib/db'
import { AppError } from '@/lib/errors'

import type { Collection } from 'mongodb'

export const MAX_DEVICES = 50
export const MAX_ITEMS = 1000
/** Longer than any write here takes; a crashed holder frees the vault after it. */
const LOCK_MS = 30_000

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
  userId: string
  name: string
  ciphertext: string
  keys: VaultKey[]
  createdAt: Date
  updatedAt: Date
}

export const devices = (): Collection<VaultDeviceDoc> => db().collection('vault_devices')
export const items = (): Collection<VaultItemDoc> => db().collection('vault_items')
const locks = (): Collection<{ _id: string; token: string; until: Date }> =>
  db().collection('vault_locks')

/**
 * Runs one write of a user's vault at a time. Every write reads the device set
 * or the item names and then writes against it, so two at once could leave an
 * item without a key for an enrolled device.
 */
async function exclusive<T>(userId: string, body: () => Promise<T>): Promise<T> {
  const token = randomUUID()
  const now = new Date()

  try {
    // Matches only an expired lock; a held one makes the upsert collide on _id.
    await locks().updateOne(
      { _id: userId, until: { $lt: now } },
      { $set: { token, until: new Date(now.getTime() + LOCK_MS) } },
      { upsert: true },
    )
  } catch (error) {
    if (error instanceof MongoServerError && error.code === 11000) {
      throw new AppError(409, 'vault_busy', 'Another change to this vault is in progress; retry')
    }
    throw error
  }
  try {
    return await body()
  } finally {
    await locks().deleteOne({ _id: userId, token })
  }
}

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
    /** A computer reads its items with its device credential and never writes. */
    computer: Boolean(doc.computer),
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

/** Whether `given` names some of `allowed`, each at most once. */
export function distinctWithin(given: string[], allowed: string[]): boolean {
  const names = new Set(given)

  return names.size === given.length && given.every((name) => allowed.includes(name))
}

async function enrolled(userId: string) {
  return devices().find({ userId, state: 'enrolled' }).toArray()
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
    const first = (await enrolled(userId)).length === 0

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
 * An enrolled device approves a pending one by wrapping for it the keys of the
 * items it should read: none for a computer, which gets items shared with it one
 * by one. The backend has no item key, so it alone can never give a device one.
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
    const names = (await items().find({ userId }).project({ name: 1 }).toArray()).map(
      (doc) => doc.name as string,
    )
    const keyNames = keys.map((key) => key.name)

    if (!distinctWithin(keyNames, names)) {
      throw new AppError(409, 'vault_items_changed', 'Wrap item keys once each')
    }
    for (const key of keys) {
      await items().updateOne(
        { userId, name: key.name, 'keys.deviceId': { $ne: deviceId } },
        { $push: { keys: { deviceId, wrapped: key.wrapped } } },
      )
    }
    const enrolledAt = new Date()

    await devices().updateOne(
      { _id: deviceId, userId },
      { $set: { state: 'enrolled', enrolledAt } },
    )

    return deviceView({ ...device, state: 'enrolled', enrolledAt })
  })
}

/**
 * Drops the device and its wrapped keys. Items are not re-keyed. A device stays
 * while it is the last personal device that can open some item: without it that
 * item could never be shared or rotated again.
 */
export function removeVaultDevice(userId: string, deviceId: string): Promise<void> {
  return exclusive(userId, async () => {
    const device = await devices().findOne({ _id: deviceId, userId })

    if (!device) throw new AppError(404, 'not_found', 'Device not found')
    // Only personal devices, not computers, can share an item or write it.
    const others = (await enrolled(userId))
      .filter((doc) => !doc.computer && doc._id !== deviceId)
      .map((doc) => doc._id)

    // `$nin` on an array matches an item none of whose keys is for another personal device.
    if (await items().countDocuments({ userId, 'keys.deviceId': { $nin: others } }, { limit: 1 })) {
      throw new AppError(409, 'vault_last_device', 'Share or delete what only it can open')
    }
    await devices().deleteOne({ _id: deviceId, userId })
    await items().updateMany({ userId }, { $pull: { keys: { deviceId } } })
  })
}

export async function listVaultItems(userId: string) {
  const docs = await items()
    .find({ userId })
    .project<Pick<VaultItemDoc, 'name' | 'updatedAt' | 'keys'>>({
      name: 1,
      updatedAt: 1,
      'keys.deviceId': 1,
    })
    .sort({ name: 1 })
    .toArray()

  return docs.map((doc) => ({
    name: doc.name,
    updatedAt: doc.updatedAt.toISOString(),
    /** The devices it is shared with. */
    deviceIds: doc.keys.map((key) => key.deviceId),
  }))
}

export async function getVaultItem(userId: string, name: string) {
  const doc = await items().findOne({ userId, name })

  if (!doc) throw new AppError(404, 'not_found', 'Item not found')

  return itemView(doc)
}

/** An item is shared with exactly the devices its key is wrapped for. */
export function putVaultItem(userId: string, name: string, ciphertext: string, keys: VaultKey[]) {
  return exclusive(userId, async () => {
    const ids = keys.map((key) => key.deviceId)
    const all = await enrolled(userId)
    const personal = all.filter((doc) => !doc.computer).map((doc) => doc._id)
    const enrolledIds = all.map((doc) => doc._id)

    if (!distinctWithin(ids, enrolledIds)) {
      throw new AppError(409, 'vault_devices_changed', 'Wrap for enrolled devices, once each')
    }
    if (!ids.some((id) => personal.includes(id))) {
      throw new AppError(409, 'vault_no_personal_device', 'Share with a device of yours too')
    }
    if (
      !(await items().countDocuments({ userId, name }, { limit: 1 })) &&
      (await items().countDocuments({ userId })) >= MAX_ITEMS
    ) {
      throw new AppError(409, 'vault_item_limit', `A vault holds at most ${MAX_ITEMS} items`)
    }
    const now = new Date()
    const doc = await items().findOneAndUpdate(
      { userId, name },
      {
        $set: { ciphertext, keys, updatedAt: now },
        $setOnInsert: { _id: randomUUID(), createdAt: now },
      },
      { upsert: true, returnDocument: 'after' },
    )

    return itemView(doc as VaultItemDoc)
  })
}

export function deleteVaultItem(userId: string, name: string): Promise<void> {
  return exclusive(userId, async () => {
    const { deletedCount } = await items().deleteOne({ userId, name })

    if (!deletedCount) throw new AppError(404, 'not_found', 'Item not found')
  })
}
