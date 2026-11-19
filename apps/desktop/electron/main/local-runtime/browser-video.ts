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
}

/** By default a video ends after 2 minutes or 100 MB of frames, whichever comes first. */
const LIMITS = { maxMs: 120_000, maxBytes: 100 * 1024 * 1024 }
/** How long past its cap a video's helper waits for record_stop before it closes. */
const ABANDONED_MS = 10 * 60_000
/** The tab's viewport (browser-tabs.ts, cli-browser.ts): frames are drawn at that size. */
const SIZE = { width: 1440, height: 900 }

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
      chunks.push({ ms: chunk.timestamp / 1000, key: chunk.type === 'key', data: btoa(binary) })
    },
    error: (error) => (failed = error),
  })
  let drawn = Promise.resolve()
  let last
  let keyed = -Infinity
  // A key frame every 2 seconds, so the video seeks quickly.
  const encode = (image, ms) => {
    const frame = new VideoFrame(image, { timestamp: ms * 1000 })
    const keyFrame = ms - keyed >= 2000

    if (keyFrame) keyed = ms
    encoder.encode(frame, { keyFrame })
    frame.close()
  }

  encoder.configure({ codec: 'vp8', ...${JSON.stringify(SIZE)}, bitrate: 2000000 })
  window.draw = (jpeg, ms) => {
    drawn = drawn.then(async () => {
      const blob = await (await fetch('data:image/jpeg;base64,' + jpeg)).blob()

      last = await createImageBitmap(blob, { resizeWidth: ${SIZE.width}, resizeHeight: ${SIZE.height} })
      encode(last, ms)
    })
  }
  window.finish = (ms) => drawn.then(async () => {
    if (last) encode(last, ms)
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
  }

  video.expiry.unref()
  try {
    await helper.evaluate(SETUP)
    // The video's clock starts at its first frame, and a tab that does not repaint sends none
    // until it changes, so the first frame is the page as it is now.
    // A refused screenshot only loses that first frame, not the recording.
    const { data } = (await debug
      .sendCommand('Page.captureScreenshot', { format: 'jpeg', quality: 70 })
      .catch(() => ({}))) as { data?: string }

    if (data) void helper.evaluate(`draw(${JSON.stringify(data)}, 0)`).catch(() => {})
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
  video.frames++
  void video.helper
    .evaluate(`draw(${JSON.stringify(data)}, ${Date.now() - video.started})`)
    .catch(() => {})
}

function stopFrames(video: Video): void {
  if (video.stopped) return
  video.stopped = true
  video.debugger.off('message', video.onMessage)
  void video.debugger.sendCommand('Page.stopScreencast').catch(() => {})
}

/** Ends the video and writes it to `file`; returns what `record_stop` reports of it. */
export async function stopVideo(video: Video, file: string) {
  clearTimeout(video.expiry)
  stopFrames(video)
  try {
    const ms = Date.now() - video.started
    const chunks = JSON.parse((await video.helper.evaluate(`finish(${ms})`)) as string) as {
      ms: number
      key: boolean
      data: string
    }[]

    if (!chunks.length) throw new Error('No frame of the tab was recorded.')
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
