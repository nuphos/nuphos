import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from 'bun:test'

import { RUNTIME_FILE_PROGRAM } from './runtime-file-program'

test('the cloud panel runner reads JSON params and returns exact binary bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'runtime-file-'))

  try {
    const bytes = Buffer.from([0, 255, 10, 128])

    await writeFile(join(root, 'image.bin'), bytes)
    await writeFile(join(root, 'runner.mjs'), RUNTIME_FILE_PROGRAM)
    await writeFile(
      join(root, 'params.json'),
      JSON.stringify({ path: 'image.bin', workspace: root }),
    )
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- Executes the fixture with the installed Node interpreter, without a shell.
    const output = execFileSync('node', [join(root, 'runner.mjs'), root], {
      env: { PATH: process.env.PATH },
      encoding: 'utf8',
      timeout: 5000,
    })

    expect(JSON.parse(output)).toEqual({
      name: 'image.bin',
      size: 4,
      data: bytes.toString('base64'),
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('directory browsing stays inside the workspace and omits symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'runtime-directory-'))
  const outside = await mkdtemp(join(tmpdir(), 'runtime-outside-'))

  try {
    await writeFile(join(outside, 'secret'), 'private')
    await mkdir(join(root, 'folder'))
    await writeFile(join(root, 'file.txt'), 'hello')
    await symlink(outside, join(root, 'escape'))
    const list = (path: string) =>
      JSON.parse(
        // eslint-disable-next-line sonarjs/no-os-command-from-path -- Uses the installed Node interpreter without a shell.
        execFileSync('node', ['--input-type=module', '-e', RUNTIME_FILE_PROGRAM], {
          input: JSON.stringify({ path, workspace: root, action: 'list' }),
          encoding: 'utf8',
          timeout: 5000,
        }),
      )

    expect(list('/workspace')).toEqual({
      entries: [
        { name: 'folder', kind: 'directory' },
        { name: 'file.txt', kind: 'file' },
      ],
      truncated: false,
    })
    expect(list('folder')).toEqual({ entries: [], truncated: false })
    expect(list('escape')).toEqual({ error: 'forbidden_path' })
    expect(list(outside)).toEqual({ error: 'forbidden_path' })
    expect(list('..')).toEqual({ error: 'forbidden_path' })
    expect(list('file.txt')).toEqual({ error: 'not_a_directory' })
    for (let i = 0; i < 501; i++) await writeFile(join(root, 'folder', String(i)), '')
    expect(list('folder').entries).toHaveLength(500)
    expect(list('folder').truncated).toBe(true)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test("the conversation owner's session home is readable, except its dot-entries", async () => {
  const root = await mkdtemp(join(tmpdir(), 'runtime-home-'))
  const workspace = join(root, 'workspace')
  const homes = join(root, '.nuphos', 'session-homes')
  const home = join(homes, createHash('sha256').update('s1').digest('hex'))
  const other = join(homes, createHash('sha256').update('s2').digest('hex'))

  try {
    await mkdir(workspace)
    await mkdir(join(home, 'recordings'), { recursive: true })
    await mkdir(join(home, '.aws'))
    await mkdir(other)
    await writeFile(join(home, 'recordings', 'box1.mp4'), 'video')
    await writeFile(join(home, '.aws', 'credentials'), 'secret')
    await writeFile(join(home, '.gitconfig'), 'secret')
    await writeFile(join(other, 'file.txt'), 'theirs')
    const run = (params: Record<string, unknown>) =>
      JSON.parse(
        // eslint-disable-next-line sonarjs/no-os-command-from-path -- Uses the installed Node interpreter without a shell.
        execFileSync('node', ['--input-type=module', '-e', RUNTIME_FILE_PROGRAM], {
          input: JSON.stringify({ workspace, sessionId: 's1', ...params }),
          env: { PATH: process.env.PATH, HOME: root },
          encoding: 'utf8',
          timeout: 5000,
        }),
      )

    expect(run({ path: join(home, 'recordings', 'box1.mp4') })).toEqual({
      name: 'box1.mp4',
      size: 5,
      data: Buffer.from('video').toString('base64'),
    })
    expect(run({ path: home, action: 'list' })).toEqual({
      entries: [{ name: 'recordings', kind: 'directory' }],
      truncated: false,
    })
    expect(run({ path: join(home, '.aws', 'credentials') })).toEqual({ error: 'forbidden_path' })
    expect(run({ path: join(home, '.gitconfig') })).toEqual({ error: 'forbidden_path' })
    expect(run({ path: join(other, 'file.txt') })).toEqual({ error: 'forbidden_path' })
    expect(run({ path: join(home, 'recordings', 'box1.mp4'), sessionId: undefined })).toEqual({
      error: 'forbidden_path',
    })
    // A non-dot link to a dot-entry is refused by where it resolves.
    await symlink(join(home, '.aws', 'credentials'), join(home, 'creds'))
    expect(run({ path: join(home, 'creds') })).toEqual({ error: 'forbidden_path' })
    // A home that is itself a link is not followed.
    const outside = join(root, 'outside')

    await mkdir(outside)
    await writeFile(join(outside, 'secret'), 'private')
    await rm(home, { recursive: true })
    await symlink(outside, home)
    expect(run({ path: join(home, 'secret') })).toEqual({ error: 'forbidden_path' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a file too large to preview is sized, then uploaded whole to the given URL', async () => {
  const root = await mkdtemp(join(tmpdir(), 'runtime-upload-'))
  const bytes = Buffer.alloc(600 * 1024, 7)
  let received: Buffer | undefined
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      if (request.method !== 'PUT') return new Response(null, { status: 405 })
      received = Buffer.from(await request.arrayBuffer())

      return new Response(null, { status: 200 })
    },
  })

  try {
    await writeFile(join(root, 'clip.mp4'), bytes)
    // Asynchronous, so the test server can answer the upload meanwhile.
    const run = async (params: Record<string, unknown>) => {
      const child = Bun.spawn(['node', '--input-type=module', '-e', RUNTIME_FILE_PROGRAM], {
        stdin: new Blob([JSON.stringify({ path: 'clip.mp4', workspace: root, ...params })]),
      })

      return JSON.parse(await new Response(child.stdout).text()) as unknown
    }
    const url = `http://127.0.0.1:${String(server.port)}/upload`

    expect(await run({})).toEqual({ error: 'file_too_large' })
    expect(await run({ action: 'stat' })).toEqual({ name: 'clip.mp4', size: bytes.length })
    expect(await run({ action: 'upload', url, size: bytes.length - 1 })).toEqual({
      error: 'file_read_failed',
    })
    expect(received).toBeUndefined()
    // A file that grew after it was sized is refused, not read past the admitted size.
    await writeFile(join(root, 'clip.mp4'), Buffer.concat([bytes, Buffer.alloc(1024)]))
    expect(await run({ action: 'upload', url, size: bytes.length })).toEqual({
      error: 'file_read_failed',
    })
    expect(received).toBeUndefined()
    await writeFile(join(root, 'clip.mp4'), bytes)
    expect(await run({ action: 'upload', url, size: bytes.length })).toEqual({
      name: 'clip.mp4',
      size: bytes.length,
    })
    expect(received?.equals(bytes)).toBe(true)
  } finally {
    await server.stop(true)
    await rm(root, { recursive: true, force: true })
  }
})
