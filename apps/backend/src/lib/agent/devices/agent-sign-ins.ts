import { logError } from '@/lib/observability'

import { recordDeviceAccessChange } from './access-audit'
import { registryKey } from './agent-registry'
import { deviceOwner } from './box-access'
import { LOCAL_AGENT_PROVIDERS } from './local-runtime/protocol'
import { requestAgentReset } from './pending-resets'
import { agentDevices } from './store'

import type { DeviceAccessAuditEntry, DeviceAccessChanger, TeamAccess } from './access-audit'
import type { AgentSignIn, RegisteredAgent } from './agent-registry'
import type { LocalAgentProvider, RemovableAgent } from './local-runtime/protocol'
import type { AgentDevice } from './store'

type DeviceRef = Pick<AgentDevice, 'userId' | 'deviceId'>
type AgentRef = Pick<RegisteredAgent, 'provider' | 'instanceId'>
type Reset = typeof requestAgentReset

/** Who signed the agent in through Nuphos, ended or not. */
export function agentSignIn(
  device: Pick<AgentDevice, 'signIns'>,
  agent: AgentRef,
): AgentSignIn | undefined {
  return device.signIns?.find((entry) => entry.agent === registryKey(agent))
}

/**
 * Records who signed the agent in, replacing its record, ended or not: its host reset it first,
 * so it holds only this account. A newer record is kept over a late write; false then. A
 * sign-out records nothing: removing an API key can leave the account.
 */
export async function recordAgentSignIn(
  { userId, deviceId }: DeviceRef,
  agent: AgentRef,
  by: { userId: string; teamId: string; at: Date },
): Promise<boolean> {
  const key = registryKey(agent)
  const others = {
    $filter: { input: { $ifNull: ['$signIns', []] }, cond: { $ne: ['$$this.agent', key] } },
  }
  const entry: AgentSignIn = { agent: key, ...by }
  // A reset asked for before it, still waiting for a host that could not run it, would sign
  // this one out once that host can: the one it was for is gone already.
  const stale = {
    $and: [
      { $eq: [{ $ifNull: ['$$this.agent.instanceId', '$$this.agent.provider'] }, key] },
      { $lt: ['$$this.at', by.at] },
    ],
  }
  const { matchedCount } = await agentDevices().updateOne(
    { userId, deviceId, signIns: { $not: { $elemMatch: { agent: key, at: { $gt: by.at } } } } },
    [
      {
        $set: {
          signIns: { $concatArrays: [others, [{ $literal: entry }]] },
          pendingResets: {
            $filter: { input: { $ifNull: ['$pendingResets', []] }, cond: { $not: [stale] } },
          },
        },
      },
    ],
  )

  return matchedCount > 0
}

/** The agent a registry key names: a default agent by its provider, an added one by its id. */
const removable = (key: string): RemovableAgent =>
  (LOCAL_AGENT_PROVIDERS as readonly string[]).includes(key)
    ? { provider: key as LocalAgentProvider }
    : { instanceId: key }

const current = (device: Pick<AgentDevice, 'signIns'>) =>
  (device.signIns ?? []).filter((signIn) => !signIn.endedAt)

/**
 * Ends these sign-ins and has the computer reset their agents, now or once it can, so none
 * keeps the account. An ended agent runs nothing meanwhile, so this does not wait for its host.
 */
async function endSignIns(
  device: AgentDevice,
  ending: AgentSignIn[],
  by: { actorId: string; teamId: string },
  reset: Reset,
): Promise<void> {
  if (!ending.length) return
  const { userId, deviceId } = device

  await agentDevices().updateOne(
    { userId, deviceId },
    { $set: { 'signIns.$[s].endedAt': new Date() } },
    {
      // These records only: a sign-in recorded since is not the one that went out of reach.
      arrayFilters: [
        {
          $or: ending.map(({ agent, at }) => ({ 's.agent': agent, 's.at': at })),
          's.endedAt': { $exists: false },
        },
      ],
    },
  )
  for (const { agent } of ending)
    void reset({ userId, deviceId }, removable(agent), by).catch((error: unknown) => {
      logError('backend.device_agent_reset_failed', error, { deviceId, agent })
    })
}

/** Ends this person's sign-in of the agent, for one who lost managing it while signing in. */
export async function endAgentSignIn(
  { userId, deviceId }: DeviceRef,
  agent: AgentRef,
  signer: { userId: string; teamId: string },
  reset: Reset = requestAgentReset,
): Promise<void> {
  const device = await agentDevices().findOne({ userId, deviceId })
  const signIn = device ? agentSignIn(device, agent) : undefined

  if (device && signIn && !signIn.endedAt && signIn.userId === signer.userId)
    await endSignIns(
      device,
      [signIn],
      { actorId: deviceOwner(device), teamId: signer.teamId },
      reset,
    )
}

/** Whether anyone who could use the computer under `previous` cannot under `next`. */
function someoneLost(previous: TeamAccess | null, next: TeamAccess | null): boolean {
  if (!previous) return false
  const kept = new Set([...(next?.userIds ?? []), ...(next?.managerIds ?? [])])

  return (
    (previous.everyone && !next?.everyone) ||
    (!next?.everyone && [...previous.userIds, ...previous.managerIds].some((id) => !kept.has(id)))
  )
}

/**
 * Ends the sign-ins a change to who may use or manage a computer puts out of reach: all of them
 * when anyone loses access, else those its new non-managers made in the team.
 */
export async function endSignInsAfter(
  before: AgentDevice,
  entry: DeviceAccessAuditEntry,
  reset: Reset = requestAgentReset,
): Promise<void> {
  const { previous, next, teamId, actorUserId } = entry
  const managers = new Set(next?.managerIds)
  // A Box changing hands keeps them (#2425): its grants stay as they were.
  const ending = someoneLost(previous, next)
    ? current(before)
    : current(before).filter(
        ({ teamId: team, userId }) =>
          team === teamId && previous?.managerIds.includes(userId) && !managers.has(userId),
      )

  await endSignIns(before, ending, { actorId: actorUserId, teamId }, reset)
}

/** Audits a change to a computer's access, then ends the sign-ins it puts out of reach. */
export async function recordAccessChange(
  before: AgentDevice,
  entry: DeviceAccessAuditEntry,
  reset: Reset = requestAgentReset,
): Promise<void> {
  await recordDeviceAccessChange(entry)
  await endSignInsAfter(before, entry, reset).catch((error: unknown) => {
    logError('backend.device_sign_in_end_failed', error, { deviceId: before.deviceId })
  })
}

/** Someone left the team: they could use every computer granted to everyone in it. */
export async function endSignInsOnLeave(
  teamId: string,
  by: DeviceAccessChanger,
  reset: Reset = requestAgentReset,
): Promise<void> {
  const devices = await agentDevices()
    .find({
      access: { $elemMatch: { teamId, everyone: true } },
      signIns: { $elemMatch: { endedAt: { $exists: false } } },
    })
    .toArray()

  await Promise.all(
    devices.map((device) =>
      endSignIns(device, current(device), { actorId: by.actorUserId, teamId }, reset),
    ),
  )
}
