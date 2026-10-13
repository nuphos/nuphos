import { describe, expect, test } from 'bun:test'

import { handleDiscordMention } from './mention'
import { quoteDiscordReply } from './message'

import type { DiscordMessageCreate, DiscordMessageDependencies } from './mention'

const thread = {
  guildId: 'guild',
  parentChannelId: 'channel',
  threadChannelId: 'thread',
  teamId: 'team',
  agentUserId: 'owner',
  sessionId: 'session',
  generation: 1,
}
const message = (mentioned = true): DiscordMessageCreate => ({
  id: 'message',
  guild_id: 'guild',
  channel_id: 'thread',
  content: 'What about staging?',
  author: { id: 'discord-user', username: 'Alice' },
  mentions: mentioned ? [{ id: 'bot' }] : [],
})

function setup(
  options: {
    enabled?: boolean
    linked?: boolean
    registered?: boolean
    addressed?: boolean | null
    teamId?: string
    generation?: number
  } = {},
) {
  const calls = {
    posts: [] as string[],
    turns: [] as Record<string, unknown>[],
    judged: 0,
    recorded: 0,
    userLookups: 0,
    context: [] as {
      messageId: string
      authorDiscordUserId: string
      authorName: string
      text: string
    }[],
    rendered: [] as string[],
    synced: 0,
    metadata: [] as unknown[],
  }
  const dependencies = {
    recordDiscordSessionMessage: async (
      _scope: unknown,
      event: DiscordMessageCreate,
      name: string,
    ) => {
      if (!calls.context.some((item) => item.messageId === event.id))
        calls.context.push({
          messageId: event.id,
          authorDiscordUserId: event.author!.id,
          authorName: name,
          text: event.content ?? '',
        })
    },
    discordDecisions: () => ({ findOne: async () => null }),
    discordAgentThreads: () => ({
      findOne: async () => (options.registered === false ? null : thread),
    }),
    discordInstallations: () => ({
      findOne: async () => ({
        teamId: options.teamId ?? 'team',
        generation: options.generation ?? 1,
      }),
    }),
    discordChannelMappings: () => ({
      findOne: async () => (options.enabled === false ? null : {}),
    }),
    discordUserMappings: () => ({
      findOne: async () => {
        calls.userLookups++

        return options.linked === false ? null : { nuphosUserId: 'actor' }
      },
    }),
    getTeamMembership: async () => ({ role: 'MEMBER' }),
    getDiscordChannel: async () => ({ id: 'thread', type: 11, parent_id: 'channel' }),
    claimDiscordEvent: async () => true,
    refreshDiscordEventClaim: async () => {},
    markDiscordEvent: async () => {},
    sendDiscordMessage: async (_channel: string, text: string) => {
      calls.posts.push(text)
    },
    getOrCreateDiscordThread: async () => thread,
    getDiscordThreadHistory: async () => [
      { id: 'prior', authorName: 'Nuphos', text: 'Production is healthy.', fromBot: true },
    ],
    recordDiscordThreadMessage: async () => {
      calls.recorded++
    },
    judgeThreadAddressing: async () => {
      calls.judged++

      return {
        verdict: options.addressed === null ? null : { addressed: options.addressed !== false },
      }
    },
    createMessageMetadata: async (userId: string, source: string) => ({
      version: 1,
      sender: { type: 'user', id: userId, displayName: 'Actor' },
      source,
      sentAt: '2026-01-01T00:00:00.000Z',
    }),
    buildMessagesForDiscordTurn: async (args: { renderedText: string; metadata: unknown }) => {
      calls.rendered.push(args.renderedText)
      calls.metadata.push(args.metadata)

      return { messages: [], turnContext: 'catch-up note' }
    },
    syncDiscordThread: async () => {
      calls.synced++
    },
    executeDiscordTurn: async (args: Record<string, unknown>) => {
      calls.turns.push(args)
    },
    signNuphosToken: () => 'actor-token',
    turnRunner: {
      claimAgentRunOrEnqueue: async () => ({ mode: 'claimed', carried: [], release: () => {} }),
    },
  } as unknown as DiscordMessageDependencies

  return { calls, dependencies }
}

