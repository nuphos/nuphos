import { beforeEach, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { createSlackOutboundContext } from './agent-outbound'

import type { SlackOutboundDependencies } from './agent-outbound'

const teamId = new ObjectId().toHexString()
let installed = true
let channelGrants: { slackWorkspaceId: string; slackChannelId: string }[] = []
let workspaceBot: { botToken: string; workspaceName: string } | null = {
  botToken: 'grant-token',
  workspaceName: 'HostCo',
}
let selfMapping: { slackUserId: string } | null = { slackUserId: 'U1' }
let existingThread: { slackChannelId: string } | null = null
let postCount = 0
const bindings: Record<string, unknown>[] = []
const postedMessages: Record<string, unknown>[] = []
const transcriptAppends: { key: Record<string, unknown>; message: Record<string, unknown> }[] = []
const FORK_SESSION_ID = 'forked-session-1'

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
  getThreadBySessionId: async () => existingThread,
  bindThread: async (input) => {
    bindings.push(input)

    return input
  },
  appendThreadMessage: async (key, message) => {
    transcriptAppends.push({ key, message })
  },
  newSessionId: () => FORK_SESSION_ID,
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
}

beforeEach(() => {
  installed = true
  channelGrants = []
  workspaceBot = { botToken: 'grant-token', workspaceName: 'HostCo' }
  selfMapping = { slackUserId: 'U1' }
  existingThread = null
  postCount = 0
  bindings.length = 0
  postedMessages.length = 0
  transcriptAppends.length = 0
})

