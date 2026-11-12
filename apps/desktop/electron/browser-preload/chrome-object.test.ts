import assert from 'node:assert/strict'
import { test } from 'node:test'

import { addChromeObject } from './chrome-object.ts'
import type { ChromePage } from './chrome-object.ts'

function page(chrome?: Record<string, unknown>) {
  const timing = {
    navigationStart: 1_000,
    responseStart: 1_200,
    domContentLoadedEventEnd: 1_500,
    loadEventEnd: 1_800,
  }

  return { chrome, performance: { timing, now: () => 900 } } as ChromePage & {
    chrome: Record<string, unknown>
  }
}

test('fills in the members Chrome pages have, in Chrome order', () => {
  const target = page({})

  addChromeObject(target)
  assert.deepEqual(Object.keys(target.chrome), ['loadTimes', 'csi', 'app'])
  const loadTimes = (target.chrome.loadTimes as () => Record<string, unknown>)()

  assert.equal(loadTimes.requestTime, 1)
  assert.equal(loadTimes.finishLoadTime, 1.8)
  assert.deepEqual((target.chrome.csi as () => unknown)(), {
    startE: 1_000,
    onloadT: 1_800,
    pageT: 900,
    tran: 15,
  })
  const app = target.chrome.app as Record<string, unknown> & { getIsInstalled: () => boolean }

  assert.equal(app.isInstalled, false)
  assert.equal(app.getIsInstalled(), false)
})

test('creates window.chrome when the page has none', () => {
  const target = page()

  addChromeObject(target)
  assert.equal(typeof target.chrome.loadTimes, 'function')
})

test('leaves a window.chrome that already has Chrome members alone', () => {
  const loadTimes = () => 'native'
  const target = page({ loadTimes })

  addChromeObject(target)
  assert.equal(target.chrome.loadTimes, loadTimes)
  assert.equal('csi' in target.chrome, false)
})
