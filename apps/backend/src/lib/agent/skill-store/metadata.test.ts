import { describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import {
  MAX_APPLIED_MUTATION_RECEIPTS,
  SkillMetadataRepository,
  serializeSkillMetadata,
  serializeSkillMutationEvent,
  skillTeamIdFromScope,
} from './metadata'

import type { SkillMutationEvent, SkillRecord } from './metadata'
import type { Collection } from 'mongodb'

class InMemoryRecords {
  docs: SkillRecord[] = []

  async findOne(filter: Record<string, unknown>): Promise<SkillRecord | null> {
    return (
      this.docs.find((doc) => {
        if (filter.scope !== undefined && doc.scope !== filter.scope) return false
        if (filter.name !== undefined && doc.name !== filter.name) return false
        if (filter._id !== undefined && !doc._id?.equals(filter._id as ObjectId)) return false
        if (filter.revision !== undefined && doc.revision !== filter.revision) return false
        const mutationFilter = filter['appliedMutations.mutationId'] as { $ne?: string } | undefined

        if (
          mutationFilter?.$ne &&
          doc.appliedMutations?.some((entry) => entry.mutationId === mutationFilter.$ne)
        ) {
          return false
        }

        return true
      }) ?? null
    )
  }

  async insertOne(input: SkillRecord): Promise<{ insertedId: ObjectId }> {
    if (this.docs.some((doc) => doc.scope === input.scope && doc.name === input.name)) {
      throw Object.assign(new Error('duplicate'), { code: 11000 })
    }
    const insertedId = new ObjectId()

    this.docs.push({ ...input, _id: insertedId })

    return { insertedId }
  }

  async replaceOne(
    filter: Record<string, unknown>,
    replacement: SkillRecord,
  ): Promise<{ modifiedCount: number }> {
    const current = await this.findOne(filter)

    if (!current) return { modifiedCount: 0 }
    const index = this.docs.indexOf(current)

    this.docs[index] = { ...replacement, _id: current._id }

    return { modifiedCount: 1 }
  }
}

class InMemoryEvents {
  docs: SkillMutationEvent[] = []

  async findOne(filter: Record<string, unknown>): Promise<SkillMutationEvent | null> {
    return (
      this.docs.find(
        (doc) =>
          (filter.mutationId === undefined || doc.mutationId === filter.mutationId) &&
          (filter.phase === undefined || doc.phase === filter.phase),
      ) ?? null
    )
  }

  async insertOne(input: SkillMutationEvent): Promise<{ insertedId: ObjectId }> {
    if (this.docs.some((doc) => doc.mutationId === input.mutationId && doc.phase === input.phase)) {
      throw Object.assign(new Error('duplicate'), { code: 11000 })
    }
    const insertedId = new ObjectId()

    this.docs.push({ ...input, _id: insertedId })

    return { insertedId }
  }
}

function createRepository() {
  const records = new InMemoryRecords()
  const events = new InMemoryEvents()
  let tick = 0
  const repository = new SkillMetadataRepository(
    records as unknown as Collection<SkillRecord>,
    events as unknown as Collection<SkillMutationEvent>,
    () => new Date(Date.UTC(2026, 6, 11, 8, 0, tick++)),
  )

  return { repository, records, events }
}

describe('skill metadata serialization', () => {
  test('derives team identity from a normalized team scope', () => {
    expect(skillTeamIdFromScope('teams/64f1a2b3c4d5e6f7a8b9c0d1')).toBe('64f1a2b3c4d5e6f7a8b9c0d1')
    expect(skillTeamIdFromScope('global')).toBeNull()
  })

  test('serializes trusted provenance without inventing legacy creation time', () => {
    const record: SkillRecord = {
      scope: 'teams/team-1',
      teamId: 'team-1',
      name: 'deploy-checklist',
      status: 'active',
      createdAt: null,
      createdByUserId: null,
      createdSource: 'legacy',
      updatedAt: new Date('2026-07-11T08:00:00.000Z'),
      updatedByUserId: null,
      updatedSource: 'legacy',
      revision: 0,
      lastMutationId: 'legacy:teams/team-1:deploy-checklist',
      deletedAt: null,
      deletedByUserId: null,
      appliedMutations: [],
    }

    expect(serializeSkillMetadata(record)).toEqual({
      createdAt: null,
      createdByUserId: null,
      createdSource: 'legacy',
      updatedAt: '2026-07-11T08:00:00.000Z',
      updatedByUserId: null,
      updatedSource: 'legacy',
      revision: 0,
      status: 'active',
      deletedAt: null,
      deletedByUserId: null,
      legacy: true,
    })
  })

  test('serializes append-only events with a stable public id', () => {
    const event: SkillMutationEvent = {
      _id: new ObjectId('64f1a2b3c4d5e6f7a8b9c0d1'),
      mutationId: 'mutation-1',
      phase: 'result',
      scope: 'teams/team-1',
      teamId: 'team-1',
      skillName: 'deploy-checklist',
      action: 'create',
      status: 'applied',
      actorUserId: 'user-1',
      source: 'desktop',
      requestId: 'request-1',
      conversationId: null,
      toolCallId: null,
      changedKeys: ['skills/deploy-checklist/SKILL.md'],
      revision: 1,
      beforeEtags: {},
      afterEtags: { 'skills/deploy-checklist/SKILL.md': 'etag-1' },
      error: null,
      createdAt: new Date('2026-07-11T08:00:00.000Z'),
    }

    expect(serializeSkillMutationEvent(event)).toEqual({
      id: '64f1a2b3c4d5e6f7a8b9c0d1',
      mutationId: 'mutation-1',
      phase: 'result',
      scope: 'teams/team-1',
      teamId: 'team-1',
      skillName: 'deploy-checklist',
      action: 'create',
      status: 'applied',
      actorUserId: 'user-1',
      source: 'desktop',
      requestId: 'request-1',
      conversationId: null,
      toolCallId: null,
      changedKeys: ['skills/deploy-checklist/SKILL.md'],
      revision: 1,
      beforeEtags: {},
      afterEtags: { 'skills/deploy-checklist/SKILL.md': 'etag-1' },
      error: null,
      createdAt: '2026-07-11T08:00:00.000Z',
    })
  })
})

describe('SkillMetadataRepository', () => {
  const base = {
    mutationId: 'mutation-1',
    scope: 'teams/team-1',
    skillName: 'deploy-checklist',
    action: 'create' as const,
    actor: {
      userId: 'user-1',
      source: 'desktop' as const,
      requestId: 'request-1',
    },
    changedKeys: ['skills/deploy-checklist/SKILL.md'],
    beforeEtags: {},
  }

  test('records one lifecycle and keeps retries revision-idempotent', async () => {
    const { repository, records, events } = createRepository()

    await repository.begin(base)
    const first = await repository.complete({
      ...base,
      status: 'applied',
      recordStatus: 'active',
      createdNew: true,
      afterEtags: { 'skills/deploy-checklist/SKILL.md': 'etag-1' },
    })

    await repository.begin(base)
    const retry = await repository.complete({
      ...base,
      status: 'applied',
      recordStatus: 'active',
      createdNew: true,
      afterEtags: { 'skills/deploy-checklist/SKILL.md': 'etag-1' },
    })

    expect(first.record.revision).toBe(1)
    expect(retry.record.revision).toBe(1)
    expect(records.docs).toHaveLength(1)
    expect(events.docs).toHaveLength(2)
  })

  test('increments revision for a later mutation and preserves creator provenance', async () => {
    const { repository } = createRepository()

    await repository.begin(base)
    await repository.complete({
      ...base,
      status: 'applied',
      recordStatus: 'active',
      createdNew: true,
    })

    const update = {
      ...base,
      mutationId: 'mutation-2',
      action: 'update' as const,
      actor: { userId: 'user-2', source: 'admin' as const },
    }

    await repository.begin(update)
    const result = await repository.complete({
      ...update,
      status: 'applied',
      recordStatus: 'active',
      createdNew: false,
    })

    expect(result.record.revision).toBe(2)
    expect(result.record.createdByUserId).toBe('user-1')
    expect(result.record.updatedByUserId).toBe('user-2')
  })

  test('turns a deleted skill into a tombstone without erasing provenance', async () => {
    const { repository } = createRepository()

    await repository.begin(base)
    await repository.complete({
      ...base,
      status: 'applied',
      recordStatus: 'active',
      createdNew: true,
    })

    const deletion = {
      ...base,
      mutationId: 'mutation-2',
      action: 'delete_skill' as const,
    }

    await repository.begin(deletion)
    const result = await repository.complete({
      ...deletion,
      status: 'applied',
      recordStatus: 'deleted',
      createdNew: false,
    })

    expect(result.record.status).toBe('deleted')
    expect(result.record.createdByUserId).toBe('user-1')
    expect(result.record.deletedByUserId).toBe('user-1')
    expect(result.record.revision).toBe(2)
  })

  test('rejects a mutation id reused for a different skill', async () => {
    const { repository } = createRepository()

    await repository.begin(base)
    await expect(repository.begin({ ...base, skillName: 'another-skill' })).rejects.toThrow(
      'retried with different content',
    )
  })

  test('records failed results at the current revision without changing projection', async () => {
    const { repository, records, events } = createRepository()

    await repository.begin(base)
    await repository.complete({
      ...base,
      status: 'applied',
      recordStatus: 'active',
      createdNew: true,
    })

    const failed = {
      ...base,
      mutationId: 'mutation-2',
      action: 'update' as const,
    }

    await repository.begin(failed)
    const result = await repository.fail({ ...failed, error: 'S3 unavailable' })

    expect(result.status).toBe('failed')
    expect(result.revision).toBe(1)
    expect(result.error).toBe('S3 unavailable')
    expect(records.docs[0]?.revision).toBe(1)
    expect(events.docs).toHaveLength(4)
  })

  test('bounds projection receipts while retaining recent retry protection', async () => {
    const { repository } = createRepository()

    for (let number = 1; number <= MAX_APPLIED_MUTATION_RECEIPTS + 10; number += 1) {
      const mutation = {
        ...base,
        mutationId: `mutation-${String(number)}`,
        action: number === 1 ? ('create' as const) : ('update' as const),
      }

      await repository.begin(mutation)
      await repository.complete({
        ...mutation,
        status: 'applied',
        recordStatus: 'active',
        createdNew: number === 1,
      })
    }

    const record = await repository.complete({
      ...base,
      mutationId: `mutation-${String(MAX_APPLIED_MUTATION_RECEIPTS + 10)}`,
      action: 'update',
      status: 'applied',
      recordStatus: 'active',
      createdNew: false,
    })

    expect(record.record.appliedMutations).toHaveLength(MAX_APPLIED_MUTATION_RECEIPTS)
    expect(record.record.appliedMutations.at(-1)).toEqual({
      mutationId: `mutation-${String(MAX_APPLIED_MUTATION_RECEIPTS + 10)}`,
      revision: MAX_APPLIED_MUTATION_RECEIPTS + 10,
    })
  })
})
