import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { CLOUD_CLIS } from '../../src/lib/cloudCli.ts'

import { findCloudCli } from './cloud-cli-probe-core.ts'

test('detects all seven providers without executing the CLI or requiring a login', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nuphos-cli-probe-'))

  try {
    for (const [provider, { commands }] of Object.entries(CLOUD_CLIS)) {
      const executable = path.join(dir, commands[0])

      await writeFile(executable, '#!/bin/sh\nexit 99\n', { mode: 0o755 })
      assert.deepEqual(await findCloudCli(provider, { PATH: dir }, 'darwin'), {
        installed: true,
        command: commands[0],
        path: executable,
      })
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('missing commands, directories and non-executable files do not count as installed', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nuphos-cli-probe-'))

  try {
    const missing = { installed: false, command: null, path: null }

    assert.deepEqual(await findCloudCli('aws', { PATH: dir }, 'darwin'), missing)
    await mkdir(path.join(dir, 'aws'))
    assert.deepEqual(await findCloudCli('aws', { PATH: dir }, 'darwin'), missing)
    await rm(path.join(dir, 'aws'), { recursive: true })
    await writeFile(path.join(dir, 'aws'), 'not executable')
    await chmod(path.join(dir, 'aws'), 0o644)
    assert.deepEqual(await findCloudCli('aws', { PATH: dir }, 'darwin'), missing)
    await assert.rejects(findCloudCli('../aws', { PATH: dir }), /Unsupported/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('supports the legacy Volcengine executable name', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nuphos-cli-probe-'))

  try {
    await writeFile(path.join(dir, 'volcengine-cli'), '', { mode: 0o755 })
    assert.equal(
      (await findCloudCli('volcengine', { PATH: dir }, 'darwin')).command,
      'volcengine-cli',
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
