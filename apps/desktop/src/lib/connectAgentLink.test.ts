import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  isConnectAgentLink,
  normalizeAgentUrl,
  normalizePairingCode,
  parseConnectAgentLink,
} from './connectAgentLink.ts'

const CODE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

function link(params: Record<string, string>): string {
  return `nuphos://connect-runtime?${new URLSearchParams(params).toString()}`
}

test('recognizes only the connect-runtime host', () => {
  assert.equal(isConnectAgentLink(link({ url: 'https://a.example', code: CODE })), true)
  assert.equal(isConnectAgentLink('nuphos://open?path=/'), false)
  assert.equal(isConnectAgentLink('https://connect-runtime/?code=x'), false)
})

test('normalizes the agent address onto its ACP endpoint', () => {
  assert.equal(normalizeAgentUrl('https://agent.example.com'), 'wss://agent.example.com/acp')
  assert.equal(normalizeAgentUrl('http://127.0.0.1:8080/'), 'ws://127.0.0.1:8080/acp')
  assert.equal(normalizeAgentUrl('wss://agent.example.com/acp/'), 'wss://agent.example.com/acp')
  assert.equal(normalizeAgentUrl('ftp://agent.example.com'), null)
  assert.equal(normalizeAgentUrl('https://user:pw@agent.example.com'), null)
  assert.equal(normalizeAgentUrl('agent.example.com'), null)
})

test('accepts only a 26-character base32 code, tolerating case and separators', () => {
  assert.equal(normalizePairingCode(CODE), CODE)
  assert.equal(normalizePairingCode('abcde-fghij klmno-pqrst uvwxyz'), CODE)
  assert.equal(normalizePairingCode(`${CODE.slice(0, 25)}1`), null)
  assert.equal(normalizePairingCode(CODE.slice(1)), null)
})

test('parses a console link and drops a malformed one', () => {
  assert.deepEqual(
    parseConnectAgentLink(
      link({ url: 'https://agent.example.com', code: CODE, exp: '1790000000' }),
    ),
    { url: 'wss://agent.example.com/acp', code: CODE, expiresAt: 1_790_000_000_000 },
  )
  assert.deepEqual(parseConnectAgentLink(link({ url: 'wss://a.example/acp', code: CODE })), {
    url: 'wss://a.example/acp',
    code: CODE,
  })
  assert.equal(parseConnectAgentLink(link({ url: 'mailto:agent@example.com', code: CODE })), null)
  assert.equal(parseConnectAgentLink(link({ url: 'https://a.example', code: 'short' })), null)
  assert.equal(parseConnectAgentLink(link({ code: CODE })), null)
})
