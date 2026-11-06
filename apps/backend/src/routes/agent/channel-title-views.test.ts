import '@/routes/agent'

import { beforeEach, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useAgentRunStore } from '@/lib/test/doubles/agent-run-store'
import { useDb } from '@/lib/test/doubles/db'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useRedis } from '@/lib/test/doubles/redis'
import { useSessionExecutionState } from '@/lib/test/doubles/session-execution-state'
import { useSlackAgentBot } from '@/lib/test/doubles/slack-agent-bot'
import { portabilityDb } from '@/lib/test/runtime-portability-db'

import { serializeConversationList } from './conversations-list-view'
import { agent } from './router'

import type * as dbActual from '@/lib/db'

// An unnamed chat's title is each viewer's own view: the list and the detail
// both carry it, so no client has to work it out.
const teamId = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const ann = 'bbbbbbbbbbbbbbbbbbbbbbbb'
const bob = 'cccccccccccccccccccccccc'
let viewer = ann
let participantIds = [bob]
let memory = portabilityDb()

const chat = () => ({
  sessionId: 'chat',
  userId: ann,
  teamId,
  kind: 'channel' as const,
  title: '',
  participantIds,
  agentSessionIds: [],
})

useDb({ db: (() => memory) as unknown as typeof dbActual.db })
useRedis({ redisEnabled: () => false, withRedis: async () => null })
useIdentity({
  authenticateToken: async () => ({ user: { id: viewer } }),
  getTeamMembership: async () => ({ role: 'MEMBER' }),
  getTeamMembers: async () =>
    [
      { id: ann, name: 'Ann', email: '' },
      { id: bob, name: 'Bob', email: '' },
    ] as never,
})
useAgentDb({
  getConversationWithMessages: async () => ({ conversation: chat() as never, messages: [] }),
})
useAgentRunStore({ getActiveAgentRunForSession: async () => null })
useSessionExecutionState({ conversationExecutionState: async () => ({ state: 'idle' }) as never })
useSlackAgentBot({
  getSlackAgentThreadBySessionId: async () => null,
  getSlackAgentThreadsBySessionIds: async () => [],
})

const app = new Hono().route('/agent', agent)

beforeEach(() => {
  memory = portabilityDb()
  viewer = ann
  participantIds = [bob]
})

async function listed() {
  const [row] = (await serializeConversationList(
    [chat()] as never,
    { id: viewer } as never,
    teamId,
  )) as {
    title: string
  }[]

  return row?.title
}

async function opened() {
  const response = await app.request(`/agent/conversations/chat?teamId=${teamId}`, {
    headers: { authorization: 'Bearer test-token' },
  })

  return ((await response.json()) as { title: string }).title
}

test('each member sees an unnamed chat called by the other, in the list and the detail', async () => {
  expect(await listed()).toBe('Bob')
  expect(await opened()).toBe('Bob')
  viewer = bob
  expect(await listed()).toBe('Ann')
  expect(await opened()).toBe('Ann')
})

test('alone in an unnamed chat, the viewer sees their own name', async () => {
  participantIds = []
  expect(await listed()).toBe('Ann')
  expect(await opened()).toBe('Ann')
})
