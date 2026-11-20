import assert from 'node:assert/strict'
import { test } from 'node:test'

import { launchChromium } from './cli-chromium.ts'

test('a browser that dies at start resets its pipes without taking `nuphos agent` down', async () => {
  // A browser that cannot start, say with no sandbox it can use, exits at once.
  const browser = launchChromium('/bin/false', '/nonexistent')

  await browser.exited
  assert.doesNotThrow(() => browser.read.emit('error', new Error('read ECONNRESET')))
  assert.doesNotThrow(() => browser.write.emit('error', new Error('write EPIPE')))
})
