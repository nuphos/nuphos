import { readFileSync } from 'node:fs'

import { afterAll, beforeEach, expect, spyOn, test } from 'bun:test'
import { unzipSync } from 'fflate'
import { ObjectId } from 'mongodb'

import { mongo } from '@/lib/db'
import { useDb } from '@/lib/test/doubles/db'
import { useSkillStoreService } from '@/lib/test/doubles/skill-store-service'

import { exportTeam } from './export'

const teamId = '000000000000000000000001'
const otherTeam = '000000000000000000000002'
const userId = new ObjectId('000000000000000000000003')
const now = new Date('2026-11-13T00:00:00Z')
let records: Record<string, Record<string, unknown>[]> = {}
let snapshots = 0
const equal = (a: unknown, b: unknown) => String(a) === String(b)

function matches(row: Record<string, unknown>, query: Record<string, unknown>): boolean {
  return Object.entries(query).every(([key, value]) => {
    if (key === '$or')
      return (value as Record<string, unknown>[]).some((part) => matches(row, part))
    if (value && typeof value === 'object' && !(value instanceof ObjectId)) {
      if ('$exists' in value) return (row[key] !== undefined) === value.$exists
      if ('$ne' in value) return !equal(row[key], value.$ne)
    }

    return equal(row[key], value)
  })
}
const database = {
  collection(name: string) {
    return {
      async findOne(query: Record<string, unknown>) {
        return records[name]?.find((row) => matches(row, query)) ?? null
      },
      find(query: Record<string, unknown>, options: { session?: unknown }) {
        expect(options.session).toBeDefined()
        const rows = records[name]?.filter((row) => matches(row, query)) ?? []
        const cursor = {
          sort: () => cursor,
          close: async () => {},
          async *[Symbol.asyncIterator]() {
            yield* rows
          },
        }

        return cursor
      },
    }
  },
}

useDb({ db: () => database })
useSkillStoreService({ isSkillsStoreConfigured: () => false })
const snapshot = spyOn(mongo, 'startSession').mockImplementation((options) => {
  expect(options?.snapshot).toBe(true)
  snapshots++

  return { endSession: async () => {} } as ReturnType<typeof mongo.startSession>
})

afterAll(() => snapshot.mockRestore())
beforeEach(() => {
  snapshots = 0
  records = {
    teams: [
      {
        _id: new ObjectId(teamId),
        name: 'Source',
        members: [{ userId, role: 'ADMINISTRATOR', joinedAt: now }],
        billing: { secret: 'EXCLUDED' },
      },
    ],
    users: [{ _id: userId, email: 'member@example.com', name: 'Member', passwordHash: 'EXCLUDED' }],
    agent_conversations: [
      {
        sessionId: 's',
        teamId,
        userId: String(userId),
        title: 'Ours',
        firstMessage: 'Hello',
        createdAt: now,
        lastActiveAt: now,
        runtimeOperation: { token: 'EXCLUDED' },
      },
      {
        sessionId: 'other',
        teamId: otherTeam,
        userId: String(userId),
        title: 'OTHER-TEAM',
        firstMessage: 'OTHER-TEAM',
        createdAt: now,
        lastActiveAt: now,
      },
    ],
    agent_messages: [
      {
        sessionId: 's',
        userId: String(userId),
        messageId: 'm',
        index: 0,
        role: 'user',
        parts: [
          { type: 'text', text: 'Our words' },
          { type: 'tool-result', result: 'EXCLUDED' },
        ],
        createdAt: now,
        updatedAt: now,
      },
      {
        sessionId: 'other',
        userId: String(userId),
        messageId: 'm2',
        index: 0,
        role: 'user',
        parts: [{ type: 'text', text: 'OTHER-TEAM' }],
        createdAt: now,
        updatedAt: now,
      },
    ],
    agent_memories: [
      {
        _id: new ObjectId(),
        teamId,
        scope: 'personal',
        text: 'PERSONAL',
        type: 'fact',
        source: 'save_memory',
        categories: [],
        conversationId: null,
        createdAt: now,
        updatedAt: now,
      },
    ],
    agent_triggers: [
      {
        _id: new ObjectId(),
        teamId,
        userId: String(userId),
        targetSessionId: 's',
        name: 'Trigger',
        triggerType: 'webhook',
        messageTemplate: 'Check',
        enabled: true,
        webhookSecret: 'EXCLUDED',
        createdAt: now,
        updatedAt: now,
      },
    ],
  }
})

test('real exporter scopes conversation children and knowledge, excludes structured secrets, keeps owning trigger id', async () => {
  const archive = await exportTeam(teamId)

  try {
    const entries = unzipSync(readFileSync(archive.path))
    const text = Object.values(entries)
      .map((value) => Buffer.from(value).toString())
      .join('\n')

    expect(text).toContain('Our words')
    expect(text).not.toContain('EXCLUDED')
    expect(text).not.toContain('OTHER-TEAM')
    expect(text).not.toContain('PERSONAL')
    expect(snapshots).toBe(1)
    const trigger = JSON.parse(Buffer.from(entries['work/triggers.ndjson']!).toString())

    expect(trigger.targetSessionId).toBe('s')
    expect(trigger.enabled).toBe(false)
  } finally {
    archive.dispose()
  }
})

test('snapshot source failures reject the entire export', async () => {
  delete records.teams
  await expect(exportTeam(teamId)).rejects.toThrow('Team not found')
})
