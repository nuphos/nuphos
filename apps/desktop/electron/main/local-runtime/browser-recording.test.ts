import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
  existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { before, mock, test } from 'node:test'

import type * as Recording from './browser-recording.ts'
import type { WebContents } from 'electron'

const temp = mkdtempSync(join(tmpdir(), 'har-test-'))
let recording: typeof Recording

before(async () => {
  mock.module('electron', {
    namedExports: { app: { getPath: () => temp, getVersion: () => '1.0.0' } },
  })
  recording = await import('./browser-recording.ts')
})

/** A tab whose debugger answers body requests from `bodies` and records commands. */
function tab(bodies: Record<string, string> = {}) {
  const debug = Object.assign(new EventEmitter(), {
    attached: false,
    commands: [] as string[],
    attach() {
      if (debug.attached) throw new Error('already attached')
      debug.attached = true
    },
    detach() {
      debug.attached = false
    },
    isAttached: () => debug.attached,
    sendCommand(method: string, params?: { requestId: string }) {
      debug.commands.push(method)
      const body = params && bodies[params.requestId]

      return body === undefined
        ? Promise.resolve({})
        : Promise.resolve({ body, base64Encoded: false })
    },
  })
  const contents = { id: 7, debugger: debug } as unknown as WebContents
  const send = (method: string, params: Record<string, unknown>) =>
    debug.emit('message', {}, method, params)

  return { contents, debug, send }
}

test('record_stop writes the requests, wire headers and bodies seen since record_start as HAR', async () => {
  const { contents, debug, send } = tab({ r1: '{"ok":true}' })

  await recording.startRecording(contents)
  assert.deepEqual(debug.commands, ['Network.enable'])
  // Chromium may send a request's wire headers before the request itself.
  send('Network.requestWillBeSentExtraInfo', {
    requestId: 'r1',
    headers: { Cookie: 'sid=1', 'Content-Type': 'application/x-www-form-urlencoded' },
  })
  send('Network.requestWillBeSent', {
    requestId: 'r1',
    timestamp: 10,
    wallTime: 1_700_000_000,
    request: {
      url: 'https://api.example.com/me?x=1',
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      postData: 'a=1',
    },
  })
  send('Network.responseReceivedExtraInfo', { requestId: 'r1', headers: { 'Set-Cookie': 'a=b' } })
  send('Network.responseReceived', {
    requestId: 'r1',
    response: {
      url: 'https://api.example.com/me',
      status: 200,
      statusText: 'OK',
      protocol: 'h2',
      headers: {},
      mimeType: 'application/json',
    },
  })
  send('Network.loadingFinished', { requestId: 'r1', timestamp: 10.25, encodedDataLength: 11 })
  send('Network.requestWillBeSent', {
    requestId: 'r2',
    timestamp: 11,
    wallTime: 1_700_000_001,
    request: { url: 'https://cdn.example.com/a.js', method: 'GET', headers: {} },
  })
  send('Network.loadingFailed', { requestId: 'r2', timestamp: 11.1, errorText: 'net::ERR_FAILED' })

  const result = await recording.stopRecording(contents)

  assert.equal(debug.attached, false)
  // The HAR holds live cookies, so only this user may read it.
  assert.equal(statSync(result.file).mode & 0o777, 0o600)
  assert.equal(statSync(join(temp, 'har')).mode & 0o777, 0o700)
  assert.deepEqual(result.summary, [
    'POST 200 https://api.example.com/me',
    'GET net::ERR_FAILED https://cdn.example.com/a.js',
  ])
  const [entry] = (
    JSON.parse(readFileSync(result.file, 'utf8')) as {
      log: { entries: Record<string, Record<string, unknown>>[] }
    }
  ).log.entries

  assert.equal(entry?.time, 250)
  assert.deepEqual(entry?.request?.headers, [
    { name: 'Cookie', value: 'sid=1' },
    { name: 'Content-Type', value: 'application/x-www-form-urlencoded' },
  ])
  assert.deepEqual(entry?.request?.postData, {
    mimeType: 'application/x-www-form-urlencoded',
    text: 'a=1',
  })
  assert.deepEqual(entry?.response?.headers, [{ name: 'Set-Cookie', value: 'a=b' }])
  assert.deepEqual(entry?.response?.content, {
    size: 11,
    mimeType: 'application/json',
    text: '{"ok":true}',
  })
})

test('a redirect keeps each hop as its own entry', async () => {
  const { contents, send } = tab()
  const request = (url: string) => ({ url, method: 'GET', headers: {} })

  await recording.startRecording(contents)
  send('Network.requestWillBeSent', {
    requestId: 'r',
    timestamp: 1,
    wallTime: 1,
    request: request('http://a.test/'),
  })
  send('Network.requestWillBeSent', {
    requestId: 'r',
    timestamp: 2,
    wallTime: 2,
    request: request('https://a.test/'),
    redirectResponse: { status: 301, headers: { Location: 'https://a.test/' }, mimeType: '' },
  })

  const { summary } = await recording.stopRecording(contents)

  assert.deepEqual(summary, ['GET 301 http://a.test/', 'GET - https://a.test/'])
})

test('record_stop without record_start, or a second record_start, fails', async () => {
  const { contents } = tab()

  await assert.rejects(recording.stopRecording(contents), /not recording/)
  await recording.startRecording(contents)
  await assert.rejects(recording.startRecording(contents), /already recording/)
})

test('record_stop deletes HARs older than a day', async () => {
  const dir = join(temp, 'har')
  const old = join(dir, 'old.har')
  const recent = join(dir, 'recent.har')

  mkdirSync(dir, { recursive: true })
  writeFileSync(old, '{}')
  writeFileSync(recent, '{}')
  utimesSync(old, new Date(Date.now() - 2 * 86_400_000), new Date(Date.now() - 2 * 86_400_000))
  const { contents } = tab()

  await recording.startRecording(contents)
  await recording.stopRecording(contents)
  assert.equal(existsSync(old), false)
  assert.equal(existsSync(recent), true)
})
