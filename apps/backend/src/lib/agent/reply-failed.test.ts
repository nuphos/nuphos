import { describe, expect, test } from 'bun:test'

import { AppError } from '@/lib/errors'
import { useDb } from '@/lib/test/doubles/db'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import { agentConversations } from './db'
import { noteReplyFailed } from './reply-failed'

import type * as dbActual from '@/lib/db'

const memory = portabilityDb()

useDb({ db: (() => memory) as unknown as typeof dbActual.db })

const signedOut = () => new AppError(409, 'runtime_login_required', 'Sign the agent in again.')
const offline = () => new AppError(409, 'runtime_offline', 'The computer is offline.')

/** A channel with a member's post, and a Bot owned by someone who is not in it. */
async function seed(bot: string) {
  await agentConversations().insertOne({
    sessionId: `${bot}-channel`,
    userId: 'member',
    teamId: 'team',
    title: 'Chat',
    messageCount: 1,
  } as never)
  await agentConversations().insertOne({
    sessionId: bot,
    userId: 'owner',
    teamId: 'team',
    title: 'Scribe',
    agentRuntime: 'claude-code',
  } as never)
}

describe('a channel reply that failed (#4179)', () => {
  test('because the Bot is signed out tells its owner, once however often it fails', async () => {
    const told: { userIds: string[]; push: unknown }[] = []

    await seed('bot-a')
    for (let post = 0; post < 3; post++)
      await noteReplyFailed('bot-a-channel', 'bot-a', signedOut(), (userIds, push) => {
        told.push({ userIds, push })
      })

    expect(told).toEqual([
      {
        userIds: ['owner'],
        push: expect.objectContaining({
          sessionId: 'bot-a',
          teamId: 'team',
          title: 'Bot signed out',
          body: expect.stringContaining('Scribe could not reply in a channel'),
        }),
      },
    ])
  })

  test('for any other reason leaves its owner to the channel line', async () => {
    const told: string[][] = []

    await seed('bot-b')
    await noteReplyFailed('bot-b-channel', 'bot-b', offline(), (userIds) => {
      told.push(userIds)
    })

    expect(told).toEqual([])
  })
})

describe('a channel reply on a runtime that is gone', () => {
  test('offers its owner to move the Bot, in the runtime’s own words', async () => {
    const gone = new AppError(
      404,
      'runtime_not_found',
      'This runtime is no longer available to you. Move this conversation to another runtime to continue.',
    )

    await seed('bot-c')
    await noteReplyFailed('bot-c-channel', 'bot-c', gone)
    const channel = await agentConversations().findOne({ sessionId: 'bot-c-channel' })

    // The client offers Switch runtime for any cause but `other`.
    expect(channel?.timelineEvents?.at(-1)).toMatchObject({
      kind: 'agent_reply_failed',
      cause: 'offline',
      reason: gone.message,
    })
  })
})
