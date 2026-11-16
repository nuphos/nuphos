import '@/routes/agent'

import { expect, test } from 'bun:test'

import { useAgentRunStore } from '@/lib/test/doubles/agent-run-store'
import { useRedis } from '@/lib/test/doubles/redis'

const mirrored: string[] = []

useRedis({ redisEnabled: () => false, withRedis: async () => null })
useAgentRunStore({
  mirrorAgentRunFrame: (_userId: string, _streamId: string, frame: string) => {
    mirrored.push(frame)
  },
})

const { appendAgentRunFrame } = await import('./run-frames')
const { createAgentRun } = await import('./run-registry')

const runtimeState = (phase: string, emittedAt: number) =>
  `data: ${JSON.stringify({ type: 'runtime-state', snapshot: { phase, commands: ['/help'] }, emittedAt })}\n\n`
const types = (frames: string[]) =>
  frames.map(
    (frame) =>
      (JSON.parse(frame.slice('data: '.length)) as { snapshot?: { phase: string } }).snapshot
        ?.phase ?? '',
  )

// A runtime re-sends its snapshot several times a second, mostly unchanged. A
// repeat tells no client anything new, so it is neither kept nor mirrored.
test('a runtime snapshot identical to the last one is dropped, live and mirrored', () => {
  const run = createAgentRun('user-a', 'session-a', 'stream-a')

  appendAgentRunFrame(run, runtimeState('working', 1))
  appendAgentRunFrame(run, runtimeState('working', 2))
  appendAgentRunFrame(run, runtimeState('tool', 3))
  appendAgentRunFrame(run, runtimeState('working', 4))

  expect(types(run.frames)).toEqual(['working', 'tool', 'working'])
  expect(types(mirrored)).toEqual(['working', 'tool', 'working'])
})

test('tool events between unchanged snapshots leave one snapshot frame', () => {
  const run = createAgentRun('user-b', 'session-b', 'stream-b')
  const tool = (i: number) =>
    `data: ${JSON.stringify({ type: 'tool-input-available', toolCallId: `call-${String(i)}` })}\n\n`

  for (let i = 0; i < 5; i++) {
    appendAgentRunFrame(run, tool(i))
    appendAgentRunFrame(run, runtimeState('working', i))
  }

  expect(run.frames.filter((frame) => frame.includes('"runtime-state"'))).toHaveLength(1)
  expect(run.frames).toHaveLength(6)
})
