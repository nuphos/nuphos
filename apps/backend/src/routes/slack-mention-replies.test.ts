import { useDb } from '@/lib/test/doubles/db'

useDb({
  db: () => ({
    collection: () => ({
      findOne: () => Promise.resolve(null),
      // Speaking in a thread records the speaker as a participant.
      findOneAndUpdate: () => Promise.resolve(null),
    }),
  }),
})

// Every @-mention of the bot (and every reply in a thread the bot started) must
// produce a visible outcome — a turn, a hint, an onboarding prompt, or an
// explanation. Silent 'ignored' dead-ends are regressions (a bare mention
// posted a hint without registering the thread, so replies in that thread were
// dropped without a trace).
import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { drainPendingUserMessages, hasPendingUserMessages } from '@/lib/agent/pending-messages'
import { useTurnRunner } from '@/lib/agent/turn-runner-testing'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useFileTransferService } from '@/lib/test/doubles/file-transfer-service'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useSlackAgentBot } from '@/lib/test/doubles/slack-agent-bot'
import { useSlackApi } from '@/lib/test/doubles/slack-api'
import { useSlackInstallations } from '@/lib/test/doubles/slack-installations'

import type { SlackAgentThread, SlackChannelMapping, SlackUserMapping } from '@/lib/slack/agent-bot'

const WORKSPACE = 'T1'
const CHANNEL = 'C1'
const BOT_USER = 'UBOT'
const SLACK_USER = 'USLACK'
const NUPHOS_USER = '62e6289482f5f9d9408f1a79'
const OTHER_NUPHOS_USER = '69f3f2cb3a343b67cf568765'
const TEAM = '6a6198d06a7585a89e02775d'

type PostedMessage = { channel: string; threadTs?: string; text: string }

const state: {
  channelMapping: SlackChannelMapping | null
  userMapping: SlackUserMapping | null
  thread: SlackAgentThread | null
  installTeamId: string
  userEmail: string | null
  threadReplies: Record<string, unknown>[]
} = {
  channelMapping: null,
  userMapping: null,
  thread: null,
  installTeamId: TEAM,
  userEmail: null,
  threadReplies: [],
}

let teamMember = true
const posted: PostedMessage[] = []
const ephemerals: (PostedMessage & { user: string })[] = []
const eventMarks: { eventId: string; status: string }[] = []
const threadUpserts: unknown[] = []
const agentRuns: {
  firstMessage?: string
  sessionId: string
  teamId?: string
  renderedTurn?: string
}[] = []
const claimActors: (string | undefined)[] = []

