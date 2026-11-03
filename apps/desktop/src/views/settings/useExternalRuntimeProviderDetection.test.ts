import assert from 'node:assert/strict'
import { test } from 'node:test'

import { detectionKey, looksLikeAcpUrl } from './useExternalRuntimeProviderDetection.ts'

const PASSWORD = '0123456789abcdef'.repeat(4)

test('only a WebSocket address counts as an ACP address', () => {
  assert.equal(looksLikeAcpUrl('wss://runtime.example.com/acp'), true)
  assert.equal(looksLikeAcpUrl(' ws://openab.team.svc/acp '), true)
  assert.equal(looksLikeAcpUrl('https://runtime.example.com/acp'), false)
  assert.equal(looksLikeAcpUrl('runtime.example.com'), false)
})

test('detection waits for an address and a usable password', () => {
  assert.equal(detectionKey('', PASSWORD), null)
  assert.equal(detectionKey('wss://runtime.example.com/acp', 'short'), null)
  assert.equal(detectionKey('wss://runtime.example.com/acp', `${PASSWORD.slice(1)}=`), null)
})

test('surrounding whitespace does not trigger a second probe', () => {
  const key = detectionKey('wss://runtime.example.com/acp', PASSWORD)

  assert.notEqual(key, null)
  assert.equal(detectionKey('  wss://runtime.example.com/acp ', ` ${PASSWORD} `), key)
})
