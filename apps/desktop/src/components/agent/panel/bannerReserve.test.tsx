import assert from 'node:assert/strict'

import { test } from 'bun:test'
import { Window } from 'happy-dom'
import { act, createElement, useRef } from 'react'

const dom = new Window()
const observed: { callback: () => void; targets: Element[] }[] = []

/** Resizes are driven by hand: happy-dom lays nothing out. */
class FakeResizeObserver {
  private entry: { callback: () => void; targets: Element[] }

  constructor(callback: () => void) {
    this.entry = { callback, targets: [] }
    observed.push(this.entry)
  }

  observe(target: Element) {
    this.entry.targets.push(target)
  }

  disconnect() {
    this.entry.targets = []
  }
}

const browser: Record<string, unknown> = {
  window: dom,
  navigator: dom.navigator,
  IS_REACT_ACT_ENVIRONMENT: true,
}

for (const key of Object.getOwnPropertyNames(dom))
  if (!(key in globalThis)) browser[key] = Reflect.get(dom, key)
browser.ResizeObserver = FakeResizeObserver
for (const [key, value] of Object.entries(browser))
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })

const { createRoot } = await import('react-dom/client')
const { BANNER_HEIGHT_VAR, BANNER_HOST, useFollowOnResize, useReserveBannerHeight } =
  await import('./bannerReserve')

const resize = (target: Element) => {
  for (const entry of observed) if (entry.targets.includes(target)) entry.callback()
}

function Banner({ open }: { open: boolean }) {
  const ref = useRef<HTMLDivElement>(null)

  useReserveBannerHeight(ref, open)

  return <div ref={ref} data-banner="" />
}

function Transcript({ following }: { following: () => boolean }) {
  const ref = useRef<HTMLDivElement>(null)

  useFollowOnResize(ref, following)

  return <div ref={ref} data-transcript="" />
}

test('the open banner reserves its height on its host, and gives it back when it closes', async () => {
  const host = dom.document.createElement('div')

  host.setAttribute(BANNER_HOST, '')
  dom.document.body.append(host)
  const root = createRoot(host as unknown as HTMLElement)
  const height = () => host.style.getPropertyValue(BANNER_HEIGHT_VAR)

  await act(() => root.render(createElement(Banner, { open: true })))
  const banner = host.querySelector('[data-banner]')

  assert.ok(banner)
  Object.defineProperty(banner, 'offsetHeight', { configurable: true, value: 32 })
  resize(banner)
  assert.equal(height(), '32px')
  // A longer reason wraps, and the room grows with it.
  Object.defineProperty(banner, 'offsetHeight', { configurable: true, value: 52 })
  resize(banner)
  assert.equal(height(), '52px')
  await act(() => root.render(createElement(Banner, { open: false })))
  assert.equal(height(), '0px', 'a closing banner frees its room at once')
  await act(() => root.unmount())
  assert.equal(height(), '')
  host.remove()
})

test('a banner outside a host reserves nothing', async () => {
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)

  await act(() => root.render(createElement(Banner, { open: true })))
  assert.equal(container.style.getPropertyValue(BANNER_HEIGHT_VAR), '')
  await act(() => root.unmount())
  container.remove()
})

test('a transcript keeps following the latest message when its box shrinks, unless the reader scrolled away', async () => {
  const container = dom.document.createElement('div')

  dom.document.body.append(container)
  const root = createRoot(container as unknown as HTMLElement)
  let following = true

  await act(() => root.render(createElement(Transcript, { following: () => following })))
  const transcript = container.querySelector<HTMLElement>('[data-transcript]')

  assert.ok(transcript)
  Object.defineProperty(transcript, 'scrollHeight', { configurable: true, value: 900 })
  transcript.scrollTop = 0
  resize(transcript)
  assert.equal(transcript.scrollTop, 900)
  following = false
  transcript.scrollTop = 120
  resize(transcript)
  assert.equal(transcript.scrollTop, 120, 'a reader reading history stays where they are')
  await act(() => root.unmount())
  container.remove()
  await dom.happyDOM.close()
})
