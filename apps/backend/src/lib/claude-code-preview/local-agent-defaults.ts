import { db } from '@/lib/db'

import type { RuntimeDefaults } from './runtime-defaults'

/** An owner's choices for one of their own local agents; never a team's runtime defaults. */
type LocalAgentDefaultsDocument = { _id: string; defaults: RuntimeDefaults; updatedAt: Date }

const collection = () => db().collection<LocalAgentDefaultsDocument>('local_agent_defaults')

export async function getLocalAgentDefaults(runtimeId: string): Promise<RuntimeDefaults> {
  return (await collection().findOne({ _id: runtimeId }))?.defaults ?? {}
}

/** Replace the defaults as a unit; an empty object restores the agent's own defaults. */
export async function setLocalAgentDefaults(
  runtimeId: string,
  defaults: RuntimeDefaults,
): Promise<void> {
  await collection().updateOne(
    { _id: runtimeId },
    { $set: { defaults, updatedAt: new Date() } },
    { upsert: true },
  )
}
