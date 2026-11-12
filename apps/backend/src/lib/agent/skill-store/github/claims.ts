import { randomUUID } from 'node:crypto'

import { skillMetadataRepository } from '@/lib/agent/skill-store/metadata'
import { db } from '@/lib/db'
import { AppError } from '@/lib/errors'

import { skillOriginId } from './origin'

/** A claim older than this belongs to a request that died before releasing it. */
export const CLAIM_TTL_MS = 10 * 60_000

type SkillNameClaim = { _id: string; mutationId: string; claimedAt: Date }

const claims = () => db().collection<SkillNameClaim>('skill_name_claims')

const isDuplicateKey = (err: unknown) => (err as { code?: unknown }).code === 11000

/**
 * Holds `name` in `scope` for one install, so two installs of the same name
 * cannot both write it. The same mutation may take its own claim again.
 */
async function claim(scope: string, name: string, mutationId: string): Promise<void> {
  const _id = skillOriginId(scope, name)
  const claimedAt = new Date()

  try {
    await claims().insertOne({ _id, mutationId, claimedAt })
  } catch (err) {
    if (!isDuplicateKey(err)) throw err
    const stale = new Date(claimedAt.getTime() - CLAIM_TTL_MS)
    const taken = await claims().findOneAndReplace(
      { _id, $or: [{ mutationId }, { claimedAt: { $lt: stale } }] },
      { mutationId, claimedAt },
    )

    if (!taken)
      throw new AppError(409, 'skill_exists', `${name}: another install of this name is running`)
  }
}

/** Claims every name, or none: a refused name releases the ones already taken. */
export async function claimSkillNames(
  scope: string,
  names: string[],
  mutationId: (name: string) => string | undefined,
): Promise<() => Promise<void>> {
  const held: { _id: string; mutationId: string }[] = []
  const release = async () => {
    for (const entry of held) await claims().deleteOne(entry)
  }

  try {
    for (const name of names) {
      const id = mutationId(name) ?? randomUUID()

      await claim(scope, name, id)
      held.push({ _id: skillOriginId(scope, name), mutationId: id })
    }
  } catch (err) {
    await release()
    throw err
  }

  return release
}

/** Whether this mutation already completed, so a retried request is a replay, not a conflict. */
export async function completedBefore(mutationId: string | undefined): Promise<boolean> {
  if (!mutationId) return false

  return (await skillMetadataRepository().getResult(mutationId))?.status === 'applied'
}
