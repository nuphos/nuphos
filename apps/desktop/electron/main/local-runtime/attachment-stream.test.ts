import assert from 'node:assert/strict'
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
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

test('expired local batches are reclaimed without blocking new downloads on cleanup failure', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'attachment-retention-'))
  const root = join(workspace, '.nuphos-attachments')
  const expired = join(root, 'nuphos-attachments-expired')
  const recent = join(root, 'nuphos-attachments-recent')
  const unrelated = join(root, 'keep-other-directory')
  const locked = join(root, 'nuphos-attachments-locked')
  const canLock = process.platform !== 'win32' && process.getuid?.() !== 0
  const server = createServer((_request, response) => response.end('red'))

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()

  assert.ok(address && typeof address !== 'string')
  try {
    for (const dir of [expired, recent, unrelated]) {
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'keep.txt'), 'keep')
    }
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)

    await utimes(expired, old, old)
    await utimes(unrelated, old, old)
    if (canLock) {
      await mkdir(locked)
      await writeFile(join(locked, 'keep.txt'), 'locked')
      await utimes(locked, old, old)
      await chmod(locked, 0o500)
    }
    const names = ['image.png']
    const result = (await request(new LocalAttachmentStream(workspace, program), {
      files: names.map((name) => ({
        name,
        url: `http://127.0.0.1:${address.port}/image`,
        size: 3,
      })),
    })) as { paths: string[] }

    assert.equal(result.paths.length, names.length)
    for (const path of result.paths) assert.equal(await readFile(path, 'utf8'), 'red')
    await assert.rejects(stat(expired), { code: 'ENOENT' })
    assert.equal(await readFile(join(recent, 'keep.txt'), 'utf8'), 'keep')
    assert.equal(await readFile(join(unrelated, 'keep.txt'), 'utf8'), 'keep')
    if (canLock) assert.equal(await readFile(join(locked, 'keep.txt'), 'utf8'), 'locked')
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    if (canLock) await chmod(locked, 0o700).catch(() => {})
    await rm(workspace, { recursive: true, force: true })
  }
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

test('a symlinked attachment root cannot redirect downloads or stale cleanup', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'attachment-root-link-'))
  const outside = await mkdtemp(join(tmpdir(), 'attachment-outside-'))
  const expired = join(outside, 'nuphos-attachments-expired')

  try {
    await mkdir(expired)
    await writeFile(join(expired, 'keep.txt'), 'keep')
    const old = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)

    await utimes(expired, old, old)
    await symlink(outside, join(workspace, '.nuphos-attachments'), 'junction')
    const result = await request(new LocalAttachmentStream(workspace, program), {
      files: [{ name: 'image.png', url: 'https://example.test/image', size: 3 }],
    })

    assert.equal(result, null)
    assert.equal(await readFile(join(expired, 'keep.txt'), 'utf8'), 'keep')
    assert.deepEqual(await (await import('node:fs/promises')).readdir(outside), [
      'nuphos-attachments-expired',
    ])
  } finally {
    await rm(workspace, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})
