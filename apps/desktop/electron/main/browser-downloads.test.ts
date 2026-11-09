import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isRepeatTabDownload } from './browser-downloads.ts'

const FILE = 'https://example.com/plan.docx'

function item(chain: string[]) {
  return { getURL: () => chain[chain.length - 1] ?? '', getURLChain: () => chain }
}

function tab(url: string) {
  return { getURL: () => url }
}

test('a tab that is a file asks once, then its reloads are dropped', () => {
  const asked = new Set<string>()

  assert.equal(isRepeatTabDownload(asked, item([FILE]), tab('')), false)
  assert.equal(isRepeatTabDownload(asked, item([FILE]), tab('')), true)
  assert.equal(isRepeatTabDownload(asked, item([FILE]), tab('about:blank')), true)
  assert.equal(isRepeatTabDownload(asked, item([FILE]), tab(FILE)), true)
})

test('a redirected file is keyed by the address the tab loads', () => {
  const asked = new Set<string>()
  const chain = [FILE, 'https://cdn.example.com/signed/plan.docx']

  assert.equal(isRepeatTabDownload(asked, item(chain), tab('')), false)
  assert.equal(isRepeatTabDownload(asked, item(chain), tab(chain[1] ?? '')), true)
})

test('a link on a loaded page always asks', () => {
  const asked = new Set<string>()
  const page = tab('https://example.com/docs')

  assert.equal(isRepeatTabDownload(asked, item([FILE]), page), false)
  assert.equal(isRepeatTabDownload(asked, item([FILE]), page), false)
  assert.equal(asked.size, 0)
})

test('a different file in the same kind of tab still asks', () => {
  const asked = new Set<string>()

  assert.equal(isRepeatTabDownload(asked, item([FILE]), tab('')), false)
  assert.equal(isRepeatTabDownload(asked, item(['https://example.com/other.pdf']), tab('')), false)
})

test('a download without a tab is treated as the tab load', () => {
  const asked = new Set<string>()

  assert.equal(isRepeatTabDownload(asked, item([FILE]), undefined), false)
  assert.equal(isRepeatTabDownload(asked, item([FILE]), undefined), true)
})
