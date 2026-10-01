// The transcript PUT has delete-absent semantics, so for Slack-bound
// conversations it must be refused SERVER-side (routes-conversations-
// mutations.ts checks this guard before syncing): any client view that missed
// a Slack-side exchange — old desktop builds without the renderer guard, or a
// tab that went stale mid-session — would otherwise erase those messages
// permanently.
import { beforeEach, describe, expect, test } from 'bun:test'

import { useSlackAgentBot } from '@/lib/test/doubles/slack-agent-bot'

const SESSION_ID = 'sess-transcript-guard-1'

const state: { thread: 'bound' | 'unbound' | 'error' } = { thread: 'unbound' }

useSlackAgentBot({
  getSlackAgentThreadBySessionId: async () => {
    if (state.thread === 'error') throw new Error('thread store down')

    return state.thread === 'bound' ? ({ sessionId: SESSION_ID } as never) : null
  },
})

const { isTranscriptSyncBlockedBySlackBinding } = await import('./chat-slack-bound')

beforeEach(() => {
  state.thread = 'unbound'
})

describe('isTranscriptSyncBlockedBySlackBinding', () => {
  test('an ordinary conversation syncs as before', async () => {
    expect(await isTranscriptSyncBlockedBySlackBinding(SESSION_ID)).toBe(false)
  })

  test('a Slack-bound conversation is blocked from the delete-absent sync', async () => {
    state.thread = 'bound'
    expect(await isTranscriptSyncBlockedBySlackBinding(SESSION_ID)).toBe(true)
  })

  test('a failed binding lookup fails closed (skip, do not delete)', async () => {
    state.thread = 'error'
    expect(await isTranscriptSyncBlockedBySlackBinding(SESSION_ID)).toBe(true)
  })
})
