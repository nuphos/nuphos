import { beforeEach, describe, expect, test } from 'bun:test'

import { AppError } from '@/lib/errors'
import { pickUpConversationInSlack } from '@/lib/slack/session-pickup'

import type { SlackAgentThread, SlackUserMapping } from '@/lib/slack/agent-bot'
import type { ResolvedSlackBot } from '@/lib/slack/installations'
import type { SlackSessionPickupDependencies } from '@/lib/slack/session-pickup'

const now = new Date('2026-08-25T00:00:00.000Z')
const TEAM_ID = '6579a0b1c2d3e4f5a6b7c8d9'

const bot = (slackTeamId = 'T1'): ResolvedSlackBot =>
  ({
    botToken: 'xoxb-token',
    botUserId: 'B1',
    nuphosTeamId: TEAM_ID,
    binding: { slackTeamId },
  }) as ResolvedSlackBot

const mapping = (): SlackUserMapping => ({
  slackWorkspaceId: 'T1',
  slackUserId: 'U1',
  teamId: TEAM_ID,
  nuphosUserId: 'user-1',
  enabled: true,
  createdBy: 'test',
  createdAt: now,
  updatedAt: now,
})

const thread = (overrides: Partial<SlackAgentThread> = {}): SlackAgentThread => ({
  slackWorkspaceId: 'T1',
  slackChannelId: 'D100',
  slackThreadTs: '1700.100',
  teamId: TEAM_ID,
  agentUserId: 'user-1',
  sessionId: 'session-1',
  createdBySlackUserId: 'U1',
  origin: 'user_pickup',
  createdAt: now,
  lastActiveAt: now,
  ...overrides,
})

let existingThread: SlackAgentThread | null
let resolvedBot: ResolvedSlackBot | null
let selfMapping: SlackUserMapping | null
let permalink: string | null
let postedMessages: { channel: string; text: string }[]
let bindInput: Parameters<SlackSessionPickupDependencies['bindThread']>[0] | null
let bindError: Error | null
let racedThread: SlackAgentThread | null

const dependencies: SlackSessionPickupDependencies = {
  getThreadBySessionId: async () => {
    // After a bind failure the service re-reads to detect a lost race.
    if (bindError && bindInput) return racedThread

    return existingThread
  },
  resolveBot: async () => resolvedBot,
  getSelfMapping: async () => selfMapping,
  openDm: async () => 'D100',
  postMessage: async (args) => {
    postedMessages.push({ channel: args.channel, text: args.text })

    return { ok: true, ts: '1700.100', channel: 'D100' }
  },
  bindThread: async (input) => {
    bindInput = input
    if (bindError) throw bindError

    return thread({ slackThreadTs: input.slackThreadTs, sessionId: input.sessionId })
  },
  getPermalink: async () => permalink,
}

const args = {
  userId: 'user-1',
  teamId: TEAM_ID,
  sessionId: 'session-1',
  conversationTitle: 'Investigate the noisy cron',
}

beforeEach(() => {
  existingThread = null
  resolvedBot = bot()
  selfMapping = mapping()
  permalink = 'https://ws.slack.com/archives/D100/p1700100'
  postedMessages = []
  bindInput = null
  bindError = null
  racedThread = null
})

describe('pickUpConversationInSlack', () => {
  test('posts a DM root and binds it with the user_pickup origin', async () => {
    const result = await pickUpConversationInSlack(args, dependencies)

    expect(result.status).toBe('bound')
    expect(result.thread).toEqual({
      workspaceId: 'T1',
      channelId: 'D100',
      threadTs: '1700.100',
      url: 'https://ws.slack.com/archives/D100/p1700100',
    })
    expect(postedMessages).toHaveLength(1)
    expect(postedMessages[0]?.channel).toBe('D100')
    expect(postedMessages[0]?.text).toContain('Investigate the noisy cron')
    expect(bindInput).toMatchObject({
      slackWorkspaceId: 'T1',
      slackChannelId: 'D100',
      slackThreadTs: '1700.100',
      teamId: TEAM_ID,
      agentUserId: 'user-1',
      sessionId: 'session-1',
      createdBySlackUserId: 'U1',
      origin: 'user_pickup',
    })
  })

  test('falls back to the constructed thread URL when the permalink is unavailable', async () => {
    permalink = null
    const result = await pickUpConversationInSlack(args, dependencies)

    expect(result.thread.url).toBe('https://app.slack.com/client/T1/D100/thread/D100-1700.100')
  })

  test('returns the existing thread instead of binding twice', async () => {
    existingThread = thread({ origin: 'agent_notification', slackChannelId: 'C42' })
    const result = await pickUpConversationInSlack(args, dependencies)

    expect(result.status).toBe('already_bound')
    expect(result.thread.channelId).toBe('C42')
    expect(postedMessages).toHaveLength(0)
    expect(bindInput).toBeNull()
  })

  test('rejects when the team has no Slack installation', async () => {
    resolvedBot = null
    await expect(pickUpConversationInSlack(args, dependencies)).rejects.toThrow(AppError)
    await expect(pickUpConversationInSlack(args, dependencies)).rejects.toMatchObject({
      code: 'slack_not_installed',
    })
  })

  test('treats the legacy shared-token fallback (no workspace id) as not installed', async () => {
    resolvedBot = bot('')
    await expect(pickUpConversationInSlack(args, dependencies)).rejects.toMatchObject({
      code: 'slack_not_installed',
    })
  })

  test('rejects when the caller has no Slack identity on the team', async () => {
    selfMapping = null
    await expect(pickUpConversationInSlack(args, dependencies)).rejects.toMatchObject({
      code: 'slack_identity_unlinked',
    })
    expect(postedMessages).toHaveLength(0)
  })

  test('a lost bind race resolves to the winner’s thread', async () => {
    bindError = new Error('This Nuphos conversation is already bound to a Slack thread')
    racedThread = thread({ slackThreadTs: '1600.001' })
    const result = await pickUpConversationInSlack(args, dependencies)

    expect(result.status).toBe('already_bound')
    expect(result.thread.threadTs).toBe('1600.001')
  })

  test('a bind failure with no competing binding is surfaced', async () => {
    bindError = new Error('mongo unavailable')
    racedThread = null
    await expect(pickUpConversationInSlack(args, dependencies)).rejects.toThrow('mongo unavailable')
  })
})
