import { logError } from '@/lib/observability'

import { buildDeviceAccessAuditEntry, recordDeviceAccessChange } from './access-audit'
import { registryKey } from './agent-registry'
import { teamGrant } from './device-grants'
import { parseLocalRuntimeId } from './local-runtime/address'
import { agentDevices } from './store'

import type { LocalAgentRef } from './local-runtime/address'

/**
 * Notes who signed a computer's agent in, or that it was signed out, and audits it. Other
 * runtimes are skipped. Best effort, as the audit: the sign-in itself already happened.
 */
export async function recordAgentSignIn(
  teamId: string,
  runtimeId: string,
  userId: string,
  signedOut: boolean,
): Promise<void> {
  const ref = parseLocalRuntimeId(runtimeId)

  if (!ref) return
  try {
    await noteSignIn(teamId, ref, userId, signedOut)
  } catch (err) {
    logError('agent.sign_in_record.write_failed', err, { deviceId: ref.deviceId, teamId })
  }
}

async function noteSignIn(
  teamId: string,
  ref: LocalAgentRef,
  userId: string,
  signedOut: boolean,
): Promise<void> {
  const key = registryKey(ref)
  const filter = { userId: ref.userId, deviceId: ref.deviceId }
  // One update, so two sign-ins finishing together still leave one entry for the agent.
  const others = {
    $filter: {
      input: { $ifNull: ['$signIns', []] },
      cond: { $ne: ['$$this.key', { $literal: key }] },
    },
  }
  const before = await agentDevices().findOneAndUpdate(
    filter,
    [
      {
        $set: {
          signIns: signedOut
            ? others
            : { $concatArrays: [others, [{ $literal: { key, userId, at: new Date() } }]] },
        },
      },
    ],
    { returnDocument: 'before' },
  )

  if (!before) return
  const grant = teamGrant(before, teamId)
  const access = grant
    ? { everyone: grant.everyone, userIds: grant.userIds, managerIds: grant.managerIds }
    : null

  await recordDeviceAccessChange({
    ...buildDeviceAccessAuditEntry(before, teamId, access, {
      actorUserId: userId,
      via: 'agent_sign_in',
    }),
    agent: {
      provider: ref.provider,
      ...(ref.instanceId ? { instanceId: ref.instanceId } : {}),
      ...(signedOut ? { signedOut: true as const } : {}),
    },
  })
}
