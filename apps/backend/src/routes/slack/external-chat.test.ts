import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { agentConversations, agentMessages } from '@/lib/agent/db'
import { fromOwner } from '@/lib/agent/db/channel-notes'
import { readChannelMessages } from '@/lib/agent/db/channels'
import { attributionHeader } from '@/lib/agent/message-metadata'
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
let wakes: unknown[] = []
let marked: string[] = []
let externalChatId: string | undefined = 'chat'
let notificationThread = false
// Slack users as users.info reports them: their home workspace and email.
const slackUsers: Record<string, { team_id: string; email: string; name: string }> = {
  UOWNER: { team_id: 'T1', email: 'Owner@Example.com', name: 'Owner in Slack' },
  // A Slack Connect member of another org whose email matches the owner's.
  UEXT: { team_id: 'TOTHER', email: 'owner@example.com', name: 'Outsider' },
  UNEW: { team_id: 'T1', email: 'stranger@example.com', name: 'Stranger' },
  ULINKED: { team_id: 'T1', email: 'someone-else@example.com', name: 'Linked' },
  UMEI: { team_id: 'T1', email: 'mei@example.com', name: 'Mei in Slack' },
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
  getTeamMembers: async () =>
    [
      { id: 'owner', name: 'Owner', email: 'owner@example.com' },
      { id: 'mei', name: 'Mei', email: 'mei@example.com' },
    ] as never,
})
useSlackInstallations({
  resolveSlackBotForWorkspace: async () =>
    ({
      botToken: 'xoxb-1',
      botUserId: 'UBOT',
      nuphosTeamId: 'team',
      binding: { scope: 'chat:write' },
    }) as never,
})
useSlackAgentBot({
  getSlackChannelMapping: async () => ({
    teamId: 'team',
    enabled: true,
    ...(externalChatId ? { externalChatId } : {}),
  }),
  getSlackUserMapping: async (_workspace: string, _team: string, slackUserId: string) =>
    links[slackUserId] ?? null,
  getSlackChannelMappingByExternalChat: async () =>
    ({ slackWorkspaceId: 'T1', slackChannelId: 'C1', teamId: 'team', enabled: true }) as never,
  getSlackAgentThread: async () =>
    (notificationThread ? { origin: 'agent_notification' } : null) as never,
  markSlackEvent: async (_id: string, status: string) => {
    marked.push(status)
  },
})
useSlackApi({
  // The Bot's answers, as Slack takes them.
  slackApi: async () => ({ ok: true, ts: '30.1' }) as never,
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

const { routeSlackToExternalChat } = await import('@/routes/slack/external-chat')
const { postAsAgent } = await import('@/lib/agent/channel-chat')

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
  wakes = []
  marked = []
  events = 0
  externalChatId = 'chat'
  notificationThread = false
  installTurnRunner({
    claimAgentRunOrEnqueue: async (args) => {
      woken.push(args.sessionId)
      wakes.push(args.message)
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

  await seed('chat', { kind: 'channel', external: 'slack', agentSessionIds: ['bot'] })
  await seed('bot', { avatar: '07-ada' })
})
afterEach(async () => {
  resetTurnRunner()
  await clearPendingUserMessages('owner', 'bot')
})

describe('a Slack channel that is an external chat', () => {
  test("the Bot's owner, by email in their own workspace, speaks as the owner", async () => {
    expect(await routeSlackToExternalChat(envelope({ user: 'UOWNER' }))).toBe(true)

    expect(await lastRead()).toMatchObject({
      sender: { type: 'user', id: 'owner', fromOwner: true },
      text: '<channel-message>\nIs the deploy done?\n</channel-message>',
    })
    expect(woken).toEqual(['bot'])
    expect(marked).toEqual(['completed'])
  })

  test("the Bot's own conversation names the Slack channel that woke it", async () => {
    await agentConversations().updateOne({ sessionId: 'chat' }, { $set: { title: 'deploys' } })
    await routeSlackToExternalChat(envelope({ user: 'UNEW' }))

    expect(wakes).toEqual([
      expect.objectContaining({
        renderedText: 'New messages in a Slack channel (channelId chat).',
        metadata: expect.objectContaining({
          // Not `channel:`, which every app draws as a chat to open.
          sender: expect.objectContaining({
            id: 'slack-channel:chat',
            displayName: 'Slack #deploys',
          }),
        }),
      }),
    ])
    const notice = wakes[0] as { id: string; metadata: unknown }

    expect(notice.metadata).not.toHaveProperty('resourceUrl')
    // The Bot still gets a chat's instructions: how to read it and answer there.
    expect(attributionHeader(notice.id, notice.metadata)).toContain('channel_post')
  })

  test('a linked Slack account speaks as its member', async () => {
    await routeSlackToExternalChat(envelope({ user: 'ULINKED' }))

    expect(await lastRead()).toMatchObject({ sender: { id: 'owner', fromOwner: true } })
  })

  test("a teammate's Slack post is attributed to them, without adding them to the chat", async () => {
    await routeSlackToExternalChat(envelope({ user: 'UMEI' }))

    expect(await lastRead()).toMatchObject({ sender: { type: 'user', id: 'mei', name: 'Mei' } })
    expect((await chat()).participantIds ?? []).not.toContain('mei')
  })

  test('a Slack Connect outsider whose email matches is only data, and still wakes the Bot', async () => {
    await routeSlackToExternalChat(envelope({ user: 'UEXT', user_team: 'TOTHER' }))
    const post = await lastRead()

    expect(post?.sender).toMatchObject({ id: 'slack:T1:UEXT', name: 'Outsider' })
    expect(post?.sender).not.toHaveProperty('fromOwner')
    expect(woken).toEqual(['bot'])
  })

  test('an unlinked member of the workspace wakes the Bot, as data', async () => {
    await routeSlackToExternalChat(envelope({ user: 'UNEW' }))
    const post = await lastRead()

    expect(post?.sender).toMatchObject({ id: 'slack:T1:UNEW', name: 'Stranger' })
    expect(post?.sender).not.toHaveProperty('fromOwner')
    expect(woken).toEqual(['bot'])
  })

  test('a message Slack delivers twice, or also as a mention, is stored once', async () => {
    await routeSlackToExternalChat(envelope({ user: 'UNEW' }))
    await routeSlackToExternalChat(envelope({ user: 'UNEW' }))
    expect(await routeSlackToExternalChat(envelope({ type: 'app_mention', user: 'UNEW' }))).toBe(
      true,
    )

    expect(await agentMessages().countDocuments({ messageId: 'slack:C1:10.1' })).toBe(1)
    expect(woken).toEqual(['bot'])
  })

  test('a reply in a Slack thread quotes the thread root', async () => {
    await routeSlackToExternalChat(envelope({ user: 'UOWNER' }))
    await routeSlackToExternalChat(
      envelope({ user: 'UNEW', ts: '10.2', thread_ts: '10.1', text: 'Yes.' }),
    )

    expect(
      (await agentMessages().findOne({ messageId: 'slack:C1:10.2' }))?.metadata?.replyTo,
    ).toMatchObject({ id: 'slack:C1:10.1', text: 'Is the deploy done?' })
  })

  test('a thread reply keeps its Slack root even when that root is not in the record', async () => {
    await routeSlackToExternalChat(
      envelope({ user: 'UNEW', ts: '10.2', thread_ts: '9.9', text: 'A reply.' }),
    )

    expect((await agentMessages().findOne({ messageId: 'slack:C1:10.2' }))?.metadata).toMatchObject(
      {
        slackThreadTs: '9.9',
      },
    )
  })

  test("the app's own posts and other bots never enter the chat", async () => {
    await routeSlackToExternalChat(envelope({ user: 'UBOT' }))
    await routeSlackToExternalChat(envelope({ user: 'UNEW', bot_id: 'B1' }))
    await routeSlackToExternalChat(envelope({ user: 'UNEW', subtype: 'message_changed' }))

    expect(await agentMessages().countDocuments({})).toBe(0)
    expect(woken).toEqual([])
  })

  test('a post on the record, even naming a teammate, notifies no one in Nuphos', async () => {
    await routeSlackToExternalChat(envelope({ user: 'UNEW', text: 'Ping @Mei' }))
    await postAsAgent(
      (await chat()).sessionId,
      { sessionId: 'bot', title: 'Bot' },
      'Ask @Mei.',
      [],
      0,
    )

    expect(await agentMessages().countDocuments({ sessionId: 'chat' })).toBe(2)
    expect((await chat()).mentions ?? {}).toEqual({})
  })

  test('a mapping that names an ordinary Nuphos chat posts nothing there', async () => {
    await agentConversations().updateOne({ sessionId: 'chat' }, { $unset: { external: '' } })
    await routeSlackToExternalChat(envelope({ user: 'UOWNER' }))

    expect(await agentMessages().countDocuments({})).toBe(0)
    expect(woken).toEqual([])
  })

  test('a reply in a notification thread stays with that thread', async () => {
    notificationThread = true

    expect(
      await routeSlackToExternalChat(envelope({ user: 'UNEW', ts: '10.2', thread_ts: '10.1' })),
    ).toBe(false)
    expect(await agentMessages().countDocuments({})).toBe(0)
  })

  test('a channel with no external chat is left to the existing handlers', async () => {
    externalChatId = undefined

    expect(await routeSlackToExternalChat(envelope({ user: 'UNEW' }))).toBe(false)
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
