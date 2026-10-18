import assert from 'node:assert/strict'
import { test } from 'node:test'

import { LocalBrowserStream } from './browser-stream.ts'

import type { BrowserCall } from './browser-stream.ts'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

test('runs one call and closes with its result', async () => {
  const calls: BrowserCall[] = []
  const stream = new LocalBrowserStream(async (call) => {
    calls.push(call)

    return { content: [{ type: 'text', text: 'ok' }] }
  })
  const sent: unknown[] = []
  let closed = false

  stream.addEventListener('message', (event) => sent.push(JSON.parse(String(event.data))))
  stream.addEventListener('close', () => {
    closed = true
  })
  await tick()
  stream.send(JSON.stringify({ t: 'call', action: 'tabs', team: 't1' }))
  stream.send(JSON.stringify({ t: 'call', action: 'tabs', team: 't1' }))
  await tick()

  assert.equal(calls.length, 1)
  assert.equal(calls[0]?.action, 'tabs')
  assert.deepEqual(sent, [{ t: 'result', result: { content: [{ type: 'text', text: 'ok' }] } }])
  assert.equal(closed, true)
})

test('a throwing action becomes an error result', async () => {
  const stream = new LocalBrowserStream(() => Promise.reject(new Error('boom')))
  const sent: { result: { isError?: boolean; content: { text: string }[] } }[] = []

  stream.addEventListener('message', (event) => sent.push(JSON.parse(String(event.data))))
  await tick()
  stream.send(JSON.stringify({ t: 'call', action: 'eval', team: 't1', tab: 1, script: 'x' }))
  await tick()

  assert.equal(sent[0]?.result.isError, true)
  assert.equal(sent[0]?.result.content[0]?.text, 'boom')
})
