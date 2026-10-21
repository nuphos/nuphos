// Runs the real backend/host attachment protocol on Windows without production credentials.
// Bundle with `bun build --target=node scripts/windows-attachment-e2e.ts --outfile /tmp/attachment-e2e.mjs`.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const { createLocalTunnelBus } = await import('../src/lib/agent/devices/local-runtime/bus')
const { attachRuntimeTunnel } = await import('../src/lib/agent/devices/local-runtime/holder')
const { createMemoryPresenceStore } =
  await import('../src/lib/agent/devices/local-runtime/presence')
const { localAttachments } = await import('../src/lib/claude-code-preview/local-attachments')
const { attachmentFileUrl } = await import('../src/lib/claude-code-preview/attachment-path')
const { LocalAttachmentStream } =
  await import('../../desktop/electron/main/local-runtime/attachment-stream.ts')

const program = process.argv[2]

assert.ok(program, 'Pass the locally bundled attachment-job.mjs path')
const workspace = await mkdtemp(join(tmpdir(), 'Nuphos attachment 空白 '))
const bus = createLocalTunnelBus()
const presence = createMemoryPresenceStore()
const streams = new Map<string, InstanceType<typeof LocalAttachmentStream>>()
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAIAAAD8GO2jAAAAKElEQVR4nO3NsQ0AAAzCMP5/un0CNkuZ41wybXsHAAAAAAAAAAAAxR4yw/wuPL6QkAAAAABJRU5ErkJggg==',
  'base64',
)
const server = createServer((_request, response) => response.end(png))

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()

assert.ok(address && typeof address !== 'string')
const tunnel = await attachRuntimeTunnel(
  'owner',
  'device',
  {
    send(frame) {
      if (frame.t === 'open') {
        assert.equal(frame.purpose, 'attachments')
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
await new Promise((resolve) => setTimeout(resolve, 10))
try {
  const output = await localAttachments(
    'team',
    'owner',
    'local_owner_device',
    ['圖片 space.png', 'report?.png', 'CON.png', 'trailing. ', '圖'.repeat(300)].map((name) => ({
      name,
      url: `http://127.0.0.1:${address.port}/image`,
      size: png.length,
    })),
    { bus, presence },
  )
  const { paths } = JSON.parse(output!)

  assert.equal(paths.length, 5)
  for (const path of paths) assert.deepEqual(await readFile(path), png)
  const uri = attachmentFileUrl(paths[0])

  assert.ok(uri?.startsWith('file:///'))
  let agentResult: string | undefined
  const cli = process.argv[3]

  if (cli) {
    const { stdout } = await promisify(execFile)(
      cli,
      [
        '-p',
        `Use Read to inspect the PNG at ${paths[0]}. Reply only with its dominant color. Do not run commands or modify files.`,
        '--allowedTools',
        'Read',
        '--max-turns',
        '3',
        '--output-format',
        'json',
      ],
      { cwd: workspace, timeout: 90_000, maxBuffer: 1024 * 1024 },
    )

    agentResult = JSON.parse(stdout).result
    assert.match(agentResult!, /red|紅/iu)
  }
  console.log(
    JSON.stringify({ agentResult, platform: process.platform, passed: true, path: paths[0], uri }),
  )
} finally {
  for (const stream of streams.values()) stream.close()
  tunnel.closed()
  server.closeAllConnections()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  await rm(workspace, { recursive: true, force: true })
}
