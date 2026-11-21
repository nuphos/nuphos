// What a recorded tab showed, as a WebM. A helper page's VideoEncoder encodes its screencast
// frames: both hosts are Chromium (Desktop's Electron, the CLI host's headless browser), so no
// video encoder ships with Nuphos.
import { writeFile } from 'node:fs/promises'

import { webm } from './webm.ts'

import type { RecordedTab } from './browser-recording.ts'

/**
 * Where a helper page is opened: no request leaves for it, the host answers it with a blank page.
 * The page has to be on https, as VideoEncoder only exists in a secure context.
 */
export const HELPER_URL = 'https://video.nuphos.invalid/'
/** A blank page the host keeps for one recording: Desktop's hidden window, a headless one on the CLI. */
export type Helper = { evaluate: (script: string) => Promise<unknown>; close: () => void }
export type OpenHelper = () => Promise<Helper>
type Debugger = RecordedTab['debugger']
type Listener = Parameters<Debugger['on']>[1]

export type Video = {
  debugger: Debugger
  helper: Helper
  onMessage: Listener
  started: number
  frames: number
  bytes: number
  stopped: boolean
  truncated: boolean
  limits: { maxMs: number; maxBytes: number }
  /** Closes the helper of a recording nobody stopped, say because its tab closed first. */
  expiry: ReturnType<typeof setTimeout>
  /** The page as it is now, as a JPEG: the frames a page that does not repaint never sends. */
  snapshot: Snapshot
  /** Whether any frame was drawn yet, the first one at record_start included. */
  drawn: boolean
}
export type Snapshot = () => Promise<string | undefined>

/** A tab's own screenshot over its debugger, which the CLI host's headless pages always answer. */
const screenshot =
  (debug: Debugger): Snapshot =>
  () =>
    debug
      .sendCommand('Page.captureScreenshot', { format: 'jpeg', quality: 70 })
      .then((shot) => (shot as { data?: string }).data)

/** Desktop captures its tab with capturePage, which a hidden window answers when CDP does not. */
export const snapshotOf = (tab: RecordedTab): Snapshot =>
  tab.capturePage
    ? () =>
        // Called on the tab itself: WebContents methods need their `this`.
        tab.capturePage!().then((image) =>
          image.isEmpty() ? undefined : image.toJPEG(70).toString('base64'),
        )
    : screenshot(tab.debugger)

/** By default a video ends after 2 minutes or 100 MB of frames, whichever comes first. */
const LIMITS = { maxMs: 120_000, maxBytes: 100 * 1024 * 1024 }
/** How long past its cap a video's helper waits for record_stop before it closes. */
const ABANDONED_MS = 10 * 60_000
/** The tab's viewport (browser-tabs.ts, cli-browser.ts): frames are drawn at that size. */
const SIZE = { width: 1440, height: 900 }
/** How long record_start waits for the first frame: a hidden Electron window may never paint one. */
const SCREENSHOT_MS = 1_000
/** How long record_stop waits for the helper to hand the video over. */
const FINISH_MS = 15_000

/** `work`, or `fallback()` once `ms` have passed. */
const within = <T>(work: Promise<T>, ms: number, fallback: () => T | Promise<T>) => {
  let timer: ReturnType<typeof setTimeout> | undefined

  return Promise.race([
    work,
    new Promise<T>((resolve, reject) => {
      timer = setTimeout(() => void Promise.resolve().then(fallback).then(resolve, reject), ms)
    }),
  ]).finally(() => clearTimeout(timer))
}

/** How far the helper got with the frames it was sent, for an error that says why a video failed. */
const progressOf = async (video: Video) =>
  String(await within(video.helper.evaluate('JSON.stringify(progress)'), 2_000, () => 'no answer'))

// Each frame is encoded at the time it arrived, given by the host: a helper page that runs late,
// as a headless one may, still gives the video its real timing. finish encodes the last frame
// again at record_stop, so a page that stopped changing still lasts until then.
const SETUP = `(() => {
  const chunks = []
  let failed
  const encoder = new VideoEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength)

      chunk.copyTo(data)
      let binary = ''

      for (let i = 0; i < data.length; i += 32768) binary += String.fromCharCode(...data.subarray(i, i + 32768))
      progress.chunks++
      chunks.push({ ms: chunk.timestamp / 1000, key: chunk.type === 'key', data: btoa(binary) })
    },
    error: (error) => (failed = error),
  })
  let drawn = Promise.resolve()
  // How far the frames got, for a record_stop that times out.
  window.progress = { drawn: 0, decoded: 0, encoded: 0, chunks: 0, flushing: false }
  let last
  let keyed = -Infinity
  // A key frame every 2 seconds, so the video seeks quickly.
  const encode = (image, ms) => {
    const frame = new VideoFrame(image, { timestamp: ms * 1000 })
    const keyFrame = ms - keyed >= 2000

    if (keyFrame) keyed = ms
    encoder.encode(frame, { keyFrame })
    progress.encoded++
    frame.close()
  }

  encoder.configure({ codec: 'vp8', ...${JSON.stringify(SIZE)}, bitrate: 2000000 })
  // A page can send frames faster than they encode (some 300 a second on the e2e runner), so only
  // the newest one waiting is encoded, once the encoder has room: the work stays at the encoder's
  // pace, and the last frame is always the page as it last was.
  let waiting
  window.draw = (jpeg, ms) => {
    progress.drawn++
    if (!waiting) drawn = drawn.then(next)
    waiting = { jpeg, ms }
  }
  const next = async () => {
    const { jpeg, ms } = waiting

    waiting = undefined
    const blob = await (await fetch('data:image/jpeg;base64,' + jpeg)).blob()

    last = await createImageBitmap(blob, { resizeWidth: ${SIZE.width}, resizeHeight: ${SIZE.height} })
    progress.decoded++
    encode(last, ms)
    while (encoder.encodeQueueSize > 1)
      await new Promise((done) => encoder.addEventListener('dequeue', done, { once: true }))
  }
  window.finish = (ms) => drawn.then(async () => {
    if (last) encode(last, ms)
    progress.flushing = true
    await encoder.flush()
    if (failed) throw failed

    return JSON.stringify(chunks)
  })
})()`

