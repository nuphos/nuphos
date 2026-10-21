import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from 'bun:test'

import { LocalAttachmentStream } from '../../../../desktop/electron/main/local-runtime/attachment-stream.ts'
import { createLocalTunnelBus } from '../agent/devices/local-runtime/bus'
import { attachRuntimeTunnel } from '../agent/devices/local-runtime/holder'
import { createMemoryPresenceStore } from '../agent/devices/local-runtime/presence'

import { localAttachments } from './local-attachments'

const program = fileURLToPath(new URL('./attachment-job.mjs', import.meta.url))

test('the real backend tunnel and fixed host downloader deliver bytes into a private workspace', async () => {
  const bus = createLocalTunnelBus()
  const presence = createMemoryPresenceStore()
  const workspace = await mkdtemp(join(tmpdir(), 'local attachments space '))
  const streams = new Map<string, LocalAttachmentStream>()
  const server = Bun.serve({ port: 0, fetch: () => new Response('image') })
  const tunnel = await attachRuntimeTunnel(
    'owner',
    'device',
    {
      send(frame) {
        if (frame.t === 'open') {
          expect(frame.purpose).toBe('attachments')
          const stream = new LocalAttachmentStream(workspace, program)

          streams.set(frame.s, stream)
          stream.addEventListener('open', () =>
            tunnel.receive(JSON.stringify({ t: 'opened', s: frame.s })),
          )
          stream.addEventListener('message', ({ data }) =>
            tunnel.receive(JSON.stringify({ t: 'data', s: frame.s, d: data })),
          )
          stream.addEventListener('close', () =>
            tunnel.receive(JSON.stringify({ t: 'close', s: frame.s })),
          )
        } else if (frame.t === 'data') streams.get(frame.s)?.send(frame.d)
        else if (frame.t === 'close') streams.get(frame.s)?.close()
      },
      close() {},
    },
    { bus, presence, isMember: async () => true, heartbeatMs: 60_000 },
  )

  tunnel.receive(JSON.stringify({ t: 'status', status: { agents: {}, localAttachments: true } }))
  tunnel.receive(JSON.stringify({ t: 'pong' }))
  await new Promise((resolve) => setTimeout(resolve, 5))
  try {
    const output = await localAttachments(
      'team',
      'owner',
      'local_owner_device',
      [{ name: 'image.png', url: server.url.href, size: 5 }],
      { bus, presence },
    )
    const result = JSON.parse(output!)

    expect(result.paths).toHaveLength(1)
    expect(await readFile(result.paths[0], 'utf8')).toBe('image')
    expect(result.paths[0]).toStartWith(join(workspace, '.nuphos-attachments'))
  } finally {
    for (const stream of streams.values()) stream.close()
    tunnel.closed()
    await server.stop(true)
    await rm(workspace, { recursive: true, force: true })
  }
})

test('old Desktop and cloud runtimes retain the existing job fallback', async () => {
  const deps = { bus: createLocalTunnelBus(), presence: createMemoryPresenceStore() }

  expect(await localAttachments('team', 'owner', 'cloud', [], deps)).toBeNull()
  expect(await localAttachments('team', 'owner', 'local_owner_device', [], deps)).toBeNull()
})
