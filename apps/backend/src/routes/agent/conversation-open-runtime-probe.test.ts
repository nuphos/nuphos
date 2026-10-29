import '@/routes/agent'

import { beforeEach, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { agent } from './router'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useAgentRunStore } from '@/lib/test/doubles/agent-run-store'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useSessionExecutionState } from '@/lib/test/doubles/session-execution-state'
import { useSlackAgentBot } from '@/lib/test/doubles/slack-agent-bot'

const teamId = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const userId = 'bbbbbbbbbbbbbbbbbbbbbbbb'
let run: { streamId: string; startedAt: string } | null = null
let probes = 0
let probed: { state: string; schemaVersion?: number } = { state: 'active', schemaVersion: 2 }
let requestedTail: number | undefined

useIdentity({
  authenticateToken: async () => ({ user: { id: userId } }),
  getTeamMembership: async () => ({ role: 'MEMBER' }),
  getTeamMembers: async () => [{ id: userId, name: 'Owner', email: '', avatarURL: '' }],
})
useAgentDb({
  getConversationWithMessages: async (
    _sessionId: string,
    _userId: string,
    _teamId?: string,
    options?: { tail?: number },
  ) => {
    requestedTail = options?.tail

    return {
      conversation: { sessionId: 'open-probe', userId, teamId, title: 'Chat' },
      messages: [],
    }
  },
})
useAgentRunStore({ getActiveAgentRunForSession: async () => run })
useSessionExecutionState({
  conversationExecutionState: async () => {
    probes++

    return probed
  },
})
useSlackAgentBot({ getSlackAgentThreadBySessionId: async () => null })

const app = new Hono().route('/agent', agent)
const open = (query: string) =>
  app.request(`/agent/conversations/open-probe?teamId=${teamId}&tail=30${query}`, {
    headers: { authorization: 'Bearer test-token' },
  })

beforeEach(() => {
  run = null
  probes = 0
  probed = { state: 'active', schemaVersion: 2 }
  requestedTail = undefined
})

test('opening without a run skips the runtime probe and answers like the list', async () => {
  const body = (await (await open('&runtimeState=omit')).json()) as Record<string, unknown>

  expect(probes).toBe(0)
  expect((body.runtimeState as { state: string }).state).toBe('dormant')
  expect(body.activeRun).toBeNull()
})

test('an unreachable runtime answers like the list, never "disconnected"', async () => {
  probed = { state: 'disconnected' }
  const idle = (await (await open('')).json()) as Record<string, unknown>

  expect(probes).toBe(1)
  expect((idle.runtimeState as { state: string }).state).toBe('dormant')

  run = { streamId: 'stream-1', startedAt: '1700000000000' }
  const running = (await (await open('')).json()) as Record<string, unknown>

  expect((running.runtimeState as { state: string }).state).toBe('active')
  expect((running.activeRun as { streamId: string }).streamId).toBe('stream-1')
})

test('opening with a run still confirms it against the runtime', async () => {
  run = { streamId: 'stream-1', startedAt: '1700000000000' }
  const body = (await (await open('&runtimeState=omit')).json()) as Record<string, unknown>

  expect(probes).toBe(1)
  expect((body.activeRun as { streamId: string }).streamId).toBe('stream-1')
})

test('polls without the flag keep reading runtime state', async () => {
  const body = (await (await open('')).json()) as Record<string, unknown>

  expect(probes).toBe(1)
  expect((body.runtimeState as { state: string }).state).toBe('active')
})

test('a status poll with messages=omit reads no messages', async () => {
  await open('&messages=omit')
  expect(requestedTail).toBe(0)

  await open('')
  expect(requestedTail).toBe(30)
})
