import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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
    const hello = { name: 'a.md', size: 5, data: Buffer.from('hello').toString('base64') }

    assert.deepEqual(await readThisComputerFile('/workspace/docs/a.md', workspace), hello)
    assert.deepEqual(await readThisComputerFile(join(workspace, 'docs/a.md'), null), hello)
    for (const [path, base] of [
      ['/workspace/docs/missing.md', workspace],
      ['/workspace/docs', workspace],
      ['/workspace/../secret', workspace],
      ['/workspace/docs/a.md', null],
      ['/workspace/big', workspace],
    ] as const)
      assert.equal(await readThisComputerFile(path, base), null, path)
    // Opening in place has no preview limit, but the same workspace bounds.
    assert.equal(await resolveThisComputerFile('/workspace/big', workspace), join(workspace, 'big'))
    assert.equal(await resolveThisComputerFile('/workspace/../secret', workspace), null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
