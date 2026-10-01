import {
  MAX_APPLIED_MUTATION_RECEIPTS,
  skillEvents,
  skillRecords,
  skillTeamIdFromScope,
} from './metadata-types'
import { normalizeSkillScope } from './scope'

import type {
  BeginSkillMutationInput,
  CompleteSkillMutationInput,
  FailSkillMutationInput,
  SkillMutationEvent,
  SkillRecord,
} from './metadata-types'
import type { Collection } from 'mongodb'

export {
  backfillLegacySkillRecord,
  getSkillRecord,
  listSkillMutationEvents,
  listSkillRecords,
  setupSkillMetadataIndexes,
} from './metadata-queries'
export {
  MAX_APPLIED_MUTATION_RECEIPTS,
  serializeSkillMetadata,
  serializeSkillMutationEvent,
  SKILL_EVENTS_COLLECTION,
  SKILL_RECORDS_COLLECTION,
  skillEvents,
  skillRecords,
  skillTeamIdFromScope,
} from './metadata-types'
export type {
  BeginSkillMutationInput,
  CompleteSkillMutationInput,
  FailSkillMutationInput,
  SkillMetadataDTO,
  SkillMutationAction,
  SkillMutationActor,
  SkillMutationEvent,
  SkillMutationEventDTO,
  SkillMutationPhase,
  SkillMutationSource,
  SkillMutationStatus,
  SkillRecord,
  SkillRecordStatus,
} from './metadata-types'

type Clock = () => Date

function isDuplicateKey(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000
}

