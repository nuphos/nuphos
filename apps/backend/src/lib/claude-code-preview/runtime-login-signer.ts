import { registryKey } from '@/lib/agent/devices/agent-registry'
import { endAgentSignIn, recordAgentSignIn } from '@/lib/agent/devices/agent-sign-ins'
import { parseLocalRuntimeId } from '@/lib/agent/devices/local-runtime/address'
import { runtimePresenceStore } from '@/lib/agent/devices/local-runtime/presence'
import { requireAgentSignInAccess } from '@/lib/agent/devices/manage-access'
import { hostResets, requestAgentReset } from '@/lib/agent/devices/pending-resets'
import { agentDevices } from '@/lib/agent/devices/store'
import { AppError } from '@/lib/errors'

import { reportedLocalAgent } from './local-runtime-catalog'

import type { RuntimeLoginDoc } from './runtime-login-store'
import type { DeviceAgentRecords } from '@/lib/agent/devices/agent-registry'
import type { LocalAgentRef } from '@/lib/agent/devices/local-runtime/address'
import type { LocalRuntimeStatus } from '@/lib/agent/devices/local-runtime/protocol'

export type SignerDeps = {
  /** Whether the signer still manages the computer once their sign-in is recorded. */
  manages?: (doc: RuntimeLoginDoc, deviceId: string) => Promise<boolean>
  /** Resets a computer's agent, or queues it; defaults to its host (pending-resets). */
  reset?: typeof requestAgentReset
}

/** Whether a computer is a Box, whose host resets its default agents too. */
const isBox = async ({ userId, deviceId }: { userId: string; deviceId: string }) =>
  Boolean((await agentDevices().findOne({ userId, deviceId }, { projection: { box: 1 } }))?.box)

export type UnstartedDeps = {
  status?: (ref: LocalAgentRef) => Promise<LocalRuntimeStatus | undefined>
  device?: (ref: LocalAgentRef) => Promise<DeviceAgentRecords | null>
}

const unstartedDeps: Required<UnstartedDeps> = {
  status: async (ref) => (await runtimePresenceStore().get(ref.userId, ref.deviceId))?.status,
  device: ({ userId, deviceId }) =>
    agentDevices().findOne({ userId, deviceId }, { projection: { agents: 1, signIns: 1 } }),
}

/**
 * An added agent its online computer is still installing, or does not list yet, has never run
 * if the computer never reported its CLI installed and no one signed it in: its own home holds
 * no account. Its reset would wait out the install, past the call's deadline. One whose CLI went
 * missing later is registered, so it still resets.
 */
export async function unstarted(ref: LocalAgentRef, deps: UnstartedDeps = {}): Promise<boolean> {
  const { status: readStatus, device: readDevice } = { ...unstartedDeps, ...deps }
  const status = await readStatus(ref)
  const agent = status && reportedLocalAgent(status, ref)

  if (!status || (agent && !agent.cli.installing)) return false
  const device = await readDevice(ref)
  const key = registryKey(ref)

  return Boolean(
    device &&
    !device.agents?.some((known) => registryKey(known) === key) &&
    !device.signIns?.some((entry) => entry.agent === key),
  )
}

/**
 * Has the computer delete every account its agent holds before someone signs it in, so it
 * ends up holding theirs alone. A host too old to reset signs in over them, as it always has,
 * and so do the default agents a host never resets: a person's own computer's, which is their
 * CLI login, and Antigravity's, whose sign-in is the OS keyring.
 */
export async function resetBeforeSignIn(
  teamId: string,
  runtimeId: string,
  userId: string,
  reset = requestAgentReset,
  box = isBox,
  fresh = unstarted,
): Promise<void> {
  const ref = parseLocalRuntimeId(runtimeId)

  if (!ref) return
  const agent = ref.instanceId ? { instanceId: ref.instanceId } : { provider: ref.provider }

  if (!ref.instanceId && !hostResets(agent, await box(ref))) return
  if (ref.instanceId && (await fresh(ref))) return
  const result = await reset(ref, agent, { actorId: userId, teamId })

  if (result.state === 'queued' && result.why === 'offline')
    throw new AppError(
      409,
      'runtime_offline',
      'The computer running this agent is offline. Open Nuphos on it with the local agent turned on.',
    )
}

/**
 * A computer's agent acts as whoever signed it in, so the computer keeps who that was, as of
 * `at`, when the runtime said so. Their access may have changed while they signed in, so it is
 * checked again once that is recorded: a change after the check sees the new sign-in, and ends
 * it itself (agent-sign-ins).
 */
export async function noteSignIn(
  doc: RuntimeLoginDoc,
  at: Date,
  { manages = managesComputer, reset }: SignerDeps = {},
): Promise<void> {
  const ref = parseLocalRuntimeId(doc.runtimeId)
  const signer = doc.userId && { userId: doc.userId, teamId: doc.teamId }

  // A newer sign-in recorded meanwhile has its own signer checked.
  if (!ref || !signer || !(await recordAgentSignIn(ref, ref, { ...signer, at }))) return
  if (!(await manages(doc, ref.deviceId))) await endAgentSignIn(ref, ref, signer, reset)
}

function managesComputer(doc: RuntimeLoginDoc, deviceId: string): Promise<boolean> {
  return requireAgentSignInAccess(doc.userId ?? '', doc.teamId, deviceId).then(
    () => true,
    () => false,
  )
}
