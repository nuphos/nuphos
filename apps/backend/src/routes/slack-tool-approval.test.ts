import { beforeEach, describe, expect, test } from 'bun:test'

import type { SlackAgentThread, SlackUserMapping } from '@/lib/slack/agent-bot'

import { useIdentity } from '@/lib/test/doubles/identity'
import { useFakeRuntimeRequests } from '@/lib/test/doubles/runtime-request-store'
import { useSlackAgentBot } from '@/lib/test/doubles/slack-agent-bot'
import { useSlackApi } from '@/lib/test/doubles/slack-api'
import { useSlackInstallations } from '@/lib/test/doubles/slack-installations'

const WORKSPACE = 'T1'
const CHANNEL = 'C1'
const SLACK_USER = 'USLACK'
const NUPHOS_USER = '62e6289482f5f9d9408f1a79'
const OTHER_USER = '69f3f2cb3a343b67cf568765'
const TEAM = '69e989027ab63e8d6a0ffcb6'
const SESSION = 'session-1'
const TOOL_CALL = 'tool-1'

const state = { mappedUserId: NUPHOS_USER }
const responses: Record<string, unknown>[] = []

const thread: SlackAgentThread = {
  slackWorkspaceId: WORKSPACE,
  slackChannelId: CHANNEL,
  slackThreadTs: '100.1',
  teamId: TEAM,
  agentUserId: NUPHOS_USER,
  sessionId: SESSION,
  createdBySlackUserId: SLACK_USER,
  origin: 'slack',
  createdAt: new Date(),
  lastActiveAt: new Date(),
}

function mapping(): SlackUserMapping {
  return {
    slackWorkspaceId: WORKSPACE,
    slackUserId: SLACK_USER,
    teamId: TEAM,
    nuphosUserId: state.mappedUserId,
    enabled: true,
    createdBy: 'auto:slack-email',
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

useSlackInstallations({
  resolveSlackBotForWorkspace: async () => ({
    botToken: 'xoxb-test',
    botUserId: 'UBOT',
    nuphosTeamId: TEAM,
    binding: null,
  }),
})
useSlackAgentBot({
  getSlackAgentThreadBySessionId: async () => thread,
  getSlackUserMapping: async () => mapping(),
})
useSlackApi({
  postSlackResponseUrl: async (_url, body) => {
    responses.push(body)

    return { ok: true }
  },
  postSlackEphemeral: async () => ({ ok: true }),
})
useIdentity({
  getTeamMembership: async (userId, teamId) =>
    teamId === TEAM && userId === NUPHOS_USER ? { role: 'MEMBER' } : null,
})

const { registerPreviewWait, resetLocalPreviewWaits, takePreviewDecision } =
  await import('@/lib/claude-code-preview/decision-waiter')
const { handleToolApprovalInteraction } = await import('./slack')

beforeEach(() => {
  resetLocalPreviewWaits()
  state.mappedUserId = NUPHOS_USER
  responses.length = 0
})

async function openWait() {
  return registerPreviewWait({
    userId: NUPHOS_USER,
    sessionId: SESSION,
    kind: 'agent-permission',
    ref: TOOL_CALL,
  })
}

async function click(decision: 'allow' | 'reject') {
  await handleToolApprovalInteraction({
    slackWorkspaceId: WORKSPACE,
    slackUserId: SLACK_USER,
    decision,
    value: JSON.stringify({ sessionId: SESSION, toolCallId: TOOL_CALL }),
    responseUrl: 'https://hooks.slack.test/response',
    channelId: CHANNEL,
    threadTs: '100.1',
  })
}

describe('Slack OpenAB tool approval', () => {
  test('the turn principal can allow the pending tool once', async () => {
    const wait = await openWait()

    await click('allow')

    expect(await takePreviewDecision(NUPHOS_USER, SESSION, wait.waitId)).toMatchObject({
      payload: { decision: 'approved' },
      kind: 'agent-permission',
    })
    expect(responses).toContainEqual(
      expect.objectContaining({ replace_original: true, text: 'Tool approved once.' }),
    )
  })

  test('a different member cannot authorize use of the original principal credentials', async () => {
    const wait = await openWait()

    state.mappedUserId = OTHER_USER

    await click('allow')

    expect(await takePreviewDecision(NUPHOS_USER, SESSION, wait.waitId)).toBeNull()
    expect(responses).toEqual([])
  })

  test('reject resolves the wait without selecting an allow option', async () => {
    const wait = await openWait()

    await click('reject')

    expect(await takePreviewDecision(NUPHOS_USER, SESSION, wait.waitId)).toMatchObject({
      payload: { decision: 'rejected' },
    })
    expect(responses).toContainEqual(
      expect.objectContaining({ replace_original: true, text: 'Tool request rejected.' }),
    )
  })
})

useFakeRuntimeRequests()
