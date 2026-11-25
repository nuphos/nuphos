// A team's shared vault against a real MongoDB (nuphos/nuphos#5080): every item
// stays wrapped for exactly the team vault's devices, and only members read it.
// Runs when TEST_MONGODB_URI is set, with MONGODB_URI pointing at the same server.
import { randomUUID } from 'node:crypto'

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { closeDb, connectDb, db } from '@/lib/db'
import {
  addVaultDevice,
  approveVaultDevice,
  getVaultItem,
  listVaultItems,
  removeVaultDevice,
} from '@/lib/vault'
import { getVaultItemForComputer } from '@/lib/vault-computer'
import {
  addTeamVaultDevice,
  deleteTeamVaultItem,
  getTeamVaultItem,
  listTeamVaultDevices,
  listTeamVaultItems,
  putTeamVaultItem,
  removeTeamVaultDevice,
} from '@/lib/vault-team'

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

async function teamOf(...userIds: string[]) {
  const _id = new ObjectId()

  await db()
    .collection('teams')
    .insertOne({
      _id,
      name: 'Vault test',
      ownerID: new ObjectId(userIds[0]),
      members: userIds.map((id) => ({ userId: new ObjectId(id), role: 'ADMINISTRATOR' })),
      createdAt: new Date(),
      updatedAt: new Date(),
    })

  return _id.toHexString()
}

const removeMember = (teamId: string, userId: string) =>
  db()
    .collection('teams')
    .updateOne(
      { _id: new ObjectId(teamId), 'members.userId': new ObjectId(userId) },
      { $set: { 'members.$.deletedAt': new Date() } },
    )

const holders = async (teamId: string, name: string) =>
  (await getTeamVaultItem(teamId, (await anyMember(teamId))!, name)).keys.map((key) => key.deviceId)

async function anyMember(teamId: string) {
  const team = await db()
    .collection('teams')
    .findOne({ _id: new ObjectId(teamId) })

  return (team?.members as { userId: ObjectId; deletedAt?: Date }[])
    .find((member) => !member.deletedAt)
    ?.userId.toHexString()
}

