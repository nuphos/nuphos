import { beforeEach, describe, expect, test } from 'bun:test'

import { useRedis } from '@/lib/test/doubles/redis'
import { useFakeRuntimeRequests } from '@/lib/test/doubles/runtime-request-store'

useRedis({ redisEnabled: () => false, withRedis: async () => null })

const { registerPreviewWait, resetLocalPreviewWaits, resolvePreviewDecision } =
  await import('./decision-waiter')
const { watchPreviewTurnPauses } = await import('./preview-turn-pause')

beforeEach(() => resetLocalPreviewWaits())

describe('watchPreviewTurnPauses', () => {
  test('reports each wait once as a pause and once as a resume, leaving agent permissions to the bridge', async () => {
    const events: string[] = []
    const controller = new AbortController()
    const watching = watchPreviewTurnPauses({
      userId: 'u1',
      sessionId: 'conv-1',
      signal: controller.signal,
      pollMs: 5,
      onPause: (wait) => {
        events.push(`pause:${wait.kind}`)
      },
      onResume: (wait, decision) => {
        events.push(`resume:${wait.kind}:${String(decision.streamId)}`)
      },
    })

    await registerPreviewWait({
      userId: 'u1',
      sessionId: 'conv-1',
      kind: 'agent-permission',
      ref: 'tool-1',
    })
    const wait = await registerPreviewWait({
      userId: 'u1',
      sessionId: 'conv-1',
      kind: 'permission-grant',
    })

    await new Promise((resolve) => setTimeout(resolve, 30))
    await resolvePreviewDecision({
      userId: 'u1',
      sessionId: 'conv-1',
      waitId: wait.waitId,
      payload: { decision: 'approved' },
      streamId: 'st-9',
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    controller.abort()
    await watching

    expect(events).toEqual(['pause:permission-grant', 'resume:permission-grant:st-9'])
  })
})

useFakeRuntimeRequests()
