import { expect, test } from 'bun:test'

import { InstanceStreams } from '../../../../../../desktop/electron/main/local-runtime/instance-streams.ts'

import { createLocalTunnelBus } from './bus'
import { attachRuntimeTunnel } from './holder'
import { createLocalAgentInstance } from './instances'
import { createMemoryPresenceStore } from './presence'

/** Exercise the real backend and host stream envelopes together. No CLI or OAuth. */
test('backend create interoperates with the host management stream', async () => {
  const bus = createLocalTunnelBus()
  const presence = createMemoryPresenceStore()
  const metadata = {
    instanceId: '11111111-1111-4111-8111-111111111111',
    provider: 'claude-code' as const,
    label: 'Work',
  }
  const streams = new InstanceStreams(
    async (body) => {
      expect(body).toEqual({ method: 'create', ...metadata })

      return { instance: metadata }
    },
    (frame) => tunnel.receive(JSON.stringify(frame)),
  )

  const tunnel = await attachRuntimeTunnel(
    'owner',
    'box',
    {
      send(frame) {
        if (frame.t === 'open') {
          expect(frame.purpose).toBe('instances')
          streams.open(frame.s)
        } else if (frame.t === 'data') streams.data(frame.s, frame.d)
        else if (frame.t === 'close') streams.close(frame.s)
      },
      close() {},
    },
    { bus, presence, isMember: async () => true, heartbeatMs: 60_000 },
  )

  tunnel.receive(JSON.stringify({ t: 'status', status: { agents: {}, agentInstances: true } }))
  tunnel.receive(JSON.stringify({ t: 'pong' }))
  await new Promise((resolve) => setTimeout(resolve, 5))
  try {
    const result = await createLocalAgentInstance(
      { userId: 'owner', actorId: 'owner', deviceId: 'box', teamId: 'team' },
      metadata,
      { deps: { bus, presence } },
    )

    expect(result).toEqual(metadata)
  } finally {
    streams.clear()
    tunnel.closed()
  }
})
