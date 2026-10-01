import {
  serializeSkillMutationEvent,
  skillEvents,
  skillRecords,
  skillTeamIdFromScope,
} from './metadata-types'
import { normalizeSkillScope } from './scope'

import type { SkillMutationEventDTO, SkillRecord } from './metadata-types'

export async function getSkillRecord(scope: string, name: string): Promise<SkillRecord | null> {
  return skillRecords().findOne({ scope: normalizeSkillScope(scope), name })
}

export async function listSkillRecords(scope: string, names: string[]): Promise<SkillRecord[]> {
  if (names.length === 0) return []

  return skillRecords()
    .find({ scope: normalizeSkillScope(scope), name: { $in: [...new Set(names)] } })
    .toArray()
}

/**
 * Persist an S3-only package as explicitly unknown legacy provenance. This is
 * insert-only: a real mutation record is never overwritten by a backfill.
 */
export async function backfillLegacySkillRecord(input: {
  scope: string
  name: string
  lastModified: Date | null
}): Promise<boolean> {
  const scope = normalizeSkillScope(input.scope)
  const record: SkillRecord = {
    scope,
    teamId: skillTeamIdFromScope(scope),
    name: input.name,
    status: 'active',
    createdAt: null,
    createdByUserId: null,
    createdSource: 'legacy',
    updatedAt: input.lastModified,
    updatedByUserId: null,
    updatedSource: 'legacy',
    revision: 0,
    lastMutationId: `legacy:${scope}:${input.name}`,
    deletedAt: null,
    deletedByUserId: null,
    appliedMutations: [],
  }
  const result = await skillRecords().updateOne(
    { scope, name: input.name },
    { $setOnInsert: record },
    { upsert: true },
  )

  return result.upsertedCount === 1
}

export async function listSkillMutationEvents(
  scope: string,
  name: string,
  limit = 100,
): Promise<SkillMutationEventDTO[]> {
  const safeLimit = Math.max(1, Math.min(limit, 250))
  const rows = await skillEvents()
    .find({ scope: normalizeSkillScope(scope), skillName: name })
    .sort({ createdAt: -1, _id: -1 })
    .limit(safeLimit)
    .toArray()

  return rows.map(serializeSkillMutationEvent)
}

export async function setupSkillMetadataIndexes(): Promise<void> {
  await skillRecords().createIndex(
    { scope: 1, name: 1 },
    { unique: true, name: 'skill_records_scope_name_unique' },
  )
  await skillRecords().createIndex(
    { teamId: 1, status: 1, updatedAt: -1 },
    { background: true, name: 'skill_records_team_status_updatedAt' },
  )
  await skillEvents().createIndex(
    { mutationId: 1, phase: 1 },
    { unique: true, name: 'skill_events_mutation_phase_unique' },
  )
  await skillEvents().createIndex(
    { scope: 1, skillName: 1, createdAt: -1 },
    { background: true, name: 'skill_events_scope_name_createdAt' },
  )
  await skillEvents().createIndex(
    { teamId: 1, createdAt: -1 },
    { background: true, name: 'skill_events_team_createdAt' },
  )
  await skillEvents().createIndex(
    { actorUserId: 1, createdAt: -1 },
    { background: true, name: 'skill_events_actor_createdAt' },
  )
  await skillEvents().createIndex(
    { phase: 1, status: 1, createdAt: 1 },
    { background: true, name: 'skill_events_phase_status_createdAt' },
  )
}
