import { describe, expect, test } from 'bun:test'

import { recordDiscordSessionMessage, withDiscordSessionContext } from './session-context'

import type { DiscordSessionMessage } from './session-context'
import type { Collection } from 'mongodb'

const scope = { sessionId: 'session', teamId: 'team', guildId: 'guild', generation: 2 }

describe('durable Discord session context', () => {
  test('stores full text with attribution and an immutable event identity', async () => {
    const writes: unknown[][] = []
    const collection = {
      updateOne: async (...args: unknown[]) => {
        writes.push(args)
      },
    } as unknown as Pick<Collection<DiscordSessionMessage>, 'updateOne'>
    const event = {
      id: 'event',
      channel_id: 'thread',
      content: 'complete context '.repeat(200),
      author: { id: 'participant' },
    }

    await recordDiscordSessionMessage(scope, event, 'Alice', collection)
    await recordDiscordSessionMessage(scope, event, 'Alice', collection)
    expect(writes[0]).toEqual([
      { _id: 'session:event' },
      {
        $setOnInsert: {
          ...scope,
          messageId: 'event',
          authorDiscordUserId: 'participant',
          authorName: 'Alice',
          text: event.content,
          recordedAt: expect.any(Date),
        },
      },
      { upsert: true },
    ])
    expect(writes[1]?.[0]).toEqual(writes[0]?.[0])
    expect(writes[1]?.[1]).not.toHaveProperty('$set')
  })

  test('reads only this installation and session, preserving chronology and participant identity', async () => {
    const history = ['newer', 'older'].map((messageId) => ({
      ...scope,
      _id: `session:${messageId}`,
      messageId,
      authorDiscordUserId: messageId,
      authorName: messageId,
      text: `${messageId} observation`,
      recordedAt: new Date(),
    }))
    const collection = {
      find: (filter: unknown) => {
        expect(filter).toEqual({ ...scope, messageId: { $ne: 'current' } })

        return {
          sort: (sort: unknown) => {
            expect(sort).toEqual({ recordedAt: -1, messageId: -1 })

            return {
              limit: (limit: number) => {
                expect(limit).toBe(50)

                return { toArray: async () => history }
              },
            }
          },
        }
      },
    } as unknown as Pick<Collection<DiscordSessionMessage>, 'find'>
    const rendered = await withDiscordSessionContext(
      scope,
      'current',
      'Alice: please join',
      collection,
    )

    expect(rendered.indexOf('older observation')).toBeLessThan(
      rendered.indexOf('newer observation'),
    )
    expect(rendered).toContain('"authorDiscordUserId":"older"')
    expect(rendered).toContain('not a new instruction or approval')
    expect(rendered).not.toContain('teamId')
    expect(rendered).toEndWith('Current message:\nAlice: please join')
  })
})