describe.skipIf(!process.env.TEST_MONGODB_URI)('team vault on a real database', () => {
  beforeAll(async () => {
    await connectDb()
  })
  afterAll(async () => {
    await closeDb()
  })

  test('a member shares with another, and removing a member stops their reads', async () => {
    const alice = new ObjectId().toHexString()
    const bob = new ObjectId().toHexString()
    const team = await teamOf(alice, bob)
    const laptop = await addVaultDevice(alice, 'alice laptop', KEY)
    const desk = await addVaultDevice(bob, 'bob desk', KEY)

    // Nothing to write to before a device is in the team vault.
    expect(
      await fails(putTeamVaultItem(team, alice, 'token', 'c1', keysFor(laptop.id))),
    ).toMatchObject({ status: 409, code: 'vault_devices_changed' })
    // The first device of an empty team vault is its starter's own.
    expect(await fails(addTeamVaultDevice(team, alice, desk.id, []))).toMatchObject({
      code: 'vault_not_enrolled',
    })
    await addTeamVaultDevice(team, alice, laptop.id, [])
    await putTeamVaultItem(team, alice, 'token', 'c1', keysFor(laptop.id))
    expect(await holders(team, 'token')).toEqual([laptop.id])
    // The item is the team's, not Alice's own.
    expect(await listVaultItems(alice)).toEqual([])

    // Bob sees the item but cannot write before one of his devices is in.
    expect((await listTeamVaultItems(team, bob)).map((item) => item.name)).toEqual(['token'])
    expect(await fails(putTeamVaultItem(team, bob, 'token', 'x', keysFor(desk.id)))).toMatchObject({
      status: 403,
      code: 'vault_team_no_device',
    })
    expect(await fails(addTeamVaultDevice(team, bob, desk.id, []))).toMatchObject({ status: 403 })
    // Alice adds Bob's device: she wraps every item for it.
    expect(await fails(addTeamVaultDevice(team, alice, desk.id, []))).toMatchObject({
      code: 'vault_items_changed',
    })
    await addTeamVaultDevice(team, alice, desk.id, [{ name: 'token', wrapped: 'w-desk' }])
    expect(await holders(team, 'token')).toEqual([laptop.id, desk.id])
    expect(
      (await listTeamVaultDevices(team, bob)).map((device) => [device.name, device.shared]),
    ).toEqual([
      ['alice laptop', true],
      ['bob desk', true],
    ])
    // Now every write wraps for both.
    expect(await fails(putTeamVaultItem(team, bob, 'token', 'c2', keysFor(desk.id)))).toMatchObject(
      { code: 'vault_devices_changed' },
    )
    await putTeamVaultItem(team, bob, 'token', 'c2', keysFor(laptop.id, desk.id))

    // Bob leaves: he reads nothing, and the next write needs no key for him.
    await removeMember(team, bob)
    expect(await fails(getTeamVaultItem(team, bob, 'token'))).toMatchObject({ status: 403 })
    expect(await fails(listTeamVaultItems(team, bob))).toMatchObject({ status: 403 })
    await putTeamVaultItem(team, alice, 'token', 'c3', keysFor(laptop.id))
    expect(await holders(team, 'token')).toEqual([laptop.id])

    // A stranger reaches nothing.
    const eve = new ObjectId().toHexString()

    expect(await fails(listTeamVaultDevices(team, eve))).toMatchObject({ status: 403 })
    expect(await fails(deleteTeamVaultItem(team, eve, 'token'))).toMatchObject({ status: 403 })
  })

  test("a computer in a member's vault reads team items with its own key", async () => {
    const alice = new ObjectId().toHexString()
    const team = await teamOf(alice)
    const box = { userId: alice, deviceId: randomUUID() }
    const laptop = await addVaultDevice(alice, 'laptop', KEY)
    const computer = await addVaultDevice(alice, 'box', KEY, box)

    await approveVaultDevice(alice, computer.id, [])
    await addTeamVaultDevice(team, alice, laptop.id, [])
    await putTeamVaultItem(team, alice, 'claude', 'c1', keysFor(laptop.id))
    // Enrolled in Alice's vault, but not yet in the team's.
    expect(await fails(getVaultItemForComputer(alice, box, 'claude', team))).toMatchObject({
      status: 404,
    })
    await addTeamVaultDevice(team, alice, computer.id, [{ name: 'claude', wrapped: 'w-box' }])
    expect(await getVaultItemForComputer(alice, box, 'claude', team)).toMatchObject({
      deviceId: computer.id,
      item: { ciphertext: 'c1', keys: [{ deviceId: computer.id, wrapped: 'w-box' }] },
    })
    // Its own vault has no such item.
    expect(await fails(getVaultItemForComputer(alice, box, 'claude'))).toMatchObject({
      status: 404,
    })
    // Another team's id reads nothing.
    expect(
      await fails(getVaultItemForComputer(alice, box, 'claude', new ObjectId().toHexString())),
    ).toMatchObject({ status: 403 })

    // Removing it from Alice's vault takes it out of the team's, with its keys.
    await removeVaultDevice(alice, computer.id)
    expect((await listTeamVaultDevices(team, alice)).map((device) => device.id)).toEqual([
      laptop.id,
    ])
    expect(await holders(team, 'claude')).toEqual([laptop.id])

    // Alice leaves the team: her computers stop reading.
    const again = await addVaultDevice(alice, 'box', KEY, box)

    await approveVaultDevice(alice, again.id, [])
    await addTeamVaultDevice(team, alice, again.id, [{ name: 'claude', wrapped: 'w-box2' }])
    await removeMember(team, alice)
    expect(await fails(getVaultItemForComputer(alice, box, 'claude', team))).toMatchObject({
      status: 403,
    })
  })

  test('the last device in a team vault with items stays; its own person may remove one', async () => {
    const alice = new ObjectId().toHexString()
    const bob = new ObjectId().toHexString()
    const team = await teamOf(alice, bob)
    const laptop = await addVaultDevice(alice, 'laptop', KEY)
    const desk = await addVaultDevice(bob, 'desk', KEY)

    await addTeamVaultDevice(team, alice, laptop.id, [])
    await putTeamVaultItem(team, alice, 'token', 'c1', keysFor(laptop.id))
    await addTeamVaultDevice(team, alice, desk.id, [{ name: 'token', wrapped: 'w' }])
    // Bob takes his own device out.
    await removeTeamVaultDevice(team, bob, desk.id)
    expect(await holders(team, 'token')).toEqual([laptop.id])
    expect(await fails(removeTeamVaultDevice(team, alice, laptop.id))).toMatchObject({
      code: 'vault_last_device',
    })
    await deleteTeamVaultItem(team, alice, 'token')
    await removeTeamVaultDevice(team, alice, laptop.id)
    // The personal item store never saw it.
    expect(await fails(getVaultItem(alice, 'token'))).toMatchObject({ status: 404 })
  })
})
