import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { agentConversations, agentMessages } from '@/lib/agent/db'
import { fromOwner } from '@/lib/agent/db/channel-notes'
import { readChannelMessages } from '@/lib/agent/db/channels'
import { clearPendingUserMessages, enqueuePendingUserMessage } from '@/lib/agent/pending-messages'
import { installTurnRunner, resetTurnRunner } from '@/lib/agent/turn-runner'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useSlackAgentBot } from '@/lib/test/doubles/slack-agent-bot'
import { useSlackApi } from '@/lib/test/doubles/slack-api'
import { useSlackInstallations } from '@/lib/test/doubles/slack-installations'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import type { AgentConversation } from '@/lib/agent/db'
import type { MessageMetadata } from '@/lib/agent/message-metadata'
import type * as dbActual from '@/lib/db'
import type { SlackEventEnvelope, SlackMessageEvent } from '@/routes/slack/types'

let memory = portabilityDb()
let woken: string[] = []
let marked: string[] = []
let groupChatId: string | undefined = 'chat'
// Slack users as users.info reports them: their home workspace and email.
const slackUsers: Record<string, { team_id: string; email: string; name: string }> = {
  UOWNER: { team_id: 'T1', email: 'Owner@Example.com', name: 'Owner in Slack' },
  // A Slack Connect member of another org whose email matches the owner's.
  UEXT: { team_id: 'TOTHER', email: 'owner@example.com', name: 'Outsider' },
  UNEW: { team_id: 'T1', email: 'stranger@example.com', name: 'Stranger' },
  ULINKED: { team_id: 'T1', email: 'someone-else@example.com', name: 'Linked' },
}
// Slack accounts linked to Nuphos members, by Slack user id.
const links: Record<string, { nuphosUserId: string; createdBy: string }> = {
  ULINKED: { nuphosUserId: 'owner', createdBy: 'owner' },
  // An email auto-link written by the old mention path for an outsider.
  UEXT: { nuphosUserId: 'owner', createdBy: 'auto:slack-email' },
}

useDb({ db: () => memory })
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
useIdentity({
  getTeamMembership: async () => ({ role: 'MEMBER' }),
  getTeamMembers: async () => [{ id: 'owner', name: 'Owner', email: 'owner@example.com' }] as never,
})
useSlackInstallations({
  resolveSlackBotForWorkspace: async () => ({
    botToken: 'xoxb-1',
    botUserId: 'UBOT',
    nuphosTeamId: 'team',
  }),
})
useSlackAgentBot({
  getSlackChannelMapping: async () => ({
    teamId: 'team',
    enabled: true,
    ...(groupChatId ? { groupChatId } : {}),
  }),
  getSlackUserMapping: async (_workspace: string, _team: string, slackUserId: string) =>
    links[slackUserId] ?? null,
  markSlackEvent: async (_id: string, status: string) => {
    marked.push(status)
  },
})
useSlackApi({
  slackApiGet: async (_token: string, method: string, params: Record<string, unknown>) => {
    const user = slackUsers[String(params.user)]

    if (method !== 'users.info' || !user) return { ok: false, error: 'user_not_found' }

    return {
      ok: true,
      user: {
        team_id: user.team_id,
        real_name: user.name,
        profile: { email: user.email, real_name: user.name },
      },
    }
  },
})

const { routeSlackToGroupChat } = await import('@/routes/slack/group-chat')

let events = 0
const envelope = (event: Partial<SlackMessageEvent>, eventId?: string): SlackEventEnvelope => ({
  type: 'event_callback',
  team_id: 'T1',
  event_id: eventId ?? `Ev${String(++events)}`,
  event: { type: 'message', channel: 'C1', ts: '10.1', text: 'Is the deploy done?', ...event },
})

const chat = async () => (await agentConversations().findOne({ sessionId: 'chat' }))!
/** The newest post as the chat's Bot reads it, for its owner. */
const lastRead = async () =>
  (await readChannelMessages(await chat(), 'bot', 'owner', true)).messages.at(-1)

