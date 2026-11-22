import { expect, test } from 'bun:test'
import { Hono } from 'hono'

import { answerMcp } from './http-answer'

import type { JsonRpcResponse } from './protocol'

const result: JsonRpcResponse = { jsonrpc: '2.0', id: 1, result: { content: [] } }
const after = (ms: number) =>
  new Promise<{ status: 200; body: JsonRpcResponse }>((resolve) =>
    setTimeout(() => resolve({ status: 200, body: result }), ms),
  )

function app(work: () => Promise<{ status: 200 | 202 | 400; body: JsonRpcResponse | null }>) {
  return new Hono().post('/mcp', (c) => answerMcp(c, work(), 20))
}

test('a quick call answers as plain JSON', async () => {
  const response = await app(() => after(0)).request('/mcp', { method: 'POST' })

  expect(response.status).toBe(200)
  expect(await response.text()).toBe(JSON.stringify(result))
})

// #3156: a proxy drops a request that stays silent past its read timeout, so a long call
// sends whitespace while it works; JSON readers skip it.
test('a long call sends whitespace before its JSON, and the body still parses', async () => {
  const response = await app(() => after(90)).request('/mcp', { method: 'POST' })
  const reader = response.body!.getReader()
  const first = await reader.read()

  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toContain('application/json')
  expect(new TextDecoder().decode(first.value).trim()).toBe('')
  let text = new TextDecoder().decode(first.value)

  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read())
    text += new TextDecoder().decode(chunk.value)
  expect(text.length).toBeGreaterThan(JSON.stringify(result).length + 1)
  expect(JSON.parse(text)).toEqual(result)
})

test('a notification still answers 202 with no body', async () => {
  const response = await app(async () => ({ status: 202, body: null })).request('/mcp', {
    method: 'POST',
  })

  expect(response.status).toBe(202)
  expect(await response.text()).toBe('')
})
