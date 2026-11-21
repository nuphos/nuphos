import assert from 'node:assert/strict'

import { afterEach, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement } from 'react'

const dom = new Window()

const browser: Record<string, unknown> = {
  window: dom,
  navigator: dom.navigator,
  IS_REACT_ACT_ENVIRONMENT: true,
}

for (const key of Object.getOwnPropertyNames(dom))
  if (!(key in globalThis)) browser[key] = Reflect.get(dom, key)
for (const [key, value] of Object.entries(browser))
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })

const { ImageLightbox } = await import('./messageInline')
const { createRoot } = await import('react-dom/client')

const images = [
  { url: 'https://example.test/a.png', fileName: 'a.png' },
  { url: 'https://example.test/b.png', fileName: 'b.png' },
]
let unmount: (() => Promise<void>) | undefined

afterEach(() => unmount?.())

// The viewer opens in a portal, so its buttons are looked up in the whole document.
async function open(onDownload?: (index: number) => void) {
  const calls = { index: [] as (number | null)[], link: 0 }
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)
  const lightbox = createElement(ImageLightbox, {
    images,
    index: 1,
    onIndexChange: (index) => calls.index.push(index),
    onDownload,
  })

  await act(async () => {
    root.render(createElement('a', { href: '#', onClick: () => calls.link++ }, lightbox))
    await new Promise((done) => setTimeout(done, 0))
  })
  unmount = () => act(() => root.unmount())
  const button = (label: string) =>
    dom.document.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null

  return { calls, download: button('Download'), close: button('Close preview') }
}

test('the viewer has a Download button beside its close X that downloads the shown item', async () => {
  const downloads: number[] = []
  const { calls, download, close } = await open((index) => downloads.push(index))

  assert.ok(download, 'a top Download button')
  assert.ok(close, 'the close X')
  assert.equal(download.title, 'Download')
  assert.equal(download.className, close.className)
  assert.equal(download.nextElementSibling, close)

  await act(async () => download.click())

  assert.deepEqual(downloads, [1])
  assert.deepEqual(calls, { index: [], link: 0 })
})

test('without onDownload the viewer has no Download button', async () => {
  const { download, close } = await open()

  assert.ok(close)
  assert.equal(download, null)
})
