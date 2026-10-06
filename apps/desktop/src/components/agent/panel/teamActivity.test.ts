import assert from 'node:assert/strict'
import { test } from 'node:test'

import { summarizeTeamActivity } from './teamActivity.ts'

import type { AgentConversation } from '../../../api'
import type { RuntimeExecution } from '../../../lib/runtimeExecution'

const person = (id: string) => ({ id, name: id, email: `${id}@example.com` })

const chat = (
  sessionId: string,
  ownerId: string,
  lastActiveAt: string,
  runtime?: Partial<RuntimeExecution>,
): AgentConversation => ({
  sessionId,
  title: sessionId,
  firstMessage: '',
  messageCount: 1,
  createdAt: lastActiveAt,
  lastActiveAt,
  owner: person(ownerId),
  runtimeState: runtime
    ? { state: 'idle', schemaVersion: 2, observedAt: performance.now(), ...runtime }
    : undefined,
})

test('summarizeTeamActivity keeps one row per person, most urgent first', () => {
  const rows = summarizeTeamActivity([
    chat('a-old', 'alice', '2026-10-01T00:00:00Z'),
    chat('a-run', 'alice', '2026-09-30T00:00:00Z', { state: 'active' }),
    chat('b-new', 'bob', '2026-10-05T00:00:00Z'),
    chat('c-wait', 'carol', '2026-09-01T00:00:00Z', { state: 'active', requestPending: true }),
    chat('c-run', 'carol', '2026-10-02T00:00:00Z', { state: 'active' }),
  ])

  assert.deepEqual(
    rows.map((r) => [r.owner.id, r.status, r.conversation.sessionId, r.busy]),
    [
      ['carol', 'waiting', 'c-wait', 2],
      ['alice', 'running', 'a-run', 1],
      ['bob', 'idle', 'b-new', 0],
    ],
  )
})

test('a stale snapshot does not count as running or waiting', () => {
  const [row] = summarizeTeamActivity([
    chat('s', 'dan', '2026-10-01T00:00:00Z', {
      state: 'active',
      requestPending: true,
      observedAt: performance.now() - 60_000,
    }),
  ])

  assert.equal(row.status, 'idle')
})
