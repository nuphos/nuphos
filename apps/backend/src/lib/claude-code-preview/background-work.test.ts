import { beforeEach, expect, test } from 'bun:test'

import { backgroundWorkPrompt } from './background-work'

import type { TeamSession } from './team-openab-runtime'

import { useAgentDb } from '@/lib/test/doubles/agent-db'

let workLost: string | null = null

useAgentDb({
  consumeConversationWorkLost: async () => {
    const pending = workLost

    workLost = null

    return pending
  },
})

let session: TeamSession
const args = {
  message: 'Continue',
  freshSessionMessage: (uncertain?: boolean) => (uncertain ? 'hedged' : 'certain'),
}

beforeEach(() => {
  workLost = null
  session = { teamId: 'team', conversationId: 'conv' } as TeamSession
})

test('an ordinary turn prompts the message itself', async () => {
  expect(await backgroundWorkPrompt(session, false, args)).toBe('Continue')
})

test('a resume that answered the session is gone is stated as fact', async () => {
  workLost = 'session_lost'
  expect(await backgroundWorkPrompt(session, false, args)).toBe('certain')
})

test('giving up without an answer is hedged', async () => {
  workLost = 'unreachable'
  expect(await backgroundWorkPrompt(session, false, args)).toBe('hedged')
})

test('a session this turn had to create is fact, whatever was only suspected', async () => {
  // The inner session really is new, so a pending suspicion must not soften
  // what this turn already knows.
  workLost = 'unreachable'
  expect(await backgroundWorkPrompt(session, true, args)).toBe('certain')
})

test('the in-memory flag is consumed alongside the durable mark', async () => {
  session.innerSessionLost = true
  expect(await backgroundWorkPrompt(session, false, args)).toBe('certain')
  expect(session.innerSessionLost).toBe(false)
})

test('the mark is consumed even when nothing renders it', async () => {
  workLost = 'unreachable'
  expect(await backgroundWorkPrompt(session, false, { message: 'Continue' })).toBe('Continue')
  expect(workLost).toBeNull()
})
