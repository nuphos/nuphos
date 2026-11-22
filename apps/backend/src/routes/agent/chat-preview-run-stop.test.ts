import '@/routes/agent'

import { expect, test } from 'bun:test'

import { useRedis } from '@/lib/test/doubles/redis'

useRedis({ redisEnabled: () => false })

const { createPreviewRunState } = await import('./chat-preview-run')
const { createAgentRun, registerAgentRun } = await import('./run-registry')
const { stopConversationTurn } = await import('./run-cancel')

test('a Stop that arrives while the turn is still being saved stops the turn', async () => {
  const run = createAgentRun('u1', 'conv-stop', 'st-stop', {
    requestId: 'req-stop',
    userId: 'u1',
    sessionId: 'conv-stop',
    streamId: 'st-stop',
    route: '/agent/chat',
    method: 'POST',
  })

  registerAgentRun(run)
  // The Stop lands before the turn reaches its runtime: the run is accepted, its turn not started.
  await stopConversationTurn({ userId: 'u1', sessionId: 'conv-stop' } as never).catch(() => null)
  expect(run.abortController.signal.aborted).toBe(true)

  const state = createPreviewRunState({ run, userId: 'u1', sessionId: 'conv-stop' })

  expect(state.signal.aborted).toBe(true)
})
