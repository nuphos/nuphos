import { beforeEach, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'

import type { AgentTrigger } from './trigger-db'
import type { TriggerChange } from './trigger-history'

// #3755: every create, change and delete of a Trigger leaves a record that outlives it.

const records: TriggerChange[] = []
const transactions: string[] = []
const conversations: Record<string, unknown> = {
  'owners-task': {
    sessionId: 'owners-task',
    userId: 'owner',
    teamId: 'team',
    generalAccess: 'none',
  },
  'shared-task': {
    sessionId: 'shared-task',
    userId: 'owner',
    teamId: 'team',
    generalAccess: 'none',
    participantIds: ['owner', 'teammate'],
  },
}

useIdentity({ getTeamMembership: () => Promise.resolve({ role: 'EDITOR' }) as never })
useDb({
  withTransaction: async (body: (session: never) => Promise<void>) => {
    transactions.push('begin')
    await body('session' as never)
    transactions.push('commit')
  },
  db: () =>
    ({
      collection: (name: string) => ({
        insertOne: async (doc: TriggerChange, options: { session?: string }) => {
          transactions.push(`${name} ${options.session ?? 'no session'}`)
          records.push({ ...doc, _id: new ObjectId() })
        },
        findOne: async (filter: { sessionId?: string }) =>
          conversations[filter.sessionId ?? ''] ?? null,
        find: (filter: Partial<TriggerChange>) => ({
          sort: () => {
            const rows = records
              .filter(
                (row) =>
                  row.teamId === filter.teamId &&
                  (!filter.triggerId || row.triggerId === filter.triggerId),
              )
              .reverse()

            return {
              async *[Symbol.asyncIterator]() {
                yield* rows
              },
              close: async () => {},
            }
          },
        }),
      }),
    }) as never,
})

const { readTriggerHistory, writeTrigger } = await import('./trigger-history')

const trigger = (targetSessionId: string): AgentTrigger => ({
  _id: new ObjectId(),
  userId: 'owner',
  teamId: 'team',
  targetSessionId,
  name: 'Deploy hook',
  triggerType: 'webhook',
  webhookSecret: 'whsec_do_not_record',
  messageTemplate: 'Check the deploy',
  enabled: true,
  configRevision: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
})

beforeEach(() => {
  records.length = 0
  transactions.length = 0
})

test('a change and its record land in one transaction, without the webhook secret', async () => {
  const created = trigger('owners-task')
  const by = { actorId: 'owner', via: 'request' as const, client: 'nuphos-desktop/1.0' }

  expect(await writeTrigger({ after: created, by }, async () => true)).toBe(true)
  expect(transactions).toEqual(['begin', 'agent_trigger_history session', 'commit'])
  expect(records[0]).toMatchObject({
    action: 'created',
    actorId: 'owner',
    via: 'request',
    client: 'nuphos-desktop/1.0',
    triggerId: created._id!.toHexString(),
    after: { name: 'Deploy hook', enabled: true, targetSessionId: 'owners-task' },
  })
  expect(JSON.stringify(records)).not.toContain('whsec_')

  await writeTrigger(
    {
      before: created,
      after: { ...created, enabled: false },
      by: { actorId: 'owner', agentSessionId: 'agent', via: 'request' },
    },
    async () => true,
  )
  await writeTrigger({ before: created, by }, async () => true)
  expect(records.map((record) => record.action)).toEqual(['created', 'updated', 'deleted'])
  expect(records[1]).toMatchObject({ before: { enabled: true }, after: { enabled: false } })
  expect(records[2]).not.toHaveProperty('after')
})

test('a write that lost its revision fence records nothing', async () => {
  const lost = await writeTrigger(
    { before: trigger('owners-task'), by: { actorId: 'owner', via: 'request' } },
    async () => false,
  )

  expect(lost).toBe(false)
  expect(records).toEqual([])
})

test('the records outlive the Trigger and are read as the Trigger’s Task is', async () => {
  const deleted = trigger('shared-task')
  const own = trigger('owners-task')
  const by = { actorId: 'owner', via: 'request' as const }

  await writeTrigger({ after: deleted, by }, async () => true)
  await writeTrigger({ before: deleted, by }, async () => true)
  await writeTrigger({ after: own, by }, async () => true)

  // The owner reads all three, newest first; a deleted Trigger's records stay.
  const owners = await readTriggerHistory({ userId: 'owner', teamId: 'team' })

  expect(owners.map((change) => change.action)).toEqual(['created', 'deleted', 'created'])
  expect(owners[1]).toMatchObject({
    actor: { type: 'user', userId: 'owner' },
    before: { name: 'Deploy hook' },
  })
  // A teammate in only the shared Task reads only that Trigger's records.
  const teammate = await readTriggerHistory({ userId: 'teammate', teamId: 'team' })

  expect(teammate.map((change) => change.triggerId)).toEqual([
    deleted._id!.toHexString(),
    deleted._id!.toHexString(),
  ])
  expect(
    await readTriggerHistory({ userId: 'owner', teamId: 'team' }, own._id!.toHexString()),
  ).toHaveLength(1)
})

test('records of Tasks the reader cannot see never crowd out ones they can', async () => {
  const visible = trigger('shared-task')
  const hidden = trigger('owners-task')
  const by = { actorId: 'owner', via: 'request' as const }

  await writeTrigger({ after: visible, by }, async () => true)
  for (let edit = 0; edit < 250; edit++)
    await writeTrigger(
      { before: hidden, after: { ...hidden, name: `Edit ${String(edit)}` }, by },
      async () => true,
    )

  const teammate = await readTriggerHistory({ userId: 'teammate', teamId: 'team' })

  expect(teammate.map((change) => change.triggerId)).toEqual([visible._id!.toHexString()])
  // The owner reads the newest 200.
  expect(await readTriggerHistory({ userId: 'owner', teamId: 'team' })).toHaveLength(200)
})

test('a write that leaves the configuration as it was records nothing', async () => {
  const same = trigger('owners-task')

  await writeTrigger(
    {
      before: same,
      after: { ...same, updatedAt: new Date() },
      by: { actorId: 'owner', via: 'request' },
    },
    async () => true,
  )
  expect(records).toEqual([])
})

test('a change its config cannot show is recorded by its reason, still without the secret', async () => {
  const before = trigger('owners-task')

  await writeTrigger(
    {
      before,
      after: { ...before, webhookSecret: 'whsec_rotated' },
      by: { actorId: 'owner', via: 'request' },
      reason: 'webhook_secret_rotated',
    },
    () => Promise.resolve(true),
  )
  expect(records).toHaveLength(1)
  expect(records[0]).toMatchObject({ action: 'updated', reason: 'webhook_secret_rotated' })
  expect(JSON.stringify(records)).not.toContain('whsec_')
})
