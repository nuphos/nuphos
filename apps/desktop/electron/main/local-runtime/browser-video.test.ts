import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { startRecording, stopRecording } from './browser-recording.ts'
import { startVideo, stopVideo } from './browser-video.ts'

import type { RecordedTab } from './browser-recording.ts'

const temp = mkdtempSync(join(tmpdir(), 'video-test-'))
const output = { dir: temp, creator: { name: 'Nuphos Desktop', version: '1.0.0' } }

/** A tab whose debugger records the commands it is sent. */
function tab({ failScreencast = false, failScreenshot = false } = {}) {
  const debug = Object.assign(new EventEmitter(), {
    commands: [] as { method: string; params?: object }[],
    attached: false,
    attach: () => {
      debug.attached = true
    },
    detach: () => {
      debug.attached = false
    },
    isAttached: () => debug.attached,
    sendCommand(method: string, params?: object) {
      debug.commands.push({ method, params })
      if (failScreencast && method === 'Page.startScreencast')
        return Promise.reject(new Error('screencast refused'))
      if (failScreenshot && method === 'Page.captureScreenshot')
        return Promise.reject(new Error('screenshot refused'))

      return Promise.resolve(method === 'Page.captureScreenshot' ? { data: 'SHOT' } : {})
    },
  })
  const frame = (data: string, sessionId: number) =>
    debug.emit('message', {}, 'Page.screencastFrame', { data, sessionId, metadata: {} })

  return { contents: { id: 3, debugger: debug } as unknown as RecordedTab, debug, frame }
}

/** A helper page that encodes nothing: `finish(ms)` answers with one frame's chunk. */
function helper({ fail }: { fail?: 'setup' | 'finish' } = {}) {
  const page = {
    scripts: [] as string[],
    closed: false,
    evaluate: (script: string) => {
      page.scripts.push(script)
      const finish = script.startsWith('finish(')

      if (fail === 'setup' && !finish && !script.startsWith('draw('))
        return Promise.reject(new Error('no VideoEncoder'))
      if (fail === 'finish' && finish) return Promise.reject(new Error('encoder crashed'))

      return Promise.resolve(finish ? JSON.stringify([{ ms: 0, key: true, data: 'VlA4' }]) : null)
    },
    close: () => {
      page.closed = true
    },
  }

  return page
}

const methods = (debug: ReturnType<typeof tab>['debug']) => debug.commands.map((c) => c.method)

test('record_start with a helper also records what the tab shows, and record_stop writes it as WebM', async () => {
  const { contents, debug, frame } = tab()
  const page = helper()

  await startRecording(contents, () => Promise.resolve(page))
  assert.ok(methods(debug).includes('Page.startScreencast'))
  frame('AAAA', 1)
  await new Promise((resolve) => setImmediate(resolve))
  // Every frame is acknowledged, or Chromium sends no more, and drawn in the helper page.
  assert.deepEqual(debug.commands.at(-1), {
    method: 'Page.screencastFrameAck',
    params: { sessionId: 1 },
  })
  assert.ok(page.scripts.some((s) => s.startsWith('draw("AAAA", ')))

  const result = await stopRecording(contents, output)

  assert.ok(methods(debug).includes('Page.stopScreencast'))
  assert.equal(page.closed, true)
  const video = result.video && 'file' in result.video ? result.video : undefined

  assert.ok(video?.file.endsWith('.webm'))
  // An EBML header, then the frame the helper encoded.
  const bytes = readFileSync(video?.file ?? '')

  assert.equal(bytes.subarray(0, 4).toString('hex'), '1a45dfa3')
  assert.ok(bytes.includes('VP8'))
  assert.equal(video?.frames, 1)
  assert.equal(video?.truncated, false)
})

test('record_start without a helper records no video, as before', async () => {
  const { contents, debug } = tab()

  await startRecording(contents)
  assert.ok(!methods(debug).includes('Page.startScreencast'))
  assert.equal((await stopRecording(contents, output)).video, undefined)
})

test('a video past its frame budget stops taking frames and says it was cut short', async () => {
  const { contents, debug, frame } = tab()
  const page = helper()
  const video = await startVideo(contents.debugger, () => Promise.resolve(page), {
    maxMs: 60_000,
    maxBytes: 6,
  })

  frame('AAAA', 1) // 3 bytes
  frame('AAAA', 2) // 6 bytes: at the budget
  frame('AAAA', 3) // past it: not drawn
  await new Promise((resolve) => setImmediate(resolve))
  assert.ok(methods(debug).includes('Page.stopScreencast'))
  assert.equal(page.scripts.filter((s) => s.startsWith('draw("AAAA", ')).length, 2)

  const done = await stopVideo(video, join(temp, 'cut.webm'))

  assert.equal(done.truncated, true)
  assert.equal(done.frames, 2)
})

test('a video that fails to start closes its helper page and leaves no listener behind', async () => {
  for (const [failing, page] of [
    [tab(), helper({ fail: 'setup' })],
    [tab({ failScreencast: true }), helper()],
  ] as const) {
    await assert.rejects(startVideo(failing.contents.debugger, () => Promise.resolve(page)))
    assert.equal(page.closed, true)
    assert.equal(failing.debug.listenerCount('message'), 0)
  }
})

test('a video that fails to finish still writes the HAR, detaches, and says the video failed', async () => {
  const { contents, debug } = tab()
  const page = helper({ fail: 'finish' })

  await startRecording(contents, () => Promise.resolve(page))
  const result = await stopRecording(contents, output)

  assert.ok(result.file.endsWith('.har'))
  assert.match(readFileSync(result.file, 'utf8'), /"version":"1.2"/)
  assert.deepEqual(result.video, { failed: 'encoder crashed' })
  assert.equal(debug.isAttached(), false)
  assert.equal(debug.listenerCount('message'), 0)
  assert.equal(page.closed, true)
})

test('a video starts with the page as it is at record_start, before any screencast frame', async () => {
  const { contents, debug } = tab()
  const page = helper()

  await startVideo(contents.debugger, () => Promise.resolve(page))
  // A tab that does not repaint sends no frame, and the video would only start at its next change.
  assert.ok(page.scripts.includes('draw("SHOT", 0)'))
  assert.ok(
    methods(debug).indexOf('Page.captureScreenshot') <
      methods(debug).indexOf('Page.startScreencast'),
  )
})

test('a refused first screenshot still starts the video', async () => {
  const { contents, debug } = tab({ failScreenshot: true })

  await startVideo(contents.debugger, () => Promise.resolve(helper()))
  assert.ok(methods(debug).includes('Page.startScreencast'))
})

test('each frame is encoded at the time it arrived, however late the helper runs', async () => {
  const { contents, frame } = tab()
  const page = helper()

  await startVideo(contents.debugger, () => Promise.resolve(page))
  await new Promise((resolve) => setTimeout(resolve, 300))
  frame('AAAA', 1)
  const at = Number(/^draw\("AAAA", (\d+)\)$/.exec(page.scripts.at(-1) ?? '')?.[1])

  assert.ok(at >= 300 && at < 1000, String(at))
})
