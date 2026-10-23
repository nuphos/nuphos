import { afterEach, expect, test } from 'bun:test'

import { readBoxMetrics } from './box-metrics'
import { createLocalTunnelBus } from './local-runtime/bus'
import { attachRuntimeTunnel } from './local-runtime/holder'
import { createMemoryPresenceStore } from './local-runtime/presence'
import { holderChannel } from './local-runtime/protocol'

import type { RuntimeTunnel } from './local-runtime/holder'
import type { BackendFrame } from './local-runtime/protocol'

const sample = {
  sampledAt: new Date().toISOString(),
  cpuPercent: 25,
  memory: { used: 2, total: 4 },
  disk: { used: 3, total: 8 },
}
const tunnels: RuntimeTunnel[] = []
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
  for (const tunnel of tunnels.splice(0)) tunnel.closed()
})

test('offline and old hosts never open a connection or lease', async () => {
  const bus = createLocalTunnelBus()
  const presence = createMemoryPresenceStore()
  const messages: string[] = []
  const unsubscribe = await bus.subscribe(holderChannel('u', 'd'), (raw) => messages.push(raw))
  const deps = { bus, presence }

  expect((await readBoxMetrics('u', 'd', true, deps)).metricsStatus).toBe('offline')
  await presence.claim('u', 'd', 'c')
  await presence.put('u', 'd', { conn: 'c', seenAt: Date.now(), status: { agents: {} } })
  expect((await readBoxMetrics('u', 'd', true, deps)).metricsStatus).toBe('unsupported')
  await tick()
  expect(messages).toEqual([])
  unsubscribe()
})

test('a host report is live on the first read; demand still reaches older hosts', async () => {
  const bus = createLocalTunnelBus()
  const presence = createMemoryPresenceStore()
  const frames: BackendFrame[] = []
  const tunnel = await attachRuntimeTunnel(
    'u',
    'd',
    {
      send: (frame) => frames.push(frame),
      close: () => {
        /* No transport is opened in this in-process test. */
      },
    },
    { bus, presence, isMember: () => Promise.resolve(true), heartbeatMs: 60_000 },
  )

  tunnels.push(tunnel)
  tunnel.receive(JSON.stringify({ t: 'status', status: { agents: {}, localMetrics: true } }))
  tunnel.receive(JSON.stringify({ t: 'pong' }))
  await tick()
  const deps = { bus, presence }

  expect((await readBoxMetrics('u', 'd', false, deps)).metricsStatus).toBe('waiting')
  // Hosts report without being asked, so the first look already has a live reading.
  tunnel.receive(JSON.stringify({ t: 'metrics', metrics: sample }))
  await tick()
  const reading = await readBoxMetrics('u', 'd', false, deps)

  expect(reading.metricsStatus).toBe('live')
  expect(reading.metrics).toEqual(sample)
  expect(reading.metricsReceivedAt).not.toBeNull()
  const receivedAt = Date.parse(reading.metricsReceivedAt!)

  expect(
    (await readBoxMetrics('u', 'd', false, { ...deps, now: () => receivedAt + 12_000 }))
      .metricsStatus,
  ).toBe('stale')
  tunnel.receive(JSON.stringify({ t: 'metrics', metrics: { ...sample, cpuPercent: 99 } }))
  await tick()
  expect((await presence.get('u', 'd'))?.metrics?.cpuPercent).toBe(99)
  expect(frames.some((f) => f.t === 'metrics')).toBe(false)
  await readBoxMetrics('u', 'd', true, deps)
  await tick()
  expect(frames.filter((f) => f.t === 'metrics')).toEqual([{ t: 'metrics', leaseMs: 12_000 }])
  tunnel.closed()
  await tick()
  expect((await readBoxMetrics('u', 'd', true, deps)).metricsStatus).toBe('offline')
})
