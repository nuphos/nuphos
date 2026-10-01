import assert from 'node:assert/strict'
import test from 'node:test'

import { configureStableUpdateChannel } from './updater-channel.ts'

test('prerelease clients check the published stable channel without allowing downgrades', () => {
  const updater = {
    channel: 'beta' as string | null,
    allowPrerelease: true,
    allowDowngrade: true,
  }

  configureStableUpdateChannel(updater)

  assert.deepEqual(updater, {
    channel: 'latest',
    allowPrerelease: false,
    allowDowngrade: false,
  })
})