/** Starts recording what the tab shows, on a debugger already attached to it. */
export async function startVideo(
  debug: Debugger,
  open: OpenHelper,
  limits = LIMITS,
  snapshot = screenshot(debug),
): Promise<Video> {
  const helper = await open()
  const video: Video = {
    debugger: debug,
    helper,
    onMessage: (_event, method, params) => {
      if (method === 'Page.screencastFrame') onFrame(video, params)
    },
    started: Date.now(),
    frames: 0,
    bytes: 0,
    stopped: false,
    truncated: false,
    limits,
    expiry: setTimeout(() => {
      stopFrames(video)
      helper.close()
    }, limits.maxMs + ABANDONED_MS),
    snapshot,
    drawn: false,
  }

  video.expiry.unref()
  try {
    await helper.evaluate(SETUP)
    // The video's clock starts at its first frame, and a tab that does not repaint sends none
    // until it changes, so the first frame is the page as it is now. One that does not come in
    // a second is taken again at record_stop instead.
    const data = await within(
      snapshot().catch(() => undefined),
      SCREENSHOT_MS,
      () => undefined,
    )

    if (data) draw(video, data, 0)
    debug.on('message', video.onMessage)
    await debug.sendCommand('Page.startScreencast', {
      format: 'jpeg',
      quality: 70,
      maxWidth: SIZE.width,
      maxHeight: SIZE.height,
    })
  } catch (error) {
    clearTimeout(video.expiry)
    debug.off('message', video.onMessage)
    helper.close()
    throw error
  }

  return video
}

function onFrame(video: Video, params: Record<string, unknown>): void {
  const data = params.data as string

  // Chromium sends the next frame only once this one is acknowledged.
  void video.debugger
    .sendCommand('Page.screencastFrameAck', { sessionId: params.sessionId })
    .catch(() => {})
  if (video.stopped) return
  const bytes = video.bytes + (data.length * 3) / 4

  if (bytes > video.limits.maxBytes || Date.now() - video.started > video.limits.maxMs) {
    video.truncated = true
    stopFrames(video)

    return
  }
  video.bytes = bytes
  draw(video, data, Date.now() - video.started)
}

function stopFrames(video: Video): void {
  if (video.stopped) return
  video.stopped = true
  video.debugger.off('message', video.onMessage)
  void video.debugger.sendCommand('Page.stopScreencast').catch(() => {})
}

function draw(video: Video, jpeg: string, ms: number): void {
  video.drawn = true
  video.frames++
  void video.helper.evaluate(`draw(${JSON.stringify(jpeg)}, ${String(ms)})`).catch(() => {})
}

/** Ends the video and writes it to `file`; returns what `record_stop` reports of it. */
export async function stopVideo(video: Video, file: string) {
  clearTimeout(video.expiry)
  stopFrames(video)
  try {
    const ms = Date.now() - video.started

    // A still page sent nothing, so it is captured now: it looked this way all along.
    if (!video.drawn) {
      const still = await within(
        video.snapshot().catch(() => undefined),
        FINISH_MS,
        () => undefined,
      )

      if (still) draw(video, still, 0)
    }
    const finished = await within(video.helper.evaluate(`finish(${ms})`), FINISH_MS, async () => {
      throw new Error(`The video did not finish in 15 s (${await progressOf(video)}).`)
    })
    const chunks = JSON.parse(finished as string) as {
      ms: number
      key: boolean
      data: string
    }[]

    if (!chunks.length)
      throw new Error(
        `No frame of the tab was recorded (${String(video.frames)} sent, ${await progressOf(video)}).`,
      )
    const bytes = webm(
      chunks.map((c) => ({ ...c, data: Buffer.from(c.data, 'base64') })),
      SIZE,
      ms,
    )

    await writeFile(file, bytes, { mode: 0o600 })

    return {
      file,
      seconds: Math.round(ms / 100) / 10,
      bytes: bytes.length,
      frames: video.frames,
      truncated: video.truncated,
    }
  } finally {
    video.helper.close()
  }
}
