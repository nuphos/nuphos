import { expect, test } from 'bun:test'

import { createLocalTunnelBus } from '../agent/devices/local-runtime/bus'
import { attachRuntimeTunnel } from '../agent/devices/local-runtime/holder'
import { createMemoryPresenceStore } from '../agent/devices/local-runtime/presence'

import { localAttachments } from './local-attachments'

test('a capable host receives only the attachment file list through its own purpose', async () => {
  const bus = createLocalTunnelBus()
  const presence = createMemoryPresenceStore()
  let received: unknown
  const tunnel = await attachRuntimeTunnel(
    'owner',
    'device',
    {
      send(frame) {
        if (frame.t === 'open') {
          expect(frame.purpose).toBe('attachments')
          tunnel.receive(JSON.stringify({ t: 'opened', s: frame.s }))
        } else if (frame.t === 'data') {
          received = JSON.parse(frame.d)
          tunnel.receive(
            JSON.stringify({
              t: 'data',
              s: frame.s,
              d: JSON.stringify({ paths: ['/workspace/image.png'] }),
            }),
          )
        }
      },
      close() {},
    },
    { bus, presence, isMember: async () => true, heartbeatMs: 60_000 },
  )

  tunnel.receive(JSON.stringify({ t: 'status', status: { agents: {}, localAttachments: true } }))
  tunnel.receive(JSON.stringify({ t: 'pong' }))
  await new Promise((resolve) => setTimeout(resolve, 5))
  const files = [{ name: 'image.png', url: 'https://store.example/signed', size: 5 }]

  try {
    const output = await localAttachments('team', 'owner', 'local_owner_device', files, {
      bus,
      presence,
    })

    expect(JSON.parse(output!)).toEqual({ paths: ['/workspace/image.png'] })
    expect(received).toEqual({ files })
  } finally {
    tunnel.closed()
  }
})

test('old Desktop and cloud runtimes retain the existing job fallback', async () => {
  const deps = { bus: createLocalTunnelBus(), presence: createMemoryPresenceStore() }

  expect(await localAttachments('team', 'owner', 'cloud', [], deps)).toBeNull()
  expect(await localAttachments('team', 'owner', 'local_owner_device', [], deps)).toBeNull()
})

test('the tunnel holder refuses attachment delivery after team membership is revoked', async () => {
  const bus = createLocalTunnelBus()
  const presence = createMemoryPresenceStore()
  let opened = false
  const tunnel = await attachRuntimeTunnel(
    'owner',
    'device',
    {
      send(frame) {
        if (frame.t === 'open') opened = true
      },
      close() {},
    },
    { bus, presence, isMember: async () => false, heartbeatMs: 60_000 },
  )

  tunnel.receive(JSON.stringify({ t: 'status', status: { agents: {}, localAttachments: true } }))
  tunnel.receive(JSON.stringify({ t: 'pong' }))
  await new Promise((resolve) => setTimeout(resolve, 5))
  try {
    await expect(
      localAttachments('team', 'owner', 'local_owner_device', [], { bus, presence }),
    ).rejects.toThrow('Could not prepare attachments')
    expect(opened).toBe(false)
  } finally {
    tunnel.closed()
  }
})
