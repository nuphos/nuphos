// What a recorded tab showed, as a WebM. Its screencast frames are drawn on a canvas in a helper
// page whose MediaRecorder encodes them: both hosts are Chromium (Desktop's Electron, the CLI
// host's headless browser), so no video encoder ships with Nuphos.
import { writeFile } from 'node:fs/promises'

import type { RecordedTab } from './browser-recording.ts'

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

// Frames are drawn in arrival order; MediaRecorder keeps their timing, as it records in real time.
// A page that stops changing sends no frames, so finish draws the last one again: the video
// then lasts until record_stop instead of ending at the page's last change.
const SETUP = `(() => {
  const canvas = Object.assign(document.createElement('canvas'), ${JSON.stringify(SIZE)})
  const context = canvas.getContext('2d')
  const chunks = []
  const recorder = new MediaRecorder(canvas.captureStream(30), { mimeType: 'video/webm;codecs=vp8' })
  let drawn = Promise.resolve()
  let last

  document.body.append(canvas)
  recorder.ondataavailable = (event) => chunks.push(event.data)
  recorder.start(1000)
  window.draw = (jpeg) => {
    drawn = drawn.then(async () => {
      last = await createImageBitmap(await (await fetch('data:image/jpeg;base64,' + jpeg)).blob())
      context.drawImage(last, 0, 0, canvas.width, canvas.height)
    })
  }
  window.finish = () => drawn.then(() => new Promise((done) => {
    recorder.onstop = async () => {
      const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer())
      let binary = ''

      for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768))
      done(btoa(binary))
    }
    if (last) context.drawImage(last, 0, 0, canvas.width, canvas.height)
    setTimeout(() => recorder.stop(), 200)
  }))
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
  void video.helper.evaluate(`draw(${JSON.stringify(data)})`).catch(() => {})
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
    const webm = Buffer.from((await video.helper.evaluate('finish()')) as string, 'base64')

    await writeFile(file, webm, { mode: 0o600 })

    return {
      file,
      seconds: Math.round((Date.now() - video.started) / 100) / 10,
      bytes: webm.length,
      frames: video.frames,
      truncated: video.truncated,
    }
  } finally {
    video.helper.close()
  }
}
