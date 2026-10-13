import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { readThisComputerFile } from './linked-file.ts'

test('reads a linked file on this computer, resolving /workspace against the local workspace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'linked-file-'))

  try {
    await mkdir(join(root, 'docs'))
    await writeFile(join(root, 'docs/a.md'), 'hello')
    const expected = { name: 'a.md', size: 5, data: Buffer.from('hello').toString('base64') }

    assert.deepEqual(await readThisComputerFile('/workspace/docs/a.md', root), expected)
    assert.deepEqual(await readThisComputerFile(join(root, 'docs/a.md'), null), expected)
    assert.equal(await readThisComputerFile('/workspace/docs/missing.md', root), null)
    assert.equal(await readThisComputerFile('/workspace/docs', root), null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
