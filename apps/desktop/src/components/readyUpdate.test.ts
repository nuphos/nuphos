import assert from 'node:assert/strict'
import { test } from 'node:test'

import { readyUpdate } from './readyUpdate.ts'

const downloading = {
  kind: 'downloading',
  version: '0.126.1',
  transferred: 41,
  total: 100,
  bytesPerSecond: 10,
} as const

test('a ready update is on offer, with its installer when the last restart missed it', () => {
  assert.deepEqual(
    readyUpdate({ kind: 'ready', version: '0.126.0', installerUrl: 'https://x' }, false),
    { version: '0.126.0', percent: null, installerUrl: 'https://x' },
  )
})

test('a newer release downloading in place of the offer keeps it, with the percent', () => {
  assert.deepEqual(readyUpdate(downloading, true), {
    version: '0.126.1',
    percent: 41,
    installerUrl: null,
  })
  assert.equal(readyUpdate({ ...downloading, total: 0 }, true)?.percent, 0)
})

test('a first download, or no update, offers nothing', () => {
  assert.equal(readyUpdate(downloading, false), null)
  for (const kind of ['idle', 'checking', 'up-to-date', 'error'] as const) {
    assert.equal(readyUpdate({ kind }, true), null)
  }
})
