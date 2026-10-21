import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { LocalAttachmentStream } from './attachment-stream.ts'

const program = fileURLToPath(
  new URL('../../../../backend/src/lib/claude-code-preview/attachment-job.mjs', import.meta.url),
)

function request(stream: LocalAttachmentStream, input: object): Promise<unknown> {
  return new Promise((resolve) => {
    stream.addEventListener('open', () => stream.send(JSON.stringify(input)))
    stream.addEventListener('message', ({ data }) => resolve(JSON.parse(String(data))))
    stream.addEventListener('close', () => resolve(null))
  })
}

test('the fixed downloader handles spaces and Unicode paths without a shell or caller-supplied code', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'attachment space '))
  const server = createServer((_request, response) => response.end('red'))

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()

  assert.ok(address && typeof address !== 'string')
  try {
    const result = (await request(new LocalAttachmentStream(workspace, program), {
      files: [{ name: '../../圖片.png', url: `http://127.0.0.1:${address.port}/image`, size: 3 }],
      runner: 'throw new Error("caller code must never execute")',
      env: { NODE_OPTIONS: '--require=malicious' },
      workspace: '/caller-controlled-root',
    })) as { paths: string[] }

    assert.equal(result.paths.length, 1)
    assert.equal(await readFile(result.paths[0]!, 'utf8'), 'red')
    assert.ok(
      relative(join(workspace, '.nuphos-attachments'), result.paths[0]!).startsWith(
        'nuphos-attachments-',
      ),
    )
    assert.ok(result.paths[0]!.endsWith('圖片.png'))
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(workspace, { recursive: true, force: true })
  }
})

test('invalid requests are closed without running a downloader', async () => {
  for (const input of [
    { files: [{ name: 'x', url: 'file:///private', size: 1 }] },
    { files: [{ name: 'x', url: 'https://example.test', size: -1 }] },
    { files: 'not a file list' },
    { runner: 'arbitrary code' },
  ])
    assert.equal(await request(new LocalAttachmentStream('/unused', '/must-not-run'), input), null)
})

test('an absent bundle or unknown instance cannot open an attachment stream', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'attachment-instance-'))

  try {
    const state = { workspace, instances: [] } as never

    assert.equal(LocalAttachmentStream.open(state, workspace), null)
    await mkdir(join(workspace, 'bundle'))
    assert.equal(LocalAttachmentStream.open(state, workspace, 'unknown'), null)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})
