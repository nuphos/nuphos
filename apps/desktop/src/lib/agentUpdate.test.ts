import assert from 'node:assert/strict'
import { test } from 'node:test'

import { localUpdateVersion, newerVersion } from './agentUpdate.ts'

test('compares release versions numerically', () => {
  assert.equal(newerVersion('0.162.1', '0.160.0'), true)
  assert.equal(newerVersion('2.1.10', '2.1.9'), true)
  assert.equal(newerVersion('2.1.9', '2.1.10'), false)
  assert.equal(newerVersion('2.1.9', '2.1.9'), false)
  assert.equal(newerVersion('not-a-version', '2.1.9'), false)
})

test('offers a local update only for a CLI that can update itself', () => {
  const cli = {
    installed: true,
    path: '/Users/me/.local/bin/claude',
    version: '2.1.0',
    loggedIn: true,
  } as const

  assert.equal(localUpdateVersion(cli, '2.2.0'), '2.2.0')
  assert.equal(localUpdateVersion(cli, '2.1.0'), undefined)
  assert.equal(localUpdateVersion(cli, undefined), undefined)
  assert.equal(localUpdateVersion({ installed: false }, '2.2.0'), undefined)
  assert.equal(localUpdateVersion({ ...cli, bundled: true }, '2.2.0'), undefined)
})
