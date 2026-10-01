import { db } from '@/lib/db'

import { normalizeSkillScope } from './scope'

import type { Collection, ObjectId } from 'mongodb'

export const SKILL_RECORDS_COLLECTION = 'skill_records'
export const SKILL_EVENTS_COLLECTION = 'skill_events'
export const MAX_APPLIED_MUTATION_RECEIPTS = 256

export type SkillMutationSource = 'desktop' | 'admin' | 'agent' | 'import' | 'legacy'
export type SkillMutationAction = 'create' | 'update' | 'delete_object' | 'delete_skill'
export type SkillMutationPhase = 'intent' | 'result'
export type SkillMutationStatus = 'pending' | 'applied' | 'failed' | 'partial'
export type SkillRecordStatus = 'active' | 'deleted'

export type SkillMutationActor = {
  userId: string | null
  source: SkillMutationSource
  requestId?: string | null
  conversationId?: string | null
  toolCallId?: string | null
}

/**
 * Current projection for one logical skill package. S3 remains authoritative
 * for file bytes; this document owns trusted provenance and the monotonically
 * increasing package revision.
 */
export type SkillRecord = {
  _id?: ObjectId
  scope: string
  teamId: string | null
  name: string
  status: SkillRecordStatus
  createdAt: Date | null
  createdByUserId: string | null
  createdSource: SkillMutationSource
  updatedAt: Date | null
  updatedByUserId: string | null
  updatedSource: SkillMutationSource
  revision: number
  lastMutationId: string
  deletedAt: Date | null
  deletedByUserId: string | null
  /** Idempotency receipts. Kept on the projection so a retry stays safe even
   * after a later mutation has replaced lastMutationId. */
  appliedMutations: { mutationId: string; revision: number }[]
}

/**
 * Append-only mutation event. A mutation writes one intent and one result row,
 * keyed by (mutationId, phase). Full skill bodies never enter this collection.
 */
export type SkillMutationEvent = {
  _id?: ObjectId
  mutationId: string
  phase: SkillMutationPhase
  scope: string
  teamId: string | null
  skillName: string
  action: SkillMutationAction
  status: SkillMutationStatus
  actorUserId: string | null
  source: SkillMutationSource
  requestId: string | null
  conversationId: string | null
  toolCallId: string | null
  changedKeys: string[]
  revision: number | null
  beforeEtags: Record<string, string>
  afterEtags: Record<string, string>
  error: string | null
  createdAt: Date
}

export type SkillMetadataDTO = {
  createdAt: string | null
  createdByUserId: string | null
  createdSource: SkillMutationSource
  updatedAt: string | null
  updatedByUserId: string | null
  updatedSource: SkillMutationSource
  revision: number
  status: SkillRecordStatus
  deletedAt: string | null
  deletedByUserId: string | null
  legacy: boolean
}

export type SkillMutationEventDTO = Omit<SkillMutationEvent, '_id' | 'createdAt'> & {
  id: string
  createdAt: string
}

export type BeginSkillMutationInput = {
  mutationId: string
  scope: string
  skillName: string
  action: SkillMutationAction
  actor: SkillMutationActor
  changedKeys: string[]
  beforeEtags?: Record<string, string>
}

export type CompleteSkillMutationInput = BeginSkillMutationInput & {
  status: 'applied' | 'partial'
  recordStatus: SkillRecordStatus
  /** True only when no object for this skill existed before this mutation. */
  createdNew: boolean
  afterEtags?: Record<string, string>
  error?: string | null
}

export type FailSkillMutationInput = BeginSkillMutationInput & {
  error: string
}

export const skillRecords = (): Collection<SkillRecord> =>
  db().collection<SkillRecord>(SKILL_RECORDS_COLLECTION)

export const skillEvents = (): Collection<SkillMutationEvent> =>
  db().collection<SkillMutationEvent>(SKILL_EVENTS_COLLECTION)

export function skillTeamIdFromScope(scope: string): string | null {
  const normalized = normalizeSkillScope(scope)

  if (!normalized.startsWith('teams/')) return null
  const teamId = normalized.slice('teams/'.length)

  return teamId || null
}

export function serializeSkillMetadata(record: SkillRecord): SkillMetadataDTO {
  return {
    createdAt: record.createdAt?.toISOString() ?? null,
    createdByUserId: record.createdByUserId,
    createdSource: record.createdSource,
    updatedAt: record.updatedAt?.toISOString() ?? null,
    updatedByUserId: record.updatedByUserId,
    updatedSource: record.updatedSource,
    revision: record.revision,
    status: record.status,
    deletedAt: record.deletedAt?.toISOString() ?? null,
    deletedByUserId: record.deletedByUserId,
    legacy: record.createdSource === 'legacy',
  }
}

export function serializeSkillMutationEvent(event: SkillMutationEvent): SkillMutationEventDTO {
  const { _id, createdAt, ...rest } = event

  return {
    ...rest,
    id: _id?.toHexString() ?? `${event.mutationId}:${event.phase}`,
    createdAt: createdAt.toISOString(),
  }
}
