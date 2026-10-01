import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, expect, test } from 'bun:test'

import { WORKSPACE_ARCHIVE_PROGRAM } from './workspace-archive-program'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function root() {
  const dir = await mkdtemp(join(tmpdir(), 'nuphos-workspace-test-'))

  roots.push(dir)

  return dir
}
function run(mode: string, dir: string, input?: Buffer) {
  return execFileSync(
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- fixture executes the installed Node interpreter, with no shell
    'node',
    [
      '--input-type=module',
      '-e',
      WORKSPACE_ARCHIVE_PROGRAM,
      mode,
      dir,
      'test-session',
      String(input?.length ?? 0),
    ],
    {
      input,
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )
}
test('workspace survives export/import, including binary and dot files', async () => {
  const source = await root()
  const target = await root()

  await mkdir(join(source, 'conv-test-session/.git'), { recursive: true })
  await writeFile(join(source, 'conv-test-session/.git/config'), 'repo configuration')
  await writeFile(join(source, 'conv-test-session/data.bin'), Buffer.from([0, 255, 128, 10]))
  await symlink('data.bin', join(source, 'conv-test-session/資料連結'))
  const archive = run('export', source)

  run('import', target, archive)
  run('import', target, archive)
  expect(await readFile(join(target, 'conv-test-session/資料連結'))).toEqual(
    Buffer.from([0, 255, 128, 10]),
  )
  expect(await readFile(join(target, 'conv-test-session/data.bin'))).toEqual(
    Buffer.from([0, 255, 128, 10]),
  )
  expect(await readFile(join(target, 'conv-test-session/.git/config'), 'utf8')).toBe(
    'repo configuration',
  )
})
test('export refuses symlinks into runtime credentials', async () => {
  const source = await root()

  await mkdir(join(source, 'conv-test-session'))
  await writeFile(join(source, 'credentials'), 'private')
  await symlink('../credentials', join(source, 'conv-test-session/token'))
  expect(() => run('export', source)).toThrow()
})
test('import rejects traversal, corrupt content, duplicates, and preserves existing work', async () => {
  const target = await root()

  for (const entries of [
    [{ path: '../escape', kind: 'directory' }],
    [{ path: '/escape', kind: 'directory' }],
    [{ path: 'file', kind: 'file', data: 'aGVsbG8=', sha256: 'bad' }],
    [
      { path: 'a', kind: 'directory' },
      { path: 'a', kind: 'directory' },
    ],
  ]) {
    expect(() =>
      run(
        'import',
        target,
        Buffer.from(JSON.stringify({ version: 1, sessionId: 'test-session', entries })),
      ),
    ).toThrow()
  }
  await mkdir(join(target, 'conv-test-session'))
  await writeFile(join(target, 'conv-test-session/keep'), 'keep')
  const empty = Buffer.from(JSON.stringify({ version: 1, sessionId: 'test-session', entries: [] }))

  expect(() => run('import', target, empty)).toThrow()
  expect(await readFile(join(target, 'conv-test-session/keep'), 'utf8')).toBe('keep')
})
