import { db } from '@/lib/db'

import { localRuntimeId } from './local-runtime/address'

import type { Filter, UpdateFilter } from 'mongodb'

type Doc = Record<string, unknown>

// Every stored selection that can hold a device id, limited to the documents
// whose turns run as `userId`, the only user who can use that device.
const SELECTIONS: [string, string, (userId: string) => Filter<Doc>][] = [
  ['agent_conversations', 'credentialAccess.deviceIds', (userId) => ({ userId })],
  ['cost_panels', 'credentialAccess.deviceIds', (createdBy) => ({ createdBy })],
  ...(['agent_triggers', 'agent_trigger_groups'] as const).map(
    (name): [string, string, (userId: string) => Filter<Doc>] => [
      name,
      'executionCredentialAccess.deviceIds',
      (userId) => ({
        $or: [{ userId }, { createdByUserId: userId }, { executionPrincipalUserId: userId }],
      }),
    ],
  ),
]

// Per-device history, read back by owner and device id.
const HISTORY = ['agent_device_exec_audit', 'agent_device_runtime_sessions']

/**
 * Folds a registration this computer used before into its stable one: the
 * user's selections that ticked the old id tick the new one, conversations on
 * its local agents move with it, its history follows, and the old record goes.
 * Only the caller's own registration is merged and only their documents are
 * touched; a repeat is a no-op. The record is deleted last, so a merge cut
 * short is finished by the next registration.
 */
export async function mergeAgentDevice(
  userId: string,
  fromId: string,
  toId: string,
): Promise<boolean> {
  const devices = db().collection('agent_devices')

  if (fromId === toId || !(await devices.findOne({ userId, deviceId: fromId }))) return false
  for (const [name, field, owned] of SELECTIONS) {
    const selections = db().collection<Doc>(name)

    // A selection that already ticks both just loses the old id.
    await selections.updateMany({ ...owned(userId), [field]: { $all: [fromId, toId] } }, {
      $pull: { [field]: fromId },
    } as UpdateFilter<Doc>)
    await selections.updateMany(
      { ...owned(userId), [field]: fromId },
      { $set: { [`${field}.$[old]`]: toId } },
      { arrayFilters: [{ old: fromId }] },
    )
  }
  for (const provider of ['claude-code', 'codex'] as const) {
    await db()
      .collection('agent_conversations')
      .updateMany(
        { userId, runtimeId: localRuntimeId({ userId, deviceId: fromId, provider }) },
        { $set: { runtimeId: localRuntimeId({ userId, deviceId: toId, provider }) } },
      )
  }
  for (const name of HISTORY) {
    await db()
      .collection(name)
      .updateMany({ ownerUserId: userId, deviceId: fromId }, { $set: { deviceId: toId } })
  }
  await devices.deleteOne({ userId, deviceId: fromId })

  return true
}
