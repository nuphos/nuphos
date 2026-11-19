import { beforeEach, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'

import type { AgentTrigger } from './trigger-db'

const writes: { name: string; filter: unknown; update: unknown }[] = []
const conversations = new Map<string, { sessionId: string; userId: string; teamId?: string }>()

useDb({
  db: () => ({
    collection: (name: string) => ({
      updateOne: (filter: unknown, update: unknown) => {
        writes.push({ name, filter, update })

        return Promise.resolve({})
      },
      findOne: (filter: { sessionId?: string }) =>
        Promise.resolve(conversations.get(filter.sessionId ?? '') ?? null),
    }),
  }),
})
let member = true

useIdentity({ getTeamMembership: () => Promise.resolve(member ? { role: 'EDITOR' } : null) })

const { resolveExecutionAuthorization } = await import('./trigger-executor-authorization')

function trigger(overrides: Partial<AgentTrigger> = {}): AgentTrigger {
  return {
    _id: new ObjectId(),
    userId: 'principal',
    teamId: 'team-1',
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
  beforeEach(() => {
    member = true
  })

  test('a Trigger runs in its Task', async () => {
    const { target } = await resolveExecutionAuthorization(trigger({ targetSessionId: 'own' }))

    expect(target.sessionId).toBe('own')
    expect(paused()).toBeUndefined()
  })

  test('a Trigger in a teammate’s Task runs as that Task’s owner', async () => {
    const { target } = await resolveExecutionAuthorization(
      trigger({ targetSessionId: 'other-user' }),
    )

    expect(target.userId).toBe('someone')
  })

  test.each([undefined, 'other-team', 'deleted'])(
    'a Trigger without a Task in its team (%s) is paused',
    async (targetSessionId) => {
      await expect(
        resolveExecutionAuthorization(trigger(targetSessionId ? { targetSessionId } : {})),
      ).rejects.toMatchObject({ code: 'trigger_target_session_invalid' })
      expect(paused()?.update).toMatchObject({
        $set: { enabled: false, executionAuthorizationStatus: 'invalid' },
      })
    },
  )

  test('a Trigger whose Task owner left the team is paused', async () => {
    member = false
    await expect(
      resolveExecutionAuthorization(trigger({ targetSessionId: 'own' })),
    ).rejects.toMatchObject({ code: 'trigger_execution_principal_invalid' })
    expect(paused()).toBeDefined()
  })
})
