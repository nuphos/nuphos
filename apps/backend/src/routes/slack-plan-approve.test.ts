// The Approve button on Slack plan cards must work in channel-mapped channels
// whose Nuphos team differs from the workspace's OAuth binding, and every
// rejection must be logged (cross-team clicks died on ephemeral replies with
// zero telemetry for two days — plans #88/#89 never executed).
import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { useTurnRunner } from '@/lib/agent/turn-runner-testing'
import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useAgentPlans } from '@/lib/test/doubles/agent-plans'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useJournalCapture } from '@/lib/test/doubles/journal-capture'
import { real as realObservability, useObservability } from '@/lib/test/doubles/observability'
import { useSlackAgentBot } from '@/lib/test/doubles/slack-agent-bot'
import { useSlackApi } from '@/lib/test/doubles/slack-api'
import { useSlackInstallations } from '@/lib/test/doubles/slack-installations'

import type { SlackAgentThread, SlackUserMapping } from '@/lib/slack/agent-bot'

const WORKSPACE = 'T1'
const CHANNEL = 'C1'
const SLACK_USER = 'USLACK'
const NUPHOS_USER = '62e6289482f5f9d9408f1a79'
// The workspace's OAuth binding points at one team; the thread (channel
// mapping) belongs to another. The plan lives in the thread's team.
const WORKSPACE_TEAM = '69e989027ab63e8d6a0ffcb6'
const THREAD_TEAM = '69f3f2cb3a343b67cf568765'
const PLAN_ID = '88'
const SESSION_ID = 'sess-1'

const state: {
  thread: SlackAgentThread | null
  planExists: boolean
  /** Whether the in-Nuphos approver has a Slack identity in this workspace. */
  approverHasSlackMapping: boolean
  /** A turn is mid-flight for the plan's session. */
  turnAlreadyRunning: boolean
} = { thread: null, planExists: true, approverHasSlackMapping: true, turnAlreadyRunning: false }

const userMappingLookups: string[] = []
const recordPlanApprovalCalls: {
  id: string
  scope: { teamId?: string; userId: string }
  userId: string
}[] = []
const journaled: { planId: string; decision: string }[] = []
const responseUrlBodies: Record<string, unknown>[] = []
const ephemerals: { channel: string; user: string; text: string; threadTs?: string }[] = []
const loggedEvents: { event: string; data?: Record<string, unknown> }[] = []
const agentRuns: { sessionId: string; teamId: string }[] = []
// What the resume actually told the model — the approval sentence must not
// render a mention for an approver who has no Slack identity.
const turnTexts: string[] = []

function makeThread(overrides?: Partial<SlackAgentThread>): SlackAgentThread {
  return {
    slackWorkspaceId: WORKSPACE,
    slackChannelId: CHANNEL,
    slackThreadTs: '100.1',
    teamId: THREAD_TEAM,
    agentUserId: NUPHOS_USER,
    sessionId: SESSION_ID,
    createdBySlackUserId: SLACK_USER,
    origin: 'slack',
    createdAt: new Date(),
    lastActiveAt: new Date(),
    ...overrides,
  }
}

