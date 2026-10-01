// The seam between "a plan was approved in the app" and "its Slack thread runs
// it". Two things must hold: a plan with no Slack thread must not drag the Slack
// route module (and its own import of routes/agent.ts) into the request, and a
// plan WITH one must reach the resume.
import { beforeEach, describe, expect, mock, test } from 'bun:test'

import { useSlackAgentBot } from '@/lib/test/doubles/slack-agent-bot'

import type { SlackAgentThread } from '@/lib/slack/agent-bot'

const SESSION_ID = 'sess-1'
const TEAM = '69f3f2cb3a343b67cf568765'
const NUPHOS_USER = '62e6289482f5f9d9408f1a79'

const state: { thread: SlackAgentThread | null } = { thread: null }
const threadLookups: string[] = []
const resumeCalls: { planId: string; sessionId: string; approverNuphosUserId: string }[] = []

function makeThread(): SlackAgentThread {
  return {
    slackWorkspaceId: 'T1',
    slackChannelId: 'C1',
    slackThreadTs: '100.1',
    teamId: TEAM,
    agentUserId: NUPHOS_USER,
    sessionId: SESSION_ID,
    createdBySlackUserId: 'USLACK',
    origin: 'slack',
    createdAt: new Date(),
    lastActiveAt: new Date(),
  }
}

useSlackAgentBot({
  getSlackAgentThreadBySessionId: async (sessionId: string) => {
    threadLookups.push(sessionId)

    return state.thread
  },
})

// Passed in rather than installed with mock.module: '@/routes/slack' is a
// process-wide registration, and the Slack route's own suites import the real
// resumeApprovedPlanTurnFromNuphos.
const recordResume = async (args: {
  thread: SlackAgentThread
  planId: string
  approverNuphosUserId: string
}) => {
  resumeCalls.push({
    planId: args.planId,
    sessionId: args.thread.sessionId,
    approverNuphosUserId: args.approverNuphosUserId,
  })
}

const { resumeSlackThreadForApprovedPlan } = await import('./plan-slack-resume')

beforeEach(() => {
  state.thread = makeThread()
  threadLookups.length = 0
  resumeCalls.length = 0
})

describe('resumeSlackThreadForApprovedPlan', () => {
  test('hands a Slack-bound plan to its thread', async () => {
    await resumeSlackThreadForApprovedPlan(
      {
        sessionId: SESSION_ID,
        planId: '88',
        planTitle: 'Daily RustFS backup',
        approverNuphosUserId: NUPHOS_USER,
      },
      recordResume,
    )

    expect(threadLookups).toEqual([SESSION_ID])
    expect(resumeCalls).toEqual([
      { planId: '88', sessionId: SESSION_ID, approverNuphosUserId: NUPHOS_USER },
    ])
  })

  test('a plan with no Slack thread is a no-op — the usual case', async () => {
    state.thread = null

    await resumeSlackThreadForApprovedPlan(
      {
        sessionId: SESSION_ID,
        planId: '88',
        planTitle: 'Daily RustFS backup',
        approverNuphosUserId: NUPHOS_USER,
      },
      recordResume,
    )

    expect(resumeCalls).toEqual([])
  })
})
