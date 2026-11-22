import { parseLocalRuntimeId } from '@/lib/agent/devices/local-runtime/address'

/** Who may sign a computer's agent in: its owner and its managers (#2431). */
export type ComputerSigners = { owner: string; canSignIn: (userId: string) => boolean }

/**
 * The computer a local agent runs on, as on record, and who may sign that agent in, which
 * is the rule runtime-login.ts enforces. Null for a team agent or a computer no longer on
 * record. Loaded on use: device access reaches the whole devices graph.
 */
export async function computerSigners(
  teamId: string,
  runtimeId: string,
): Promise<ComputerSigners | null> {
  const ref = parseLocalRuntimeId(runtimeId)

  if (!ref) return null
  const { allows, deviceAccess, deviceOwner, deviceAccessDeps } =
    await import('@/lib/agent/devices/box-access')
  const device = await deviceAccessDeps.getDevice(ref.userId, ref.deviceId)

  return device
    ? {
        owner: deviceOwner(device),
        canSignIn: (userId) => allows(deviceAccess(device, userId, teamId), 'manage'),
      }
    : null
}
