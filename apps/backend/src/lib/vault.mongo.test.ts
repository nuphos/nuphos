// The vault's rules against a real MongoDB: every item is wrapped only for enrolled
// devices, at least one per item, one write at a time, within each user's vault.
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
  linkVaultDevice,
  listVaultDevices,
  listVaultItems,
  putVaultItem,
  removeVaultDevice,
} from '@/lib/vault'
import type { VaultKey } from '@/lib/vault'
import {
  getVaultItemForComputer,
  offerComputerKey,
  vaultOwnersSharingWithComputer,
} from '@/lib/vault-computer'

const KEY = Buffer.alloc(32, 1).toString('base64')
const keysFor = (...ids: string[]) =>
  ids.map((deviceId) => ({ deviceId, wrapped: `w-${deviceId}` }))
/** Writes as a client that read the item just before. */
const put = async (user: string, name: string, ciphertext: string, keys: VaultKey[]) => {
  const seen = await db().collection('vault_items').findOne({ userId: user, name })

  return putVaultItem(user, name, ciphertext, keys, seen?.updatedAt.toISOString() ?? null)
}
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

  test('an item is shared with the enrolled devices its key is wrapped for', async () => {
    const user = randomUUID()
    const first = await addVaultDevice(user, 'laptop', KEY)
    const second = await addVaultDevice(user, 'desktop', KEY)
    const holders = async () => (await getVaultItem(user, 'token')).keys.map((key) => key.deviceId)

    expect([first.state, second.state]).toEqual(['enrolled', 'pending'])

    await put(user, 'token', 'c1', keysFor(first.id))
    // A pending device holds no key, so a write that wraps for it is refused.
    expect(await fails(put(user, 'token', 'c2', keysFor(first.id, second.id)))).toMatchObject({
      status: 409,
      code: 'vault_devices_changed',
    })
    // Nor twice for one device.
    expect(await fails(put(user, 'token', 'c2', keysFor(first.id, first.id)))).toMatchObject({
      status: 409,
      code: 'vault_devices_changed',
    })
    // Approval wraps nothing: the new device reads only what is shared with it later.
    await approveVaultDevice(user, second.id)
    expect(await holders()).toEqual([first.id])
    expect(await fails(approveVaultDevice(user, second.id))).toMatchObject({
      status: 409,
      code: 'vault_device_enrolled',
    })
    await put(user, 'token', 'c2', keysFor(first.id, second.id))
    expect(await holders()).toEqual([first.id, second.id])
    // Unsharing from one device is a write without its key.
    await put(user, 'token', 'c3', keysFor(second.id))
    expect(await holders()).toEqual([second.id])
    expect((await listVaultItems(user))[0]).toMatchObject({ name: 'token', deviceIds: [second.id] })
    // The only device that can open it stays; the other one may go.
    expect(await fails(removeVaultDevice(user, second.id))).toMatchObject({
      status: 409,
      code: 'vault_last_device',
    })
    await removeVaultDevice(user, first.id)
    expect(await holders()).toEqual([second.id])
  })

  test('another user reaches nothing of a vault', async () => {
    const owner = randomUUID()
    const other = randomUUID()
    const device = await addVaultDevice(owner, 'laptop', KEY)
    const pending = await addVaultDevice(owner, 'phone', KEY)

    await put(owner, 'token', 'c1', keysFor(device.id))

    expect(await listVaultItems(other)).toEqual([])
    expect(await fails(getVaultItem(other, 'token'))).toMatchObject({ status: 404 })
    expect(await fails(deleteVaultItem(other, 'token'))).toMatchObject({ status: 404 })
    expect(await fails(approveVaultDevice(other, pending.id))).toMatchObject({ status: 404 })
    expect(await fails(removeVaultDevice(other, device.id))).toMatchObject({ status: 404 })
    // The other user's first device is their own first device, trusted on first use.
    expect((await addVaultDevice(other, 'theirs', KEY)).state).toBe('enrolled')
  })

  test('a write waits for no one: it is refused while another holds the vault', async () => {
    const user = randomUUID()
    const device = await addVaultDevice(user, 'laptop', KEY)
    const locks = db().collection<{ _id: string; token: string; until: Date }>('vault_locks')

    await locks.insertOne({ _id: user, token: 'other', until: new Date(Date.now() + 60_000) })
    expect(await fails(put(user, 'token', 'c1', keysFor(device.id)))).toMatchObject({
      status: 409,
      code: 'vault_busy',
    })
    // A holder that never released it frees the vault once its lock expires.
    await locks.updateOne({ _id: user }, { $set: { until: new Date(Date.now() - 1) } })
    await put(user, 'token', 'c1', keysFor(device.id))
    expect(await locks.countDocuments({ _id: user })).toBe(0)
  })

  test('concurrent writes never leave an item wrapped for a device that is not enrolled', async () => {
    const user = randomUUID()
    const first = await addVaultDevice(user, 'laptop', KEY)
    const second = await addVaultDevice(user, 'desktop', KEY)
    const results = await Promise.allSettled([
      put(user, 'new', 'c1', keysFor(first.id)),
      removeVaultDevice(user, first.id),
      approveVaultDevice(user, second.id),
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

      expect(holders.length).toBeGreaterThan(0)
      expect(holders.every((id) => enrolled.includes(id))).toBe(true)
    }
  })

  test('a write based on an older read is refused', async () => {
    const user = randomUUID()
    const laptop = await addVaultDevice(user, 'laptop', KEY)
    const desktop = await addVaultDevice(user, 'desktop', KEY)
    const changed = { status: 409, code: 'vault_item_changed' }
    const first = await putVaultItem(user, 'token', 'c1', keysFor(laptop.id), null)

    // A new item must not exist yet.
    expect(await fails(putVaultItem(user, 'token', 'c1', keysFor(laptop.id), null))).toMatchObject(
      changed,
    )
    // Sharing it changes the item: a write read before would drop that device.
    await approveVaultDevice(user, desktop.id)
    await putVaultItem(user, 'token', 'c1', keysFor(laptop.id, desktop.id), first.updatedAt)
    expect(
      await fails(putVaultItem(user, 'token', 'c1', keysFor(laptop.id), first.updatedAt)),
    ).toMatchObject(changed)
    // A share racing a rotation of the same read: one lands, the other is refused.
    const seen = (await getVaultItem(user, 'token')).updatedAt
    const results = await Promise.allSettled([
      putVaultItem(user, 'token', 'rotated', keysFor(laptop.id, desktop.id), seen),
      putVaultItem(user, 'token', 'c1', keysFor(laptop.id), seen),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    // Sequential, the late share still cannot bring the old value back.
    const after = await getVaultItem(user, 'token')

    expect(await fails(putVaultItem(user, 'token', 'c1', keysFor(laptop.id), seen))).toMatchObject(
      changed,
    )
    expect(await getVaultItem(user, 'token')).toEqual(after)
  })

  test('the last device that can read items stays', async () => {
    const user = randomUUID()
    const device = await addVaultDevice(user, 'laptop', KEY)

    await put(user, 'token', 'c1', keysFor(device.id))
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
    expect(await fails(put(user, 'one-more', 'c', keysFor(device.id)))).toMatchObject({
      status: 409,
      code: 'vault_item_limit',
    })
    // An existing item can still change.
    await put(user, 'item-0', 'c2', keysFor(device.id))
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
    await put(user, 'token', 'c1', keysFor(laptop.id))
    expect(await fails(getVaultItemForComputer(user, box, 'token'))).toMatchObject({ status: 404 })

    // Approved, it reads nothing until an item is shared with it.
    await approveVaultDevice(user, added.id)
    expect(await fails(getVaultItemForComputer(user, box, 'token'))).toMatchObject({ status: 404 })
    await put(user, 'token', 'c1', [
      ...keysFor(laptop.id),
      { deviceId: added.id, wrapped: 'w-box' },
    ])
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
    // Unshared, it reads it no more.
    await put(user, 'token', 'c2', keysFor(laptop.id))
    expect(await fails(getVaultItemForComputer(user, box, 'token'))).toMatchObject({ status: 404 })
    // Every device is treated the same: the computer alone may hold an item,
    // and then the laptop may go while the computer stays.
    await put(user, 'token', 'c3', [{ deviceId: added.id, wrapped: 'w-box' }])
    expect(await fails(removeVaultDevice(user, added.id))).toMatchObject({
      status: 409,
      code: 'vault_last_device',
    })
    await removeVaultDevice(user, laptop.id)
    expect((await getVaultItemForComputer(user, box, 'token')).item.ciphertext).toBe('c3')
  })

  test('a computer learns whose vaults share an item with it, and nothing more', async () => {
    const box = { userId: randomUUID(), deviceId: randomUUID() }
    const sharing = async (shareIt: boolean) => {
      const user = randomUUID()
      const laptop = await addVaultDevice(user, 'laptop', KEY)
      const added = await addVaultDevice(user, 'box', KEY, box)

      await approveVaultDevice(user, added.id)
      await put(user, 'token', 'c1', [
        ...keysFor(laptop.id),
        ...(shareIt ? [{ deviceId: added.id, wrapped: 'w-box' }] : []),
      ])

      return user
    }
    const alice = await sharing(true)
    const bob = await sharing(true)

    await sharing(false)
    // Linked but still pending: not yet a vault it reads.
    const pending = randomUUID()
    const laptop = await addVaultDevice(pending, 'laptop', KEY)

    await addVaultDevice(pending, 'box', KEY, box)
    await put(pending, 'token', 'c1', keysFor(laptop.id))

    const owners = await vaultOwnersSharingWithComputer(box, 'token')

    // Random ids are no users: who they are, with no name.
    expect(owners).toHaveLength(2)
    expect(owners).toContainEqual({ userId: alice, name: '' })
    expect(owners).toContainEqual({ userId: bob, name: '' })
    expect(await vaultOwnersSharingWithComputer(box, 'other')).toEqual([])
    expect(
      await vaultOwnersSharingWithComputer({ ...box, deviceId: randomUUID() }, 'token'),
    ).toEqual([])
  })

  test('Desktop reads what its owner and others share with its computer, with its one key', async () => {
    const bob = randomUUID()
    const alice = randomUUID()
    const mac = { userId: bob, deviceId: randomUUID() }
    const desktop = await addVaultDevice(bob, 'Mac (Desktop)', KEY)

    await linkVaultDevice(bob, desktop.id, mac.deviceId)
    await put(bob, 'token', 'bob', keysFor(desktop.id))
    // Alice adds Bob's computer: what Bob approved for it is the key she gets.
    const laptop = await addVaultDevice(alice, 'laptop', KEY)
    const added = await addVaultDevice(alice, 'Mac', KEY, mac)

    await approveVaultDevice(alice, added.id)
    await put(alice, 'token', 'alice', [...keysFor(laptop.id), ...keysFor(added.id)])

    const owners = await vaultOwnersSharingWithComputer(mac, 'token')

    expect(new Set(owners.map((owner) => owner.userId))).toEqual(new Set([alice, bob]))
    expect(await getVaultItemForComputer(bob, mac, 'token')).toMatchObject({
      deviceId: desktop.id,
      item: { ciphertext: 'bob', keys: keysFor(desktop.id) },
    })
    expect(await getVaultItemForComputer(alice, mac, 'token')).toMatchObject({
      deviceId: added.id,
      item: { ciphertext: 'alice', keys: keysFor(added.id) },
    })
    // A new enrollment on that computer takes the link; another person's device it cannot.
    const again = await addVaultDevice(bob, 'Mac (Desktop)', Buffer.alloc(32, 3).toString('base64'))

    await approveVaultDevice(bob, again.id)
    await linkVaultDevice(bob, again.id, mac.deviceId)
    await put(bob, 'token', 'bob2', keysFor(again.id))
    expect((await getVaultItemForComputer(bob, mac, 'token')).deviceId).toBe(again.id)
    expect(await fails(linkVaultDevice(bob, laptop.id, mac.deviceId))).toMatchObject({
      code: 'not_found',
    })
  })

  test('a computer that joined offers one key, even when two offers race', async () => {
    const user = randomUUID()
    const mac = { userId: user, deviceId: randomUUID(), label: 'Studio Mac' }
    const otherKey = Buffer.alloc(32, 2).toString('base64')

    // No vault yet: nothing is offered.
    expect(await fails(offerComputerKey(mac, KEY))).toMatchObject({ code: 'vault_not_enrolled' })
    await addVaultDevice(user, 'laptop', KEY)
    const results = await Promise.allSettled([
      offerComputerKey(mac, KEY),
      offerComputerKey(mac, otherKey),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const offered = (await listVaultDevices(user)).filter((device) => device.name === 'Studio Mac')

    expect(offered).toHaveLength(1)
    expect(offered[0]).toMatchObject({ state: 'pending' })
    // The same key again is the same device.
    const again = await offerComputerKey(mac, offered[0]!.publicKey)

    expect(again.id).toBe(offered[0]!.id)
  })
})
