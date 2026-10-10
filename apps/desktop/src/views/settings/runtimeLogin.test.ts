import assert from 'node:assert/strict'
import { test } from 'node:test'

import { authorizeUrl, devicePage, pastedSignInReady } from './runtimeLogin.ts'

const GOOGLE =
  'https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=http%3A%2F%2F127.0.0.1%3A41234%2F&state=s'

test('each agent opens only its own sign-in page', () => {
  assert.equal(
    authorizeUrl('claude-code', 'https://claude.ai/oauth/authorize?x=1'),
    'https://claude.ai/oauth/authorize?x=1',
  )
  assert.equal(authorizeUrl('antigravity', GOOGLE), GOOGLE)
  assert.equal(authorizeUrl('claude-code', GOOGLE), undefined)
  assert.equal(authorizeUrl('antigravity', 'https://claude.ai/oauth/authorize'), undefined)
  assert.equal(authorizeUrl('antigravity', 'https://accounts.google.com/elsewhere'), undefined)
  assert.equal(authorizeUrl('codex', 'https://claude.ai/oauth/authorize'), undefined)
  assert.equal(authorizeUrl('grok', undefined), undefined)
})

test('a device code links to its own agent’s page only', () => {
  assert.equal(
    devicePage('codex', 'https://auth.openai.com/codex/device'),
    'https://auth.openai.com/codex/device',
  )
  assert.equal(
    devicePage('grok', 'https://accounts.x.ai/oauth2/device'),
    'https://accounts.x.ai/oauth2/device',
  )
  assert.equal(devicePage('grok', 'https://auth.openai.com/codex/device'), undefined)
  assert.equal(
    devicePage('opencode', 'https://auth.openai.com/codex/device'),
    'https://auth.openai.com/codex/device',
  )
  assert.equal(devicePage('codex', undefined), undefined)
})

test('Antigravity takes the loopback address the browser ended on; Claude takes its code', () => {
  assert.equal(
    pastedSignInReady('antigravity', ' http://127.0.0.1:41234/?state=s&code=4/abc '),
    true,
  )
  assert.equal(
    pastedSignInReady('antigravity', 'http://localhost:41234/?error=access_denied'),
    true,
  )
  assert.equal(pastedSignInReady('antigravity', '4/abc'), false)
  assert.equal(pastedSignInReady('antigravity', 'http://127.0.0.1:41234/'), false)
  assert.equal(pastedSignInReady('antigravity', 'https://example.com/?code=x'), false)
  assert.equal(pastedSignInReady('claude-code', 'abc#state'), true)
  assert.equal(pastedSignInReady('claude-code', '  '), false)
})
