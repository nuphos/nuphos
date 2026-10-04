import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test } from 'bun:test'

import { RUNTIME_FILE_PROGRAM } from './runtime-file-program'

test('the cloud panel runner reads JSON params and returns exact binary bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'runtime-file-'))

  try {
    const bytes = Buffer.from([0, 255, 10, 128])

    await mkdir(join(root, 'conv-s'))
    await writeFile(join(root, 'conv-s/image.bin'), bytes)
    await writeFile(join(root, 'runner.mjs'), RUNTIME_FILE_PROGRAM)
    await writeFile(
      join(root, 'params.json'),
      JSON.stringify({ sessionId: 's', path: 'image.bin', workspace: root }),
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
    await mkdir(join(root, 'conv-s'))
    await mkdir(join(root, 'conv-other'))
    await writeFile(join(root, 'conv-other/secret'), 'private')
    await mkdir(join(root, 'conv-s/folder'))
    await writeFile(join(root, 'conv-s/file.txt'), 'hello')
    await symlink(outside, join(root, 'conv-s/escape'))
    const list = (path: string) =>
      JSON.parse(
        // eslint-disable-next-line sonarjs/no-os-command-from-path -- Uses the installed Node interpreter without a shell.
        execFileSync('node', ['--input-type=module', '-e', RUNTIME_FILE_PROGRAM], {
          input: JSON.stringify({ sessionId: 's', path, workspace: root, action: 'list' }),
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
    expect(list('../conv-other')).toEqual({ error: 'forbidden_path' })
    expect(list(join(root, 'conv-other'))).toEqual({ error: 'forbidden_path' })
    expect(list('..')).toEqual({ error: 'forbidden_path' })
    expect(list('file.txt')).toEqual({ error: 'not_a_directory' })
    for (let i = 0; i < 501; i++) await writeFile(join(root, 'conv-s/folder', String(i)), '')
    expect(list('folder').entries).toHaveLength(500)
    expect(list('folder').truncated).toBe(true)
  } finally {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})