describe('agent outbound Slack context', () => {
  test('is absent without a team-owned Slack installation', async () => {
    installed = false
    await expect(
      createSlackOutboundContext(
        { userId: 'user-1', conversationId: 'conv-1', teamId },
        dependencies,
      ),
    ).resolves.toBeNull()
  })

  test('lists joined channels and current-user DM availability', async () => {
    const context = await createSlackOutboundContext(
      { userId: 'user-1', conversationId: 'conv-1', teamId },
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
      { userId: 'user-1', conversationId: 'conv-1', teamId },
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

  test('posts one root and binds it to the current conversation', async () => {
    const context = await createSlackOutboundContext(
      { userId: 'user-1', conversationId: 'conv-1', teamId },
      dependencies,
    )
    const first = await context?.post({
      destination: { type: 'channel', channelId: 'C1' },
      text: 'Incident report',
      bindConversation: true,
    })

    expect(first).toEqual({
      ok: true,
      destination: { type: 'channel', channelId: 'C1', label: '#ops' },
      delivery: 'root',
      messageTs: '123.456',
      rootThreadTs: '123.456',
      threadBound: true,
    })
    expect(bindings).toEqual([
      expect.objectContaining({
        slackWorkspaceId: 'T1',
        slackChannelId: 'C1',
        slackThreadTs: '123.456',
        teamId,
        agentUserId: 'user-1',
        sessionId: 'conv-1',
      }),
    ])
    // A fresh root is seeded by bindThread's rootText — appending it too would
    // record the same message twice.
    expect(transcriptAppends).toHaveLength(0)

    await expect(
      context?.post({
        destination: { type: 'channel', channelId: 'C1' },
        text: 'Duplicate',
        bindConversation: true,
      }),
    ).resolves.toEqual(expect.objectContaining({ ok: false }))
    expect(postCount).toBe(1)
  })

  test('a non-destination rejection is capped too, so no validation path loops', async () => {
    // Every pre-delivery rejection must reach the same cap. An unbound-DM
    // refusal hits the datastore on each call, so an uncapped path is a real
    // loop, not just a noisy one.
    selfMapping = null
    const context = await createSlackOutboundContext(
      { userId: 'user-1', conversationId: 'conv-dm-loop', teamId },
      dependencies,
    )
    const unlinkedDm = () =>
      context?.post({
        destination: { type: 'dm_self' },
        text: 'Alert fired.',
        bindConversation: true,
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
      { userId: 'user-1', conversationId: 'conv-throwing', teamId },
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
        bindConversation: true,
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
      { userId: 'user-1', conversationId: 'conv-race', teamId },
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
        bindConversation: false,
      })

    const results = await Promise.all([send('first report'), send('second report')])

    expect(results.filter((r) => r.ok)).toHaveLength(1)
    expect(results.filter((r) => !r.ok)).toHaveLength(1)
    expect(postCount).toBe(1)
  })

  test('refuses DM when the current user has no Slack identity mapping', async () => {
    selfMapping = null
    const context = await createSlackOutboundContext(
      { userId: 'user-1', conversationId: 'conv-1', teamId },
      dependencies,
    )

    await expect(
      context?.post({ destination: { type: 'dm_self' }, text: 'Report', bindConversation: true }),
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
      { userId: 'user-1', conversationId: 'conv-1', teamId },
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
      createSlackOutboundContext(
        { userId: 'user-1', conversationId: 'conv-1', teamId },
        dependencies,
      ),
    ).resolves.toBeNull()
  })

  test('posts to a granted channel with the granting workspace bot', async () => {
    const context = await createSlackOutboundContext(
      { userId: 'user-1', conversationId: 'conv-1', teamId },
      dependencies,
    )

    await expect(
      context?.post({
        destination: { type: 'channel', channelId: 'C9' },
        text: 'hello',
        bindConversation: false,
      }),
    ).resolves.toEqual(expect.objectContaining({ ok: true, delivery: 'root' }))
    expect(postedMessages).toEqual([
      expect.objectContaining({ token: 'grant-token', channel: 'C9' }),
    ])
  })

  test('rejects channels outside the grant', async () => {
    const context = await createSlackOutboundContext(
      { userId: 'user-1', conversationId: 'conv-1', teamId },
      dependencies,
    )

    await expect(
      context?.post({
        destination: { type: 'channel', channelId: 'C-ELSEWHERE' },
        text: 'hello',
        bindConversation: false,
      }),
    ).resolves.toEqual(
      expect.objectContaining({ ok: false, error: expect.stringContaining('not linked') }),
    )
    expect(postCount).toBe(0)
  })

  test('rejects any DM destination', async () => {
    const context = await createSlackOutboundContext(
      { userId: 'user-1', conversationId: 'conv-1', teamId },
      dependencies,
    )

    await expect(
      context?.post({
        destination: { type: 'dm_self' },
        text: 'hello',
        bindConversation: false,
      }),
    ).resolves.toEqual(
      expect.objectContaining({ ok: false, error: expect.stringContaining('DM is unavailable') }),
    )
    expect(postCount).toBe(0)
  })

  test('fails closed when the grant is revoked between planning and posting', async () => {
    const context = await createSlackOutboundContext(
      { userId: 'user-1', conversationId: 'conv-1', teamId },
      dependencies,
    )

    channelGrants = []
    await expect(
      context?.post({
        destination: { type: 'channel', channelId: 'C9' },
        text: 'hello',
        bindConversation: false,
      }),
    ).resolves.toEqual(
      expect.objectContaining({ ok: false, error: expect.stringContaining('no longer connected') }),
    )
    expect(postCount).toBe(0)
  })

  test('binds the conversation to a root posted through the granting workspace', async () => {
    const context = await createSlackOutboundContext(
      { userId: 'user-1', conversationId: 'conv-1', teamId },
      dependencies,
    )

    await expect(
      context?.post({
        destination: { type: 'channel', channelId: 'C9' },
        text: 'alert',
        bindConversation: true,
      }),
    ).resolves.toEqual(expect.objectContaining({ ok: true, delivery: 'root' }))
    expect(bindings).toEqual([
      expect.objectContaining({ slackWorkspaceId: 'T9', slackChannelId: 'C9', teamId }),
    ])
  })
})

describe('mixed access (own installation plus foreign channel grants)', () => {
  beforeEach(() => {
    installed = true
    channelGrants = [{ slackWorkspaceId: 'T9', slackChannelId: 'C9' }]
  })

  test('lists own joined channels and granted foreign channels together', async () => {
    const context = await createSlackOutboundContext(
      { userId: 'user-1', conversationId: 'conv-1', teamId },
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
      { userId: 'user-1', conversationId: 'conv-1', teamId },
      dependencies,
    )

    await expect(
      context?.post({
        destination: { type: 'channel', channelId: 'C9', slackWorkspaceId: 'T9' },
        text: 'hello',
        bindConversation: false,
      }),
    ).resolves.toEqual(expect.objectContaining({ ok: true }))
    expect(postedMessages).toEqual([
      expect.objectContaining({ token: 'grant-token', channel: 'C9' }),
    ])
  })

  test('falls back to the grant when the own bot cannot reach an unqualified channel', async () => {
    const context = await createSlackOutboundContext(
      { userId: 'user-1', conversationId: 'conv-1', teamId },
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
        bindConversation: false,
      }),
    ).resolves.toEqual(expect.objectContaining({ ok: true }))
    expect(postedMessages).toEqual([
      expect.objectContaining({ token: 'grant-token', channel: 'C9' }),
    ])
  })

  test('prefers the own bot for an unqualified channel it can reach', async () => {
    const context = await createSlackOutboundContext(
      { userId: 'user-1', conversationId: 'conv-1', teamId },
      dependencies,
    )

    await expect(
      context?.post({
        destination: { type: 'channel', channelId: 'C9' },
        text: 'hello',
        bindConversation: false,
      }),
    ).resolves.toEqual(expect.objectContaining({ ok: true }))
    expect(postedMessages).toEqual([
      expect.objectContaining({ token: 'secret-token', channel: 'C9' }),
    ])
  })
})

describe('a report that opens its own reply thread', () => {
  test('posts the root, opens the thread, and gives it a conversation of its own', async () => {
    const context = await createSlackOutboundContext(
      { userId: 'user-1', conversationId: 'conv-1', teamId },
      dependencies,
    )
    const result = await context?.post({
      destination: { type: 'channel', channelId: 'C1' },
      text: 'Lighthouse cost is up 12%',
      bindConversation: true,
      replyThread: { text: 'Full breakdown per instance…' },
    })

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        delivery: 'root',
        threadBound: true,
        replyThread: { opened: true, sessionId: FORK_SESSION_ID },
      }),
    )
    // The root, then one reply under it.
    expect(postedMessages).toEqual([
      expect.objectContaining({ channel: 'C1', text: 'Lighthouse cost is up 12%' }),
      expect.objectContaining({ channel: 'C1', threadTs: '123.456' }),
    ])
    expect(postedMessages[1]?.text).toContain('Full breakdown per instance…')
    // The invitation is the server's, not the model's.
    expect(postedMessages[1]?.text).toContain('Mention me in this thread')
    // The root is seeded by bindThread's rootText; the reply under it must be
    // appended separately or the fork's judge never sees the bot's own report.
    expect(transcriptAppends).toEqual([
      {
        key: { slackWorkspaceId: 'T1', slackChannelId: 'C1', slackThreadTs: '123.456' },
        message: expect.objectContaining({
          ts: '123.789',
          authorName: 'Nuphos',
          fromBot: true,
          text: postedMessages[1]?.text,
        }),
      },
    ])
  })

  test('binds the fork, never the conversation that produced the report', async () => {
    const context = await createSlackOutboundContext(
      { userId: 'user-1', conversationId: 'conv-1', teamId },
      dependencies,
    )

    await context?.post({
      destination: { type: 'channel', channelId: 'C1' },
      text: 'Daily digest',
      bindConversation: true,
      replyThread: { text: 'Detail' },
    })
    expect(bindings).toEqual([
      expect.objectContaining({ sessionId: FORK_SESSION_ID, slackThreadTs: '123.456' }),
    ])
    expect(bindings[0]?.sessionId).not.toBe('conv-1')
  })

  test('carries the untruncated report to the fork, so its first reply has it in hand', async () => {
    const context = await createSlackOutboundContext(
      { userId: 'user-1', conversationId: 'conv-1', teamId },
      dependencies,
    )

    await context?.post({
      destination: { type: 'channel', channelId: 'C1' },
      text: 'Root summary',
      bindConversation: true,
      replyThread: { text: 'Thread detail' },
    })
    const context_ = bindings[0]?.notificationContext as string

    expect(context_).toContain('Root summary')
    expect(context_).toContain('Thread detail')
  })

  test('a thread that fails to open never fails the report already delivered', async () => {
    let posts = 0
    const context = await createSlackOutboundContext(
      { userId: 'user-1', conversationId: 'conv-1', teamId },
      {
        ...dependencies,
        postMessage: async (input) => {
          posts += 1
          if (posts === 2) throw new Error('thread_not_found')
          postedMessages.push(input)

          return { ok: true, channel: input.channel, ts: '123.456' }
        },
      },
    )
    const result = await context?.post({
      destination: { type: 'channel', channelId: 'C1' },
      text: 'Digest',
      bindConversation: true,
      replyThread: { text: 'Detail' },
    })

    expect(result).toEqual(
      expect.objectContaining({
        ok: true,
        messageTs: '123.456',
        threadBound: false,
        replyThread: expect.objectContaining({ opened: false, error: 'thread_not_found' }),
      }),
    )
    expect(bindings).toEqual([])
  })
})
