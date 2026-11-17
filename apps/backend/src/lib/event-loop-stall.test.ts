import { afterEach, expect, test } from 'bun:test'

import { serving, startEventLoopStallLog, trackInFlight } from './event-loop-stall'

type Line = { event: string; properties: Record<string, unknown> }

let stop: (() => void) | undefined

afterEach(() => stop?.())

const block = (ms: number) => {
  const end = performance.now() + ms

  while (performance.now() < end);
}
const tick = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

test('a stall names its length and the requests in flight during it', async () => {
  const lines: Line[] = []

  stop = startEventLoopStallLog((_level, event, properties) => {
    lines.push({ event, properties: properties ?? {} })
  })
  const done = trackInFlight('POST', '/teams/t-1/agent/chat')

  await tick(150)
  block(700)
  await tick(150)
  done()

  expect(lines).toHaveLength(1)
  expect(lines[0]?.event).toBe('backend.event_loop.stalled')
  expect(lines[0]?.properties.stall_ms).toBeGreaterThanOrEqual(500)
  expect(lines[0]?.properties.in_flight_count).toBe(1)
  expect(String(lines[0]?.properties.in_flight)).toContain('POST /teams/t-1/agent/chat')
  expect(lines[0]?.properties.heap_used_mb).toBeGreaterThan(0)
})

test('short delays are not logged, and stalls are logged at most once per 10 s', async () => {
  const lines: Line[] = []

  stop = startEventLoopStallLog((_level, event, properties) => {
    lines.push({ event, properties: properties ?? {} })
  })
  await tick(150)
  block(200)
  await tick(150)
  expect(lines).toHaveLength(0)

  block(700)
  await tick(150)
  block(700)
  await tick(150)
  expect(lines).toHaveLength(1)
})

test('a finished request is no longer in flight', async () => {
  const lines: Line[] = []

  stop = startEventLoopStallLog((_level, event, properties) => {
    lines.push({ event, properties: properties ?? {} })
  })
  trackInFlight('GET', '/health')()
  await tick(150)
  block(700)
  await tick(150)

  expect(lines[0]?.properties.in_flight_count).toBe(0)
})

test('a stall during a background job names the job', async () => {
  const lines: Line[] = []

  stop = startEventLoopStallLog((_level, event, properties) => {
    lines.push({ event, properties: properties ?? {} })
  })
  await serving('job', 'run-trigger', async () => {
    await tick(150)
    block(700)
    await tick(150)
  })

  expect(String(lines[0]?.properties.in_flight)).toContain('job run-trigger')
})
