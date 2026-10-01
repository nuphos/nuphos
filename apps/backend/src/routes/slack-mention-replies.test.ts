import { useDb } from '@/lib/test/doubles/db'

useDb({ db: () => ({ collection: () => ({ findOne: () => Promise.resolve(null) }) }) })

// Every @-mention of the bot (and every reply in a thread the bot started) must
// produce a visible outcome — a turn, a hint, an onboarding prompt, or an
// explanation. Silent 'ignored' dead-ends are regressions (a bare mention
// posted a hint without registering the thread, so replies in that thread were
// dropped without a trace).
import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { THREAD_ADDRESSING_PROMPT_VERSION } from '@/lib/agent/thread-addressing-core'
import { drainPendingUserMessages, hasPendingUserMessages } from '@/lib/agent/pending-messages'
import { useTurnRunner } from '@/lib/agent/turn-runner-testing'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useAgentPlans } from '@/lib/test/doubles/agent-plans'
import { useFileTransferService } from '@/lib/test/doubles/file-transfer-service'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useSlackAgentBot } from '@/lib/test/doubles/slack-agent-bot'
import { useSlackApi } from '@/lib/test/doubles/slack-api'
import { useSlackInstallations } from '@/lib/test/doubles/slack-installations'
import { useThreadAddressing } from '@/lib/test/doubles/thread-addressing'

import type {
  SlackAddressingVerdict,
  SlackAgentThread,
  SlackChannelMapping,
  SlackUserMapping,
} from '@/lib/slack/agent-bot'

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
  planAwaitingApproval: boolean
  threadReplies: Record<string, unknown>[]
} = {
  channelMapping: null,
  userMapping: null,
  thread: null,
  installTeamId: TEAM,
  userEmail: null,
  planAwaitingApproval: false,
  threadReplies: [],
}

// null = the judge failed (fail-open); the handler must run the turn anyway.
let addressingVerdict: { addressed: boolean; reason: string } | null = {
  addressed: true,
  reason: 'test',
}
const addressingCalls: {
  historySize: number
  incoming: string
  pendingDecision?: boolean
}[] = []

const verdictWrites: Omit<SlackAddressingVerdict, '_id'>[] = []

const posted: PostedMessage[] = []
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
  recordSlackAddressingVerdict: async (verdict: Omit<SlackAddressingVerdict, '_id'>) => {
    verdictWrites.push(verdict)
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
  getTeamMembership: async () => ({ role: 'MEMBER' }),
  signNuphosToken: () => 'test-token',
})

useAgentDb({ getConversationWithMessages: async () => null })

useFileTransferService({
  listSessionDownloadsSince: async () => [],
})

useThreadAddressing({
  judgeThreadAddressing: async (input: {
    history: unknown[]
    incoming: { text: string }
    pendingDecision?: boolean
  }) => {
    addressingCalls.push({
      historySize: input.history.length,
      incoming: input.incoming.text,
      pendingDecision: input.pendingDecision,
    })

    return {
      verdict: addressingVerdict,
      prompt: `judge prompt for: ${input.incoming.text}`,
      rawText: addressingVerdict ? JSON.stringify(addressingVerdict) : null,
      modelId: 'judge-model',
    }
  },
})

useAgentPlans({ hasPlanAwaitingApprovalForConversation: async () => state.planAwaitingApproval })

