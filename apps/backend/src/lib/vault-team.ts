// A team's shared vault (nuphos/nuphos#5080): its items are stored as a person's
// are, owned by `team:<teamId>`, with each key wrapped for every device in the
// team vault's device set. A device joins that set only when a device already in
// it wraps every item's key for it, as a person approves their own devices, so the
// backend still never holds a key it could open. Any enrolled device of a current
// team member can be added; every read checks membership, so a removed member and
// their computers stop reading at once, and their keys are dropped on the next
// write. A removed member keeps whatever they already read: rotate it.
import { ObjectId } from 'mongodb'

import { db } from '@/lib/db'
import { AppError } from '@/lib/errors'
import { teams, users } from '@/lib/identity/shared'
import { inTokenTeamScope } from '@/lib/identity/token-team-scope'
import {
  devices,
  itemView,
  items,
  listVaultItems,
  wrapEveryItemFor,
  writeVaultItem,
} from '@/lib/vault'
import { exclusive } from '@/lib/vault-lock'

import type { VaultKey } from '@/lib/vault'
import type { Collection } from 'mongodb'

/** A device in a team vault's device set: it holds a key to each of its items. */
type TeamDeviceDoc = { _id: string; teamId: string; deviceId: string; addedAt: Date }

const teamDevices = (): Collection<TeamDeviceDoc> => db().collection('vault_team_devices')

export const teamOwner = (teamId: string) => `team:${teamId}`

export async function setupTeamVaultIndexes(): Promise<void> {
  await teamDevices().createIndex({ teamId: 1 })
}

/** The team's current members, when `userId` is one of them. */
async function membersFor(teamId: string, userId: string): Promise<string[]> {
  const team =
    ObjectId.isValid(teamId) && inTokenTeamScope(teamId)
      ? await teams().findOne({ _id: new ObjectId(teamId), deletedAt: { $exists: false } })
      : null
  const members = (team?.members ?? [])
    .filter((member) => !member.deletedAt)
    .map((member) => member.userId.toHexString())

  if (!members.includes(userId))
    throw new AppError(403, 'forbidden', 'You are not a member of this team')

  return members
}

/**
 * The team vault's device set: enrolled devices of current members. Devices of
 * former members, or removed from their person's vault since, leave it here with
 * their keys, so nothing else has to remember to drop them.
 */
async function deviceSet(teamId: string, members: string[]) {
  const listed = await teamDevices().find({ teamId }).toArray()
  const live = await devices()
    .find({
      _id: { $in: listed.map((doc) => doc.deviceId) },
      userId: { $in: members },
      state: 'enrolled',
    })
    .toArray()
  const gone = listed.filter((doc) => !live.some((device) => device._id === doc.deviceId))

  if (gone.length) {
    const ids = gone.map((doc) => doc.deviceId)

    await teamDevices().deleteMany({ teamId, deviceId: { $in: ids } })
    await items().updateMany(
      { userId: teamOwner(teamId) },
      { $pull: { keys: { deviceId: { $in: ids } } } },
    )
  }

  return live
}

/** A write needs one of the caller's own devices in the set, unless the vault is new. */
async function writable(teamId: string, userId: string) {
  const members = await membersFor(teamId, userId)
  const set = await deviceSet(teamId, members)
  const empty =
    set.length === 0 &&
    (await items().countDocuments({ userId: teamOwner(teamId) }, { limit: 1 })) === 0

  if (!empty && !set.some((device) => device.userId === userId))
    throw new AppError(
      403,
      'vault_team_no_device',
      'Ask a teammate to add one of your devices to the team vault first',
    )

  return { members, set }
}

/** Every enrolled device of the team's members, and whether it is in the team vault. */
export async function listTeamVaultDevices(teamId: string, userId: string) {
  const members = await membersFor(teamId, userId)
  const inSet = new Set((await deviceSet(teamId, members)).map((device) => device._id))
  const docs = await devices()
    .find({ userId: { $in: members }, state: 'enrolled' })
    .sort({ createdAt: 1 })
    .toArray()
  const names = new Map(
    (
      await users()
        .find({ _id: { $in: members.map((id) => new ObjectId(id)) } })
        .project<{ _id: ObjectId; name: string }>({ name: 1 })
        .toArray()
    ).map((user) => [user._id.toHexString(), user.name]),
  )

  return docs.map((doc) => ({
    id: doc._id,
    name: doc.name,
    publicKey: doc.publicKey,
    userId: doc.userId,
    userName: names.get(doc.userId) ?? '',
    shared: inSet.has(doc._id),
  }))
}

