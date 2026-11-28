import { beforeEach, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { createSlackOutboundContext } from './agent-outbound'

import { createNotificationTools } from '@/lib/agent/tools-skilled/notification-tools'

import type { SlackOutboundDependencies } from './agent-outbound'

const teamId = new ObjectId().toHexString()
let installed = true
let channelGrants: { slackWorkspaceId: string; slackChannelId: string }[] = []
let workspaceBot: { botToken: string; workspaceName: string } | null = {
  botToken: 'grant-token',
  workspaceName: 'HostCo',
}
let selfMapping: { slackUserId: string } | null = { slackUserId: 'U1' }
let postCount = 0
const postedMessages: Record<string, unknown>[] = []
let mayPost = true

const dependencies: SlackOutboundDependencies = {
  getBinding: async () =>
    installed ? { slackTeamId: 'T1', slackTeamName: 'Acme', botUserId: 'B1' } : null,
  resolveBot: async () =>
    installed
      ? {
          botToken: 'secret-token',
          binding: { slackTeamId: 'T1', slackTeamName: 'Acme' },
        }
      : null,
  listChannelGrants: async () => channelGrants,
  resolveWorkspaceBot: async () => workspaceBot,
  getSelfMapping: async () => selfMapping,
  canViewPrivateChannels: async () => true,
  listChannels: async () => [{ id: 'C1', name: 'ops', isPrivate: false }],
  getChannel: async (_token: string, channelId: string) => ({
    id: channelId,
    name: 'ops',
    isPrivate: false,
  }),
  openDm: async () => 'D1',
  postMessage: async (input) => {
    postCount += 1
    postedMessages.push(input)

    return { ok: true, channel: input.channel, ts: input.threadTs ? '123.789' : '123.456' }
  },
  readHistory: async () => ({ messages: [], hasMore: false }),
  readReplies: async () => ({ messages: [], hasMore: false }),
  listMembers: async () => ({ members: [], truncated: false }),
  mayPostIn: async () => mayPost,
}

beforeEach(() => {
  installed = true
  channelGrants = []
  workspaceBot = { botToken: 'grant-token', workspaceName: 'HostCo' }
  selfMapping = { slackUserId: 'U1' }
  postCount = 0
  postedMessages.length = 0
  mayPost = true
})

describe('agent outbound Slack context', () => {
  test('is absent without a team-owned Slack installation', async () => {
    installed = false
    await expect(
      createSlackOutboundContext({ userId: 'user-1', teamId, sessionId: 'bot-1' }, dependencies),
    ).resolves.toBeNull()
  })

  test('lists joined channels and current-user DM availability', async () => {
    const context = await createSlackOutboundContext(
      { userId: 'user-1', teamId, sessionId: 'bot-1' },
      dependencies,
    )

    await expect(context?.listDestinations()).resolves.toEqual({
      ok: true,
      workspace: { id: 'T1', name: 'Acme' },
      channels: [
        {
          id: 'C1',
          name: 'ops',
          isPrivate: false,
          slackWorkspaceId: 'T1',
          slackWorkspaceName: 'Acme',
        },
      ],
      dmSelfAvailable: true,
    })
  })

  test('does not disclose private destination names to non-administrators', async () => {
    const context = await createSlackOutboundContext(
      { userId: 'user-1', teamId, sessionId: 'bot-1' },
      {
        ...dependencies,
        canViewPrivateChannels: async () => false,
        listChannels: async () => [
          { id: 'C1', name: 'ops', isPrivate: false },
          { id: 'G1', name: 'executive-incidents', isPrivate: true },
        ],
      },
    )

    await expect(context?.listDestinations()).resolves.toEqual(
      expect.objectContaining({
        channels: [expect.objectContaining({ id: 'C1', name: 'ops', isPrivate: false })],
      }),
    )
  })

  test('posts one message and reports where it went', async () => {
    const context = await createSlackOutboundContext(
      { userId: 'user-1', teamId, sessionId: 'bot-1' },
      dependencies,
    )
    const first = await context?.post({
      destination: { type: 'channel', channelId: 'C1' },
      text: 'Incident report',
    })

    expect(first).toEqual({
      ok: true,
      destination: { type: 'channel', channelId: 'C1', label: '#ops' },
      messageTs: '123.456',
    })

    await expect(
      context?.post({
        destination: { type: 'channel', channelId: 'C1' },
        text: 'Duplicate',
      }),
    ).resolves.toEqual(expect.objectContaining({ ok: false }))
    expect(postCount).toBe(1)
  })

  test('every post says which conversation it is from, so its Bot is named', async () => {
    const context = await createSlackOutboundContext(
      { userId: 'user-1', teamId, sessionId: 'bot-1' },
      dependencies,
    )

    await context?.post({ destination: { type: 'channel', channelId: 'C1' }, text: 'Done.' })
    const again = await createSlackOutboundContext(
      { userId: 'user-1', teamId, sessionId: 'bot-1' },
      dependencies,
    )

    await again?.post({ destination: { type: 'dm_self' }, text: 'Done.' })

    expect(postedMessages.map((one) => one.from)).toEqual([
      { sessionId: 'bot-1', slackWorkspaceId: 'T1' },
      { sessionId: 'bot-1', slackWorkspaceId: 'T1' },
    ])
  })

  test("another Bot's chat refuses the post before anything reaches Slack", async () => {
    mayPost = false
    const context = await createSlackOutboundContext(
      { userId: 'user-1', teamId, sessionId: 'bot-1' },
      dependencies,
    )

    await expect(
      context?.post({ destination: { type: 'channel', channelId: 'C1' }, text: 'Hello.' }),
    ).resolves.toEqual({
      ok: false,
      error: "#ops is another Bot's chat. Only that Bot and its Tasks post there.",
    })
    expect(postCount).toBe(0)
  })

  test('a non-destination rejection is capped too, so no validation path loops', async () => {
    // Every pre-delivery rejection must reach the same cap. An unbound-DM
    // refusal hits the datastore on each call, so an uncapped path is a real
    // loop, not just a noisy one.
    selfMapping = null
    const context = await createSlackOutboundContext(
      { userId: 'user-1', teamId, sessionId: 'bot-1' },
      dependencies,
    )
    const unlinkedDm = () =>
      context?.post({
        destination: { type: 'dm_self' },
        text: 'Alert fired.',
      })

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(unlinkedDm()).resolves.toEqual(
        expect.objectContaining({ ok: false, error: expect.stringContaining('not linked') }),
      )
    }
    await expect(unlinkedDm()).resolves.toEqual(
      expect.objectContaining({ ok: false, error: expect.stringContaining('Too many invalid') }),
    )
    expect(postCount).toBe(0)
  })

  test('a throwing dependency is capped too, so a failing channel cannot loop', async () => {
    // Resolving a channel calls Slack, so an uncapped retry here is a loop
    // against their API rather than a local one.
    let lookups = 0
    const context = await createSlackOutboundContext(
      { userId: 'user-1', teamId, sessionId: 'bot-1' },
      {
        ...dependencies,
        getChannel: async () => {
          lookups += 1
          throw new Error('channel_not_found')
        },
      },
    )
    const failingPost = () =>
      context?.post({
        destination: { type: 'channel', channelId: 'C1' },
        text: 'Alert fired.',
      })

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(failingPost()).resolves.toEqual(
        expect.objectContaining({ ok: false, error: expect.stringContaining('channel_not_found') }),
      )
    }
    await expect(failingPost()).resolves.toEqual(
      expect.objectContaining({ ok: false, error: expect.stringContaining('Too many invalid') }),
    )
    expect(lookups).toBe(5)
    expect(postCount).toBe(0)
  })

  test('two ordinary posts issued together cannot both spend the same budget', async () => {
    // An ordinary turn allows exactly one outbound message. The ceiling check at
    // the top of post() sits before several awaits, and a model can emit two
    // tool calls in one step, so that check alone bounds nothing — commitAttempt
    // has to be the gate.
    const context = await createSlackOutboundContext(
      { userId: 'user-1', teamId, sessionId: 'bot-1' },
      {
        ...dependencies,
        // Yield inside the pre-commit window so both calls get past the fast path.
        getChannel: async (_token: string, channelId: string) => {
          await new Promise((resolve) => setTimeout(resolve, 5))

          return { id: channelId, name: 'ops', isPrivate: false }
        },
      },
    )
    const send = (text: string) =>
      context!.post({
        destination: { type: 'channel', channelId: 'C1' },
        text,
      })

    const results = await Promise.all([send('first report'), send('second report')])

    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok)).toHaveLength(1)
    expect(postCount).toBe(1)
  })

  test('refuses DM when the current user has no Slack identity mapping', async () => {
    selfMapping = null
    const context = await createSlackOutboundContext(
      { userId: 'user-1', teamId, sessionId: 'bot-1' },
      dependencies,
    )

    await expect(
      context?.post({ destination: { type: 'dm_self' }, text: 'Report' }),
    ).resolves.toEqual(
      expect.objectContaining({ ok: false, error: expect.stringContaining('not linked') }),
    )
    expect(postCount).toBe(0)
  })
})

