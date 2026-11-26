import { beforeEach, describe, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import { agentConversations } from '@/lib/agent/db'
import { useDb } from '@/lib/test/doubles/db'
import { useSlackApi } from '@/lib/test/doubles/slack-api'
import { useSlackInstallations } from '@/lib/test/doubles/slack-installations'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import type { AgentConversation } from '@/lib/agent/db'
import type { SlackOutboundDependencies } from '@/lib/slack/agent-outbound/types'
import type * as dbActual from '@/lib/db'

const teamId = new ObjectId().toHexString()
const CHAT = '00000000-0000-4000-8000-000000000031'
let memory = portabilityDb()
const posted: Record<string, unknown>[] = []

useDb({ db: (() => memory) as unknown as typeof dbActual.db })
useSlackInstallations({
  resolveSlackBotForWorkspace: () =>
    Promise.resolve({ botToken: 'xoxb-1', binding: { scope: 'chat:write' } } as never),
})
// Only the Slack HTTP call is faked.
useSlackApi({
  postSlackMessage: async (args: Record<string, unknown>) => {
    posted.push(args)

    return { ok: true, ts: '1.1', channel: args.channel }
  },
})

const { postAgentSlackMessage } = await import('@/lib/slack/agent-message')
const { slackChannelMappings } = await import('@/lib/slack/agent-bot/collections')
const { createNotificationTools } = await import('@/lib/agent/tools-skilled/notification-tools')
const { defaultDependencies } = await import('@/lib/slack/agent-outbound/default-dependencies')
const { createSlackOutboundContext } = await import('@/lib/slack/agent-outbound')

// The team's installation and channel lookups stand in for Slack; naming
// (postMessage) and the channel gate (mayPostIn) are the real defaults.
const dependencies: SlackOutboundDependencies = {
  ...defaultDependencies,
  getBinding: async () => ({ slackTeamId: 'T1', slackTeamName: 'Acme', botUserId: 'B1' }),
  resolveBot: async () => ({
    botToken: 'xoxb-1',
    binding: { slackTeamId: 'T1', slackTeamName: 'Acme' },
  }),
  listChannelGrants: async () => [],
  getSelfMapping: async () => null,
  getChannel: async (_token, channelId) => ({ id: channelId, name: 'ops', isPrivate: false }),
}

const seed = (sessionId: string, extra: Partial<AgentConversation>) =>
  agentConversations().insertOne({
    sessionId,
    userId: 'owner',
    title: 'Chat',
    firstMessage: '',
    messageCount: 0,
    createdAt: new Date(),
    lastActiveAt: new Date(),
    ...extra,
  } as AgentConversation)

const slackPost = async (sessionId: string, channelId: string, extra: object = {}) => {
  const slackOutbound = await createSlackOutboundContext(
    { userId: 'owner', teamId, sessionId },
    dependencies,
  )
  const tool = createNotificationTools({ slackOutbound, larkOutbound: null }).slackNotificationTools
    .slack_post as {
    inputSchema: { parse: (input: unknown) => unknown }
    execute: (input: unknown, options: unknown) => Promise<{ ok: boolean }>
  }

  return await tool.execute(
    tool.inputSchema.parse({
      label: 'Post',
      destination: { type: 'channel', channelId },
      text: 'Done.',
      ...extra,
    }),
    {},
  )
}

beforeEach(async () => {
  memory = portabilityDb()
  posted.length = 0
  await seed('bot', { title: 'Deploy Bot', avatar: 'robot' })
  await seed('task', { title: 'Check the rollout', parentSessionId: 'bot' })
  await seed('other-bot', { title: 'Billing Bot', avatar: 'robot' })
  await seed('other-task', { title: 'Invoices', parentSessionId: 'other-bot' })
  await seed('plain', {})
  await seed(CHAT, { agentSessionIds: ['bot'] })
  // C9 is the Deploy Bot's chat; C1 is an ordinary channel.
  await slackChannelMappings().insertOne({
    teamId,
    slackWorkspaceId: 'T1',
    slackChannelId: 'C9',
    externalChatId: CHAT,
    enabled: true,
  } as never)
})

describe('defaultDependencies', () => {
  // slack_post carries the agent's own CommonMark. Wiring it straight to
  // postSlackMessage is what made `**bold**` and `[a](b)` render literally, so
  // pin the seam rather than the symptom.
  test('sends slack_post text through the agent mrkdwn boundary', () => {
    expect(defaultDependencies.postMessage).toBe(postAgentSlackMessage)
  })
})

describe('slack_post through the default dependencies', () => {
  test('a Bot and its Task post under the Bot’s name; a plain chat does not', async () => {
    for (const sessionId of ['bot', 'task', 'plain']) await slackPost(sessionId, 'C1')

    expect(posted.map(({ channel, text }) => ({ channel, text }))).toEqual([
      { channel: 'C1', text: '*Deploy Bot*\nDone.' },
      { channel: 'C1', text: '*Deploy Bot*\nDone.' },
      { channel: 'C1', text: 'Done.' },
    ])
  })

  test('a Bot’s chat takes only that Bot and its Tasks', async () => {
    const results: Record<string, boolean> = {}

    for (const sessionId of ['bot', 'task', 'other-bot', 'other-task', 'plain'])
      results[sessionId] = (await slackPost(sessionId, 'C9')).ok

    expect(results).toEqual({
      bot: true,
      task: true,
      'other-bot': false,
      'other-task': false,
      plain: false,
    })
    expect(posted.map(({ text }) => text)).toEqual(['*Deploy Bot*\nDone.', '*Deploy Bot*\nDone.'])
  })

  test('a replyThread argument still posts a single message with no thread', async () => {
    await slackPost('bot', 'C1', { replyThread: { text: 'Detail.' } })

    expect(posted).toHaveLength(1)
    expect(posted[0]).not.toHaveProperty('threadTs')
  })
})
