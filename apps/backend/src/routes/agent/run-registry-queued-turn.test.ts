import '@/routes/agent'

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  buildPendingUserMessage,
  clearPendingUserMessages,
  drainPendingUserMessages,
  enqueuePendingUserMessage,
} from '@/lib/agent/pending-messages'
import { useDb } from '@/lib/test/doubles/db'

import {
  agentRuns,
  awaitQueuedTurn,
  claimAgentRunOrEnqueue,
  createAgentRun,
  registerAgentRun,
} from './run-registry'

// Turn admission looks the conversation up; none here means no move is running.
useDb({ db: (() => ({ collection: () => ({ findOne: async () => null }) })) as never })

const OWNER = 'queued-owner'
const SESSION = 'queued-session'
const FAST = { pollMs: 10, timeoutMs: 2_000 }

function startBusyTurn() {
  const run = createAgentRun(OWNER, SESSION, 'stream-busy', {
    requestId: 'request-busy',
    userId: OWNER,
    sessionId: SESSION,
    streamId: 'stream-busy',
    route: 'lark.agent',
    method: 'TRIGGER',
  })

  registerAgentRun(run)

  return () => {
    run.done = true
    run.releaseOwnership()
    agentRuns.delete(run.key)
  }
}

async function queue(text: string, source = 'lark') {
  const message = buildPendingUserMessage({ renderedText: text, source, actorUserId: OWNER })
  const outcome = await claimAgentRunOrEnqueue({ userId: OWNER, sessionId: SESSION, message })

  expect(outcome.mode).toBe('queued')

  return message
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

describe('awaitQueuedTurn', () => {
  test('a channel message queued behind a busy turn runs once that turn ends', async () => {
    const endTurn = startBusyTurn()
    const message = await queue('what about staging?')
    const other = await queue('and prod?')
    const waiting = awaitQueuedTurn(
      { userId: OWNER, sessionId: SESSION, messageId: message.id },
      FAST,
    )

    await new Promise((resolve) => setTimeout(resolve, 50))
    endTurn()
    const turn = await waiting

    expect(turn.mode).toBe('run')
    if (turn.mode !== 'run') return
    expect(turn.carried.map((entry) => entry.id)).toEqual([other.id])
    turn.release()
  })

  test('reports a message another turn already drained as taken', async () => {
    startBusyTurn()
    const message = await queue('hello')

    await drainPendingUserMessages(OWNER, SESSION, OWNER)

    expect(
      await awaitQueuedTurn({ userId: OWNER, sessionId: SESSION, messageId: message.id }, FAST),
    ).toEqual({ mode: 'taken' })
  })

  test('takes a message that never got a turn off the queue', async () => {
    startBusyTurn()
    const message = await queue('stuck')
    const other = buildPendingUserMessage({ renderedText: 'keep', source: 'app' })

    await enqueuePendingUserMessage(OWNER, SESSION, other)

    expect(
      await awaitQueuedTurn(
        { userId: OWNER, sessionId: SESSION, messageId: message.id },
        { pollMs: 10, timeoutMs: 50 },
      ),
    ).toEqual({ mode: 'expired' })
    expect((await drainPendingUserMessages(OWNER, SESSION)).map((entry) => entry.id)).toEqual([
      other.id,
    ])
  })
})
