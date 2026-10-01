import { z } from 'zod'

import { db } from '@/lib/db'

export const runtimeDefaultsSchema = z
  .object({
    model: z.string().trim().min(1).max(500).optional(),
    fast: z.enum(['on', 'off']).optional(),
    effort: z.string().trim().min(1).max(100).optional(),
  })
  .strict()

export type RuntimeDefaults = z.infer<typeof runtimeDefaultsSchema>

type RuntimeDefaultsDocument = {
  _id: string
  teamId: string
  runtimeId: string
  defaults: RuntimeDefaults
}

const collection = () => db().collection<RuntimeDefaultsDocument>('agent_runtime_defaults')
const key = (teamId: string, runtimeId: string) => JSON.stringify([teamId, runtimeId])

export async function listRuntimeDefaults(teamId: string, runtimeIds: string[]) {
  const docs = await collection()
    .find({ teamId, _id: { $in: runtimeIds.map((runtimeId) => key(teamId, runtimeId)) } })
    .sort({ _id: 1 })
    .toArray()

  return new Map(docs.map((doc) => [doc.runtimeId, doc.defaults]))
}

export async function getRuntimeDefaults(
  teamId: string,
  runtimeId: string,
): Promise<RuntimeDefaults> {
  const doc = await collection().findOne({ _id: key(teamId, runtimeId), teamId })

  return doc?.defaults ?? {}
}

/** Replace the defaults as a unit; an empty object restores runtime defaults. */
export async function setRuntimeDefaults(
  teamId: string,
  runtimeId: string,
  defaults: RuntimeDefaults,
) {
  await collection().updateOne(
    { _id: key(teamId, runtimeId), teamId },
    { $set: { teamId, runtimeId, defaults } },
    { upsert: true },
  )
}

export async function removeRuntimeDefaults(teamId: string, runtimeId: string) {
  await collection().deleteOne({ _id: key(teamId, runtimeId), teamId })
}