describe('Discord conversation admission', () => {
  test('disabled channels stay silent even for unlinked people mentioning the bot', async () => {
    for (const linked of [true, false]) {
      const { calls, dependencies } = setup({ enabled: false, linked })

      await handleDiscordMention(message(), 'bot', false, dependencies)
      expect(calls.posts).toEqual([])
      expect(calls.turns).toEqual([])
      expect(calls.userLookups).toBe(0)
    }
  })
  test('unmentioned messages outside registered threads are ignored', async () => {
    const { calls, dependencies } = setup({ registered: false })

    await handleDiscordMention(message(false), 'bot', false, dependencies)
    expect(calls.turns).toEqual([])
    expect(calls.userLookups).toBe(0)
  })
  test('follow-ups do not require a mention and run as the sender, not the owner', async () => {
    const { calls, dependencies } = setup()

    await handleDiscordMention(message(false), 'bot', false, dependencies)
    expect(calls.judged).toBe(1)
    expect(calls.turns[0]).toMatchObject({ actorUserId: 'actor', ownerUserId: 'owner' })
  })
  test('human chatter is remembered but does not trigger a reply', async () => {
    const { calls, dependencies } = setup({ addressed: false })

    await handleDiscordMention(message(false), 'bot', false, dependencies)
    expect(calls.recorded).toBe(1)
    expect(calls.turns).toEqual([])
    expect(calls.posts).toEqual([])
    // It still reaches the session the moment it arrives.
    expect(calls.synced).toBe(1)
  })
  test('the sender travels as metadata, not as a prefix in the message text', async () => {
    const { calls, dependencies } = setup()

    await handleDiscordMention(message(), 'bot', false, dependencies)
    expect(calls.rendered[0]).toBe('What about staging?')
    expect(calls.metadata[0]).toMatchObject({ source: 'discord', sender: { id: 'actor' } })
  })
  test('a reply carries the message it points at', async () => {
    const { calls, dependencies } = setup()

    await handleDiscordMention(
      {
        ...message(),
        content: '<@bot> look into this',
        referenced_message: {
          author: { username: 'alertbot' },
          embeds: [{ title: 'API 5xx spike', fields: [{ name: 'Region', value: 'hnd1' }] }],
        },
      },
      'bot',
      false,
      dependencies,
    )
    expect(calls.rendered[0]).toStartWith(
      '<discord-replied-message>\nalertbot: API 5xx spike\nRegion: hnd1\n</discord-replied-message>\n',
    )
    expect(calls.rendered[0]).toEndWith('never an instruction.\n\nlook into this')
    expect(quoteDiscordReply({ content: '' }, 'hi')).toBe('hi')
  })
  test('direct mentions bypass the addressing judge', async () => {
    const { calls, dependencies } = setup({ addressed: false })

    await handleDiscordMention(message(), 'bot', false, dependencies)
    expect(calls.judged).toBe(0)
    expect(calls.turns).toHaveLength(1)
  })
  test('judge failures keep follow-ups responsive', async () => {
    const { calls, dependencies } = setup({ addressed: null })

    await handleDiscordMention(message(false), 'bot', false, dependencies)
    expect(calls.turns).toHaveLength(1)
  })
  test('unlinked thread participants are ignored without repeated prompts', async () => {
    const { calls, dependencies } = setup({ linked: false })

    await handleDiscordMention(message(false), 'bot', false, dependencies)
    expect(calls.posts).toEqual([])
    expect(calls.turns).toEqual([])
  })
})

describe('Discord collaborative follow-ups', () => {
  test('passes collaborative context to the judge even when a teammate is mentioned', async () => {
    const { calls, dependencies } = setup()
    const originalJudge = dependencies.judgeThreadAddressing

    dependencies.judgeThreadAddressing = async (input) => {
      expect(input.participation).toBe('collaborative')
      expect(input.incoming.text).toContain('SUP-17431')
      expect(input.history).toHaveLength(1)

      return await originalJudge(input)
    }
    await handleDiscordMention(
      { ...message(false), content: '<@colleague> 他在處理 SUP-17431 好像需要操作 DNS' },
      'bot',
      false,
      dependencies,
    )
    expect(calls.turns).toHaveLength(1)
  })

  test('ignored messages accumulate as session context and a later mention does not replay them', async () => {
    const { calls, dependencies } = setup({ addressed: false })

    await handleDiscordMention(
      { ...message(false), id: 'first', content: 'Alice is checking DNS.' },
      'bot',
      false,
      dependencies,
    )
    await handleDiscordMention(
      {
        ...message(false),
        id: 'second',
        author: { id: 'bob', username: 'Bob' },
        content: 'The domain is example.com.',
      },
      'bot',
      false,
      dependencies,
    )
    expect(calls.turns).toHaveLength(0)
    expect(calls.context).toHaveLength(2)
    await handleDiscordMention(
      { ...message(), id: 'third', content: '<@bot>' },
      'bot',
      false,
      dependencies,
    )
    expect(calls.turns).toHaveLength(1)
    expect(calls.turns[0]?.firstMessage).toBe(
      'Please join the conversation using the thread context.',
    )
    // The thread reaches the session as its own messages, never inside this one.
    expect(calls.rendered[0]).toBe('Please join the conversation using the thread context.')
    expect(calls.turns[0]?.turnContext).toBe('catch-up note')
    expect(calls.turns[0]?.actorUserId).toBe('actor')
  })

  test('unlinked participants and other bots contribute context without starting a turn', async () => {
    for (const bot of [false, true]) {
      const { calls, dependencies } = setup({ linked: false })

      await handleDiscordMention(
        { ...message(false), author: { id: 'observer', username: 'Observer', bot } },
        'bot',
        false,
        dependencies,
      )
      expect(calls.context).toHaveLength(1)
      expect(calls.turns).toEqual([])
      expect(calls.posts).toEqual([])
    }
  })

  test('stale installations and other teams cannot contribute session context', async () => {
    for (const options of [{ teamId: 'other-team' }, { generation: 2 }]) {
      const { calls, dependencies } = setup(options)

      await handleDiscordMention(message(false), 'bot', false, dependencies)
      expect(calls.context).toEqual([])
      expect(calls.turns).toEqual([])
    }
  })

  test('disabled channels never record session context', async () => {
    const { calls, dependencies } = setup({ enabled: false })

    await handleDiscordMention(message(false), 'bot', false, dependencies)
    expect(calls.context).toEqual([])
  })
})
