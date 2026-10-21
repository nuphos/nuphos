import '@/routes/agent'

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  buildPendingUserMessage,
  clearPendingUserMessages,
  drainPendingUserMessages,
} from '@/lib/agent/pending-messages'

import {
  agentRuns,
  claimAgentRunOrEnqueue,
  createAgentRun,
  isHumanTurn,
  registerAgentRun,
} from './run-registry'

const OWNER = 'conversation-owner'
const ACTOR_A = 'actor-a'
const ACTOR_B = 'actor-b'
const SESSION = 'shared-session'

function message(text: string) {
  return buildPendingUserMessage({ renderedText: text, source: 'slack' })
}

beforeEach(async () => {
  await clearPendingUserMessages(OWNER, SESSION)
})

afterEach(async () => {
  for (const [key, run] of agentRuns) {
    if (run.sessionId !== SESSION) continue
    run.done = true
    run.releaseOwnership()
    agentRuns.delete(key)
  }
  await clearPendingUserMessages(OWNER, SESSION)
})

describe('shared-conversation participant state machine', () => {
  test('messages are all accepted but drain only into their own execution principal', async () => {
    const run = createAgentRun(OWNER, SESSION, 'stream-a', {
      requestId: 'request-a',
      userId: ACTOR_A,
      sessionId: SESSION,
      streamId: 'stream-a',
      route: 'slack.agent',
      method: 'TRIGGER',
    })

    registerAgentRun(run)

    const sameActor = await claimAgentRunOrEnqueue({
      userId: OWNER,
      sessionId: SESSION,
      actorUserId: ACTOR_A,
      message: message('continue'),
    })
    const otherActor = await claimAgentRunOrEnqueue({
      userId: OWNER,
      sessionId: SESSION,
      actorUserId: ACTOR_B,
      message: message('delete production'),
    })

    expect(sameActor).toEqual({ mode: 'queued', activeActorUserId: ACTOR_A })
    expect(otherActor).toEqual({ mode: 'queued', activeActorUserId: ACTOR_A })
    expect(
      (await drainPendingUserMessages(OWNER, SESSION, ACTOR_A)).map((entry) => entry.renderedText),
    ).toEqual(['continue'])
    expect(
      (await drainPendingUserMessages(OWNER, SESSION, ACTOR_B)).map((entry) => entry.renderedText),
    ).toEqual(['delete production'])
  })

  test('an actorless message defaults to the conversation owner, never the active actor', async () => {
    const run = createAgentRun(OWNER, SESSION, 'stream-a', {
      requestId: 'request-a',
      userId: ACTOR_A,
      sessionId: SESSION,
      streamId: 'stream-a',
      route: 'slack.agent',
      method: 'TRIGGER',
    })

    registerAgentRun(run)
    await claimAgentRunOrEnqueue({
      userId: OWNER,
      sessionId: SESSION,
      message: message('owner follow-up'),
    })

    expect(await drainPendingUserMessages(OWNER, SESSION, ACTOR_A)).toEqual([])
    expect(
      (await drainPendingUserMessages(OWNER, SESSION, OWNER)).map((entry) => entry.renderedText),
    ).toEqual(['owner follow-up'])
  })
})

describe('human turn', () => {
  const trace = (route: string, method: string) => ({
    requestId: 'request',
    userId: ACTOR_A,
    sessionId: SESSION,
    streamId: 'stream',
    route,
    method,
  })

  test('people start app, queued and verified-sender bridge turns', () => {
    expect(isHumanTurn(trace('/agent/chat', 'POST'))).toBe(true)
    expect(isHumanTurn(trace('/agent/chat', 'QUEUED'))).toBe(true)
    expect(isHumanTurn(trace('slack.agent', 'TRIGGER'))).toBe(true)
    // A runtime follow-up continues that person's work, so they can steer it.
    expect(isHumanTurn(trace('claude-code/autonomous', 'RUNTIME'))).toBe(true)
  })

  test("agents, resource events and triggers start no person's turn", () => {
    for (const route of ['agent.thread', 'agent.resource', 'agent.trigger', 'lark.agent'])
      expect(isHumanTurn(trace(route, 'TRIGGER'))).toBe(false)
  })
})
