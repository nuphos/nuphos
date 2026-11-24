// The vault's rules against a real MongoDB: every item stays wrapped for
// exactly the enrolled devices, one write at a time, within each user's vault.
// Runs when TEST_MONGODB_URI is set, with MONGODB_URI pointing at the same server.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { closeDb, connectDb, db } from '@/lib/db'
import {
  MAX_DEVICES,
  MAX_ITEMS,
  addVaultDevice,
  approveVaultDevice,
  deleteVaultItem,
  getVaultItem,
  listVaultDevices,
  listVaultItems,
  putVaultItem,
  removeVaultDevice,
} from '@/lib/vault'
import { getVaultItemForComputer } from '@/lib/vault-computer'

const KEY = Buffer.alloc(32, 1).toString('base64')
const keysFor = (...ids: string[]) =>
  ids.map((deviceId) => ({ deviceId, wrapped: `w-${deviceId}` }))
const fails = async (promise: Promise<unknown>) => {
  try {
    await promise
  } catch (error) {
    return error as { status: number; code: string }
  }
  throw new Error('expected a rejection')
}

describe.skipIf(!process.env.TEST_MONGODB_URI)('vault on a real database', () => {
  beforeAll(async () => {
    await connectDb()
  })
  afterAll(async () => {
    await closeDb()
  })

  test('enroll, approve, write and remove keep every item wrapped for each enrolled device', async () => {
    const user = randomUUID()
    const first = await addVaultDevice(user, 'laptop', KEY)
    const second = await addVaultDevice(user, 'desktop', KEY)

    expect([first.state, second.state]).toEqual(['enrolled', 'pending'])

    await putVaultItem(user, 'token', 'c1', keysFor(first.id))
    // A pending device holds no key, so a write that wraps for it is refused.
    expect(
      await fails(putVaultItem(user, 'token', 'c2', keysFor(first.id, second.id))),
    ).toMatchObject({ status: 409, code: 'vault_devices_changed' })
    // An approval must wrap every existing item.
    expect(await fails(approveVaultDevice(user, second.id, []))).toMatchObject({
      status: 409,
      code: 'vault_items_changed',
    })

    await approveVaultDevice(user, second.id, [{ name: 'token', wrapped: 'w-second' }])
    expect((await getVaultItem(user, 'token')).keys.map((key) => key.deviceId)).toEqual([
      first.id,
      second.id,
    ])
    expect(
      await fails(approveVaultDevice(user, second.id, [{ name: 'token', wrapped: 'again' }])),
    ).toMatchObject({ status: 409, code: 'vault_device_enrolled' })
    // Now a write that leaves out the new device is refused.
    expect(await fails(putVaultItem(user, 'token', 'c3', keysFor(first.id)))).toMatchObject({
      status: 409,
      code: 'vault_devices_changed',
    })

    await removeVaultDevice(user, second.id)
    expect((await getVaultItem(user, 'token')).keys.map((key) => key.deviceId)).toEqual([first.id])
  })

  test('another user reaches nothing of a vault', async () => {
    const owner = randomUUID()
    const other = randomUUID()
    const device = await addVaultDevice(owner, 'laptop', KEY)
    const pending = await addVaultDevice(owner, 'phone', KEY)

    await putVaultItem(owner, 'token', 'c1', keysFor(device.id))

    expect(await listVaultItems(other)).toEqual([])
    expect(await fails(getVaultItem(other, 'token'))).toMatchObject({ status: 404 })
    expect(await fails(deleteVaultItem(other, 'token'))).toMatchObject({ status: 404 })
    expect(await fails(approveVaultDevice(other, pending.id, []))).toMatchObject({ status: 404 })
    expect(await fails(removeVaultDevice(other, device.id))).toMatchObject({ status: 404 })
    // The other user's first device is their own first device, trusted on first use.
    expect((await addVaultDevice(other, 'theirs', KEY)).state).toBe('enrolled')
  })

  test('a write waits for no one: it is refused while another holds the vault', async () => {
    const user = randomUUID()
    const device = await addVaultDevice(user, 'laptop', KEY)
    const locks = db().collection<{ _id: string; token: string; until: Date }>('vault_locks')

    await locks.insertOne({ _id: user, token: 'other', until: new Date(Date.now() + 60_000) })
    expect(await fails(putVaultItem(user, 'token', 'c1', keysFor(device.id)))).toMatchObject({
      status: 409,
      code: 'vault_busy',
    })
    // A holder that never released it frees the vault once its lock expires.
    await locks.updateOne({ _id: user }, { $set: { until: new Date(Date.now() - 1) } })
    await putVaultItem(user, 'token', 'c1', keysFor(device.id))
    expect(await locks.countDocuments({ _id: user })).toBe(0)
  })

  test('concurrent writes never leave an item without a key for an enrolled device', async () => {
    const user = randomUUID()
    const first = await addVaultDevice(user, 'laptop', KEY)
    const second = await addVaultDevice(user, 'desktop', KEY)
    const results = await Promise.allSettled([
      putVaultItem(user, 'new', 'c1', keysFor(first.id)),
      approveVaultDevice(user, second.id, []),
    ])

    expect(results.some((result) => result.status === 'fulfilled')).toBe(true)
    const enrolled = (
      await db()
        .collection<{ _id: string }>('vault_devices')
        .find({ userId: user, state: 'enrolled' })
        .toArray()
    ).map((doc) => doc._id)

    for (const item of await db().collection('vault_items').find({ userId: user }).toArray()) {
      const holders = (item.keys as { deviceId: string }[]).map((key) => key.deviceId)

      expect(holders).toHaveLength(enrolled.length)
      expect(new Set(holders)).toEqual(new Set(enrolled))
    }
  })

  test('the last device that can read items stays', async () => {
    const user = randomUUID()
    const device = await addVaultDevice(user, 'laptop', KEY)

    await putVaultItem(user, 'token', 'c1', keysFor(device.id))
    expect(await fails(removeVaultDevice(user, device.id))).toMatchObject({
      status: 409,
      code: 'vault_last_device',
    })
    await deleteVaultItem(user, 'token')
    await removeVaultDevice(user, device.id)
  })

  test('device and item counts are capped', async () => {
    const user = randomUUID()
    const device = await addVaultDevice(user, 'laptop', KEY)

    await db()
      .collection('vault_devices')
      .insertMany(
        Array.from({ length: MAX_DEVICES - 1 }, (_, i) => ({
          _id: `${user}-${String(i)}`,
          userId: user,
          name: 'spare',
          publicKey: KEY,
          state: 'pending',
          createdAt: new Date(),
        })) as never,
      )
    expect(await fails(addVaultDevice(user, 'one more', KEY))).toMatchObject({
      status: 409,
      code: 'vault_device_limit',
    })

    await db()
      .collection('vault_items')
      .insertMany(
        Array.from({ length: MAX_ITEMS }, (_, i) => ({
          _id: `${user}-${String(i)}`,
          userId: user,
          name: `item-${String(i)}`,
          ciphertext: 'c',
          keys: keysFor(device.id),
          createdAt: new Date(),
          updatedAt: new Date(),
        })) as never,
      )
    expect(await fails(putVaultItem(user, 'one-more', 'c', keysFor(device.id)))).toMatchObject({
      status: 409,
      code: 'vault_item_limit',
    })
    // An existing item can still change.
    await putVaultItem(user, 'item-0', 'c2', keysFor(device.id))
  })

  test('a computer added from afar waits for approval and reads only its own key', async () => {
    const user = randomUUID()
    const box = { userId: randomUUID(), deviceId: randomUUID() }
    const other = { userId: box.userId, deviceId: randomUUID() }

    // Never trusted on first use: its key came through Nuphos.
    expect(await fails(addVaultDevice(user, 'box', KEY, box))).toMatchObject({
      status: 409,
      code: 'vault_not_enrolled',
    })
    const laptop = await addVaultDevice(user, 'laptop', KEY)
    const added = await addVaultDevice(user, 'box', KEY, box)

    expect(added.state).toBe('pending')
    // Adding it again offers the same key: still one device.
    expect(await addVaultDevice(user, 'box', KEY, box)).toMatchObject({ id: added.id })
    expect(await listVaultDevices(user)).toHaveLength(2)
    await putVaultItem(user, 'token', 'c1', keysFor(laptop.id))
    expect(await fails(getVaultItemForComputer(user, box, 'token'))).toMatchObject({ status: 404 })

    await approveVaultDevice(user, added.id, [{ name: 'token', wrapped: 'w-box' }])
    expect(await getVaultItemForComputer(user, box, 'token')).toMatchObject({
      deviceId: added.id,
      item: { name: 'token', ciphertext: 'c1', keys: [{ deviceId: added.id, wrapped: 'w-box' }] },
    })
    // Another computer, or the same computer for another person's vault, reads nothing.
    expect(await fails(getVaultItemForComputer(user, other, 'token'))).toMatchObject({
      status: 404,
    })
    expect(await fails(getVaultItemForComputer(randomUUID(), box, 'token'))).toMatchObject({
      status: 404,
    })
  })
})
