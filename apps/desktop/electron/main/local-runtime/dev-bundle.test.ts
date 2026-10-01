import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { devBundleHint, devStatusFile } from './dev-bundle.ts'

function root(status?: object): string {
  const dir = path.join(mkdtempSync(path.join(tmpdir(), 'dev-bundle-')), 'darwin-arm64')

  if (status) writeFileSync(devStatusFile(dir), JSON.stringify(status))

  return dir
}

test('the launcher says it is preparing or why it failed', () => {
  assert.deepEqual(
    devBundleHint(root({ pid: 1, state: 'preparing' }), () => true),
    {
      state: 'preparing',
    },
  )
  assert.deepEqual(
    devBundleHint(root({ pid: 1, state: 'failed', reason: 'Install git' }), () => true),
    { state: 'failed', reason: 'Install git' },
  )
})

test('with no launcher, or one that is gone, the bundle is just missing', () => {
  assert.deepEqual(devBundleHint(root()), { state: 'missing' })
  assert.deepEqual(
    devBundleHint(root({ pid: 1, state: 'preparing' }), () => false),
    {
      state: 'missing',
    },
  )
})