/**
 * A device in the set wraps every item's key for a member's device. The first
 * device of an empty team vault joins on first use, as a person's first does.
 */
export function addTeamVaultDevice(
  teamId: string,
  userId: string,
  deviceId: string,
  keys: { name: string; wrapped: string }[],
) {
  const owner = teamOwner(teamId)

  return exclusive(owner, async () => {
    const { members, set } = await writable(teamId, userId)
    const device = await devices().findOne({
      _id: deviceId,
      userId: { $in: members },
      state: 'enrolled',
    })

    if (!device) throw new AppError(404, 'not_found', 'Device not found')
    // A new team vault starts with a device of the person starting it.
    if (!set.length && device.userId !== userId)
      throw new AppError(409, 'vault_not_enrolled', 'Add one of your own devices first')
    if (set.some((doc) => doc._id === deviceId))
      throw new AppError(409, 'vault_device_enrolled', 'Device is already in the team vault')
    await wrapEveryItemFor(owner, deviceId, keys)
    await teamDevices().insertOne({
      _id: `${teamId}:${deviceId}`,
      teamId,
      deviceId,
      addedAt: new Date(),
    })
  })
}

/** Takes a device out of the team vault: a device in it, or the device's own person, may. */
export function removeTeamVaultDevice(teamId: string, userId: string, deviceId: string) {
  const owner = teamOwner(teamId)

  return exclusive(owner, async () => {
    const members = await membersFor(teamId, userId)
    const set = await deviceSet(teamId, members)
    const device = set.find((doc) => doc._id === deviceId)

    if (!device) throw new AppError(404, 'not_found', 'Device not found')
    if (device.userId !== userId && !set.some((doc) => doc.userId === userId))
      throw new AppError(403, 'vault_team_no_device', 'Only a device in the team vault can do this')
    if (set.length === 1 && (await items().countDocuments({ userId: owner }, { limit: 1 })))
      throw new AppError(
        409,
        'vault_last_device',
        'Remove the team vault items first: this is the only device that can read them',
      )
    await teamDevices().deleteOne({ teamId, deviceId })
    await items().updateMany({ userId: owner }, { $pull: { keys: { deviceId } } })
  })
}

export async function listTeamVaultItems(teamId: string, userId: string) {
  await membersFor(teamId, userId)

  return listVaultItems(teamOwner(teamId))
}

export async function getTeamVaultItem(teamId: string, userId: string, name: string) {
  await membersFor(teamId, userId)
  const doc = await items().findOne({ userId: teamOwner(teamId), name })

  if (!doc) throw new AppError(404, 'not_found', 'Item not found')

  return itemView(doc)
}

export function putTeamVaultItem(
  teamId: string,
  userId: string,
  name: string,
  ciphertext: string,
  keys: VaultKey[],
) {
  const owner = teamOwner(teamId)

  return exclusive(owner, async () => {
    const { set } = await writable(teamId, userId)

    return writeVaultItem(
      owner,
      name,
      ciphertext,
      keys,
      set.map((device) => device._id),
    )
  })
}

export function deleteTeamVaultItem(teamId: string, userId: string, name: string) {
  const owner = teamOwner(teamId)

  return exclusive(owner, async () => {
    await writable(teamId, userId)
    const { deletedCount } = await items().deleteOne({ userId: owner, name })

    if (!deletedCount) throw new AppError(404, 'not_found', 'Item not found')
  })
}

/** A computer's read: its person is a member and its linked device is in the set. */
export async function teamVaultReader(teamId: string, userId: string, deviceId: string) {
  const members = await membersFor(teamId, userId)

  return (await deviceSet(teamId, members)).some((device) => device._id === deviceId)
}
