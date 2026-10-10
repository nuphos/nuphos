import { expect, test } from 'bun:test'

import { mirrorAppTurnToDiscord } from './turn'

import type { UIMessage } from 'ai'

const thread = {
  sessionId: 'session',
  teamId: 'team',
  guildId: 'guild',
  generation: 1,
  parentChannelId: 'channel',
  threadChannelId: 'thread',
  agentUserId: 'owner',
}
const message = {
  id: 'm1',
  role: 'user',
  metadata: {
    version: 1,
    sender: { type: 'user', id: 'alice', displayName: 'Alice' },
    source: 'nuphos',
    sentAt: '2026-01-01T00:00:00.000Z',
  },
  parts: [{ type: 'text', text: 'ship it?' }],
} as unknown as UIMessage

function setup(options: { bound?: boolean; connected?: boolean } = {}) {
  const calls = { posts: [] as string[][], recorded: [] as unknown[], synced: [] as unknown[][] }
  const deps = {
    discordAgentThreads: () => ({
      findOne: async (filter: unknown) => {
        expect(filter).toEqual({ sessionId: 'session', teamId: 'team' })

        return options.bound === false ? null : thread
      },
    }),
    isDiscordThreadConnected: async () => options.connected !== false,
    sendDiscordMessage: async (...args: string[]) => {
      calls.posts.push(args)
    },
    recordDiscordThreadMessage: async (_session: string, entry: unknown) => {
      calls.recorded.push(entry)
    },
    syncDiscordThread: async (...args: unknown[]) => {
      calls.synced.push(args)
    },
  } as unknown as Parameters<typeof mirrorAppTurnToDiscord>[1]

  return { calls, deps }
}

test('an app turn in a bound session posts the sender to the thread and syncs when it ends', async () => {
  const { calls, deps } = setup()
  const mirror = await mirrorAppTurnToDiscord(
    { sessionId: 'session', teamId: 'team', message },
    deps,
  )

  expect(calls.posts).toEqual([['thread', '**Alice** (from Nuphos):\nship it?']])
  expect(calls.recorded).toEqual([
    { id: expect.any(String), authorName: 'Alice', text: 'ship it?' },
  ])
  await mirror?.finish()
  expect(calls.synced).toEqual([[thread, 'owner']])
})

test('a resumed turn posts no question, and an unbound or disconnected session is left alone', async () => {
  const resumed = setup()

  expect(
    await mirrorAppTurnToDiscord({ sessionId: 'session', teamId: 'team' }, resumed.deps),
  ).not.toBeNull()
  expect(resumed.calls.posts).toEqual([])

  for (const options of [{ bound: false }, { connected: false }]) {
    const { calls, deps } = setup(options)

    expect(
      await mirrorAppTurnToDiscord({ sessionId: 'session', teamId: 'team', message }, deps),
    ).toBeNull()
    expect(calls.posts).toEqual([])
  }
})
