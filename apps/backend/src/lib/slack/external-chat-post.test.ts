import { beforeEach, describe, expect, spyOn, test } from 'bun:test'

import { agentConversations, agentMessages } from '@/lib/agent/db'
import { channelToolModule } from '@/lib/claude-code-preview/preview-tools/channels'
import * as transfers from '@/lib/file-transfer/service'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useSlackAgentBot } from '@/lib/test/doubles/slack-agent-bot'
import { useSlackApi } from '@/lib/test/doubles/slack-api'
import { useSlackInstallations } from '@/lib/test/doubles/slack-installations'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import type { AgentConversation } from '@/lib/agent/db'
import type { PreviewToolContext } from '@/lib/claude-code-preview/preview-tool-context'
import type * as dbActual from '@/lib/db'

const TEAM = '69e989027ab63e8d6a0ffcb6'
const RECORD = '00000000-0000-4000-8000-000000000021'
const CHAT = '00000000-0000-4000-8000-000000000022'
let memory = portabilityDb()
let posted: Record<string, unknown>[] = []
let slackFails = false
let scope = 'chat:write'

useDb({ db: (() => memory) as unknown as typeof dbActual.db })
// The in-memory store has no bulkWrite, so the append writes each row itself.
useAgentDb({
  appendConversationMessages: async ({ sessionId, userId, messages }) => {
    const stored = await agentMessages().find({ sessionId, userId }).toArray()

    for (const [offset, message] of messages.entries())
      await agentMessages().insertOne({
        sessionId,
        userId,
        index: stored.length + offset,
        messageId: message.id,
        role: message.role,
        parts: message.parts,
        metadata: message.metadata,
      } as never)
    await agentConversations().updateOne(
      { sessionId },
      { $set: { messageCount: stored.length + messages.length } },
    )

    return true
  },
})
useIdentity({ getTeamMembership: () => Promise.resolve({ role: 'MEMBER' } as never) })
useSlackAgentBot({
  getSlackChannelMappingByExternalChat: (externalChatId: string) =>
    Promise.resolve(
      (externalChatId === RECORD
        ? { slackWorkspaceId: 'T1', slackChannelId: 'C1', teamId: TEAM, enabled: true }
        : null) as never,
    ),
})
useSlackInstallations({
  resolveSlackBotForWorkspace: () =>
    Promise.resolve({ botToken: 'xoxb-1', botUserId: 'UBOT', binding: { scope } } as never),
})
useSlackApi({
  slackApi: (_token: string, method: string, body: Record<string, unknown>) => {
    if (slackFails) return Promise.reject(new Error('channel_not_found'))
    posted.push({ method, ...body })

    return Promise.resolve({ ok: true, ts: `20.${String(posted.length)}` } as never)
  },
})

const seed = (sessionId: string, extra: Partial<AgentConversation>) =>
  agentConversations().insertOne({
    sessionId,
    userId: 'owner',
    teamId: TEAM,
    title: sessionId,
    firstMessage: '',
    messageCount: 0,
    createdAt: new Date(),
    lastActiveAt: new Date(),
    ...extra,
  })

/** A Slack message the record holds, as the inbound path stores it. */
const slackPost = (index: number, ts: string, replyToTs?: string) =>
  agentMessages().insertOne({
    sessionId: RECORD,
    userId: 'owner',
    index,
    messageId: `slack:C1:${ts}`,
    role: 'user',
    parts: [{ type: 'text', text: `message ${ts}` }],
    metadata: {
      version: 1,
      sender: { type: 'user', id: 'slack:T1:U1', displayName: 'Someone' },
      source: 'slack',
      sentAt: new Date().toISOString(),
      unattested: true,
      ...(replyToTs
        ? { replyTo: { id: `slack:C1:${replyToTs}`, authorName: 'Someone', text: 'root' } }
        : {}),
    },
  } as never)

const post = (args: Record<string, unknown>) =>
  channelToolModule()
    .handlers({
      userId: 'owner',
      teamId: TEAM,
      sessionId: 'bot',
      locale: 'en',
    } as PreviewToolContext)
    .channel_post?.({ label: 'Answer', ...args })

beforeEach(async () => {
  memory = portabilityDb()
  posted = []
  slackFails = false
  scope = 'chat:write'
  await seed(RECORD, { kind: 'channel', external: 'slack', agentSessionIds: ['bot'] })
  await seed(CHAT, { kind: 'channel', agentSessionIds: ['bot'] })
  await seed('bot', { title: 'Deploy Bot', avatar: '07-ada' })
  await slackPost(0, '10.1')
  await slackPost(1, '10.2', '10.1')
})

describe("a Bot's post in a Slack channel's external chat", () => {
  test('goes to the Slack channel, under the Bot’s name, and keeps Slack’s id', async () => {
    expect(await post({ channelId: RECORD, text: 'Deploy is **done**.' })).toMatchObject({
      structuredContent: { posted: true },
    })

    expect(posted).toEqual([
      expect.objectContaining({
        method: 'chat.postMessage',
        channel: 'C1',
        text: '*Deploy Bot*\nDeploy is *done*.',
      }),
    ])
    expect(posted[0]).not.toHaveProperty('thread_ts')
    expect(await agentMessages().countDocuments({ messageId: 'slack:C1:20.1' })).toBe(1)
  })

  test('with the customize scope, Slack shows the Bot’s name itself', async () => {
    scope = 'chat:write,chat:write.customize'
    await post({ channelId: RECORD, text: 'Done.' })

    expect(posted[0]).toMatchObject({ text: 'Done.', username: 'Deploy Bot' })
  })

  test('an answer to a message goes into its Slack thread, at the thread’s root', async () => {
    await post({ channelId: RECORD, text: 'On it.', replyTo: 0 })
    await post({ channelId: RECORD, text: 'Also this.', replyTo: 1 })
    // An answer to the Bot's own reply in that thread stays in the same thread.
    await post({ channelId: RECORD, text: 'And more.', replyTo: 3 })

    expect(posted.map((call) => call.thread_ts)).toEqual(['10.1', '10.1', '10.1'])
  })

  test('a post Slack refuses fails the call, and the record keeps nothing', async () => {
    slackFails = true

    expect(await post({ channelId: RECORD, text: 'Hello.' })).toMatchObject({ isError: true })
    expect(await agentMessages().countDocuments({ 'metadata.sender.type': 'agent' })).toBe(0)
  })

  test('files are refused rather than dropped, until Slack uploads are wired', async () => {
    const ready = spyOn(transfers, 'getTransferGroup').mockResolvedValue({
      groupId: 'g1',
      status: 'ready',
      direction: 'download',
    } as Awaited<ReturnType<typeof transfers.getTransferGroup>>)

    try {
      expect(await post({ channelId: RECORD, text: 'See file.', files: ['g1'] })).toMatchObject({
        isError: true,
        content: [{ text: 'Files cannot be posted to a Slack channel yet.' }],
      })
      expect(posted).toEqual([])
    } finally {
      ready.mockRestore()
    }
  })

  test('a post in an ordinary Nuphos chat never reaches Slack', async () => {
    await post({ channelId: CHAT, text: 'Hello.' })

    expect(posted).toEqual([])
    expect(await agentMessages().countDocuments({ sessionId: CHAT })).toBe(1)
  })
})
