import { describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { useDb } from '@/lib/test/doubles/db'

const OWNER = new ObjectId().toHexString()
const MEMBER = new ObjectId().toHexString()
const ADMIN = new ObjectId().toHexString()
const TEAM = new ObjectId().toHexString()

const conversations: Record<string, unknown> = {
  shared: { sessionId: 'shared', userId: OWNER, teamId: TEAM, generalAccess: 'view' },
  private: { sessionId: 'private', userId: OWNER, teamId: TEAM, generalAccess: 'none' },
}

const team = {
  _id: new ObjectId(TEAM),
  name: 'Team',
  ownerID: new ObjectId(ADMIN),
  contactEmails: [],
  createdAt: new Date(),
  members: [
    { userId: new ObjectId(OWNER), role: 'EDITOR', joinedAt: new Date() },
    { userId: new ObjectId(MEMBER), role: 'EDITOR', joinedAt: new Date() },
    { userId: new ObjectId(ADMIN), role: 'ADMINISTRATOR', joinedAt: new Date() },
  ],
}

useDb({
  db: () =>
    ({
      collection: (name: string) => ({
        findOne: (filter: { sessionId?: string }) =>
          Promise.resolve(
            name === 'agent_conversations'
              ? (conversations[filter.sessionId ?? ''] ?? null)
              : name === 'teams'
                ? team
                : null,
          ),
        updateOne: () => Promise.resolve({ matchedCount: 1, modifiedCount: 1 }),
      }),
    }) as never,
})

const { assertTriggerAccess } = await import('./trigger-access')

function trigger(targetSessionId?: string) {
  return {
    userId: OWNER,
    teamId: TEAM,
    ...(targetSessionId ? { targetSessionId } : {}),
  }
}

const as = (userId: string) => ({ userId, teamId: TEAM })

describe('Trigger access follows its conversation', () => {
  test('whoever reads the conversation reads the Trigger', async () => {
    await assertTriggerAccess(trigger('shared'), as(MEMBER), 'read')
  })

  test('a private conversation hides its Triggers from the team, administrators included', async () => {
    for (const userId of [MEMBER, ADMIN]) {
      const denied = assertTriggerAccess(trigger('private'), as(userId), 'read')

      await expect(denied).rejects.toMatchObject({ status: 404 })
    }
  })

  test('only the owner may change it, whatever the team role', async () => {
    for (const level of ['manage', 'delete'] as const) {
      await assertTriggerAccess(trigger('private'), as(OWNER), level)
      for (const userId of [MEMBER, ADMIN]) {
        const denied = assertTriggerAccess(trigger('shared'), as(userId), level)

        await expect(denied).rejects.toMatchObject({ status: 403 })
      }
    }
  })

  test('a Trigger whose conversation is gone stays readable by its owner alone', async () => {
    await assertTriggerAccess(trigger('deleted'), as(OWNER), 'read')
    await expect(assertTriggerAccess(trigger('deleted'), as(ADMIN), 'read')).rejects.toMatchObject({
      status: 404,
    })
  })
})
