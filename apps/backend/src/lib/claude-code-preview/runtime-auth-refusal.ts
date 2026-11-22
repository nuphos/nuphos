import { db } from '@/lib/db'
import { logError } from '@/lib/observability'

import { isRuntimeAuthRequired } from './openab-acp-errors'

import type { Collection } from 'mongodb'

/**
 * An agent whose provider refused its sign-in on its last turn. Its computer may still
 * report the CLI signed in (a credential file the provider no longer accepts), so this
 * is the only sign that it cannot run. Kept until a turn there succeeds or it signs in again.
 */
type RuntimeAuthRefusal = { teamId: string; runtimeId: string; at: Date }

const refusals = (): Collection<RuntimeAuthRefusal> =>
  db().collection<RuntimeAuthRefusal>('runtime_auth_refusals')

export async function setupRuntimeAuthRefusalIndexes(): Promise<void> {
  await refusals().createIndex(
    { teamId: 1, runtimeId: 1 },
    { unique: true, name: 'runtime_auth_refusal_unique' },
  )
}

/** Best effort: a failed read or write never fails the listing, turn or sign-in it serves. */
async function quietly<T>(runtimeId: string, work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work()
  } catch (error) {
    logError('agent.runtime_auth_refusal.failed', error, { runtime_id: runtimeId })

    return fallback
  }
}

/** A completed sign-in clears the refusal. */
export const forgetAuthRefusal = (teamId: string, runtimeId: string) =>
  quietly(runtimeId, () => refusals().deleteOne({ teamId, runtimeId }), undefined)

/**
 * Passes a turn through, noting what it says about the agent's sign-in: a turn the agent
 * ran clears a refusal, an explicit refusal records one, and any other failure (usage, a
 * lost connection, a generic -32000) or a turn never sent says nothing.
 */
export async function noteTurnSignIn<T extends { stopReason: string; unsent?: true }>(
  teamId: string,
  runtimeId: string | undefined,
  turn: Promise<T>,
): Promise<T> {
  const result = await turn.catch(async (error: unknown) => {
    if (runtimeId && isRuntimeAuthRequired(error))
      await quietly(
        runtimeId,
        () =>
          refusals().updateOne(
            { teamId, runtimeId },
            { $set: { at: new Date() } },
            { upsert: true },
          ),
        undefined,
      )
    throw error
  })

  if (runtimeId && !result.unsent && result.stopReason !== 'cancelled')
    await forgetAuthRefusal(teamId, runtimeId)

  return result
}

/** The team's agents whose last turn was refused for their sign-in. */
export async function authRefusedRuntimes(teamId: string): Promise<Set<string>> {
  const rows = await quietly(
    teamId,
    () =>
      refusals()
        .find({ teamId }, { projection: { runtimeId: 1 } })
        .toArray(),
    [],
  )

  return new Set(rows.map((row) => row.runtimeId))
}
