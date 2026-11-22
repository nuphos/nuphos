// #3887: a computer running only `nuphos agent` has a headless local_browser. The real host
// opens a page on this machine's Chromium, screenshots it, and records its traffic as a HAR that
// comes back through the tunnel. #3895: and what the page showed, as a WebM that plays.
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'

import { agentLog } from './agent-log.ts'
import { forgetComputer } from './computer-scenarios.ts'
import { artifacts, until } from './processes.ts'
import { startSecondComputer } from './second-computer.ts'

import type { Stack } from './stack.ts'
import type { Scenario } from './ui.ts'
import type { AddressInfo } from 'node:net'

type Call = [name: string, args: object]
type Content = { type: string; text?: string; data?: string }

/** One turn whose agent makes `calls` in order on a conversation that selected `deviceId`. */
async function callAllOn(stack: Stack, deviceId: string, calls: Call[]) {
  const lines = calls.map(
    ([name, args]) => `E2E_CALL ${name} ${JSON.stringify({ label: 'Call it', ...args })}`,
  )
  const text = `Call them\n${lines.join('\n')}\nE2E_DELIVERY:${randomUUID()}`
  const from = agentLog(stack).length
  let answers: Content[][] = []

  void fetch(`${stack.apiUrl}/agent/chat`, {
    method: 'POST',
    headers: { authorization: `Bearer ${stack.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      id: randomUUID(),
      teamId: stack.teamId,
      permissionMode: 'bypass',
      credentialAccess: { deviceIds: [deviceId] },
      messages: [{ id: randomUUID(), role: 'user', parts: [{ type: 'text', text }] }],
    }),
  })
    .then(async (response) => response.text())
    .catch(() => undefined)
  await until('every call to answer', async () => {
    answers = agentLog(stack)
      .slice(from)
      .filter((item) => item.event === 'called')
      .map((item) => (item.result as { content?: Content[] } | undefined)?.content ?? [])

    return answers.length === calls.length
  })

  return answers
}

/** The newest WebM record_stop wrote under a computer's agent home. */
function newestVideo(home: string): string | undefined {
  const dir = join(home, '.nuphos-agent', 'har')

  return existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => name.endsWith('.webm'))
        .sort()
        .map((name) => join(dir, name))
        .at(-1)
    : undefined
}

const textOf = (content: Content[]) => content.map((c) => c.text ?? '').join('\n')

function must(ok: boolean, message: string) {
  if (!ok) throw new Error(message)
}

/** A page that keeps moving, so a video of it has frames to show. */
const MOVING =
  '<div id="box" style="width:240px;height:240px;background:#2a6"></div>' +
  '<script>let x = 0; (function move() { x = (x + 9) % 1100; box.style.transform = `translateX(${x}px)`; requestAnimationFrame(move) })()</script>'

/** Plays /video.webm to its end, then seeks to its middle: its size and length, once it decoded. */
export const PLAY_VIDEO = `(async () => {
  const video = document.querySelector('video')
  if (video.readyState < 2)
    await new Promise((loaded, failed) => {
      video.onloadeddata = loaded
      video.onerror = () => failed(new Error('The video did not decode: ' + video.error?.message))
    })
  video.currentTime = 1e9
  await new Promise((seeked) => (video.onseeked = seeked))
  const seconds = video.duration
  video.currentTime = seconds / 2
  await new Promise((seeked) => (video.onseeked = seeked))
  return { width: video.videoWidth, height: video.videoHeight, seconds }
})()`

/** A page on this machine, whose second request is the one the recording must catch; /play
 * plays the video file `video` names. */
export async function servePage(video: () => string | undefined = () => undefined) {
  const server = createServer((request, response) => {
    const file = video()

    if (request.url === '/video.webm' && file && existsSync(file)) {
      response.setHeader('content-type', 'video/webm')
      response.end(readFileSync(file))

      return
    }
    response.setHeader('content-type', 'text/html')
    response.end(
      request.url === '/next'
        ? '<title>E2E next</title><h1>next</h1>'
        : request.url === '/play'
          ? '<title>E2E play</title><video muted src="/video.webm"></video>'
          : `<title>E2E headless page</title><h1 style="font-size:96px">Hello from nuphos agent</h1>${MOVING}`,
    )
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))

  return {
    url: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`,
    close: () => server.close(),
  }
}

export const cliBrowserScenarios: Scenario[] = [
  {
    name: 'a computer running `nuphos agent` opens, screenshots and records a page headless, as HAR and video',
    run: async (_page, stack) => {
      const computer = await startSecondComputer(stack, 'E2E headless browser')
      // The video record_stop wrote, found when /play asks for it in the middle of the turn.
      const site = await servePage(() => newestVideo(computer.home))
      const wait = 'new Promise((done) => setTimeout(done, 2000))'

      try {
        const answers = await callAllOn(stack, computer.deviceId, [
          ['local_browser', { action: 'open', url: `${site.url}/` }],
          ['local_browser', { action: 'screenshot', tab: 1 }],
          ['local_browser', { action: 'record_start', tab: 1, video: true }],
          ['local_browser', { action: 'eval', tab: 1, script: wait }],
          ['local_browser', { action: 'navigate', tab: 1, url: `${site.url}/next` }],
          ['local_browser', { action: 'record_stop', tab: 1 }],
          ['local_exec', { command: 'cat "$NUPHOS_AGENT_HOME"/har/*.har' }],
          // The host's own Chromium plays what it recorded, served from where record_stop wrote it.
          ['local_browser', { action: 'open', url: `${site.url}/play` }],
          ['local_browser', { action: 'eval', tab: 2, script: PLAY_VIDEO }],
          ['local_browser', { action: 'screenshot', tab: 2 }],
        ])
        const [opened = [], shot = [], , , , stopped = [], har = [], , played = [], frame = []] =
          answers

        must(
          textOf(opened).includes('E2E headless page'),
          `the page to open, got ${textOf(opened)}`,
        )
        const image = shot.find((c) => c.type === 'image')?.data ?? ''

        must(image.startsWith('/9j/'), `a JPEG screenshot to come back, got ${textOf(shot)}`)
        writeFileSync(join(artifacts, 'cli-browser-screenshot.jpg'), Buffer.from(image, 'base64'))
        must(
          textOf(stopped).includes('GET 200'),
          `record_stop to list the request, got ${textOf(stopped)}`,
        )
        // local_exec answers with the command's output under `stdout`.
        const file = (JSON.parse(textOf(har)) as { stdout?: string }).stdout ?? ''

        must(
          file.includes('"version":"1.2"') && file.includes(`${site.url}/next`),
          `the HAR to come back with the recorded request, got ${file.slice(0, 500)}`,
        )
        const video = (JSON.parse(textOf(stopped)) as { video?: { file: string; frames: number } })
          .video

        must(
          Boolean(video && video.frames > 0),
          `record_stop to return a video, got ${textOf(stopped)}`,
        )
        copyFileSync(video!.file, join(artifacts, 'cli-browser-video.webm'))
        const playback = JSON.parse(textOf(played)) as { width?: number; seconds?: number }

        must(
          playback.width === 1440 && (playback.seconds ?? 0) > 1,
          `the video to play at 1440 wide for over a second, got ${textOf(played)}`,
        )
        writeFileSync(
          join(artifacts, 'cli-browser-video-frame.jpg'),
          Buffer.from(frame.find((c) => c.type === 'image')?.data ?? '', 'base64'),
        )
      } finally {
        await computer.stop()
        forgetComputer(stack.mongoUri, computer.deviceId)
        site.close()
      }
    },
  },
]
