// Same init-order guard as the sibling preview tests.
import '@/routes/agent'

import { beforeEach, describe, expect, test } from 'bun:test'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useAgentRunStore } from '@/lib/test/doubles/agent-run-store'
import { useAutoModeStore } from '@/lib/test/doubles/auto-mode-store'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useLiveTurn } from '@/lib/test/doubles/live-turn'
import { useThreadRuntime } from '@/lib/test/doubles/thread-runtime'

import type { AgentConversation } from '@/lib/agent/db'

const question = {
  id: 'q1',
  category: 'preference',
  question: 'Which region?',
  options: ['us', 'eu'],
  askedAt: new Date('2026-01-01T00:00:00Z'),
  status: 'open',
}
const session = (over: Record<string, unknown> = {}) =>
  ({
    sessionId: 's1',
    userId: 'u1',
    teamId: 't1',
    title: 'Fix the importer',
    lastActiveAt: new Date('2026-01-02T00:00:00Z'),
    messageCount: 4,
    ...over,
  }) as unknown as AgentConversation

let listed: { viewer: string; options: Record<string, unknown> } | undefined
let stored: AgentConversation | null
let running: boolean
let bypass: boolean
let picked: Record<string, unknown> | undefined

useIdentity({ getTeamMembership: async () => ({ role: 'MEMBER' }) as never })
useAgentRunStore({ getActiveAgentRunForSession: async () => (running ? ({} as never) : null) })
useLiveTurn({ getLiveTurn: async () => ({ parts: [] }) as never })
useAutoModeStore({
  getSessionBypass: async () => bypass,
  setSessionBypass: async (_session, _user, enabled) => {
    bypass = enabled
  },
})
useThreadRuntime({
  setThreadModel: async (_session, _user, pick) => {
    if (pick.model === 'nope') throw new Error('model "nope" is not offered. Choose one of: opus.')
    picked = pick

    return pick as never
  },
})
useAgentDb({
  getConversations: async (viewer, options) => {
    listed = { viewer, options }

    return {
      conversations: [session(), session({ sessionId: 's2', inputRequests: [question] })],
      parents: [],
      nextCursor: null,
      hasMore: false,
    }
  },
  getConversationBySessionId: async () => stored,
  getConversationWithMessages: async () =>
    stored && {
      conversation: stored,
      messages: [{ role: 'assistant', parts: [{ type: 'text', text: 'Done so far.' }] }] as never,
    },
  getConversationTranscriptForAgent: async () =>
    ({ lines: ['#0 user: hi', '#1 assistant: Done so far.'], nextIndex: null }) as never,
  liveTurnTranscriptLine: () => '#4 assistant (in progress): [tool: bash]',
  recordAgentEvent: () => undefined,
})

const { nuphosListSessions, nuphosUpdateSession } = await import('./sessions')
const { nuphosCheck } = await import('./check')
const ctx = { userId: 'u1' }
const body = (result: { structuredContent?: unknown }) =>
  result.structuredContent as Record<string, any>

beforeEach(() => {
  listed = undefined
  stored = session()
  running = false
  bypass = false
  picked = undefined
})

describe('nuphos_list_sessions', () => {
  test('lists the caller’s own sessions and says which wait for a person', async () => {
    const result = body(await nuphosListSessions({ team_id: 't1', search: 'importer' }, ctx))

    expect(listed?.viewer).toBe('u1')
    expect(listed?.options).toMatchObject({ teamId: 't1', scope: 'mine', search: 'importer' })
    expect(listed?.options.pendingDecision).toBeUndefined()
    expect(result.sessions.map((s: any) => [s.session_id, s.waiting_for_input])).toEqual([
      ['s1', false],
      ['s2', true],
    ])
  })

  test('filters to waiting sessions and to shared ones', async () => {
    await nuphosListSessions({ team_id: 't1', waiting_for_input: true, scope: 'shared' }, ctx)

    expect(listed?.options).toMatchObject({ scope: 'shared', pendingDecision: true })
  })
})

describe('nuphos_update_session', () => {
  test('sets model, effort and Full Access on the caller’s own session', async () => {
    const result = body(
      await nuphosUpdateSession(
        { session_id: 's1', model: 'opus', effort: 'high', full_access: true },
        ctx,
      ),
    )

    expect(picked).toEqual({ model: 'opus', effort: 'high' })
    expect(result).toMatchObject({ session_id: 's1', model: 'opus', full_access: true })
  })

  test('refuses a session the caller does not own, and changes nothing', async () => {
    stored = session({ userId: 'someone-else' })
    const result = await nuphosUpdateSession({ session_id: 's1', full_access: true }, ctx)

    expect(result.isError).toBe(true)
    expect(bypass).toBe(false)
  })

  test('a model the agent does not offer is a tool error, before Full Access changes', async () => {
    const result = await nuphosUpdateSession(
      { session_id: 's1', model: 'nope', full_access: true },
      ctx,
    )

    expect(result.isError).toBe(true)
    expect(bypass).toBe(false)
  })
})

describe('nuphos_check', () => {
  test('a session stopped on a question is waiting_for_input, with the question', async () => {
    stored = session({ inputRequests: [question] })
    const result = body(await nuphosCheck({ session_id: 's1' }, ctx))

    expect(result.status).toBe('waiting_for_input')
    expect(result.requests).toEqual([
      expect.objectContaining({
        request_id: 'q1',
        question: 'Which region?',
        options: ['us', 'eu'],
      }),
    ])
    expect(result.answer).toBe('Done so far.')
  })

  test('a running session reports what the turn has done so far', async () => {
    running = true
    const result = body(await nuphosCheck({ session_id: 's1' }, ctx))

    expect(result.status).toBe('running')
    expect(result.in_progress).toContain('[tool: bash]')
  })

  test('from_index adds a page of the transcript', async () => {
    const result = body(await nuphosCheck({ session_id: 's1', from_index: 0 }, ctx))

    expect(result.status).toBe('completed')
    expect(result.transcript).toEqual({
      lines: ['#0 user: hi', '#1 assistant: Done so far.'],
      next_index: null,
    })
    expect(body(await nuphosCheck({ session_id: 's1' }, ctx)).transcript).toBeUndefined()
  })
})
