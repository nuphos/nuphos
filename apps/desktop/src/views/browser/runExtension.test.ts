import assert from 'node:assert/strict'
import { test } from 'node:test'

import { runExtension } from './runExtension.ts'

import type { AnchorRect, BrowserExtensionItem } from '../../api/browser-extension-types.ts'

const anchor = { getBoundingClientRect: () => ({ x: 900, y: 8, width: 28, height: 28 }) } as Element
const item = (over: Partial<BrowserExtensionItem> = {}): BrowserExtensionItem => ({
  id: 'aeblfdkhhhdcdjpifhhbdiojplfjncoa',
  name: '1Password',
  icon: null,
  pinned: false,
  badge: null,
  error: null,
  ...over,
})

function recorder() {
  const calls: [string, number, AnchorRect][] = []

  return {
    calls,
    activate: (id: string, tabId: number, rect: AnchorRect) => {
      calls.push([id, tabId, rect])

      return Promise.resolve()
    },
  }
}

test('an unpinned extension runs from its menu row, its popup under the anchor', () => {
  const { calls, activate } = recorder()

  assert.equal(runExtension(activate, item(), 7, anchor), true)
  assert.deepEqual(calls, [
    ['aeblfdkhhhdcdjpifhhbdiojplfjncoa', 7, { x: 900, y: 8, width: 28, height: 28 }],
  ])
})

test('a turned-off extension does not run', () => {
  const { calls, activate } = recorder()

  assert.equal(runExtension(activate, item({ error: 'files differ' }), 7, anchor), false)
  assert.equal(calls.length, 0)
})

test('a failed activation does not surface as an unhandled rejection', async () => {
  let rejected = false
  const activate = () => {
    rejected = true

    return Promise.reject(new Error('Unable to get active tab'))
  }

  runExtension(activate, item(), 7, anchor)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(rejected, true)
})
