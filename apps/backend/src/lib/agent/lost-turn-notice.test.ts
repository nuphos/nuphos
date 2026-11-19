import { beforeEach, expect, test } from 'bun:test'

import { sessionsByConversation } from '@/lib/claude-code-preview/agent-chat-registry'
import { useAgentDb } from '@/lib/test/doubles/agent-db'

import { noteLostTurn } from './undelivered-send'

import type { appendConversationMessages } from './db'
import type { TeamSession } from '@/lib/claude-code-preview/team-openab-runtime'

// Run with: cd apps/backend && bun test src/lib/agent/lost-turn-notice.test.ts

let appended: Parameters<typeof appendConversationMessages>[0][] = []

useAgentDb({
  appendConversationMessages: async (data) => {
    appended.push(data)
  },
})

const target = { userId: 'owner', teamId: 'team', targetSessionId: 'task' }

/** `lastOutcome` is how the turn ended, as the runtime that ran it recorded; a restarted one has none. */
function attach(state: string, reattached = true, lastOutcome?: unknown) {
  sessionsByConversation.set('team:task', {
    openabSessionId: 'sess-1',
    reattached: Promise.resolve(reattached),
    client: { getSessionExecutionState: async () => ({ state, lastOutcome }) },
  } as unknown as TeamSession)
}

const ended = { result: { stopReason: 'end_turn' } }

beforeEach(() => {
  appended = []
  sessionsByConversation.delete('team:task')
})

test('a turn its computer restarted under (an update) says it was cut off', async () => {
  // A restarted runtime comes back with its agent loaded (idle) or not yet (dormant).
  for (const state of ['dormant', 'interrupted', 'idle']) {
    appended = []
    attach(state)
    await noteLostTurn(target)
    expect(appended).toHaveLength(1)
    expect(appended[0]?.sessionId).toBe('task')
    expect(appended[0]?.messages[0]?.parts).toEqual([
      { type: 'text', text: expect.stringMatching(/^This message was cut off/) },
    ])
  }
})

test('a turn the runtime kept running or finished, or a session that did not come back, says nothing', async () => {
  attach('active')
  await noteLostTurn(target)
  // The runtime finished the turn while the connection was down, and recorded how.
  for (const state of ['idle', 'dormant']) {
    attach(state, true, ended)
    await noteLostTurn(target)
  }
  attach('dormant', false)
  await noteLostTurn(target)
  sessionsByConversation.delete('team:task')
  await noteLostTurn(target)
  expect(appended).toEqual([])
})
