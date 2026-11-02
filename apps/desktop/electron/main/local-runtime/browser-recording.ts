import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { app } from 'electron'

import type { WebContents } from 'electron'

/** Response bodies larger than this, or past the recording's total, are left out of the HAR. */
const MAX_BODY_BYTES = 1024 * 1024
const MAX_TOTAL_BODY_BYTES = 64 * 1024 * 1024
/** HARs hold live cookies, so older ones are deleted at the next `record_stop`. */
const KEEP_MS = 24 * 60 * 60 * 1000
/** How many requests `record_stop` lists inline; the HAR file has them all. */
const MAX_SUMMARY_LINES = 200

type Headers = Record<string, string>
type CdpRequest = { url: string; method: string; headers: Headers; postData?: string }
type CdpResponse = {
  url: string
  status: number
  statusText: string
  protocol?: string
  headers: Headers
  mimeType: string
}
type Entry = {
  started: number
  wallTime: number
  request: CdpRequest
  response?: CdpResponse
  ended?: number
  size?: number
  error?: string
  /** Whether `request.headers` already came from the wire (ExtraInfo). */
  wire?: boolean
  body?: Promise<{ body: string; base64Encoded: boolean } | undefined>
}
type Recording = {
  entries: Map<string, Entry>
  done: Entry[]
  /** Wire headers that arrived before their request, which Chromium allows. */
  early: Map<string, Headers>
  bodyBytes: number
  bodiesOmitted: number
  onMessage: Listener
}
type Listener = (event: unknown, method: string, params: Record<string, unknown>) => void

const recordings = new WeakMap<WebContents, Recording>()

/** Starts capturing a tab's network traffic over its own debugger, so the page keeps its session. */
export async function startRecording(contents: WebContents): Promise<void> {
  if (recordings.has(contents)) throw new Error('This tab is already recording.')
  try {
    contents.debugger.attach('1.3')
  } catch {
    throw new Error('The tab is already being debugged (close its DevTools) and cannot record.')
  }
  const recording: Recording = {
    entries: new Map(),
    done: [],
    early: new Map(),
    bodyBytes: 0,
    bodiesOmitted: 0,
    onMessage: (_event, method, params) => {
      onNetworkEvent(contents, recording, method, params)
    },
  }

  contents.debugger.on('message', recording.onMessage)
  recordings.set(contents, recording)
  await contents.debugger.sendCommand('Network.enable')
}

/** Stops the tab's recording and writes it as a HAR file; returns its path and a summary. */
export async function stopRecording(contents: WebContents) {
  const recording = recordings.get(contents)

  if (!recording) throw new Error('This tab is not recording; start with action "record_start".')
  recordings.delete(contents)
  const entries = [...recording.done, ...recording.entries.values()].sort(
    (a, b) => a.started - b.started,
  )
  const har = await Promise.all(entries.map(harEntry))

  contents.debugger.off('message', recording.onMessage)
  if (contents.debugger.isAttached()) contents.debugger.detach()
  const dir = join(app.getPath('userData'), 'har')
  const file = join(dir, `tab-${String(contents.id)}-${String(Date.now())}.har`)

  await mkdir(dir, { recursive: true, mode: 0o700 })
  // Best effort: a concurrent record_stop may delete the same files.
  await prune(dir).catch(() => {})
  await writeFile(
    file,
    JSON.stringify({
      log: {
        version: '1.2',
        creator: { name: 'Nuphos Desktop', version: app.getVersion() },
        entries: har,
      },
    }),
    { mode: 0o600 },
  )

  return {
    file,
    requests: entries.length,
    bodiesOmitted: recording.bodiesOmitted,
    // Query strings can carry tokens; the HAR keeps the full URL.
    summary: entries
      .slice(0, MAX_SUMMARY_LINES)
      .map(
        (e) =>
          `${e.request.method} ${e.error ?? String(e.response?.status ?? '-')} ${e.request.url.split(/[?#]/)[0] ?? ''}`,
      ),
  }
}

async function prune(dir: string): Promise<void> {
  for (const name of await readdir(dir)) {
    const path = join(dir, name)

    if (Date.now() - (await stat(path)).mtimeMs > KEEP_MS) await rm(path, { force: true })
  }
}