function sameStringArray(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

function assertSameEvent(existing: SkillMutationEvent, next: SkillMutationEvent): void {
  if (
    existing.scope !== next.scope ||
    existing.skillName !== next.skillName ||
    existing.action !== next.action ||
    existing.status !== next.status ||
    existing.actorUserId !== next.actorUserId ||
    existing.source !== next.source ||
    !sameStringArray(existing.changedKeys, next.changedKeys)
  ) {
    throw new Error(
      `Skill mutation ${next.mutationId}/${next.phase} was retried with different content`,
    )
  }
}

/**
 * Mongo-backed provenance repository. S3 mutation orchestration lives in
 * service.ts; this class only owns idempotent intent/result events and the
 * current projection.
 */
export class SkillMetadataRepository {
  constructor(
    private readonly records: Collection<SkillRecord>,
    private readonly events: Collection<SkillMutationEvent>,
    private readonly now: Clock = () => new Date(),
  ) {}

  async begin(input: BeginSkillMutationInput): Promise<SkillMutationEvent> {
    return this.insertEvent({
      ...this.eventBase(input),
      phase: 'intent',
      status: 'pending',
      revision: null,
      afterEtags: {},
      error: null,
      createdAt: this.now(),
    })
  }

  async complete(
    input: CompleteSkillMutationInput,
  ): Promise<{ record: SkillRecord; event: SkillMutationEvent }> {
    const existingResult = await this.getResult(input.mutationId)

    if (existingResult) {
      assertSameEvent(existingResult, {
        ...existingResult,
        ...this.eventBase(input),
        phase: 'result',
        status: input.status,
      })
      const record = await this.records.findOne({
        scope: normalizeSkillScope(input.scope),
        name: input.skillName,
      })

      if (!record) {
        throw new Error(`Skill mutation ${input.mutationId} has a result but no projection`)
      }

      return { record, event: existingResult }
    }

    const record = await this.applyProjection(input)
    const receipt = record.appliedMutations?.find((entry) => entry.mutationId === input.mutationId)

    if (!receipt) throw new Error(`Skill mutation ${input.mutationId} has no projection receipt`)
    const event = await this.insertEvent({
      ...this.eventBase(input),
      phase: 'result',
      status: input.status,
      revision: receipt.revision,
      afterEtags: input.afterEtags ?? {},
      error: input.error ?? null,
      createdAt: this.now(),
    })

    return { record, event }
  }

  async getResult(mutationId: string): Promise<SkillMutationEvent | null> {
    return this.events.findOne({ mutationId, phase: 'result' })
  }

  async fail(input: FailSkillMutationInput): Promise<SkillMutationEvent> {
    const record = await this.records.findOne({
      scope: normalizeSkillScope(input.scope),
      name: input.skillName,
    })

    return this.insertEvent({
      ...this.eventBase(input),
      phase: 'result',
      status: 'failed',
      revision: record?.revision ?? null,
      afterEtags: {},
      error: input.error,
      createdAt: this.now(),
    })
  }

  private eventBase(input: BeginSkillMutationInput) {
    const scope = normalizeSkillScope(input.scope)

    return {
      mutationId: input.mutationId,
      scope,
      teamId: skillTeamIdFromScope(scope),
      skillName: input.skillName,
      action: input.action,
      actorUserId: input.actor.userId,
      source: input.actor.source,
      requestId: input.actor.requestId ?? null,
      conversationId: input.actor.conversationId ?? null,
      toolCallId: input.actor.toolCallId ?? null,
      changedKeys: [...input.changedKeys],
      beforeEtags: { ...(input.beforeEtags ?? {}) },
    }
  }

  private async insertEvent(event: SkillMutationEvent): Promise<SkillMutationEvent> {
    try {
      const inserted = await this.events.insertOne(event)

      return { ...event, _id: inserted.insertedId }
    } catch (err) {
      if (!isDuplicateKey(err)) throw err
      const existing = await this.events.findOne({
        mutationId: event.mutationId,
        phase: event.phase,
      })

      if (!existing) throw err
      assertSameEvent(existing, event)

      return existing
    }
  }

  private async applyProjection(input: CompleteSkillMutationInput): Promise<SkillRecord> {
    const scope = normalizeSkillScope(input.scope)
    const at = this.now()

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const current = await this.records.findOne({ scope, name: input.skillName })
      const applied = current?.appliedMutations?.find(
        (entry) => entry.mutationId === input.mutationId,
      )

      if (current && applied) return current

      const revision = (current?.revision ?? 0) + 1
      const resetsLifecycle = input.createdNew && (!current || current.status === 'deleted')
      const next: SkillRecord = {
        scope,
        teamId: skillTeamIdFromScope(scope),
        name: input.skillName,
        status: input.recordStatus,
        createdAt: resetsLifecycle ? at : (current?.createdAt ?? null),
        createdByUserId: resetsLifecycle ? input.actor.userId : (current?.createdByUserId ?? null),
        createdSource: resetsLifecycle ? input.actor.source : (current?.createdSource ?? 'legacy'),
        updatedAt: at,
        updatedByUserId: input.actor.userId,
        updatedSource: input.actor.source,
        revision,
        lastMutationId: input.mutationId,
        deletedAt: input.recordStatus === 'deleted' ? at : null,
        deletedByUserId: input.recordStatus === 'deleted' ? input.actor.userId : null,
        appliedMutations: [
          ...(current?.appliedMutations ?? []).slice(-(MAX_APPLIED_MUTATION_RECEIPTS - 1)),
          { mutationId: input.mutationId, revision },
        ],
      }

      if (!current) {
        try {
          const inserted = await this.records.insertOne(next)

          return { ...next, _id: inserted.insertedId }
        } catch (err) {
          if (isDuplicateKey(err)) continue
          throw err
        }
      }

      const replaced = await this.records.replaceOne(
        {
          _id: current._id,
          revision: current.revision,
          'appliedMutations.mutationId': { $ne: input.mutationId },
        },
        next,
      )

      if (replaced.modifiedCount === 1) return { ...next, _id: current._id }
    }

    throw new Error(`Could not apply skill mutation ${input.mutationId} after concurrent updates`)
  }
}

export function skillMetadataRepository(): SkillMetadataRepository {
  return new SkillMetadataRepository(skillRecords(), skillEvents())
}
