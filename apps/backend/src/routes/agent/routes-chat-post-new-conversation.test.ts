// A new conversation is stored before its run is accepted: the app takes the
// run's first frame to mean the chat exists and reads it from then on (#2168).
import { beforeEach, expect, test } from 'bun:test'
import { Hono } from 'hono'

import { errorHandler } from '@/lib/errors'
import { useAgentChatRuntime } from '@/lib/test/doubles/agent-chat-runtime'
import { useAgentTranscript } from '@/lib/test/doubles/agent-transcript'
import { useAuthMiddleware } from '@/lib/test/doubles/auth-middleware'
import { useChatConversation } from '@/lib/test/doubles/chat-conversation'
import { useChatPreviewResume } from '@/lib/test/doubles/chat-preview-resume'
import { useChatPreviewTurn } from '@/lib/test/doubles/chat-preview-turn'
import { useChatSlackBound } from '@/lib/test/doubles/chat-slack-bound'
import { useChatValidate } from '@/lib/test/doubles/chat-validate'
import { useSessionQueueSignIn } from '@/lib/test/doubles/session-queue-sign-in'
import { useSessionQueueTurn } from '@/lib/test/doubles/session-queue-turn'
import { useTeamScope } from '@/lib/test/doubles/team-scope'
import { real as frame, useTurnStartFrame } from '@/lib/test/doubles/turn-start-frame'

const USER = '64b5f1c2e4b0a1d2c3e4f5a6'
const order: string[] = []
const state = {
  conversation: null as unknown,
  teamId: 'team-1' as string | undefined,
  persistFails: false,
  released: 0,
}

useAuthMiddleware({
  requireAuth: async (c: { set: (k: string, v: string) => void }, next: () => Promise<void>) => {
    c.set('userId', USER)
    await next()
  },
})
useTeamScope({ resolveVerifiedTeamId: () => Promise.resolve(state.teamId) })
useChatConversation({ resolveChatConversation: () => Promise.resolve(state.conversation) })
useChatValidate({
  validateChatBody: () => {},
  acceptClientTail: (body) => Promise.resolve(body.messages),
})
useSessionQueueSignIn({ queueForSignIn: () => Promise.resolve(null) })
useAgentChatRuntime({
  resolveConversationChatRuntime: () =>
    Promise.resolve({ runtime: 'claude-code', endpoint: { url: 'ws://runtime', authKey: 'k' } }),
})
useChatPreviewResume({ resolvePreviewWaitFromChat: () => Promise.resolve(null) })
useSessionQueueTurn({
  admitQueueableChat: () =>
    Promise.resolve({
      mode: 'run',
      release: () => {
        state.released++
      },
      item: undefined,
    }),
})
useChatSlackBound({
  findSlackBoundThread: () => Promise.resolve(null),
  buildSlackBoundTurnPlan: () => Promise.resolve(null),
})
useTurnStartFrame({
  acceptAgentRun: (...args) => {
    order.push('accept')
    frame.acceptAgentRun(...args)
  },
})
useChatPreviewTurn({
  runClaudeCodePreviewChatTurn: () => {
    order.push('prompt')

    return Promise.resolve()
  },
})
const installTranscript = useAgentTranscript({})

await import('./routes-chat-post')
const { agent } = await import('./router')
const { agentRunKey, agentRuns } = await import('./run-registry')

const app = new Hono().route('/agent', agent).onError(errorHandler)

function post(id: string) {
  return app.request('/agent/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id,
      streamId: `stream-${id}`,
      teamId: 'team-1',
      messages: [{ id: 'm1', role: 'user', parts: [{ type: 'text', text: 'hi' }] }],
    }),
  })
}

async function settled(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100 && !predicate(); attempt++) await Bun.sleep(2)
  expect(predicate()).toBe(true)
}

beforeEach(() => {
  order.length = 0
  state.conversation = null
  state.teamId = 'team-1'
  state.persistFails = false
  state.released = 0
  installTranscript({
    persistAcceptedConversationTurn: async () => {
      order.push('persist')
      // Resolve on a later tick, so an accept that did not wait would come first.
      await Bun.sleep(5)
      if (state.persistFails) throw new Error('database unavailable')

      return { isNew: true }
    },
  })
})

test('a new conversation is stored once, before its run is accepted', async () => {
  const response = await post('new-1')

  expect(response.status).toBe(200)
  void response.body?.cancel().catch(() => {})
  await settled(() => order.includes('prompt'))
  expect(order).toEqual(['persist', 'accept', 'prompt'])
})

test('a store that fails is the request error: no run, no frame, the claim released', async () => {
  state.persistFails = true
  const response = await post('new-fail')

  expect(response.status).toBeGreaterThanOrEqual(500)
  expect(order).toEqual(['persist'])
  expect(agentRuns.get(agentRunKey(USER, 'stream-new-fail'))).toBeUndefined()
  expect(state.released).toBe(1)
})

test('an existing conversation is accepted first and stored by the turn, as before', async () => {
  state.conversation = { sessionId: 'old-1', userId: USER, teamId: 'team-1' }
  const response = await post('old-1')

  void response.body?.cancel().catch(() => {})
  await settled(() => order.includes('prompt'))
  expect(order).toEqual(['accept', 'persist', 'prompt'])
})

test('a new conversation without a team is refused before anything is written', async () => {
  state.teamId = undefined
  const response = await post('new-no-team')

  expect(response.status).toBe(400)
  expect(order).toEqual([])
  expect(state.released).toBe(1)
})
