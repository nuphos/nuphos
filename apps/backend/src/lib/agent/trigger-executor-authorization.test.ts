import { beforeEach, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'

import type { AgentTrigger } from './trigger-db'

const writes: { name: string; filter: unknown; update: unknown }[] = []
const conversations = new Map<string, { sessionId: string; userId: string; teamId?: string }>()
let group: Record<string, unknown> | null = null

useDb({
  db: () => ({
    collection: (name: string) => ({
      updateOne: (filter: unknown, update: unknown) => {
        writes.push({ name, filter, update })

        return Promise.resolve({})
      },
      updateMany: (filter: unknown, update: unknown) => {
        writes.push({ name, filter, update })

        return Promise.resolve({})
      },
      countDocuments: () => Promise.resolve(0),
      findOne: (filter: { sessionId?: string }) =>
        Promise.resolve(
          name === 'agent_trigger_groups'
            ? group
            : (conversations.get(filter.sessionId ?? '') ?? null),
        ),
      find: () => ({ toArray: () => Promise.resolve([]) }),
    }),
  }),
})
useIdentity({ getTeamMembership: () => Promise.resolve({ role: 'ADMINISTRATOR' }) })

const { resolveExecutionAuthorization } = await import('./trigger-executor-authorization')

function trigger(overrides: Partial<AgentTrigger> = {}): AgentTrigger {
  return {
    _id: new ObjectId(),
    userId: 'principal',
    teamId: 'team-1',
    executionPrincipalUserId: 'principal',
    executionAuthorizationStatus: 'valid',
    name: 'nightly',
    triggerType: 'cron',
    messageTemplate: 'check',
    enabled: true,
    ...overrides,
  } as AgentTrigger
}

function paused() {
  return writes.find(
    (write) =>
      write.name === 'agent_triggers' &&
      (write.update as { $set?: { enabled?: boolean } }).$set?.enabled === false,
  )
}

beforeEach(() => {
  writes.length = 0
  group = null
  conversations.clear()
  conversations.set('own', { sessionId: 'own', userId: 'principal', teamId: 'team-1' })
  conversations.set('other-user', { sessionId: 'other-user', userId: 'someone', teamId: 'team-1' })
  conversations.set('other-team', {
    sessionId: 'other-team',
    userId: 'principal',
    teamId: 'team-2',
  })
})

describe('resolveExecutionAuthorization', () => {
  test('a Trigger bound to its owner’s conversation delivers there', async () => {
    const { target } = await resolveExecutionAuthorization(trigger({ targetSessionId: 'own' }))

    expect(target.sessionId).toBe('own')
    expect(paused()).toBeUndefined()
  })

  test('an unbound Trigger is paused instead of opening a session', async () => {
    await expect(resolveExecutionAuthorization(trigger())).rejects.toMatchObject({
      code: 'trigger_target_session_required',
    })
    expect(paused()?.update).toMatchObject({
      $set: { enabled: false, executionAuthorizationStatus: 'invalid' },
    })
  })

  test.each(['other-user', 'other-team', 'deleted'])(
    'a Trigger bound to a %s conversation is paused',
    async (targetSessionId) => {
      await expect(
        resolveExecutionAuthorization(trigger({ targetSessionId })),
      ).rejects.toMatchObject({ code: 'trigger_target_session_invalid' })
      expect(paused()).toBeDefined()
    },
  )
})

describe('a partition repairing itself from its Watch Group', () => {
  test('drops the scope it had pinned when the Group has none', async () => {
    group = { executionPrincipalUserId: 'new-principal', credentialMode: 'all' }
    conversations.set('group-target', {
      sessionId: 'group-target',
      userId: 'new-principal',
      teamId: 'team-1',
    })

    await resolveExecutionAuthorization(
      trigger({
        watchGroupId: new ObjectId(),
        targetSessionId: 'group-target',
        executionCredentialAccess: { updatedAt: new Date(), updatedBy: 'principal' },
      } as Partial<AgentTrigger>),
    )

    const repair = writes.find((write) => write.name === 'agent_triggers')

    expect(repair?.update).toMatchObject({
      $set: { executionPrincipalUserId: 'new-principal', credentialMode: 'all' },
      $unset: { executionCredentialAccess: true },
    })
  })
})
