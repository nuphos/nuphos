import { expect, test } from 'bun:test'

import { framesShowOutput } from './live-turn'

const frame = (event: Record<string, unknown>) => `data: ${JSON.stringify(event)}\n\n`

test('bookkeeping frames are not output', () => {
  expect(
    framesShowOutput([
      frame({ type: 'start' }),
      frame({ type: 'runtime-state' }),
      frame({ type: 'text-start' }),
      frame({ type: 'text-delta', delta: '  ' }),
    ]),
  ).toBe(false)
})

test('text, reasoning, a tool call or a steer is output', () => {
  for (const event of [
    { type: 'text-delta', delta: 'On it' },
    { type: 'reasoning-delta', delta: 'Thinking' },
    { type: 'tool-input-start', toolCallId: 't1' },
    { type: 'data-steering', data: {} },
  ])
    expect(framesShowOutput([frame(event)])).toBe(true)
})
