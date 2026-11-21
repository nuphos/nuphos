// Nuphos Vault: a user's secrets, encrypted on their own devices. The backend
// keeps device public keys, item ciphertext and each item's key wrapped for
// every enrolled device; it never sees a private key or a plaintext. What it
// does enforce is that every item stays readable by every enrolled device.
import { randomUUID } from 'node:crypto'

import { db } from '@/lib/db'
import { AppError } from '@/lib/errors'

import type { Collection } from 'mongodb'

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
}

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

const devices = (): Collection<VaultDeviceDoc> => db().collection('vault_devices')
const items = (): Collection<VaultItemDoc> => db().collection('vault_items')

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

function itemView(doc: VaultItemDoc) {
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

/** The first device is trusted on first use; any later one waits for an enrolled device. */
export async function addVaultDevice(userId: string, name: string, publicKey: string) {
  const first = (await enrolledIds(userId)).length === 0
  const now = new Date()
  const doc: VaultDeviceDoc = {
    _id: randomUUID(),
    userId,
    name,
    publicKey,
    state: first ? 'enrolled' : 'pending',
    createdAt: now,
    ...(first ? { enrolledAt: now } : {}),
  }

  await devices().insertOne(doc)

  return deviceView(doc)
}

/**
 * An enrolled device approves a pending one by wrapping every item's key for
 * it. Without those keys the device could read nothing, so the backend alone
 * can never enroll one.
 */
export async function approveVaultDevice(
  userId: string,
  deviceId: string,
  keys: { name: string; wrapped: string }[],
) {
  const device = await devices().findOne({ _id: deviceId, userId })

  if (!device) throw new AppError(404, 'not_found', 'Device not found')
  if (device.state !== 'pending') {
    throw new AppError(409, 'vault_device_enrolled', 'Device is already enrolled')
  }
  const names = (await items().find({ userId }).project({ name: 1 }).toArray()).map(
    (doc) => doc.name as string,
  )

  if (
    !coversExactly(
      keys.map((key) => key.name),
      names,
    )
  ) {
    throw new AppError(409, 'vault_items_changed', 'Wrap the key of every vault item, once each')
  }
  await Promise.all(
    keys.map((key) =>
      items().updateOne(
        { userId, name: key.name, 'keys.deviceId': { $ne: deviceId } },
        { $push: { keys: { deviceId, wrapped: key.wrapped } } },
      ),
    ),
  )
  const enrolledAt = new Date()

  await devices().updateOne({ _id: deviceId, userId }, { $set: { state: 'enrolled', enrolledAt } })

  return deviceView({ ...device, state: 'enrolled', enrolledAt })
}

/** Drops the device and its wrapped keys. Items are not re-keyed. */
export async function removeVaultDevice(userId: string, deviceId: string): Promise<void> {
  const { deletedCount } = await devices().deleteOne({ _id: deviceId, userId })

  if (!deletedCount) throw new AppError(404, 'not_found', 'Device not found')
  await items().updateMany({ userId }, { $pull: { keys: { deviceId } } })
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

export async function putVaultItem(
  userId: string,
  name: string,
  ciphertext: string,
  keys: VaultKey[],
) {
  if (
    !coversExactly(
      keys.map((key) => key.deviceId),
      await enrolledIds(userId),
    )
  ) {
    throw new AppError(
      409,
      'vault_devices_changed',
      'Wrap the item key for every enrolled device, once each',
    )
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
}

export async function deleteVaultItem(userId: string, name: string): Promise<void> {
  const { deletedCount } = await items().deleteOne({ userId, name })

  if (!deletedCount) throw new AppError(404, 'not_found', 'Item not found')
}
