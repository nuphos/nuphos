import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { acquireDevInstance } from './dev-instance.ts'

test('one concurrent launcher per real worktree; separate worktrees remain independent', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'nuphos-instance-test-'))

  t.after(() => rm(root, { recursive: true, force: true }))
  const results = await Promise.allSettled([acquireDevInstance(root), acquireDevInstance(root)])
  const owner = results.find((result) => result.status === 'fulfilled')

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1)
  assert.ok(owner?.status === 'fulfilled')
  t.after(owner.value)
  await symlink(root, join(root, 'alias'))
  await assert.rejects(acquireDevInstance(join(root, 'alias')), /already running/)
  await mkdir(join(root, 'other'))
  t.after(await acquireDevInstance(join(root, 'other')))
})

test('stopping a launcher releases its lease for the next invocation', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'nuphos-instance-test-'))

  t.after(() => rm(root, { recursive: true, force: true }))
  const release = await acquireDevInstance(root)

  release()
  await new Promise((resolve) => setImmediate(resolve))
  const next = await acquireDevInstance(root)

  assert.equal(typeof next, 'function')
  t.after(next)
})
