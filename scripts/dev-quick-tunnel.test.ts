import assert from 'node:assert/strict'
import test from 'node:test'

import { tunnelUrlFromOutput } from './dev-quick-tunnel.ts'

test('a URL split across chunks is still found', () => {
  const nextUrl = tunnelUrlFromOutput()

  assert.equal(nextUrl('    |  Your quick Tunnel has been created! Visit it at: '), null)
  assert.equal(nextUrl('https://example-quick'), null)
  assert.equal(nextUrl('.trycloudflare.com  |\n'), 'https://example-quick.trycloudflare.com')
})

test('a URL inside one chunk is found, later noise does not break it', () => {
  const nextUrl = tunnelUrlFromOutput()

  assert.equal(
    nextUrl('2026-11-27 INF |  https://example-quick.trycloudflare.com  |\n'),
    'https://example-quick.trycloudflare.com',
  )
  assert.equal(nextUrl('more log lines with no url\n'), 'https://example-quick.trycloudflare.com')
})

test('output without a URL stays null and matching keeps working later', () => {
  const nextUrl = tunnelUrlFromOutput()

  for (let i = 0; i < 100; i++) assert.equal(nextUrl(`log line ${i} with no url\n`), null)
  assert.equal(nextUrl('https://late-url.trycloudflare.com'), 'https://late-url.trycloudflare.com')
})
