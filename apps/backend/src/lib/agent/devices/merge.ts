import { db } from '@/lib/db'

import { localRuntimeId, localRuntimeUrl, parseLocalRuntimeUrl } from './local-runtime/address'

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

const escapeRegex = (text: string) => text.replace(/[.*+?^$()|[\]{}\\/]/gu, '\\$&')

const at = (doc: Doc, path: string): unknown =>
  path.split('.').reduce<unknown>((value, key) => (value as Doc | undefined)?.[key], doc)

// A conversation on one of the device's local agents names it twice: in its
// runtime id and in the runtime URL its turns are addressed to.
async function moveLocalAgentConversations(userId: string, fromId: string, toId: string) {
  const conversations = db().collection<Doc>('agent_conversations')

  for (const provider of ['claude-code', 'codex'] as const) {
    await conversations.updateMany(
      { userId, runtimeId: localRuntimeId({ userId, deviceId: fromId, provider }) },
      { $set: { runtimeId: localRuntimeId({ userId, deviceId: toId, provider }) } },
    )
  }
  const prefix = `nuphos-device://runtime/${encodeURIComponent(userId)}/${encodeURIComponent(fromId)}?`
  const pinned = await conversations
    .find(
      { userId, 'claudeCodePreview.runtimeUrl': { $regex: `^${escapeRegex(prefix)}` } },
      { projection: { 'claudeCodePreview.runtimeUrl': 1 } },
    )
    .toArray()

  for (const doc of pinned) {
    const ref = parseLocalRuntimeUrl(String(at(doc, 'claudeCodePreview.runtimeUrl')))

    if (ref?.userId !== userId || ref.deviceId !== fromId) continue
    await conversations.updateOne(
      { _id: doc._id },
      {
        $set: {
          'claudeCodePreview.runtimeUrl': localRuntimeUrl({ ...ref, deviceId: toId }, ref.teamId),
        },
      },
    )
  }
}

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
  await moveLocalAgentConversations(userId, fromId, toId)
  for (const name of HISTORY) {
    await db()
      .collection(name)
      .updateMany({ ownerUserId: userId, deviceId: fromId }, { $set: { deviceId: toId } })
  }
  await devices.deleteOne({ userId, deviceId: fromId })

  return true
}
