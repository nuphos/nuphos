import '@/routes/agent'

import { expect, test } from 'bun:test'

import { usePosthog } from '@/lib/test/doubles/posthog'
import { useRedis } from '@/lib/test/doubles/redis'

const phases: unknown[] = []

useRedis({ redisEnabled: () => false, withRedis: () => Promise.resolve(null) })
usePosthog({
  capture: (_event, options) => {
    phases.push(options?.properties?.phase)
  },
})

const { appendAgentRunDone, appendAgentRunTurnComplete, finishAgentRun } =
  await import('./run-frames')
const { createAgentRun } = await import('./run-registry')

// The end of a run is one lifecycle event, run.finished (error_frame_appended for a failed one).
// Each terminal frame used to add another, twice per run, with nothing the others lack.
test('a run that ends reports its end once', () => {
  const run = createAgentRun('user-a', 'session-a', 'stream-a')

  phases.length = 0
  appendAgentRunTurnComplete(run)
  appendAgentRunDone(run)
  finishAgentRun(run)

  expect(phases.filter((phase) => String(phase).startsWith('agent.chat.run.'))).toEqual([
    'agent.chat.run.finished',
  ])
})
