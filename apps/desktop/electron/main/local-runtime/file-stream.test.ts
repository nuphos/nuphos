import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { LocalFileStream } from './file-stream.ts'

import type { LocalRuntimeState } from './controller-types.ts'

async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'runtime-preview-'))

  try {
    await mkdir(join(root, 'conv-session'))
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function read(root: string, path: string, workspace?: string, action?: 'list') {
  return await send(new LocalFileStream(root), path, workspace, action)
}

async function send(stream: LocalFileStream, path: string, workspace?: string, action?: 'list') {
  return await new Promise<Record<string, unknown>>((resolve, reject) => {
    stream.addEventListener('open', () => stream.send(JSON.stringify({ path, workspace, action })))
    stream.addEventListener('message', ({ data }) => resolve(JSON.parse(String(data))))
    stream.addEventListener('close', () => reject(new Error('closed without a result')))
  })
}

test('reads UTF-8 and empty files through the local tunnel stream', () =>
  fixture(async (root) => {
    await writeFile(join(root, 'conv-session/報告.md'), 'hello 世界')
    await writeFile(join(root, 'conv-session/empty'), '')
    const result = await read(root, '/workspace/conv-session/報告.md')

    assert.equal(Buffer.from(String(result.data), 'base64').toString(), 'hello 世界')
    assert.equal((await read(root, 'conv-session/empty')).size, 0)
  }))

test('rejects sibling paths, symlink escapes, directories and oversized files', () =>
  fixture(async (root) => {
    await writeFile(join(root, 'secret'), 'private')
    await symlink(join(root, 'secret'), join(root, 'conv-session/link'))
    await writeFile(join(root, 'conv-session/large'), Buffer.alloc(512 * 1024 + 1))
    assert.equal((await read(join(root, 'conv-session'), '../secret')).error, 'forbidden_path')
    assert.equal((await read(join(root, 'conv-session'), 'link')).error, 'forbidden_path')
    assert.equal((await read(root, 'conv-session/large')).error, 'file_too_large')
    assert.equal((await read(root, 'missing')).error, 'file_not_found')
    await mkdir(join(root, 'conv-session/folder'))
    assert.equal((await read(root, 'conv-session/folder')).error, 'not_a_file')
  }))

test('refuses a workspace root replaced with a symlink', () =>
  fixture(async (root) => {
    await rm(join(root, 'conv-session'), { recursive: true })
    await mkdir(join(root, 'other'))
    await writeFile(join(root, 'other/file'), 'private')
    await symlink(join(root, 'other'), join(root, 'conv-session'))
    assert.equal((await read(join(root, 'conv-session'), 'file')).error, 'forbidden_path')
  }))

test('ignores a caller-supplied workspace outside the local runtime', () =>
  fixture(async (root) => {
    await writeFile(join(root, 'secret'), 'private')
    assert.equal((await read(join(root, 'conv-session'), 'secret', root)).error, 'file_not_found')
  }))

test('lists directories over the local stream without trusting caller roots', () =>
  fixture(async (root) => {
    await writeFile(join(root, 'file.txt'), 'hello')
    const result = await read(root, '/workspace', '/ignored-root', 'list')

    assert.deepEqual(result.entries, [
      { name: 'conv-session', kind: 'directory' },
      { name: 'file.txt', kind: 'file' },
    ])
    assert.equal(result.truncated, false)
  }))

test('a launcher workspace without conversation subdirectories can list and preview files', () =>
  fixture(async (root) => {
    await rm(join(root, 'conv-session'), { recursive: true })
    await writeFile(join(root, 'report.txt'), 'hello')
    assert.deepEqual((await read(root, '/workspace', undefined, 'list')).entries, [
      { name: 'report.txt', kind: 'file' },
    ])
    assert.equal((await read(root, '/workspace/report.txt')).data, 'aGVsbG8=')
    assert.equal((await read(root, '../other-user/secret')).error, 'forbidden_path')
  }))

test("an agent instance's files are read from its own workspace, an unknown instance from none", () =>
  fixture(async (root) => {
    const instance = join(root, 'instances/i-1/users/u/workspace')

    await mkdir(instance, { recursive: true })
    await writeFile(join(instance, 'box-check.md'), 'ok')
    const state = {
      workspace: join(root, 'conv-session'),
      instances: [{ instanceId: 'i-1', workspace: instance }],
    } as unknown as LocalRuntimeState
    const file = join(instance, 'box-check.md')

    assert.equal((await send(LocalFileStream.open(state, 'i-1')!, file)).size, 2)
    assert.equal((await send(LocalFileStream.open(state)!, file)).error, 'forbidden_path')
    assert.equal(LocalFileStream.open(state, 'i-2'), null)
  }))
