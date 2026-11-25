// A meeting Task whose provider rate limits it (429) while the call keeps talking.
// Each event must not start another turn: the queue waits, and keeps what was said.
import '@/routes/agent'

import { randomUUID } from 'node:crypto'

import { afterEach, beforeEach, expect, test } from 'bun:test'
import { ObjectId } from 'mongodb'

import {
  buildPendingUserMessage,
  clearPendingUserMessages,
  enqueuePendingUserMessage,
} from '@/lib/agent/pending-messages'
import { listPendingUserMessages } from '@/lib/agent/pending-queue'
import { CodexTurnFailedError } from '@/lib/claude-code-preview/codex-turn-failure'
import { useCredentialOptions } from '@/lib/test/doubles/credential-options'
import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useTriggerRunExecute } from '@/lib/test/doubles/trigger-run-execute'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import type * as dbActual from '@/lib/db'

let memory = portabilityDb()
const OWNER = new ObjectId().toHexString()
let turns = 0

useDb({ db: () => memory })
useIdentity({ getTeamMembership: () => Promise.resolve({ role: 'member' }) })
useCredentialOptions({ getAgentCredentialOptions: () => Promise.resolve({} as never) })
// codex-acp reports the provider's 429, after its own retries, as a failed turn.
useTriggerRunExecute({
  executeAgentForTrigger: async () => {
    turns++
    await Bun.sleep(20)
    throw new CodexTurnFailedError('exceeded retry limit, last status: 429 Too Many Requests\n\n')
  },
})

const { handleRecallEvent } = await import('./meetings')
const { startQueuedTurn } = await import('@/lib/agent/queued-turn')
const { installQueuedTurnStarter } = await import('@/lib/agent/session-released')

installQueuedTurnStarter(startQueuedTurn)

const said = (n: number) =>
  handleRecallEvent(randomUUID(), {
    event: 'transcript.data',
    data: {
      data: { words: [{ text: `point ${String(n)}` }], participant: { name: 'Can' } },
      bot: { id: 'recall-bot' },
    },
  })

beforeEach(() => {
  turns = 0
  memory = portabilityDb()
  memory.rows('agent_conversations').push({
    _id: 'meeting',
    sessionId: 'meeting',
    userId: OWNER,
    teamId: 'team',
    title: 'Standup',
    meeting: { botId: 'recall-bot', botName: 'Nuphos' },
  })
})
afterEach(() => clearPendingUserMessages(OWNER, 'meeting'))

test('a rate-limited turn waits before the next try, and what was said waits with it', async () => {
  for (let n = 0; n < 10; n++) {
    await said(n)
    await Bun.sleep(50)
  }
  await Bun.sleep(200)

  // Before: every event that came after a failed turn started another one.
  expect(turns).toBe(1)
  expect(await listPendingUserMessages(OWNER, 'meeting')).toHaveLength(10)
})

test('a new event does not start a queue that is waiting out a refusal', async () => {
  const now = Date.now()

  await enqueuePendingUserMessage(OWNER, 'meeting', {
    ...buildPendingUserMessage({ renderedText: 'earlier', source: 'agent.resource' }),
    attempts: 3,
    refusedAt: new Date(now - 60_000).toISOString(),
    retryAfter: new Date(now + 4 * 60_000).toISOString(),
  })
  await said(1)
  await Bun.sleep(200)

  // Before: joining the queue counted as a release and ended the wait.
  expect(turns).toBe(0)
})