function makeMapping(overrides?: Partial<SlackChannelMapping>): SlackChannelMapping {
  return {
    slackWorkspaceId: WORKSPACE,
    slackChannelId: CHANNEL,
    teamId: TEAM,
    enabled: true,
    createdBy: NUPHOS_USER,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function makeUserMapping(): SlackUserMapping {
  return {
    slackWorkspaceId: WORKSPACE,
    slackUserId: SLACK_USER,
    teamId: TEAM,
    nuphosUserId: NUPHOS_USER,
    enabled: true,
    createdBy: 'auto:slack-email',
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

function makeThread(overrides?: Partial<SlackAgentThread>): SlackAgentThread {
  return {
    slackWorkspaceId: WORKSPACE,
    slackChannelId: CHANNEL,
    slackThreadTs: '100.1',
    teamId: TEAM,
    agentUserId: NUPHOS_USER,
    sessionId: 'slack-mention-session-1',
    createdBySlackUserId: SLACK_USER,
    origin: 'slack',
    createdAt: new Date(),
    lastActiveAt: new Date(),
    ...overrides,
  }
}

useSlackAgentBot({
  getSlackChannelMapping: async () => state.channelMapping,
  getCrossWorkspaceChannelMapping: async () => null,
  getSlackUserMapping: async () => state.userMapping,
  upsertSlackUserMapping: async () => makeUserMapping(),
  getSlackAgentThread: async () => state.thread,
  getOrCreateSlackAgentThread: async (data: {
    slackThreadTs: string
    teamId: string
    agentUserId: string
  }) => {
    threadUpserts.push(data)
    if (state.thread) return { thread: state.thread, isNew: false }
    state.thread = makeThread({
      slackThreadTs: data.slackThreadTs,
      teamId: data.teamId,
      agentUserId: data.agentUserId,
    })

    return { thread: state.thread, isNew: true }
  },
  markSlackEvent: async (eventId: string, status: string) => {
    eventMarks.push({ eventId, status })
  },
})

const statusCalls: { status: string }[] = []

useSlackApi({
  setSlackAssistantStatus: async (args: { status: string }) => {
    statusCalls.push({ status: args.status })

    return { ok: true }
  },
  postSlackMessage: async (args: { channel: string; threadTs?: string; text?: string }) => {
    posted.push({ channel: args.channel, threadTs: args.threadTs, text: args.text ?? '' })

    return { ok: true, ts: '999.1' }
  },
  postSlackEphemeral: async (args: {
    channel: string
    user: string
    threadTs?: string
    text: string
  }) => {
    ephemerals.push({
      channel: args.channel,
      user: args.user,
      threadTs: args.threadTs,
      text: args.text,
    })

    return { ok: true }
  },
  slackApiGet: async (_token: string, method: string) => {
    if (method === 'users.info') {
      return { ok: true, user: state.userEmail ? { profile: { email: state.userEmail } } : {} }
    }

    return { ok: true, channel: { is_member: true } }
  },
  addSlackReaction: async () => ({ ok: true }),
  fetchSlackThreadReplies: async () => ({ messages: state.threadReplies, hasMore: false }),
})

useSlackInstallations({
  resolveSlackBotForWorkspace: async () => ({
    botToken: 'xoxb-test',
    botUserId: BOT_USER,
    nuphosTeamId: state.installTeamId,
    binding: null,
  }),
})

useIdentity({
  getTeamMembers: async () => [],
  getTeamMembership: async () => (teamMember ? { role: 'MEMBER' } : null),
  signNuphosToken: () => 'test-token',
})

useAgentDb({ getConversationWithMessages: async () => null })

useFileTransferService({
  listSessionDownloadsSince: async () => [],
})

useTurnRunner({
  admitChannelTurn: async (args, timing) => {
    claimActors.push(args.actorUserId)
    const { admitChannelTurn } = await import('@/routes/agent/run-registry')

    return await admitChannelTurn(args, timing)
  },
  runAgentForTrigger: async (params) => {
    agentRuns.push({
      firstMessage: params.firstMessage,
      sessionId: params.sessionId,
      teamId: params.teamId,
      // Carries a forked thread's report into its first message; read back by
      // the fork tests below.
      renderedTurn: JSON.stringify(params.messages),
    })

    return { status: 'completed' }
  },
})

const { handleAppMention, handleThreadMessage } = await import('./slack')

function mentionEnvelope(text: string) {
  return {
    type: 'event_callback',
    team_id: WORKSPACE,
    event_id: 'Ev-mention',
    event: {
      type: 'app_mention',
      user: SLACK_USER,
      text,
      ts: '100.1',
      event_ts: '100.1',
      channel: CHANNEL,
    },
  }
}

function threadReplyEnvelope(text: string, threadTs = '100.1') {
  return {
    type: 'event_callback',
    team_id: WORKSPACE,
    event_id: 'Ev-reply',
    event: {
      type: 'message',
      user: SLACK_USER,
      text,
      ts: '100.2',
      event_ts: '100.2',
      thread_ts: threadTs,
      channel: CHANNEL,
    },
  }
}

// Nuphos answers a thread reply only when it is mentioned. In a notification
// thread the mention arrives here as a plain message event; in a thread the
// bot's own mention started, it arrives as app_mention (threadMentionEnvelope).
function mentionReplyEnvelope(text: string, threadTs = '100.1') {
  return threadReplyEnvelope(`<@${BOT_USER}> ${text}`, threadTs)
}

function threadMentionEnvelope(text: string) {
  const envelope = mentionEnvelope(text)

  return { ...envelope, event: { ...envelope.event, ts: '100.5', thread_ts: '100.1' } }
}

beforeEach(() => {
  state.channelMapping = makeMapping()
  state.userMapping = makeUserMapping()
  state.thread = null
  state.installTeamId = TEAM
  state.userEmail = null
  state.threadReplies = []
  posted.length = 0
  teamMember = true
  ephemerals.length = 0
  eventMarks.length = 0
  threadUpserts.length = 0
  agentRuns.length = 0
  claimActors.length = 0
  statusCalls.length = 0
})

describe('bare mention', () => {
  test('registers the thread and posts the hint, so the thread is not a dead end', async () => {
    await handleAppMention(mentionEnvelope(`<@${BOT_USER}>`))

    expect(threadUpserts).toHaveLength(1)
    expect(agentRuns).toHaveLength(0)
    expect(posted).toHaveLength(1)
    expect(posted[0]!.text).toContain('What would you like Nuphos to look into?')
    expect(eventMarks).toEqual([{ eventId: 'Ev-mention', status: 'completed' }])

    // The next mention in the hint thread runs a turn in the same conversation.
    await handleAppMention(threadMentionEnvelope(`<@${BOT_USER}> which team are you bound to?`))
    expect(agentRuns).toHaveLength(1)
    expect(agentRuns[0]!.firstMessage).toBe('which team are you bound to?')
    expect(agentRuns[0]!.teamId).toBe(TEAM)
  })

  test('in an unlinked channel posts the channel-link prompt instead of the hint', async () => {
    state.channelMapping = null

    await handleAppMention(mentionEnvelope(`<@${BOT_USER}>`))

    expect(threadUpserts).toHaveLength(0)
    expect(posted).toHaveLength(1)
    expect(posted[0]!.text).toContain("isn't linked to Nuphos yet")
    expect(eventMarks).toEqual([{ eventId: 'Ev-mention', status: 'completed' }])
  })

  test('from an unlinked Slack user shows the account-link prompt to that user only', async () => {
    state.userMapping = null
    state.userEmail = 'stranger@example.com'

    await handleAppMention(mentionEnvelope(`<@${BOT_USER}>`))

    expect(threadUpserts).toHaveLength(0)
    expect(posted).toHaveLength(0)
    expect(ephemerals).toEqual([
      expect.objectContaining({
        user: SLACK_USER,
        // A top-level mention: the notice sits beside it, not in a new thread.
        threadTs: undefined,
        text: expect.stringContaining("doesn't match any Nuphos user"),
      }),
    ])
    expect(eventMarks).toEqual([{ eventId: 'Ev-mention', status: 'completed' }])
  })
})

describe('thread replies never fail silently', () => {
  test('mention with text runs a turn', async () => {
    await handleAppMention(mentionEnvelope(`<@${BOT_USER}> check prod`))

    expect(agentRuns).toHaveLength(1)
    expect(agentRuns[0]!.firstMessage).toBe('check prod')
    expect(claimActors).toEqual([NUPHOS_USER])
    expect(eventMarks).toEqual([{ eventId: 'Ev-mention', status: 'completed' }])
  })

  test('a teammate message arriving during finalization starts the successor turn', async () => {
    state.thread = makeThread({ origin: 'agent_notification' })
    state.userMapping = { ...makeUserMapping(), nuphosUserId: OTHER_NUPHOS_USER }
    const {
      agentRuns: liveRuns,
      createAgentRun,
      registerAgentRun,
    } = await import('@/routes/agent/run-registry')
    const run = createAgentRun(NUPHOS_USER, state.thread.sessionId, 'stream-owner', {
      requestId: 'request-owner',
      userId: NUPHOS_USER,
      sessionId: state.thread.sessionId,
      streamId: 'stream-owner',
      route: 'slack.agent',
      method: 'TRIGGER',
    })

    registerAgentRun(run)
    try {
      const handling = handleThreadMessage(mentionReplyEnvelope('what about GCP?'))

      for (let attempt = 0; attempt < 50; attempt++) {
        if (await hasPendingUserMessages(NUPHOS_USER, state.thread.sessionId)) break
        await Bun.sleep(5)
      }
      run.done = true
      run.releaseOwnership()
      liveRuns.delete(run.key)
      await handling

      expect(agentRuns).toHaveLength(1)
      expect(claimActors).toEqual([OTHER_NUPHOS_USER])
      expect(agentRuns[0]!.firstMessage).toBe('what about GCP?')
      expect(eventMarks).toEqual([{ eventId: 'Ev-reply', status: 'completed' }])
      expect(await drainPendingUserMessages(NUPHOS_USER, state.thread.sessionId)).toEqual([])
    } finally {
      run.done = true
      run.releaseOwnership()
      liveRuns.delete(run.key)
    }
  })

  test('reply in a thread whose channel was unlinked explains instead of ignoring', async () => {
    state.thread = makeThread()
    state.channelMapping = null

    await handleThreadMessage(threadReplyEnvelope('status?'))

    expect(agentRuns).toHaveLength(0)
    expect(posted).toHaveLength(1)
    expect(posted[0]!.text).toContain('no longer linked to Nuphos')
    expect(eventMarks).toEqual([{ eventId: 'Ev-reply', status: 'completed' }])
  })

  test('reply in a thread whose channel moved to another team explains instead of ignoring', async () => {
    state.thread = makeThread()
    state.channelMapping = makeMapping({ teamId: 'someOtherTeam' })

    await handleThreadMessage(threadReplyEnvelope('status?'))

    expect(agentRuns).toHaveLength(0)
    expect(posted).toHaveLength(1)
    expect(posted[0]!.text).toContain('linked to a different Nuphos team')
    expect(eventMarks).toEqual([{ eventId: 'Ev-reply', status: 'completed' }])
  })

  test('notification-thread reply with neither installation nor grant explains instead of ignoring', async () => {
    state.thread = makeThread({ origin: 'agent_notification' })
    state.installTeamId = 'someOtherTeam'
    state.channelMapping = null

    await handleThreadMessage(threadReplyEnvelope('status?'))

    expect(agentRuns).toHaveLength(0)
    expect(posted).toHaveLength(1)
    expect(posted[0]!.text).toContain('no longer has Slack access here')
    expect(eventMarks).toEqual([{ eventId: 'Ev-reply', status: 'completed' }])
  })

  test('cross-workspace notification thread continues through its channel grant', async () => {
    // The installation belongs to another team (the workspace owner), but the
    // channel mapping grants this channel to the thread's team — the reply
    // must run a turn, not dead-end.
    state.thread = makeThread({ origin: 'agent_notification' })
    state.installTeamId = 'someOtherTeam'

    await handleThreadMessage(mentionReplyEnvelope('status?'))

    expect(posted).toHaveLength(0)
    expect(agentRuns).toHaveLength(1)
    expect(agentRuns[0]!.teamId).toBe(TEAM)
  })
})

// The counterweight to the block above: a registered thread keeps delivering
// every reply forever, so "never fail silently" must not mean "always answer".
// An unmentioned reply gets silence, and only silence — not even the
// fail-closed notices, which were themselves the noise.
describe('only a mention gets an answer', () => {
  test('an unmentioned reply runs nothing and says nothing', async () => {
    state.thread = makeThread()

    await handleThreadMessage(threadReplyEnvelope('那 staging 呢?'))

    expect(agentRuns).toHaveLength(0)
    expect(posted).toHaveLength(0)
    // The typing/loading indicator is as visible as a message.
    expect(statusCalls).toHaveLength(0)
    expect(eventMarks).toEqual([{ eventId: 'Ev-reply', status: 'ignored' }])
  })

  test('an unmentioned reply in a notification thread is ignored too', async () => {
    state.thread = makeThread({ origin: 'agent_notification' })

    await handleThreadMessage(threadReplyEnvelope('我先看 dashboard'))

    expect(agentRuns).toHaveLength(0)
    expect(posted).toHaveLength(0)
    expect(eventMarks).toEqual([{ eventId: 'Ev-reply', status: 'ignored' }])
  })

  test('an unlinked sender is not told to link their account unless they mention the bot', async () => {
    state.thread = makeThread()
    state.userMapping = null
    state.userEmail = 'stranger@example.com'

    await handleThreadMessage(threadReplyEnvelope('好我等下看'))

    expect(posted).toHaveLength(0)
    expect(ephemerals).toHaveLength(0)
    expect(eventMarks).toEqual([{ eventId: 'Ev-reply', status: 'ignored' }])
  })

  test('an unlinked sender who mentions the bot is told privately, not in the thread', async () => {
    state.thread = makeThread({ origin: 'agent_notification' })
    state.userMapping = null

    await handleThreadMessage(mentionReplyEnvelope('can you check prod?'))

    expect(agentRuns).toHaveLength(0)
    expect(posted).toHaveLength(0)
    expect(ephemerals).toEqual([
      expect.objectContaining({
        user: SLACK_USER,
        threadTs: '100.1',
        text: expect.stringContaining('not linked to Nuphos yet'),
      }),
    ])
    expect(eventMarks).toEqual([{ eventId: 'Ev-reply', status: 'completed' }])
  })

  test('a sender who left the team is refused privately in a notification thread', async () => {
    state.thread = makeThread({ origin: 'agent_notification' })
    teamMember = false

    await handleThreadMessage(mentionReplyEnvelope('what caused it?'))

    expect(agentRuns).toHaveLength(0)
    expect(posted).toHaveLength(0)
    expect(ephemerals).toEqual([
      expect.objectContaining({
        user: SLACK_USER,
        text: expect.stringContaining('no longer a member of this Nuphos team'),
      }),
    ])
  })

  test('a mentioned reply runs its turn and lights the status line', async () => {
    state.thread = makeThread({ origin: 'agent_notification' })

    await handleThreadMessage(mentionReplyEnvelope('那 staging 呢?'))

    expect(agentRuns).toHaveLength(1)
    expect(agentRuns[0]!.firstMessage).toBe('那 staging 呢?')
    expect(statusCalls.length).toBeGreaterThan(0)
  })
})

// A proactive post that never opened a thread has no conversation to deliver a
// reply to. Under a root the bot itself wrote, dropping the reply is the exact
// silence this file exists to forbid; under someone else's thread, staying out
// of it is the only correct behaviour — this handler sees every threaded reply
// in every channel the bot is in.
describe('an unbound thread under a message the bot posted', () => {
  function replyUnderBotRoot(text: string) {
    const envelope = threadReplyEnvelope(text)

    return { ...envelope, event: { ...envelope.event, parent_user_id: BOT_USER } }
  }

  test('explains how to reach the agent instead of dropping the reply', async () => {
    state.thread = null

    await handleThreadMessage(replyUnderBotRoot('why is 2.5TB over budget?'))

    expect(posted).toEqual([
      expect.objectContaining({
        threadTs: '100.1',
        text: expect.stringContaining('Mention me'),
      }),
    ])
    expect(eventMarks).toEqual([{ eventId: 'Ev-reply', status: 'completed' }])
    expect(agentRuns).toEqual([])
  })

  test('says it once per thread, not once per reply', async () => {
    state.thread = null
    state.threadReplies = [
      {
        text: "I posted this, but it is not attached to a Nuphos conversation, so replies here don't reach me.",
      },
    ]

    await handleThreadMessage(replyUnderBotRoot('so what do I do?'))

    expect(posted).toEqual([])
    expect(eventMarks).toEqual([{ eventId: 'Ev-reply', status: 'completed' }])
  })

  test('stays out of a thread rooted by a human', async () => {
    state.thread = null

    await handleThreadMessage(threadReplyEnvelope('did you see the invoice?'))

    expect(posted).toEqual([])
    expect(agentRuns).toEqual([])
    expect(eventMarks).toEqual([{ eventId: 'Ev-reply', status: 'ignored' }])
  })
})

describe('a thread forked off a proactive post', () => {
  const REPORT = 'Lighthouse extra cost is ¥113,181.63 (50.9% of spend)'

  test('hands its first turn the report it is being asked about', async () => {
    state.thread = makeThread({
      origin: 'agent_notification',
      sessionId: 'slack-mention-fork-session-1',
      notificationContext: REPORT,
      // Only the seed, which carries the root's own ts: the agent has not
      // spoken in this thread yet.
      recentMessages: [{ ts: '100.1', authorName: 'Nuphos', text: REPORT, fromBot: true }],
    })

    await handleThreadMessage(mentionReplyEnvelope('why is it half the bill?'))

    expect(agentRuns).toHaveLength(1)
    expect(agentRuns[0]!.sessionId).toBe('slack-mention-fork-session-1')
    expect(agentRuns[0]!.renderedTurn).toContain(REPORT)
  })

  test('replays the report only while the fork has never run', async () => {
    state.thread = makeThread({
      origin: 'agent_notification',
      sessionId: 'slack-mention-fork-session-1',
      notificationContext: REPORT,
      recentMessages: [
        { ts: '100.1', authorName: 'Nuphos', text: REPORT, fromBot: true },
        { ts: '100.2', authorName: 'Someone', text: 'why is it half the bill?' },
        // The agent answered: the report is in the transcript from here on.
        { ts: '100.3', authorName: 'Nuphos', text: 'Because the bundles…', fromBot: true },
      ],
    })

    await handleThreadMessage(mentionReplyEnvelope('and last month?', '100.1'))

    expect(agentRuns).toHaveLength(1)
    expect(agentRuns[0]!.renderedTurn).not.toContain(REPORT)
  })
})

// A mention in a thread the agent already follows must carry what teammates
// said there without mentioning it — otherwise "can you see what Tony said
// above?" is answered from half the conversation.
describe('a mention in a thread the agent already follows', () => {
  test('carries the replies posted since the agent last spoke', async () => {
    state.thread = makeThread({
      recentMessages: [
        { ts: '100.1', authorName: 'Yuan', text: 'how many boxes are running?' },
        { ts: '100.2', authorName: 'Nuphos', text: '8 boxes are running', fromBot: true },
        { ts: '100.3', authorName: 'Tony', text: 'the oldest one is mine' },
        { ts: '100.4', authorName: 'Devin', text: 'mine is the 8c16g one' },
        { ts: '100.5', authorName: 'Yuan', text: 'can you see what Tony and Devin said?' },
      ],
    })

    await handleAppMention(
      threadMentionEnvelope(`<@${BOT_USER}> can you see what Tony and Devin said?`),
    )

    expect(agentRuns).toHaveLength(1)
    const turn = agentRuns[0]!.renderedTurn

    expect(turn).toContain('Tony: the oldest one is mine')
    expect(turn).toContain('Devin: mine is the 8c16g one')
    // Already answered before the agent's last reply.
    expect(turn).not.toContain('how many boxes are running?')
    // The mention itself is delivered on its own, not repeated as missed.
    expect(turn).not.toContain('Yuan: can you see')
  })
})
