import { db } from '@/lib/db'

import type { UpdateFilter } from 'mongodb'

// Every stored selection that can hold a device id.
const SELECTIONS = [
  ['agent_conversations', 'credentialAccess.deviceIds'],
  ['cost_panels', 'credentialAccess.deviceIds'],
  ['agent_triggers', 'executionCredentialAccess.deviceIds'],
  ['agent_trigger_groups', 'executionCredentialAccess.deviceIds'],
] as const

/**
 * Folds a registration this computer used before into its stable one: every
 * selection that ticked the old id ticks the new one, then the old record goes.
 * Only an id registered to the same user is merged; anything else is ignored,
 * which also makes a repeat a no-op.
 */
export async function mergeAgentDevice(
  userId: string,
  fromId: string,
  toId: string,
): Promise<boolean> {
  const devices = db().collection('agent_devices')

  if (fromId === toId || !(await devices.findOne({ userId, deviceId: fromId }))) return false
  for (const [name, field] of SELECTIONS) {
    const selections = db().collection(name)

    // A selection that already ticks both just loses the old id.
    await selections.updateMany({ [field]: { $all: [fromId, toId] } }, {
      $pull: { [field]: fromId },
    } as UpdateFilter<Record<string, unknown>>)
    await selections.updateMany(
      { [field]: fromId },
      { $set: { [`${field}.$[old]`]: toId } },
      { arrayFilters: [{ old: fromId }] },
    )
  }
  await devices.deleteOne({ userId, deviceId: fromId })

  return true
}