describe('channel-grant Slack access (team without its own installation)', () => {
  beforeEach(() => {
    installed = false
    channelGrants = [{ slackWorkspaceId: 'T9', slackChannelId: 'C9' }]
  })

  test('exists when enabled channel mappings grant access through another workspace', async () => {
    const context = await createSlackOutboundContext(
      { userId: 'user-1', teamId, sessionId: 'bot-1' },
      dependencies,
    )

    await expect(context?.listDestinations()).resolves.toEqual({
      ok: true,
      workspace: { id: 'T9', name: 'HostCo' },
      channels: [
        {
          id: 'C9',
          name: 'ops',
          isPrivate: false,
          slackWorkspaceId: 'T9',
          slackWorkspaceName: 'HostCo',
        },
      ],
      dmSelfAvailable: false,
    })
  })

  test('is absent when the granting workspace has no installation', async () => {
    workspaceBot = null
    await expect(
      createSlackOutboundContext({ userId: 'user-1', teamId, sessionId: 'bot-1' }, dependencies),
    ).resolves.toBeNull()
  })

  test('posts to a granted channel with the granting workspace bot', async () => {
    const context = await createSlackOutboundContext(
      { userId: 'user-1', teamId, sessionId: 'bot-1' },
      dependencies,
    )

    await expect(
      context?.post({
        destination: { type: 'channel', channelId: 'C9' },
        text: 'hello',
      }),
    ).resolves.toEqual(expect.objectContaining({ ok: true, messageTs: '123.456' }))
    expect(postedMessages).toEqual([
      expect.objectContaining({ token: 'grant-token', channel: 'C9' }),
    ])
  })

  test('rejects channels outside the grant', async () => {
    const context = await createSlackOutboundContext(
      { userId: 'user-1', teamId, sessionId: 'bot-1' },
      dependencies,
    )

    await expect(
      context?.post({
        destination: { type: 'channel', channelId: 'C-ELSEWHERE' },
        text: 'hello',
      }),
    ).resolves.toEqual(
      expect.objectContaining({ ok: false, error: expect.stringContaining('not linked') }),
    )
    expect(postCount).toBe(0)
  })

  test('rejects any DM destination', async () => {
    const context = await createSlackOutboundContext(
      { userId: 'user-1', teamId, sessionId: 'bot-1' },
      dependencies,
    )

    await expect(
      context?.post({
        destination: { type: 'dm_self' },
        text: 'hello',
      }),
    ).resolves.toEqual(
      expect.objectContaining({ ok: false, error: expect.stringContaining('DM is unavailable') }),
    )
    expect(postCount).toBe(0)
  })

  test('fails closed when the grant is revoked between planning and posting', async () => {
    const context = await createSlackOutboundContext(
      { userId: 'user-1', teamId, sessionId: 'bot-1' },
      dependencies,
    )

    channelGrants = []
    await expect(
      context?.post({
        destination: { type: 'channel', channelId: 'C9' },
        text: 'hello',
      }),
    ).resolves.toEqual(
      expect.objectContaining({ ok: false, error: expect.stringContaining('no longer connected') }),
    )
    expect(postCount).toBe(0)
  })
})