function onNetworkEvent(
  contents: WebContents,
  recording: Recording,
  method: string,
  params: Record<string, unknown>,
): void {
  const id = params.requestId as string
  const entry = recording.entries.get(id)

  if (method === 'Network.requestWillBeSent') {
    // A redirect reuses the request id: the hop so far ends with the redirect response.
    if (entry && params.redirectResponse) {
      entry.response = params.redirectResponse as CdpResponse
      entry.ended = params.timestamp as number
      recording.done.push(entry)
    }
    const request = params.request as CdpRequest
    const wire = recording.early.get(id)

    recording.early.delete(id)
    recording.entries.set(id, {
      started: params.timestamp as number,
      wallTime: params.wallTime as number,
      request: { ...request, headers: wire ?? request.headers },
      wire: wire !== undefined,
    })
  } else if (method === 'Network.requestWillBeSentExtraInfo') {
    // Carries the headers the browser actually sent, Cookie included.
    if (entry && !entry.wire) {
      entry.request.headers = params.headers as Headers
      entry.wire = true
    } else recording.early.set(id, params.headers as Headers)
  } else if (!entry) {
    return
  } else if (method === 'Network.responseReceived') {
    const response = params.response as CdpResponse

    // Extra-info headers that arrived first are the ones actually on the wire.
    entry.response = { ...response, headers: entry.response?.headers ?? response.headers }
  } else if (method === 'Network.responseReceivedExtraInfo') {
    entry.response = { ...entry.response, headers: params.headers as Headers } as CdpResponse
  } else if (method === 'Network.loadingFinished') {
    entry.ended = params.timestamp as number
    entry.size = params.encodedDataLength as number
    fetchBody(contents, recording, id, entry)
  } else if (method === 'Network.loadingFailed') {
    entry.ended = params.timestamp as number
    entry.error = params.errorText as string
  }
}

/** Fetches a finished response's body now, before Chromium may evict it, within the size caps. */
function fetchBody(contents: WebContents, recording: Recording, id: string, entry: Entry): void {
  const size = entry.size ?? 0

  if (size > MAX_BODY_BYTES || recording.bodyBytes + size > MAX_TOTAL_BODY_BYTES) {
    recording.bodiesOmitted++

    return
  }
  recording.bodyBytes += size
  entry.body = contents.debugger
    .sendCommand('Network.getResponseBody', { requestId: id })
    .catch(() => {}) as Entry['body']
}

const pairs = (headers: Headers = {}) =>
  Object.entries(headers).map(([name, value]) => ({ name, value }))

const header = (headers: Headers = {}, name: string) =>
  Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1] ?? ''

function harRequest({ request, response }: Entry) {
  const postData = request.postData ?? ''

  return {
    method: request.method,
    url: request.url,
    httpVersion: response?.protocol ?? '',
    headers: pairs(request.headers),
    queryString: [...new URL(request.url).searchParams].map(([name, value]) => ({ name, value })),
    cookies: [],
    headersSize: -1,
    bodySize: postData.length,
    ...(postData
      ? { postData: { mimeType: header(request.headers, 'content-type'), text: postData } }
      : {}),
  }
}

async function harContent({ response, size = 0, body }: Entry) {
  const content = await body

  return {
    size,
    mimeType: response?.mimeType ?? '',
    ...(content?.body === undefined ? {} : { text: content.body }),
    ...(content?.base64Encoded ? { encoding: 'base64' } : {}),
  }
}

async function harResponse(entry: Entry) {
  const { response } = entry

  return {
    status: response?.status ?? 0,
    statusText: response?.statusText ?? entry.error ?? '',
    httpVersion: response?.protocol ?? '',
    headers: pairs(response?.headers),
    cookies: [],
    content: await harContent(entry),
    redirectURL: header(response?.headers, 'location'),
    headersSize: -1,
    bodySize: entry.size ?? 0,
  }
}

async function harEntry(entry: Entry) {
  const time = entry.ended === undefined ? -1 : (entry.ended - entry.started) * 1000

  return {
    startedDateTime: new Date(entry.wallTime * 1000).toISOString(),
    time,
    request: harRequest(entry),
    response: await harResponse(entry),
    cache: {},
    timings: { send: 0, wait: Math.max(time, 0), receive: 0 },
  }
}
