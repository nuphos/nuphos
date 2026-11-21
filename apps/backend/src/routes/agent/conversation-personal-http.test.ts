import '@/routes/agent'

import { expect, test } from 'bun:test'
import { Hono } from 'hono'

import { agent } from './router'

import { useAgentDb } from '@/lib/test/doubles/agent-db'
import { useAgentRunStore } from '@/lib/test/doubles/agent-run-store'
import { useIdentity } from '@/lib/test/doubles/identity'
import { useSessionExecutionState } from '@/lib/test/doubles/session-execution-state'
import { useSlackAgentBot } from '@/lib/test/doubles/slack-agent-bot'

const teamId = 'aaaaaaaaaaaaaaaaaaaaaaaa'
const owner = 'bbbbbbbbbbbbbbbbbbbbbbbb'
const teammate = 'cccccccccccccccccccccccc'
const A = 'a1'.repeat(12)
const B = 'b2'.repeat(12)
const access = { personalCredentialIds: ['github'], personalConnectionIds: [A, B] }
const docs: Record<string, Record<string, unknown>> = {
  bot: {
    sessionId: 'bot',
    userId: owner,
    teamId,
    title: 'Bot',
    participantIds: [teammate],
    credentialAccess: access,
  },
  task: {
    sessionId: 'task',
    userId: owner,
    teamId,
    title: 'Task',
    participantIds: [teammate],
    credentialAccess: access,
  },
}

useIdentity({
  authenticateToken: async (token: string) => ({ user: { id: token } }),
  getTeamMembership: async () => ({ role: 'MEMBER' }),
  getTeamMembers: async () => [
    { id: owner, name: 'Owner', email: '', avatarURL: '' },
    { id: teammate, name: 'Teammate', email: '', avatarURL: '' },
  ],
})
useAgentDb({
  getConversationWithMessages: async (sessionId: string) => ({
    conversation: docs[sessionId],
    messages: [],
  }),
  getConversationBySessionId: async (sessionId: string) => docs[sessionId] ?? null,
})
useAgentRunStore({ getActiveAgentRunForSession: async () => null })
useSessionExecutionState({ conversationExecutionState: async () => ({ state: 'active' }) })
useSlackAgentBot({ getSlackAgentThreadBySessionId: async () => null })

const app = new Hono().route('/agent', agent)
const read = async (as: string, sessionId: string) => {
  const res = await app.request(`/agent/conversations/${sessionId}?teamId=${teamId}`, {
    headers: { authorization: `Bearer ${as}` },
  })

  expect(res.status).toBe(200)

  return res.text()
}

for (const sessionId of ['bot', 'task']) {
  test(`the owner reads a ${sessionId}'s account ids, a teammate only a count`, async () => {
    const mine = JSON.parse(await read(owner, sessionId)) as {
      credentialAccess: Record<string, unknown>
    }
    const theirs = await read(teammate, sessionId)
    const parsed = JSON.parse(theirs) as { credentialAccess: Record<string, unknown> }

    expect(mine.credentialAccess.personalConnectionIds).toEqual([A, B])
    expect(parsed.credentialAccess.personalAccountCount).toBe(2)
    expect('personalConnectionIds' in parsed.credentialAccess).toBe(false)
    expect(theirs).not.toContain(A)
    expect(theirs).not.toContain(B)
  })
}
