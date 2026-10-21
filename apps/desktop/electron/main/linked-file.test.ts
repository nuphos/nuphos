import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { readThisComputerFile, resolveThisComputerFile } from './linked-file.ts'

test('a linked file is read on this computer within the local workspace, else left to the agent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'linked-file-'))
  const workspace = join(root, 'workspace')

  try {
    await mkdir(join(workspace, 'docs'), { recursive: true })
    await writeFile(join(workspace, 'docs/a.md'), 'hello')
    await writeFile(join(root, 'secret'), 'outside')
    await writeFile(join(workspace, 'big'), Buffer.alloc(512 * 1024 + 1))
    await writeFile(join(workspace, 'at-limit'), Buffer.alloc(512 * 1024))
    await writeFile(join(workspace, 'empty'), '')
    const hello = { name: 'a.md', size: 5, data: Buffer.from('hello').toString('base64') }

    assert.deepEqual(await readThisComputerFile('/workspace/docs/a.md', workspace), hello)
    assert.deepEqual(await readThisComputerFile(join(workspace, 'docs/a.md'), null), hello)
    for (const [path, base] of [
      ['/workspace/docs/missing.md', workspace],
      ['/workspace/docs', workspace],
      ['/workspace/../secret', workspace],
      ['/workspace/docs/a.md', null],
    ] as const)
      assert.equal(await readThisComputerFile(path, base), null, path)
    await assert.rejects(readThisComputerFile('/workspace/big', workspace), /file_too_large/)
    assert.equal((await readThisComputerFile('/workspace/at-limit', workspace))?.size, 512 * 1024)
    assert.equal((await readThisComputerFile('/workspace/empty', workspace))?.size, 0)
    // Opening in place has no preview limit, but the same workspace bounds.
    assert.equal(
      await resolveThisComputerFile('/workspace/big', workspace),
      await realpath(join(workspace, 'big')),
    )
    assert.equal(await resolveThisComputerFile('/workspace/../secret', workspace), null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('virtual workspace links cannot follow file or directory symlinks outside its real root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'linked-boundary-'))
  const workspace = join(root, 'workspace')

  try {
    await mkdir(workspace)
    await mkdir(join(root, 'outside'))
    await writeFile(join(root, 'outside', 'clip.mp4'), 'outside')
    await writeFile(join(workspace, '..safe.mp4'), 'inside')
    await symlink(join(root, 'outside', 'clip.mp4'), join(workspace, 'escape.mp4'))
    await symlink(join(root, 'outside'), join(workspace, 'escape-directory'))
    await symlink(join(workspace, '..safe.mp4'), join(workspace, 'inside.mp4'))
    assert.equal(await resolveThisComputerFile('/workspace/escape.mp4', workspace), null)
    assert.equal(
      await resolveThisComputerFile('/workspace/escape-directory/clip.mp4', workspace),
      null,
    )
    assert.equal(
      await resolveThisComputerFile('/workspace/inside.mp4', workspace),
      await realpath(join(workspace, '..safe.mp4')),
    )
    assert.equal(
      await resolveThisComputerFile('/workspace/..safe.mp4', workspace),
      await realpath(join(workspace, '..safe.mp4')),
    )
    // Explicit absolute links still name local files independently of the workspace alias.
    assert.equal(
      await resolveThisComputerFile(join(root, 'outside', 'clip.mp4'), workspace),
      join(root, 'outside', 'clip.mp4'),
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
