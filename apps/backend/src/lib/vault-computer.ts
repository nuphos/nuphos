// Adds a computer to its manager's vault from afar (nuphos/nuphos#5016). The computer
// makes its own key pair with `nuphos vault keygen` over the channel `local_exec` uses,
// so its private key never leaves it; only the public key comes back, and the device
// waits for an approval like any other. The key and its fingerprint pass through
// Nuphos: no weaker than `nuphos vault enroll` in a Nuphos terminal, weaker than one
// over the person's own SSH.

import { ObjectId } from 'mongodb'

import { dispatchLocalExec } from '@/lib/agent/devices/dispatch'
import { requireShellAccess } from '@/lib/agent/devices/manage-access'
import { AppError } from '@/lib/errors'
import { users } from '@/lib/identity/shared'
import { addVaultDevice, devices, itemView, items } from '@/lib/vault'

import type { LocalExecDispatchOutcome } from '@/lib/agent/devices/dispatch'
import type { Computer } from '@/lib/vault'

export type VaultComputerDeps = {
  /** The computer, when the actor may run commands on it; throws otherwise. */
  computer: (
    actorId: string,
    teamId: string,
    deviceId: string,
  ) => Promise<Computer & { label: string }>
  run: (
    actorId: string,
    teamId: string,
    deviceId: string,
    command: string,
  ) => Promise<LocalExecDispatchOutcome>
  addVaultDevice: typeof addVaultDevice
  /** The key Desktop holds in its owner's vault, when the computer is a Desktop that linked it. */
  ownerKey: (computer: Computer) => Promise<string | null>
}

const defaultDeps: VaultComputerDeps = {
  computer: (actorId, teamId, deviceId) => requireShellAccess(actorId, teamId, deviceId, 'exec'),
  run: (actorId, teamId, deviceId, command) =>
    dispatchLocalExec(actorId, deviceId, command, { teamId }),
  addVaultDevice,
  ownerKey: desktopKey,
}

/** The key Desktop holds in its owner's vault, when the computer is a Desktop that linked it. */
export async function desktopKey(computer: Computer): Promise<string | null> {
  const linked = await devices().findOne({
    userId: computer.userId,
    state: 'enrolled',
    computer: linkOf(computer),
    desktop: true,
  })

  return linked?.publicKey ?? null
}

const X25519_PUBLIC_KEY = /^[A-Za-z0-9+/]{43}=$/

export async function addComputerToVault(
  actorId: string,
  teamId: string,
  deviceId: string,
  deps = defaultDeps,
) {
  const computer = await deps.computer(actorId, teamId, deviceId)

  // A user id goes into a shell command: refuse anything but its plain characters,
  // and a leading "-" that would read as an option.
  if (!/^\w[\w-]*$/.test(actorId)) throw new AppError(400, 'bad_request', 'Invalid user')
  // Desktop has no CLI to make a key: it offers the one it holds in its owner's vault.
  const own = await deps.ownerKey(linkOf(computer))

  if (own) return deps.addVaultDevice(actorId, deviceName(computer), own, linkOf(computer))
  // An empty vault is refused after this, when the key is registered; the computer
  // keeps the unused key and offers it again next time.
  const outcome = await deps.run(actorId, teamId, deviceId, `nuphos vault keygen --user ${actorId}`)

  if (outcome.status !== 'ok')
    throw new AppError(409, 'runtime_offline', 'The computer did not answer. Open it, then retry.')
  const publicKey = outcome.result.stdout.trim()

  if (outcome.result.exitCode !== 0 || !X25519_PUBLIC_KEY.test(publicKey))
    throw new AppError(
      409,
      'vault_keygen_failed',
      'The computer could not make a vault key. Update Nuphos on it, then retry.',
    )

  return deps.addVaultDevice(actorId, deviceName(computer), publicKey, linkOf(computer))
}

// A device name is 1 to 64 characters, as `POST /vault/devices` takes it.
const deviceName = (computer: Computer & { label: string }) =>
  (computer.label.trim() || computer.deviceId).slice(0, 64)
// Always in this field order: the link is matched as a whole.
const linkOf = ({ userId, deviceId }: Computer): Computer => ({ userId, deviceId })

/**
 * A computer that just joined offers its own key to its owner's vault: it made the
 * key with `nuphos vault keygen`, so only the public key comes here, and it waits for
 * the owner's approval like any other device.
 */
export const offerComputerKey = (
  computer: Computer & { label: string },
  publicKey: string,
  deps = { addVaultDevice },
) => deps.addVaultDevice(computer.userId, deviceName(computer), publicKey, linkOf(computer))

/**
 * An item as a computer reads it with its device credential: only when the vault's
 * owner approved a device linked to that computer and shared the item with it, and
 * only that device's key.
 */
export async function getVaultItemForComputer(userId: string, computer: Computer, name: string) {
  const device = await devices().findOne({
    userId,
    state: 'enrolled',
    'computer.userId': computer.userId,
    'computer.deviceId': computer.deviceId,
  })
  const doc = device && (await items().findOne({ userId, name, 'keys.deviceId': device._id }))

  if (!device || !doc)
    throw new AppError(404, 'not_found', 'Item not found, or not shared with this computer')

  return {
    deviceId: device._id,
    item: itemView({ ...doc, keys: doc.keys.filter((key) => key.deviceId === device._id) }),
  }
}

/**
 * Whose vaults share an item with this computer: each owner who approved a device linked to
 * it and wrapped the item's key for that device. Who and their name only, never the item.
 */
export async function vaultOwnersSharingWithComputer(computer: Computer, name: string) {
  const linked = await devices()
    .find({
      state: 'enrolled',
      'computer.userId': computer.userId,
      'computer.deviceId': computer.deviceId,
    })
    .toArray()
  const shared = linked.length
    ? await items()
        .find({ name, userId: { $in: linked.map((device) => device.userId) } })
        .toArray()
    : []
  const owners = shared
    .filter((item) =>
      linked.some(
        (device) =>
          device.userId === item.userId && item.keys.some((key) => key.deviceId === device._id),
      ),
    )
    .map((item) => item.userId)
  const ids = owners.filter((id) => ObjectId.isValid(id)).map((id) => new ObjectId(id))
  const names = new Map(
    (
      await users()
        .find({ _id: { $in: ids } }, { projection: { name: 1 } })
        .toArray()
    ).map((user) => [user._id.toHexString(), user.name]),
  )

  return owners.map((userId) => ({ userId, name: names.get(userId) ?? '' }))
}
