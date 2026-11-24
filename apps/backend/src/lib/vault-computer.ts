// Adds a computer to its manager's vault from afar (nuphos/nuphos#5016). The computer
// makes its own key pair with `nuphos vault keygen` over the channel `local_exec` uses,
// so its private key never leaves it; only the public key comes back, and the device
// waits for an approval like any other. The key and its fingerprint pass through
// Nuphos: no weaker than `nuphos vault enroll` in a Nuphos terminal, weaker than one
// over the person's own SSH.

import { dispatchLocalExec } from '@/lib/agent/devices/dispatch'
import { requireShellAccess } from '@/lib/agent/devices/manage-access'
import { AppError } from '@/lib/errors'
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
}

const defaultDeps: VaultComputerDeps = {
  computer: (actorId, teamId, deviceId) => requireShellAccess(actorId, teamId, deviceId, 'exec'),
  run: (actorId, teamId, deviceId, command) =>
    dispatchLocalExec(actorId, deviceId, command, { teamId }),
  addVaultDevice,
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

  // A device name is at most 64 characters, as `POST /vault/devices` takes it.
  return deps.addVaultDevice(actorId, computer.label.trim().slice(0, 64), publicKey, {
    userId: computer.userId,
    deviceId: computer.deviceId,
  })
}

/**
 * An item as a computer reads it with its device credential: only when the vault's
 * owner approved a device linked to that computer, and only that device's key.
 */
export async function getVaultItemForComputer(userId: string, computer: Computer, name: string) {
  const device = await devices().findOne({
    userId,
    state: 'enrolled',
    'computer.userId': computer.userId,
    'computer.deviceId': computer.deviceId,
  })
  const doc = device && (await items().findOne({ userId, name }))

  if (!device || !doc) throw new AppError(404, 'not_found', 'Item not found')

  return {
    deviceId: device._id,
    item: itemView({ ...doc, keys: doc.keys.filter((key) => key.deviceId === device._id) }),
  }
}
