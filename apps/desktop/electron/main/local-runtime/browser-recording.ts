import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { app } from 'electron'

import type { WebContents } from 'electron'

/** Response bodies larger than this are left out of the HAR to bound memory. */
const MAX_BODY_BYTES = 1024 * 1024
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
  body?: Promise<{ body: string; base64Encoded: boolean } | undefined>
}
type Recording = { entries: Map<string, Entry>; done: Entry[]; onMessage: Listener }
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
  const dir = join(app.getPath('temp'), 'nuphos-har')
  const file = join(dir, `tab-${String(contents.id)}-${String(Date.now())}.har`)

  await mkdir(dir, { recursive: true })
  await writeFile(
    file,
    JSON.stringify({
      log: {
        version: '1.2',
        creator: { name: 'Nuphos Desktop', version: app.getVersion() },
        entries: har,
      },
    }),
  )

  return {
    file,
    requests: entries.length,
    summary: entries
      .slice(0, MAX_SUMMARY_LINES)
      .map(
        (e) =>
          `${e.request.method} ${e.error ?? String(e.response?.status ?? '-')} ${e.request.url}`,
      ),
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
    recording.entries.set(id, {
      started: params.timestamp as number,
      wallTime: params.wallTime as number,
      request: params.request as CdpRequest,
    })
  } else if (!entry) {
    return
  } else if (method === 'Network.requestWillBeSentExtraInfo') {
    // Carries the headers the browser actually sent, Cookie included.
    entry.request.headers = params.headers as Headers
  } else if (method === 'Network.responseReceived') {
    const response = params.response as CdpResponse

    // Extra-info headers that arrived first are the ones actually on the wire.
    entry.response = { ...response, headers: entry.response?.headers ?? response.headers }
  } else if (method === 'Network.responseReceivedExtraInfo') {
    entry.response = { ...entry.response, headers: params.headers as Headers } as CdpResponse
  } else if (method === 'Network.loadingFinished') {
    entry.ended = params.timestamp as number
    entry.size = params.encodedDataLength as number
    // Bodies are fetched now, before Chromium may evict them.
    if (entry.size <= MAX_BODY_BYTES)
      entry.body = contents.debugger
        .sendCommand('Network.getResponseBody', { requestId: id })
        .catch(() => {}) as Entry['body']
  } else if (method === 'Network.loadingFailed') {
    entry.ended = params.timestamp as number
    entry.error = params.errorText as string
  }
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
