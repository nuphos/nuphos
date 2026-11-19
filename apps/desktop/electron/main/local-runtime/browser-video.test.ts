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
function tab() {
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

      return Promise.resolve({})
    },
  })
  const frame = (data: string, sessionId: number) =>
    debug.emit('message', {}, 'Page.screencastFrame', { data, sessionId, metadata: {} })

  return { contents: { id: 3, debugger: debug } as unknown as RecordedTab, debug, frame }
}

/** A helper page that encodes nothing, but answers `finish()` with a WebM's bytes. */
function helper() {
  const page = {
    scripts: [] as string[],
    closed: false,
    evaluate: (script: string) => {
      page.scripts.push(script)

      return Promise.resolve(script === 'finish()' ? Buffer.from('WEBM').toString('base64') : null)
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
  assert.ok(page.scripts.includes('draw("AAAA")'))

  const result = await stopRecording(contents, output)

  assert.ok(methods(debug).includes('Page.stopScreencast'))
  assert.equal(page.closed, true)
  assert.ok(result.video?.file.endsWith('.webm'))
  assert.equal(readFileSync(result.video?.file ?? '', 'utf8'), 'WEBM')
  assert.equal(result.video?.frames, 1)
  assert.equal(result.video?.truncated, false)
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
  assert.equal(page.scripts.filter((s) => s.startsWith('draw(')).length, 2)

  const done = await stopVideo(video, join(temp, 'cut.webm'))

  assert.equal(done.truncated, true)
  assert.equal(done.frames, 2)
})
