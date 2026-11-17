import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'

import { guardBrowserDownloads, isRepeatTabDownload } from './browser-downloads.ts'

import type { Session, WebContents } from 'electron'

const FILE = 'https://example.com/plan.docx'

function item(chain: string[]) {
  return { getURL: () => chain[chain.length - 1] ?? '', getURLChain: () => chain }
}

function tab(url: string) {
  return { getURL: () => url }
}

test("an agent's tab saves its downloads, repeats included, so the guard never drops one", () => {
  const browserSession = new EventEmitter()
  const saved: string[] = []

  guardBrowserDownloads(browserSession as unknown as Session, (download) => {
    saved.push(download.getURL())

    return true
  })
  for (let i = 0; i < 2; i++) {
    const event = { defaultPrevented: false, preventDefault: () => (event.defaultPrevented = true) }

    browserSession.emit('will-download', event, item([FILE]), tab(''))
    assert.equal(event.defaultPrevented, false)
  }
  assert.deepEqual(saved, [FILE, FILE])
})

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

test('programmatic file navigation from an existing page asks once', () => {
  const asked = new Set<string>()
  const page = tab('https://example.com/docs')

  assert.equal(isRepeatTabDownload(asked, item([FILE]), page, FILE), false)
  assert.equal(isRepeatTabDownload(asked, item([FILE]), page, FILE), true)
  // A later download clicked on the page has no pending programmatic navigation.
  assert.equal(isRepeatTabDownload(asked, item([FILE]), page), false)
})

test('navigation tracking cancels automatic repeats but preserves page-initiated downloads', () => {
  const session = new EventEmitter()
  const contents = Object.assign(new EventEmitter(), tab('https://example.com/docs'))
  const track = guardBrowserDownloads(session as unknown as Session)

  track(contents as unknown as WebContents)
  const download = () => {
    let cancelled = false

    session.emit(
      'will-download',
      {
        preventDefault: () => {
          cancelled = true
        },
      },
      item([FILE]),
      contents,
    )

    return cancelled
  }
  const navigate = () =>
    contents.emit('did-start-navigation', { url: FILE, isMainFrame: true, isSameDocument: false })

  navigate()
  assert.equal(download(), false)
  navigate()
  assert.equal(download(), true)
  navigate()
  contents.emit('will-navigate', { url: FILE })
  assert.equal(download(), false)
  assert.equal(download(), false)
})