beforeEach(async () => {
  memory = portabilityDb()
  woken = []
  marked = []
  events = 0
  groupChatId = 'chat'
  installTurnRunner({
    claimAgentRunOrEnqueue: async (args) => {
      woken.push(args.sessionId)
      await enqueuePendingUserMessage(args.userId, args.sessionId, args.message)

      return { mode: 'queued' }
    },
  })
  const seed = (sessionId: string, extra: Partial<AgentConversation>) =>
    agentConversations().insertOne({
      sessionId,
      userId: 'owner',
      teamId: 'team',
      title: sessionId,
      firstMessage: '',
      messageCount: 0,
      createdAt: new Date(),
      lastActiveAt: new Date(),
      ...extra,
    })

  await seed('chat', { kind: 'channel', agentSessionIds: ['bot'] })
  await seed('bot', { avatar: '07-ada' })
})
afterEach(async () => {
  resetTurnRunner()
  await clearPendingUserMessages('owner', 'bot')
})

describe('a Slack channel connected to a group chat', () => {
  test("the Bot's owner, by email in their own workspace, speaks as the owner", async () => {
    expect(await routeSlackToGroupChat(envelope({ user: 'UOWNER' }))).toBe(true)

    expect(await lastRead()).toMatchObject({
      sender: { type: 'user', id: 'owner', fromOwner: true },
      text: '<channel-message>\nIs the deploy done?\n</channel-message>',
    })
    expect(woken).toEqual(['bot'])
    expect(marked).toEqual(['completed'])
  })

  test('a linked Slack account speaks as its member', async () => {
    await routeSlackToGroupChat(envelope({ user: 'ULINKED' }))

    expect(await lastRead()).toMatchObject({ sender: { id: 'owner', fromOwner: true } })
  })

  test('a Slack Connect outsider whose email matches is only data, and still wakes the Bot', async () => {
    await routeSlackToGroupChat(envelope({ user: 'UEXT', user_team: 'TOTHER' }))
    const post = await lastRead()

    expect(post?.sender).toMatchObject({ id: 'slack:T1:UEXT', name: 'Outsider' })
    expect(post?.sender).not.toHaveProperty('fromOwner')
    expect(woken).toEqual(['bot'])
  })

  test('an unlinked member of the workspace wakes the Bot, as data', async () => {
    await routeSlackToGroupChat(envelope({ user: 'UNEW' }))
    const post = await lastRead()

    expect(post?.sender).toMatchObject({ id: 'slack:T1:UNEW', name: 'Stranger' })
    expect(post?.sender).not.toHaveProperty('fromOwner')
    expect(woken).toEqual(['bot'])
  })

  test('a message Slack delivers twice, or also as a mention, is stored once', async () => {
    await routeSlackToGroupChat(envelope({ user: 'UNEW' }))
    await routeSlackToGroupChat(envelope({ user: 'UNEW' }))
    expect(await routeSlackToGroupChat(envelope({ type: 'app_mention', user: 'UNEW' }))).toBe(true)

    expect(await agentMessages().countDocuments({ messageId: 'slack:C1:10.1' })).toBe(1)
    expect(woken).toEqual(['bot'])
  })

  test('a reply in a Slack thread quotes the thread root', async () => {
    await routeSlackToGroupChat(envelope({ user: 'UOWNER' }))
    await routeSlackToGroupChat(
      envelope({ user: 'UNEW', ts: '10.2', thread_ts: '10.1', text: 'Yes.' }),
    )

    expect(
      (await agentMessages().findOne({ messageId: 'slack:C1:10.2' }))?.metadata?.replyTo,
    ).toMatchObject({ id: 'slack:C1:10.1', text: 'Is the deploy done?' })
  })

  test("the app's own posts and other bots never enter the chat", async () => {
    await routeSlackToGroupChat(envelope({ user: 'UBOT' }))
    await routeSlackToGroupChat(envelope({ user: 'UNEW', bot_id: 'B1' }))
    await routeSlackToGroupChat(envelope({ user: 'UNEW', subtype: 'message_changed' }))

    expect(await agentMessages().countDocuments({})).toBe(0)
    expect(woken).toEqual([])
  })

  test('a channel with no group chat is left to the existing handlers', async () => {
    groupChatId = undefined

    expect(await routeSlackToGroupChat(envelope({ user: 'UNEW' }))).toBe(false)
    expect(marked).toEqual([])
  })
})

test('only a Slack post the server resolved to the owner speaks for them', () => {
  const slack = (unattested?: true): MessageMetadata => ({
    version: 1,
    sender: { type: 'user', id: 'owner', displayName: 'Owner' },
    source: 'slack',
    sentAt: new Date().toISOString(),
    ...(unattested ? { unattested } : {}),
  })

  expect(fromOwner(slack(), 'owner')).toBe(true)
  expect(fromOwner(slack(true), 'owner')).toBe(false)
})
