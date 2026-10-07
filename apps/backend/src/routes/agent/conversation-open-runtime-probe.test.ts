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

useIdentity({
  authenticateToken: async () => ({ user: { id: userId } }),
  getTeamMembership: async () => ({ role: 'MEMBER' }),
  getTeamMembers: async () => [{ id: userId, name: 'Owner', email: '', avatarURL: '' }],
})
useAgentDb({
  getConversationWithMessages: async () => ({
    conversation: { sessionId: 'open-probe', userId, teamId, title: 'Chat' },
    messages: [],
  }),
})
useAgentRunStore({ getActiveAgentRunForSession: async () => run })
useSessionExecutionState({
  conversationExecutionState: async () => {
    probes++

    return { state: 'active', schemaVersion: 2 }
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
})

test('opening without a run skips the runtime probe', async () => {
  const body = (await (await open('&runtimeState=omit')).json()) as Record<string, unknown>

  expect(probes).toBe(0)
  expect(body.runtimeState).toBeUndefined()
  expect(body.activeRun).toBeNull()
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
