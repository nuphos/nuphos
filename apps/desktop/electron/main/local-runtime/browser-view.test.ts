import assert from 'node:assert/strict'
import { test } from 'node:test'
import { constants, inflateSync } from 'node:zlib'

import { BrowserViewStream } from './browser-view.ts'

import type { ViewedPage, WatchTab } from './browser-view.ts'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

/** A page painting at 2× its CSS size, recording what the stream sends it. */
function fakePage(cssWidth = 390) {
  const events: Record<string, unknown>[] = []
  let paint: ((image: unknown, dirty: unknown) => void) | undefined
  let subscribed = false
  const page = {
    events,
    get subscribed() {
      return subscribed
    },
    isDestroyed: () => false,
    beginFrameSubscription: (_onlyDirty: boolean, callback: typeof paint) => {
      subscribed = true
      paint = callback
    },
    endFrameSubscription: () => {
      subscribed = false
    },
    invalidate: () => {},
    /** `window.innerWidth`: the page's width in CSS pixels where it is laid out. */
    executeJavaScript: async () => cssWidth,
    sendInputEvent: (event: Record<string, unknown>) => events.push(event),
    once: () => page,
    /** Paints the whole page one colour, as BGRA. */
    paint(width: number, height: number, [b, g, r]: number[]) {
      const bitmap = Buffer.alloc(width * height * 4)

      for (let i = 0; i < bitmap.length; i += 4) bitmap.set([b ?? 0, g ?? 0, r ?? 0, 255], i)
      paint?.(
        { getSize: () => ({ width, height }), toBitmap: () => bitmap },
        { x: 0, y: 0, width, height },
      )
    },
  }

  return page
}

/** A stream whose phone side is recorded: every server byte, joined. */
function open(page: ReturnType<typeof fakePage> | null) {
  const watched: unknown[][] = []
  let stopped = 0
  const watch: WatchTab = async (...args) => {
    watched.push(args)

    return page ? { page: page as unknown as ViewedPage, stop: () => stopped++ } : null
  }
  const stream = new BrowserViewStream(watch)
  let received = Buffer.alloc(0)
  let closed = false

  stream.addEventListener('message', ({ data }) => {
    received = Buffer.concat([received, Buffer.from(String(data), 'base64')])
  })
  stream.addEventListener('close', () => {
    closed = true
  })
  const phone = (bytes: number[] | Buffer) => stream.send(Buffer.from(bytes).toString('base64'))

  return {
    stream,
    phone,
    watched,
    get stopped() {
      return stopped
    },
    get closed() {
      return closed
    },
    /** The server bytes since the last call. */
    take() {
      const out = received

      received = Buffer.alloc(0)

      return out
    },
  }
}

async function handshake(page: ReturnType<typeof fakePage>) {
  const view = open(page)

  await tick()
  view.stream.send(
    JSON.stringify({ t: 'open', sessionId: 's', tab: 'tab-1', width: 390, height: 700 }),
  )
  await tick()
  assert.equal(view.take().toString(), 'RFB 003.008\n')
  view.phone(Buffer.from('RFB 003.008\n'))
  assert.deepEqual([...view.take()], [1, 1])
  view.phone([1])
  assert.deepEqual([...view.take()], [0, 0, 0, 0])
  view.phone([1])
  // No frame yet, so no ServerInit: it carries the page's size.
  assert.equal(view.take().length, 0)
  page.paint(780, 1400, [10, 20, 30])

  return view
}

test('watches the named dock tab at the phone size, and serves it once it paints', async () => {
  const page = fakePage()
  const view = await handshake(page)

  assert.deepEqual(view.watched, [['s', 'tab-1', 390, 700]])
  const init = view.take()

  assert.equal(init.readUInt16BE(0), 780)
  assert.equal(init.readUInt16BE(2), 1400)
  assert.equal(init.subarray(24).toString(), 'Nuphos tab')

  // A full update request: one ZRLE rectangle of the whole page.
  view.phone([3, 0, 0, 0, 0, 0, 3, 12, 5, 120])
  await new Promise((resolve) => setTimeout(resolve, 20))
  const update = view.take()

  assert.deepEqual([...update.subarray(0, 4)], [0, 0, 0, 1])
  assert.equal(update.readInt32BE(12), 16)
  const tiles = inflateSync(update.subarray(20), { finishFlush: constants.Z_SYNC_FLUSH })

  // 13 × 22 tiles, each solid: subencoding 1 and the pixel as B, G, R.
  assert.equal(tiles.length, 13 * 22 * 4)
  assert.deepEqual([...tiles.subarray(0, 4)], [1, 10, 20, 30])
})

test('pointer and keys go to the page in CSS pixels, never to the Mac', async () => {
  const page = fakePage()
  const view = await handshake(page)

  view.take()
  view.phone([5, 1, 0, 200, 1, 144])
  view.phone([5, 0, 0, 200, 1, 144])
  assert.deepEqual(
    page.events.filter((event) => event.type !== 'mouseMove'),
    [
      { type: 'mouseDown', x: 100, y: 200, button: 'left', clickCount: 1, modifiers: [] },
      { type: 'mouseUp', x: 100, y: 200, button: 'left', clickCount: 1, modifiers: [] },
    ],
  )
  page.events.length = 0
  view.phone([4, 1, 0, 0, 0, 0, 0, 0x61])
  view.phone([4, 0, 0, 0, 0, 0, 0, 0x61])
  view.phone([4, 1, 0, 0, 0, 0, 0xff, 0x08])
  assert.deepEqual(page.events, [
    { type: 'char', keyCode: 'a', modifiers: [] },
    { type: 'keyDown', keyCode: 'Backspace', modifiers: [] },
  ])
})

test('closing stops the frames and the watch', async () => {
  const page = fakePage()
  const view = await handshake(page)

  view.stream.close()
  assert.equal(page.subscribed, false)
  assert.equal(view.stopped, 1)
})

test('a tab not in the dock closes the stream', async () => {
  const view = open(null)

  await tick()
  view.stream.send(
    JSON.stringify({ t: 'open', sessionId: 's', tab: 'gone', width: 390, height: 700 }),
  )
  await tick()
  assert.equal(view.closed, true)
})

test("taps land where they show while the tab keeps the dock's own width on the Mac", async () => {
  // The phone asked for 390 CSS px, but the tab is on the Mac's screen in a 500 px dock at 2×.
  const page = fakePage(500)
  const view = open(page)

  await tick()
  view.stream.send(
    JSON.stringify({ t: 'open', sessionId: 's', tab: 'tab-1', width: 390, height: 700 }),
  )
  await tick()
  view.phone(Buffer.from('RFB 003.008\n'))
  view.phone([1])
  view.phone([1])
  page.paint(1000, 1400, [0, 0, 0])
  await tick()
  view.phone([5, 1, 1, 244, 1, 144])
  assert.deepEqual(
    page.events.find((event) => event.type === 'mouseDown'),
    { type: 'mouseDown', x: 250, y: 200, button: 'left', clickCount: 1, modifiers: [] },
  )
})

test('ClientCutText is skipped by its length, the extended form too', async () => {
  const page = fakePage()
  const view = await handshake(page)
  const text = Buffer.from('hi')

  view.phone([6, 0, 0, 0, 0xff, 0xff, 0xff, 0xfe, ...text, 5, 1, 0, 200, 1, 144])
  assert.equal(view.closed, false)
  assert.ok(page.events.some((event) => event.type === 'mouseDown'))
})
