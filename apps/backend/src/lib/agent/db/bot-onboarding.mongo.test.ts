import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'

import { closeDb, connectDb } from '@/lib/db'

import { getConversations } from './conversations-list'
import { updateBotSelf } from './maintenance'
import { resolveInputRequest } from './pending-decision'

import type { InputRequest } from './pending-decision'
import { agentConversations } from './shared'

const teamId = randomUUID()
const userId = randomUUID()
const question = (id: string, category: InputRequest['category'] = 'preference') => ({
  id,
  category,
  question: id,
  askedAt: new Date(),
  status: 'open' as const,
})
const seed = (sessionId: string, fields = {}) =>
  agentConversations().insertOne({
    sessionId,
    teamId,
    userId,
    avatar: '07-ada',
    title: sessionId,
    firstMessage: '',
    messageCount: 0,
    createdAt: new Date(),
    lastActiveAt: new Date(),
    ...fields,
  } as never)

describe.skipIf(!process.env.TEST_MONGODB_URI)('persisted Bot onboarding', () => {
  beforeAll(() => connectDb())
  afterAll(async () => {
    await agentConversations().deleteMany({ teamId })
    await closeDb()
  })

  test('setup stays answerable in chat and mixed approvals still enter the Inbox', async () => {
    await seed('setup-only', { botOnboarding: 'started', inputRequests: [question('purpose')] })
    await seed('mixed', {
      botOnboarding: 'started',
      inputRequests: [question('scope'), question('ship', 'approval')],
    })
    await seed('established', { inputRequests: [question('ordinary')] })
    const options = { teamId, pendingDecision: true }
    const inbox = (await getConversations(userId, options)).conversations

    expect(inbox.map((row) => row.sessionId).sort((a, b) => a.localeCompare(b))).toEqual([
      'established',
      'mixed',
    ])
    expect(inbox.find((row) => row.sessionId === 'mixed')?.inputRequests?.map((r) => r.id)).toEqual(
      ['ship'],
    )
    const chat = (await getConversations(userId, { ...options, includeOnboarding: true }))
      .conversations

    expect(chat.find((row) => row.sessionId === 'setup-only')?.inputRequests?.[0]?.id).toBe(
      'purpose',
    )
    expect(chat.find((row) => row.sessionId === 'mixed')?.inputRequests).toHaveLength(2)
  })

  test('completion atomically saves responsibilities only after setup questions close', async () => {
    await seed('complete', { botOnboarding: 'started', inputRequests: [question('confirm')] })
    const update = { instructions: 'Review release notes.', botOnboarding: 'completed' as const }

    expect(await updateBotSelf('complete', userId, teamId, update)).toBe(false)
    expect(await resolveInputRequest('complete', userId, 'confirm')).toBe(true)
    expect(await updateBotSelf('complete', 'someone-else', teamId, update)).toBe(false)
    expect(await updateBotSelf('complete', userId, 'another-team', update)).toBe(false)
    expect(await updateBotSelf('complete', userId, teamId, { botOnboarding: 'completed' })).toBe(
      false,
    )
    expect(await updateBotSelf('complete', userId, teamId, update)).toBe(true)
    expect(await agentConversations().findOne({ sessionId: 'complete', teamId })).toMatchObject(
      update,
    )
    await agentConversations().updateOne(
      { sessionId: 'complete', teamId },
      { $push: { inputRequests: question('next-work') } },
    )
    const inbox = (await getConversations(userId, { teamId, pendingDecision: true })).conversations

    expect(inbox.find((row) => row.sessionId === 'complete')?.inputRequests?.[0]?.id).toBe(
      'next-work',
    )
  })
})
