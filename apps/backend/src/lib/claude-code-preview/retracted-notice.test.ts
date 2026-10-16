import { beforeEach, expect, test } from 'bun:test'

import { RETRACTED_NOTICE, retractedPrompt } from './retracted-notice'

import type { TeamSession } from './team-openab-runtime'

import { useAgentDb } from '@/lib/test/doubles/agent-db'

let marked = false

useAgentDb({
  consumeConversationRetracted: async () => {
    const was = marked

    marked = false

    return was
  },
})
beforeEach(() => {
  marked = true
})
const session = { conversationId: 's1', teamId: 't1' } as TeamSession

test('the next prompt in the same session is told once to disregard the taken-back message', async () => {
  expect(await retractedPrompt(session, false)).toBe(RETRACTED_NOTICE)
  expect(await retractedPrompt(session, false)).toBe('')
})

test('a fresh session rebuilt from the transcript never saw it, so says nothing', async () => {
  expect(await retractedPrompt(session, true)).toBe('')
  expect(marked).toBe(false)
})