function makeUserMapping(): SlackUserMapping {
  return {
    slackWorkspaceId: WORKSPACE,
    slackUserId: SLACK_USER,
    teamId: THREAD_TEAM,
    nuphosUserId: NUPHOS_USER,
    enabled: true,
    createdBy: 'auto:slack-email',
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

const approvablePlan = {
  id: PLAN_ID,
  number: 88,
  teamId: THREAD_TEAM,
  createdBy: NUPHOS_USER,
  sourceConversationId: SESSION_ID,
  title: 'Daily RustFS backup',
  steps: [{ title: 'Create backup job', jobs: [{ title: 'kubectl apply', commands: [] }] }],
  costSummary: '~$1/month',
  riskWorstCase: 'Backups silently empty',
  riskMitigations: ['Verify first backup manually'],
  status: 'proposed' as const,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

useSlackInstallations({
  resolveSlackBotForWorkspace: async () => ({
    botToken: 'xoxb-test',
    botUserId: 'UBOT',
    // Deliberately NOT the thread's team — scoping anything to this value is
    // the regression this suite guards against.
    nuphosTeamId: WORKSPACE_TEAM,
    binding: null,
  }),
})

useSlackAgentBot({
  getSlackAgentThreadBySessionId: async () => state.thread,
  // Mapping rows exist only in the thread's team, mirroring the real incident.
  getSlackUserMapping: async (_ws: string, teamId: string) => {
    userMappingLookups.push(teamId)

    return teamId === THREAD_TEAM ? makeUserMapping() : null
  },
  getSlackUserMappingForNuphosUser: async () =>
    state.approverHasSlackMapping ? makeUserMapping() : null,
})

useSlackApi({
  postSlackResponseUrl: async (_url: string, body: Record<string, unknown>) => {
    responseUrlBodies.push(body)

    return { ok: true }
  },
  postSlackMessage: async () => ({ ok: true, ts: '999.1' }),
  postSlackEphemeral: async (body: {
    channel: string
    user: string
    text: string
    threadTs?: string
  }) => {
    ephemerals.push(body)

    return { ok: true }
  },
  slackApiGet: async () => ({ ok: true, user: { id: SLACK_USER, real_name: 'David' } }),
})

useIdentity({
  getTeamMembership: async (_userId: string, teamId: string) =>
    teamId === THREAD_TEAM ? { role: 'MEMBER' } : null,
  signNuphosToken: () => 'test-token',
})

useAgentPlans({
  getPlan: async (_id: string, scope: { teamId?: string }) =>
    state.planExists && scope.teamId === THREAD_TEAM ? approvablePlan : null,
  recordPlanApproval: async (
    id: string,
    scope: { teamId?: string; userId: string },
    userId: string,
  ) => {
    recordPlanApprovalCalls.push({ id, scope, userId })

    return {
      plan: { ...approvablePlan, status: 'approved', approvedBy: scope.userId },
      recorded: true,
      thresholdReached: true,
    }
  },
})

useJournalCapture({
  // The route passes the full plan; the declared param is narrower, so `id` is
  // present at runtime but not in the signature.
  journalPlanDecision: async (plan, _actor, decision) => {
    journaled.push({ planId: (plan as unknown as { id: string }).id, decision })
  },
})

// Record AND delegate: other test files share this process-wide mock, so
// logEvent must keep its real behavior for them. Capture the original before
// mock.module swaps the namespace's live bindings, or the delegate recurses
// into itself.
useObservability({
  logEvent: (level, event, data) => {
    loggedEvents.push({ event, data })
    realObservability.logEvent(level, event, data)
  },
})

useAgentDb({ getConversationWithMessages: async () => null })

useTurnRunner({
  claimAgentRunForSession: async () => () => {},
  hasActiveAgentRunForSession: async () => state.turnAlreadyRunning,
  runAgentForTrigger: async (params) => {
    agentRuns.push({ sessionId: params.sessionId, teamId: params.teamId ?? '' })
    turnTexts.push(
      params.messages
        .flatMap((message) => message.parts.map((part) => ('text' in part ? part.text : '')))
        .join('\n'),
    )

    return { status: 'completed' }
  },
})

const { handlePlanApproveInteraction, resumeApprovedPlanTurnFromNuphos } = await import('./slack')

const buttonValue = JSON.stringify({
  planId: PLAN_ID,
  sessionId: SESSION_ID,
  title: 'Daily RustFS backup',
})

async function waitFor(condition: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs

  while (!condition() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

async function click(value = buttonValue) {
  await handlePlanApproveInteraction({
    slackWorkspaceId: WORKSPACE,
    slackUserId: SLACK_USER,
    value,
    responseUrl: 'https://hooks.slack.test/response',
    channelId: CHANNEL,
    threadTs: '100.1',
  })
  // The execution resume is detached from the interaction handler.
  await new Promise((resolve) => setTimeout(resolve, 20))
}

beforeEach(() => {
  state.thread = makeThread()
  state.planExists = true
  state.approverHasSlackMapping = true
  state.turnAlreadyRunning = false
  turnTexts.length = 0
  userMappingLookups.length = 0
  recordPlanApprovalCalls.length = 0
  journaled.length = 0
  responseUrlBodies.length = 0
  ephemerals.length = 0
  loggedEvents.length = 0
  agentRuns.length = 0
})

describe('handlePlanApproveInteraction', () => {
  test('approves and resumes when the thread team differs from the workspace binding', async () => {
    await click()

    // Everything is scoped to the THREAD's team, never the workspace binding.
    expect(userMappingLookups).toEqual([THREAD_TEAM])
    expect(recordPlanApprovalCalls).toEqual([
      {
        id: PLAN_ID,
        scope: { teamId: THREAD_TEAM, userId: NUPHOS_USER },
        userId: NUPHOS_USER,
      },
    ])
    expect(journaled).toEqual([{ planId: PLAN_ID, decision: 'approved' }])
    expect(loggedEvents.map((e) => e.event)).toContain('slack.plan.approved')

    // Card swapped for everyone and execution kicked in the original session.
    const swap = responseUrlBodies.find((b) => b.replace_original === true)

    expect(swap).toBeDefined()
    // The resume runs detached from the interaction ack (Slack wants a reply
    // within 3s), so wait for it rather than assuming it lands in the same
    // microtask flush — any I/O added ahead of the run would race the
    // assertion otherwise.
    await waitFor(() => agentRuns.length > 0)
    expect(agentRuns).toEqual([{ sessionId: SESSION_ID, teamId: THREAD_TEAM }])
  })

  test('missing plan rejects with an IN-THREAD ephemeral AND logs the rejection', async () => {
    state.planExists = false
    await click()

    expect(recordPlanApprovalCalls).toEqual([])
    // Delivered inside the thread the click happened in, not at channel root.
    expect(ephemerals).toEqual([
      expect.objectContaining({ channel: CHANNEL, user: SLACK_USER, threadTs: '100.1' }),
    ])
    expect(responseUrlBodies).toEqual([])
    const rejection = loggedEvents.find((e) => e.event === 'slack.plan.approve_rejected')

    expect(rejection?.data?.reason).toBe('plan_not_found')
    expect(rejection?.data?.team_id).toBe(THREAD_TEAM)
  })

  test('thread from another workspace is rejected and logged, plan untouched', async () => {
    state.thread = makeThread({ slackWorkspaceId: 'T-OTHER' })
    await click()

    expect(recordPlanApprovalCalls).toEqual([])
    expect(agentRuns).toEqual([])
    expect(ephemerals).toHaveLength(1)
    const rejection = loggedEvents.find((e) => e.event === 'slack.plan.approve_rejected')

    expect(rejection?.data?.reason).toBe('thread_unresolved')
  })
})

// Approving the same plan from the Nuphos app instead of the card. The thread
// is the ONLY place a Slack-bound plan can execute — the app serves those
// conversations read-only — so before this the plan sat at `approved` forever
// and the thread that asked for the approval was never told.
describe('resumeApprovedPlanTurnFromNuphos', () => {
  async function approveInNuphos() {
    await resumeApprovedPlanTurnFromNuphos({
      thread: state.thread!,
      planId: PLAN_ID,
      planTitle: 'Daily RustFS backup',
      approverNuphosUserId: NUPHOS_USER,
    })
  }

  test('starts the execution turn in the bound thread', async () => {
    await approveInNuphos()

    expect(agentRuns).toEqual([{ sessionId: SESSION_ID, teamId: THREAD_TEAM }])
    const resumed = loggedEvents.find((e) => e.event === 'slack.plan.resume_from_nuphos')

    expect(resumed?.data?.plan_id).toBe(PLAN_ID)
    expect(resumed?.data?.approver_slack_user_id).toBe(SLACK_USER)
  })

  test('an approver with no Slack identity still executes, and is not half-mentioned', async () => {
    state.approverHasSlackMapping = false

    await approveInNuphos()

    expect(agentRuns).toEqual([{ sessionId: SESSION_ID, teamId: THREAD_TEAM }])
    expect(turnTexts[0]).toContain('was approved in Nuphos')
    // The failure this pins: `<@undefined>` reaching the thread and the model.
    expect(turnTexts[0]).not.toContain('undefined')
    expect(turnTexts[0]).not.toContain('<@')
  })

  test('a turn already running owns the plan — no second execution, no announcement', async () => {
    // Reachable when the agent PATCHes the plan it is working on: the approval
    // came from inside the running turn, so kicking would run the plan twice.
    state.turnAlreadyRunning = true

    await approveInNuphos()

    expect(agentRuns).toEqual([])
    const skipped = loggedEvents.find((e) => e.event === 'slack.plan.resume_from_nuphos_skipped')

    expect(skipped?.data?.reason).toBe('turn_already_running')
  })
})