describe('mixed access (own installation plus foreign channel grants)', () => {
  beforeEach(() => {
    installed = true
    channelGrants = [{ slackWorkspaceId: 'T9', slackChannelId: 'C9' }]
  })

  test('lists own joined channels and granted foreign channels together', async () => {
    const context = await createSlackOutboundContext(
      { userId: 'user-1', teamId, sessionId: 'bot-1' },
      dependencies,
    )

    await expect(context?.listDestinations()).resolves.toEqual({
      ok: true,
      workspace: { id: 'T1', name: 'Acme' },
      channels: [
        {
          id: 'C1',
          name: 'ops',
          isPrivate: false,
          slackWorkspaceId: 'T1',
          slackWorkspaceName: 'Acme',
        },
        {
          id: 'C9',
          name: 'ops',
          isPrivate: false,
          slackWorkspaceId: 'T9',
          slackWorkspaceName: 'HostCo',
        },
      ],
      dmSelfAvailable: true,
    })
  })

  test('routes a workspace-qualified granted destination through the granting bot', async () => {
    const context = await createSlackOutboundContext(
      { userId: 'user-1', teamId, sessionId: 'bot-1' },
      dependencies,
    )

    await expect(
      context?.post({
        destination: { type: 'channel', channelId: 'C9', slackWorkspaceId: 'T9' },
        text: 'hello',
      }),
    ).resolves.toEqual(expect.objectContaining({ ok: true }))
    expect(postedMessages).toEqual([
      expect.objectContaining({ token: 'grant-token', channel: 'C9' }),
    ])
  })

  test('falls back to the grant when the own bot cannot reach an unqualified channel', async () => {
    const context = await createSlackOutboundContext(
      { userId: 'user-1', teamId, sessionId: 'bot-1' },
      {
        ...dependencies,
        getChannel: async (token: string, channelId: string) => {
          if (token === 'secret-token' && channelId === 'C9') {
            throw new Error('not_in_channel')
          }

          return { id: channelId, name: 'ops', isPrivate: false }
        },
      },
    )

    await expect(
      context?.post({
        destination: { type: 'channel', channelId: 'C9' },
        text: 'hello',
      }),
    ).resolves.toEqual(expect.objectContaining({ ok: true }))
    expect(postedMessages).toEqual([
      expect.objectContaining({ token: 'grant-token', channel: 'C9' }),
    ])
  })

  test('prefers the own bot for an unqualified channel it can reach', async () => {
    const context = await createSlackOutboundContext(
      { userId: 'user-1', teamId, sessionId: 'bot-1' },
      dependencies,
    )

    await expect(
      context?.post({
        destination: { type: 'channel', channelId: 'C9' },
        text: 'hello',
      }),
    ).resolves.toEqual(expect.objectContaining({ ok: true }))
    expect(postedMessages).toEqual([
      expect.objectContaining({ token: 'secret-token', channel: 'C9' }),
    ])
  })
})

// Under the channel-binds-a-Bot design (#4758) a slack_post message is never a
// handle on a conversation: a follow-up goes to the channel's Bot.
describe('the slack_post tool as the model calls it', () => {
  test('posts one message and opens no thread, whatever the model passes', async () => {
    const slackOutbound = await createSlackOutboundContext(
      { userId: 'user-1', teamId, sessionId: 'bot-1' },
      dependencies,
    )
    const { slackNotificationTools } = createNotificationTools({
      slackOutbound,
      larkOutbound: null,
    })
    const slackPost = slackNotificationTools.slack_post as {
      inputSchema: { parse: (input: unknown) => unknown }
      execute: (input: unknown, options: unknown) => Promise<unknown>
    }
    const input = slackPost.inputSchema.parse({
      label: 'Post alert',
      destination: { type: 'channel', channelId: 'C1' },
      text: 'Alert fired.',
      bindConversation: true,
      replyThread: { text: 'Detail.' },
    })

    await expect(slackPost.execute(input, {})).resolves.toEqual(
      expect.objectContaining({ ok: true, messageTs: '123.456' }),
    )
    expect(postedMessages).toEqual([expect.not.objectContaining({ threadTs: expect.anything() })])
  })
})
