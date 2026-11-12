import { createHash } from 'node:crypto'

import { byCodeUnit } from '@/lib/agent/sort-order'
import { db } from '@/lib/db'

import { normalizeSkillScope } from '../scope'

/** Where a skill installed from GitHub came from, kept apart from edit provenance. */
export type SkillOrigin = {
  _id: string
  scope: string
  name: string
  repo: string
  ref: string | null
  path: string
  commitSha: string
  /** Hash of the upstream folder, compared on update checks. */
  contentHash: string
  /** Per-file hashes of the upstream folder, for the change preview of an update.
   *  Absent on origins recorded before the hashes were kept. */
  fileHashes?: Record<string, string>
  /** Object ETags right after install; a mismatch later means the skill was edited. */
  installedEtags: Record<string, string>
  installedAt: Date
  installedByUserId: string | null
}

export const SKILL_ORIGINS_COLLECTION = 'skill_origins'

const skillOrigins = () => db().collection<SkillOrigin>(SKILL_ORIGINS_COLLECTION)

export const skillOriginId = (scope: string, name: string) =>
  `${normalizeSkillScope(scope)}/skills/${name}`

export async function recordSkillOrigin(origin: Omit<SkillOrigin, '_id'>): Promise<void> {
  const _id = skillOriginId(origin.scope, origin.name)

  await skillOrigins().replaceOne({ _id }, origin, { upsert: true })
}

export type SkillOriginDTO = Pick<SkillOrigin, 'repo' | 'ref' | 'path' | 'commitSha'> & {
  installedAt: string
}

export async function listSkillOrigins(scope: string): Promise<SkillOrigin[]> {
  return await skillOrigins()
    .find({ scope: normalizeSkillScope(scope) })
    .toArray()
}

export async function getSkillOriginDTO(
  scope: string,
  name: string,
): Promise<SkillOriginDTO | null> {
  const origin = await skillOrigins().findOne({ _id: skillOriginId(scope, name) })

  return origin
    ? {
        repo: origin.repo,
        ref: origin.ref,
        path: origin.path,
        commitSha: origin.commitSha,
        installedAt: origin.installedAt.toISOString(),
      }
    : null
}

export function skillFileHashes(files: Map<string, Uint8Array>): Record<string, string> {
  return Object.fromEntries(
    [...files].map(([path, data]) => [path, createHash('sha256').update(data).digest('hex')]),
  )
}

/** SHA-256 over sorted `path\0size\0bytes` frames, independent of storage ETags. */
export function skillContentHash(files: Map<string, Uint8Array>): string {
  const hash = createHash('sha256')

  for (const [path, data] of [...files].sort(([a], [b]) => byCodeUnit(a, b))) {
    hash.update(`${path}\0${String(data.byteLength)}\0`).update(data)
  }

  return hash.digest('hex')
}