useTurnRunner({
  claimAgentRunOrEnqueue: async (args) => {
    claimActors.push(args.actorUserId)
    const { claimAgentRunOrEnqueue } = await import('@/routes/agent/run-registry')

    return await claimAgentRunOrEnqueue(args)
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

beforeEach(() => {
  state.channelMapping = makeMapping()
  state.userMapping = makeUserMapping()
  state.thread = null
  state.installTeamId = TEAM
  state.userEmail = null
  state.planAwaitingApproval = false
  state.threadReplies = []
  posted.length = 0
  eventMarks.length = 0
  threadUpserts.length = 0
  agentRuns.length = 0
  claimActors.length = 0
  addressingVerdict = { addressed: true, reason: 'test' }
  addressingCalls.length = 0
  statusCalls.length = 0
  verdictWrites.length = 0
})

describe('bare mention', () => {
  test('registers the thread and posts the hint, so the thread is not a dead end', async () => {
    await handleAppMention(mentionEnvelope(`<@${BOT_USER}>`))

    expect(threadUpserts).toHaveLength(1)
    expect(agentRuns).toHaveLength(0)
    expect(posted).toHaveLength(1)
    expect(posted[0]!.text).toContain('What would you like Nuphos to look into?')
    expect(eventMarks).toEqual([{ eventId: 'Ev-mention', status: 'completed' }])

    // The exact incident: a plain reply in the hint thread must now run a turn
    // instead of being silently ignored.
    await handleThreadMessage(threadReplyEnvelope('which team are you bound to?'))
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

  test('from an unlinked Slack user posts the account-link prompt', async () => {
    state.userMapping = null
    state.userEmail = 'stranger@example.com'

    await handleAppMention(mentionEnvelope(`<@${BOT_USER}>`))

    expect(threadUpserts).toHaveLength(0)
    expect(posted).toHaveLength(1)
    expect(posted[0]!.text).toContain("doesn't match any Nuphos user")
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
    state.thread = makeThread()
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
      const handling = handleThreadMessage(threadReplyEnvelope('what about GCP?'))

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

    await handleThreadMessage(threadReplyEnvelope('status?'))

    expect(posted).toHaveLength(0)
    expect(agentRuns).toHaveLength(1)
    expect(agentRuns[0]!.teamId).toBe(TEAM)
  })
})

// The counterweight to the block above: a registered thread keeps delivering
// every reply forever, so "never fail silently" must not mean "always answer".
// Teammates talking to each other in the thread get silence, and only silence —
// not even the fail-closed notices, which were themselves the noise.
describe('addressing judge decides who the reply is for', () => {
  test('a reply judged not addressed to the bot runs nothing and says nothing', async () => {
    state.thread = makeThread()
    addressingVerdict = { addressed: false, reason: 'asking a colleague' }

    await handleThreadMessage(threadReplyEnvelope('@Alice 你看一下這個'))

    expect(agentRuns).toHaveLength(0)
    expect(posted).toHaveLength(0)
    expect(eventMarks).toEqual([{ eventId: 'Ev-reply', status: 'ignored' }])
  })

  test('an unlinked sender is not told to link their account unless they addressed the bot', async () => {
    state.thread = makeThread()
    state.userMapping = null
    state.userEmail = 'stranger@example.com'
    addressingVerdict = { addressed: false, reason: 'teammates talking' }

    await handleThreadMessage(threadReplyEnvelope('好我等下看'))

    expect(posted).toHaveLength(0)
    expect(eventMarks).toEqual([{ eventId: 'Ev-reply', status: 'ignored' }])
  })

  test('a reply judged addressed to the bot still runs its turn', async () => {
    state.thread = makeThread()
    addressingVerdict = { addressed: true, reason: 'follow-up to the agent' }

    await handleThreadMessage(threadReplyEnvelope('那 staging 呢?'))

    expect(agentRuns).toHaveLength(1)
    expect(addressingCalls).toHaveLength(1)
    expect(addressingCalls[0]!.incoming).toBe('那 staging 呢?')
  })

  test('a broken judge fails open: the reply is answered, not swallowed', async () => {
    state.thread = makeThread()
    addressingVerdict = null

    await handleThreadMessage(threadReplyEnvelope('status?'))

    expect(agentRuns).toHaveLength(1)
  })

  test('the judge sees the thread history recorded so far', async () => {
    state.thread = makeThread({
      recentMessages: [
        { ts: '100.1', authorName: 'Yuan', text: 'check prod' },
        { ts: '100.15', authorName: 'Nuphos', text: 'all healthy', fromBot: true },
      ],
    })

    await handleThreadMessage(threadReplyEnvelope('and staging?'))

    expect(addressingCalls[0]!.historySize).toBe(2)
  })

  test('a notification thread reply is judged too — alert triage is not a question for the bot', async () => {
    state.thread = makeThread({ origin: 'agent_notification' })
    addressingVerdict = { addressed: false, reason: 'humans triaging together' }

    await handleThreadMessage(threadReplyEnvelope('我先看 dashboard'))

    expect(agentRuns).toHaveLength(0)
    expect(posted).toHaveLength(0)
    expect(eventMarks).toEqual([{ eventId: 'Ev-reply', status: 'ignored' }])
  })

  test('a reply that is not for the bot leaves no trace at all — not even a status line', async () => {
    state.thread = makeThread()
    addressingVerdict = { addressed: false, reason: 'asking a colleague' }

    await handleThreadMessage(threadReplyEnvelope('@Alice 你看一下這個'))

    expect(agentRuns).toHaveLength(0)
    expect(posted).toHaveLength(0)
    // The typing/loading indicator is as visible as a message: showing it would
    // still be the bot reacting to something that was never for it.
    expect(statusCalls).toHaveLength(0)
  })

  test('a reply that IS for the bot lights the status line', async () => {
    state.thread = makeThread()
    addressingVerdict = { addressed: true, reason: 'follow-up' }

    await handleThreadMessage(threadReplyEnvelope('那 staging 呢?'))

    expect(statusCalls.length).toBeGreaterThan(0)
  })
})

// Every judgement leaves an audit row: which reply, what the judge saw (the
// full prompt), and what it decided — the raw material for reviewing misjudged
// replies and iterating on the prompt.
describe('every judgement is persisted', () => {
  test('an addressed reply writes a live verdict row keyed by the event', async () => {
    state.thread = makeThread()
    addressingVerdict = { addressed: true, reason: 'follow-up to the agent' }

    await handleThreadMessage(threadReplyEnvelope('那 staging 呢?'))

    expect(verdictWrites).toHaveLength(1)
    expect(verdictWrites[0]).toMatchObject({
      dedupeKey: 'live:Ev-reply',
      source: 'live',
      eventId: 'Ev-reply',
      slackWorkspaceId: WORKSPACE,
      slackChannelId: CHANNEL,
      slackThreadTs: '100.1',
      sessionId: 'slack-mention-session-1',
      teamId: TEAM,
      addressed: true,
      failOpen: false,
      reason: 'follow-up to the agent',
      pendingDecision: false,
      alertThread: false,
      incomingText: '那 staging 呢?',
      prompt: 'judge prompt for: 那 staging 呢?',
      modelId: 'judge-model',
      promptVersion: THREAD_ADDRESSING_PROMPT_VERSION,
    })
  })

  test('a not-addressed reply is persisted even though nothing else happens', async () => {
    state.thread = makeThread()
    addressingVerdict = { addressed: false, reason: 'asking a colleague' }

    await handleThreadMessage(threadReplyEnvelope('@Alice 你看一下這個'))

    expect(agentRuns).toHaveLength(0)
    expect(verdictWrites).toHaveLength(1)
    expect(verdictWrites[0]).toMatchObject({
      addressed: false,
      failOpen: false,
      reason: 'asking a colleague',
    })
  })

  test('a broken judge persists a fail-open row with no verdict', async () => {
    state.thread = makeThread()
    addressingVerdict = null

    await handleThreadMessage(threadReplyEnvelope('status?'))

    expect(agentRuns).toHaveLength(1)
    expect(verdictWrites).toHaveLength(1)
    expect(verdictWrites[0]).toMatchObject({ addressed: null, failOpen: true })
    expect(verdictWrites[0]!.rawOutput).toBeUndefined()
  })

  test('an alert-thread reply with a pending decision records both flags', async () => {
    state.thread = makeThread({ origin: 'agent_notification' })
    state.planAwaitingApproval = true

    await handleThreadMessage(threadReplyEnvelope('可以'))

    expect(verdictWrites[0]).toMatchObject({ alertThread: true, pendingDecision: true })
  })
})

// A bare "可以" reads exactly like teammate agreement, and the judge is told to
// stay quiet when unsure — so when the agent left a plan waiting for approval
// it must be told, or the person who just approved gets total silence and the
// plan sits in `proposed` forever.
describe('a pending approval is visible to the judge', () => {
  test('a plan waiting for approval in this session is flagged', async () => {
    state.thread = makeThread()
    state.planAwaitingApproval = true

    await handleThreadMessage(threadReplyEnvelope('可以'))

    expect(addressingCalls[0]!.pendingDecision).toBe(true)
  })

  test('no plan waiting means no flag — the judge keeps its normal bias', async () => {
    state.thread = makeThread()

    await handleThreadMessage(threadReplyEnvelope('可以'))

    expect(addressingCalls[0]!.pendingDecision).toBe(false)
  })

  test('flagged in alert threads too, where the judge is biased hardest to silence', async () => {
    state.thread = makeThread({ origin: 'agent_notification' })
    state.planAwaitingApproval = true

    await handleThreadMessage(threadReplyEnvelope('好 你做吧'))

    expect(addressingCalls[0]!.pendingDecision).toBe(true)
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

    await handleThreadMessage(threadReplyEnvelope('why is it half the bill?'))

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

    await handleThreadMessage(threadReplyEnvelope('and last month?', '100.1'))

    expect(agentRuns).toHaveLength(1)
    expect(agentRuns[0]!.renderedTurn).not.toContain(REPORT)
  })
})
