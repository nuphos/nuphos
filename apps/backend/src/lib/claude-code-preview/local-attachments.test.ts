import { expect, test } from 'bun:test'

import { createLocalTunnelBus } from '../agent/devices/local-runtime/bus'
import { attachRuntimeTunnel } from '../agent/devices/local-runtime/holder'
import { createMemoryPresenceStore } from '../agent/devices/local-runtime/presence'

import { localAttachments } from './local-attachments'

import type { TunnelBus } from '../agent/devices/local-runtime/bus'
import type { RuntimeTunnel } from '../agent/devices/local-runtime/holder'
import type { LocalRuntimePresenceStore } from '../agent/devices/local-runtime/presence'

/**
 * A Desktop holding a tunnel on `device`, with `client` as what it said it is.
 * An attachments stream opened on it answers with `paths`.
 */
async function desktopTunnel(
  client: string | undefined,
  paths: string[] = ['/workspace/image.png'],
): Promise<{
  presence: LocalRuntimePresenceStore
  bus: TunnelBus
  tunnel: RuntimeTunnel
  opened: () => boolean
  sent: unknown[]
}> {
  const bus = createLocalTunnelBus()
  const presence = createMemoryPresenceStore()
  const sent: unknown[] = []
  let opened = false
  const tunnel = await attachRuntimeTunnel(
    'owner',
    'device',
    {
      send(frame) {
        if (frame.t === 'open') {
          opened = true
          tunnel.receive(JSON.stringify({ t: 'opened', s: frame.s }))
        } else if (frame.t === 'data') {
          sent.push(JSON.parse(frame.d))
          tunnel.receive(JSON.stringify({ t: 'data', s: frame.s, d: JSON.stringify({ paths }) }))
        }
      },
      close() {},
    },
    { bus, presence, isMember: async () => true, heartbeatMs: 60_000 },
    client,
  )

  tunnel.receive(JSON.stringify({ t: 'status', status: { agents: {}, localAttachments: true } }))
  tunnel.receive(JSON.stringify({ t: 'pong' }))
  await new Promise((resolve) => setTimeout(resolve, 5))

  return { presence, bus, tunnel, opened: () => opened, sent }
}

test('a Desktop that cannot take a value inline is refused as outdated, not as a failure', async () => {
  const desktop = await desktopTunnel('nuphos-desktop/0.94.0')
  const files = [
    {
      name: 'API_KEY',
      url: `data:application/octet-stream;base64,${Buffer.from('sk-live').toString('base64')}`,
      size: 7,
    },
  ]

  try {
    const failed = localAttachments('team', 'owner', 'local_owner_device', files, {
      bus: desktop.bus,
      presence: desktop.presence,
    })

    await expect(failed).rejects.toMatchObject({
      status: 409,
      code: 'runtime_outdated',
      message: expect.stringContaining('Nuphos Desktop 0.95.0 or later'),
    })
    // Refused before anything crosses: the old Desktop never sees the value.
    expect(desktop.opened()).toBe(false)
  } finally {
    desktop.tunnel.closed()
  }
})

test('the first Desktop that takes an inline value saves it, and later ones still work', async () => {
  for (const client of ['nuphos-desktop/0.95.0', 'nuphos-desktop/0.99.0']) {
    const desktop = await desktopTunnel(client)
    const files = [
      {
        name: 'API_KEY',
        url: `data:application/octet-stream;base64,${Buffer.from('sk-live').toString('base64')}`,
        size: 7,
      },
    ]

    try {
      const output = await localAttachments('team', 'owner', 'local_owner_device', files, {
        bus: desktop.bus,
        presence: desktop.presence,
      })

      expect(output).toBe(JSON.stringify({ paths: ['/workspace/image.png'] }))
      expect(desktop.sent).toEqual([{ files }])
    } finally {
      desktop.tunnel.closed()
    }
  }
})

test('an old Desktop keeps carrying ordinary attachments, and an unknown host is never guessed at', async () => {
  const files = [{ name: 'image.png', url: 'https://store.example/signed', size: 5 }]

  for (const client of ['nuphos-desktop/0.94.0', undefined, 'nuphos-cli/0.3.0', 'other/0.94.0']) {
    const desktop = await desktopTunnel(client)

    try {
      const output = await localAttachments('team', 'owner', 'local_owner_device', files, {
        bus: desktop.bus,
        presence: desktop.presence,
      })

      expect(output).toBe(JSON.stringify({ paths: ['/workspace/image.png'] }))
      expect(desktop.sent).toEqual([{ files }])
    } finally {
      desktop.tunnel.closed()
    }
  }
})

test('a version that is not a stable release is left alone', async () => {
  for (const client of ['nuphos-desktop/0.94.0-beta.1', 'nuphos-desktop/dev', 'nuphos-desktop/']) {
    const desktop = await desktopTunnel(client)
    const files = [{ name: 'API_KEY', url: 'data:application/octet-stream;base64,AAAA', size: 3 }]

    try {
      const output = await localAttachments('team', 'owner', 'local_owner_device', files, {
        bus: desktop.bus,
        presence: desktop.presence,
      })

      expect(output).toBe(JSON.stringify({ paths: ['/workspace/image.png'] }))
    } finally {
      desktop.tunnel.closed()
    }
  }
})

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
