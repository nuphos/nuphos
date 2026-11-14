import { agentSignIn } from '@/lib/agent/devices/agent-sign-ins'
import { requireAgentSignInAccess, requireDeviceUse } from '@/lib/agent/devices/manage-access'
import { agentDevices } from '@/lib/agent/devices/store'
import { AppError } from '@/lib/errors'

import { runtimeLabel } from './runtime-provider'

import type { RegisteredAgent } from '@/lib/agent/devices/agent-registry'
import type { DeviceAccessDeps } from '@/lib/agent/devices/box-access'
import type { LocalAgentRef } from '@/lib/agent/devices/local-runtime/address'
import type { AgentDevice } from '@/lib/agent/devices/store'

/**
 * The computer, when the actor may reach this agent for `purpose`: signing it in takes managing
 * the computer; running it takes using it, and a sign-in that is still current.
 */
export async function requireLocalAgentAccess(
  userId: string,
  teamId: string,
  ref: LocalAgentRef,
  purpose: 'transport' | 'control' | 'login',
  access: DeviceAccessDeps,
): Promise<AgentDevice> {
  if (purpose === 'login') return requireAgentSignInAccess(userId, teamId, ref.deviceId, access)
  const device = await requireDeviceUse(userId, teamId, ref.deviceId, access)

  if (agentSignIn(device, ref)?.endedAt)
    throw new AppError(
      409,
      'runtime_login_required',
      `Whoever signed in ${runtimeLabel(ref.provider)} on this computer no longer has access to it. Someone who manages the computer needs to sign it in again.`,
    )

  return device
}

/** Whether a computer's agent is signed in; false once its sign-in ended (agent-sign-ins). */
export type LocalAgentSignIn = {
  signedIn: boolean | null
  /** Who signed it in through Nuphos, while it is signed in. */
  signedInBy?: { userId: string; at: string }
  /** Its sign-in ended: only a sign-in through Nuphos renews it, not the CLI's own. */
  signInEnded?: true
}

/** Whether the agent is signed in, and as whom when that was done through Nuphos. */
export function localAgentSignIn(
  device: AgentDevice,
  agent: Pick<RegisteredAgent, 'provider' | 'instanceId'>,
  reported: boolean | null,
): LocalAgentSignIn {
  const signIn = agentSignIn(device, agent)

  if (signIn?.endedAt) return { signedIn: false, signInEnded: true }

  return {
    signedIn: reported,
    ...(signIn && reported
      ? { signedInBy: { userId: signIn.userId, at: signIn.at.toISOString() } }
      : {}),
  }
}

export type LocalStatusDeps = { ended?: (ref: LocalAgentRef) => Promise<boolean> }

/** Whether a sign-in of this computer's agent has ended. */
async function localSignInEnded(ref: LocalAgentRef): Promise<boolean> {
  const device = await agentDevices().findOne(
    { userId: ref.userId, deviceId: ref.deviceId },
    { projection: { signIns: 1 } },
  )

  return Boolean(device && agentSignIn(device, ref)?.endedAt)
}

/**
 * Whether the agent reads signed in, as a sign-in request checks it: its CLI stays logged in
 * once its sign-in ended, but runs nothing until a new one.
 */
export async function cliSignedIn(
  ref: LocalAgentRef,
  loggedIn: boolean | null | undefined,
  { ended = localSignInEnded }: LocalStatusDeps = {},
): Promise<boolean | null | undefined> {
  return loggedIn && (await ended(ref)) ? false : loggedIn
}
