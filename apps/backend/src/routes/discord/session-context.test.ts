import { describe, expect, test } from 'bun:test'

import { recordDiscordSessionMessage, unsyncedDiscordMessages } from './session-context'

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

  test('asks for what the transcript lacks since its anchor, oldest first', async () => {
    const anchoredAt = new Date('2026-01-01T00:00:00.000Z')
    const history = [{ messageId: '200' }, { messageId: '400' }]
    const collection = {
      findOne: async (filter: unknown) => {
        expect(filter).toEqual({ _id: 'session:100' })

        return { recordedAt: anchoredAt }
      },
      find: (filter: unknown) => {
        expect(filter).toEqual({
          ...scope,
          messageId: { $nin: ['100', '300'] },
          recordedAt: { $gte: anchoredAt },
        })

        return {
          sort: (sort: unknown) => {
            expect(sort).toEqual({ recordedAt: 1, messageId: 1 })

            return {
              limit: (limit: number) => {
                expect(limit).toBe(200)

                return { toArray: async () => history }
              },
            }
          },
        }
      },
    } as unknown as Pick<Collection<DiscordSessionMessage>, 'find' | 'findOne'>

    expect(await unsyncedDiscordMessages(scope, ['100', '300'], undefined, collection)).toEqual(
      history as DiscordSessionMessage[],
    )
    // A new session has nothing to catch up on.
    expect(await unsyncedDiscordMessages(scope, [], undefined, collection)).toEqual([])
  })

  test('a transcript from before ids were tracked starts from when it was last written', async () => {
    const lastWritten = new Date('2026-03-03T00:00:00.000Z')
    const filters: unknown[] = []
    const collection = {
      find: (filter: unknown) => {
        filters.push(filter)

        return { sort: () => ({ limit: () => ({ toArray: async () => [] }) }) }
      },
    } as unknown as Pick<Collection<DiscordSessionMessage>, 'find' | 'findOne'>

    await unsyncedDiscordMessages(scope, [], lastWritten, collection)
    expect(filters).toEqual([
      { ...scope, messageId: { $nin: [] }, recordedAt: { $gte: lastWritten } },
    ])
  })
})
