import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isBareLocalLink, localUrl, turnLocalUrls } from './localUrls.ts'

import type { Part } from './parts.ts'

test('localUrl accepts loopback hosts and shows host, port and path', () => {
  assert.deepEqual(localUrl('http://127.0.0.1:8787/index.html'), {
    href: 'http://127.0.0.1:8787/index.html',
    label: '127.0.0.1:8787/index.html',
  })
  assert.equal(localUrl('http://localhost:5173/')?.label, 'localhost:5173')
  assert.equal(localUrl('http://app.localhost:3000/a?b=1')?.label, 'app.localhost:3000/a?b=1')
  assert.equal(localUrl('http://[::1]:4000')?.label, '[::1]:4000')
})

test('localUrl opens an all-interfaces bind through loopback', () => {
  assert.equal(localUrl('http://0.0.0.0:3000/')?.href, 'http://127.0.0.1:3000/')
})

test('localUrl rejects remote hosts and non-web schemes', () => {
  assert.equal(localUrl('https://example.com'), null)
  assert.equal(localUrl('http://127.0.0.1.example.com'), null)
  assert.equal(localUrl('file:///tmp/a'), null)
  assert.equal(localUrl('not a url'), null)
})

test('isBareLocalLink keeps explicitly labelled links as links', () => {
  assert.equal(isBareLocalLink('http://localhost:5173/', 'http://localhost:5173'), true)
  assert.equal(isBareLocalLink('http://localhost:5173/', 'localhost:5173'), true)
  assert.equal(isBareLocalLink('http://localhost:5173/', 'the preview'), false)
  assert.equal(isBareLocalLink('https://nuphos.ai/', 'https://nuphos.ai/'), false)
})

const tool = (toolName: string, output: unknown): Part => ({
  type: 'tool',
  toolCallId: toolName,
  toolName,
  state: 'output-available',
  output,
})

test('turnLocalUrls reads own-machine tools only', () => {
  const parts: Part[] = [
    tool('bash', '  ➜  Local:   http://localhost:5173/'),
    tool('mcp__nuphos-tools__local_exec', '{"stdout":"serving http://127.0.0.1:8787/\\n"}'),
    tool('local_terminal', { output: 'Local: http://0.0.0.0:3000' }),
  ]

  assert.deepEqual(
    turnLocalUrls(parts).map((url) => url.label),
    ['127.0.0.1:8787', '127.0.0.1:3000'],
  )
})

test('turnLocalUrls skips servers the answer already links', () => {
  const parts: Part[] = [
    tool('local_exec', { stdout: 'up at http://localhost:4000/' }),
    { type: 'text', text: 'Open http://localhost:4000/app to check it.' },
  ]

  assert.deepEqual(turnLocalUrls(parts), [])
})
