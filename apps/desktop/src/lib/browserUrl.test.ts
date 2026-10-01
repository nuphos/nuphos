import assert from 'node:assert/strict'
import { test } from 'node:test'

import { BROWSER_HOME_URL, normalizeBrowserUrl } from './browserUrl.ts'

test('browser accepts web addresses and local development servers', () => {
  for (const [input, expected] of [
    ['', BROWSER_HOME_URL],
    [' https://example.com/a?b=1#c ', 'https://example.com/a?b=1#c'],
    ['example.com:8443/path', 'https://example.com:8443/path'],
    ['localhost:5173', 'http://localhost:5173'],
    ['127.0.0.1:8080/path', 'http://127.0.0.1:8080/path'],
    ['192.168.1.10:8080/path', 'http://192.168.1.10:8080/path'],
    // eslint-disable-next-line sonarjs/no-hardcoded-ip -- LAN URL parsing fixture; no network request
    ['10.0.0.1', 'http://10.0.0.1'],
    ['[::1]:3000', 'http://[::1]:3000'],
  ])
    assert.equal(normalizeBrowserUrl(input), expected)
})

test('search text and privileged schemes never become executable navigation', () => {
  for (const input of [
    'hello world',
    '999.168.1.1',
    // eslint-disable-next-line no-script-url -- regression fixture, never executed
    'javascript:alert(1)',
    'file:///etc/passwd',
    'data:text/html,test',
  ]) {
    assert.equal(
      normalizeBrowserUrl(input),
      `https://www.google.com/search?q=${encodeURIComponent(input)}`,
    )
  }
})
