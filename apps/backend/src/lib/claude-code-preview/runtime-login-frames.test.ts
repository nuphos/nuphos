import { expect, test } from 'bun:test'

import { loginFrameReader } from './runtime-login-frames'

import type { RuntimeLoginFrame } from './runtime-login-step'

test("only Claude's own authorize page reaches the UI, and a runtime's error is ours to word", () => {
  const frames: RuntimeLoginFrame[] = []
  const read = loginFrameReader((frame) => frames.push(frame))
  const url = 'https://claude.com/cai/oauth/authorize?code=true&state=s'

  read(`${JSON.stringify({ type: 'authorize', url })}\n`)
  for (const lookalike of [
    'https://evil.example/oauth/authorize',
    'http://claude.com/cai/oauth/authorize',
    'https://claude.com.evil.example/oauth/authorize',
    'https://claude.ai/login',
  ])
    expect(() => read(`${JSON.stringify({ type: 'authorize', url: lookalike })}\n`)).toThrow(
      'Invalid login response',
    )
  for (const reason of ['input_unavailable', 'failed', 'constructor', 'runtime words'])
    read(`${JSON.stringify({ type: 'error', reason })}\n`)

  expect(frames[0]).toEqual({ type: 'authorize', url })
  const messages = frames.slice(1).map((frame) => (frame.type === 'error' ? frame.message : ''))

  expect(messages[0]).toContain('claude auth login')
  expect(messages[1]).toContain('paste the whole code')
  // Anything the reader does not know gets the fixed message, never the runtime's words.
  expect(messages[2]).toBe(messages[3])
  expect(messages.join()).not.toContain('runtime words')
})

test("a failed sign-in gives the provider's own advice", () => {
  const messages: string[] = []
  const read = loginFrameReader(
    (frame) => frame.type === 'error' && messages.push(frame.message),
    'Start again and confirm the code on the xAI page.',
  )

  read(`${JSON.stringify({ type: 'error', reason: 'failed' })}\n`)
  read(`${JSON.stringify({ type: 'error', reason: 'input_unavailable' })}\n`)
  expect(messages[0]).toBe('Start again and confirm the code on the xAI page.')
  expect(messages[1]).toContain('cannot receive the sign-in code')
})

test('a Hermes that cannot prepare its environment says so in plain words', () => {
  const messages: string[] = []
  const read = loginFrameReader(
    (frame) => frame.type === 'error' && messages.push(frame.message),
    'Sign-in did not complete. Start again and check the details you entered.',
  )

  read(`${JSON.stringify({ type: 'error', reason: 'environment' })}\n`)
  expect(messages[0]).toBe(
    'Hermes could not prepare its environment on this computer. Check that the computer is online, then start again.',
  )
})

test('Grok Build and Antigravity sign in through their own pages only', () => {
  const frames: RuntimeLoginFrame[] = []
  const read = loginFrameReader((frame) => frames.push(frame))
  const google = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=c&redirect_uri=x'
  const device = { verificationUri: 'https://accounts.x.ai/oauth2/device', userCode: '26CT-7C8A' }

  read(`${JSON.stringify({ type: 'device', ...device })}\n`)
  read(`${JSON.stringify({ type: 'authorize', url: google })}\n`)
  for (const lookalike of [
    'https://accounts.google.com.evil.example/o/oauth2/v2/auth',
    'https://accounts.google.com/signin',
  ])
    expect(() => read(`${JSON.stringify({ type: 'authorize', url: lookalike })}\n`)).toThrow(
      'Invalid login response',
    )
  expect(() =>
    read(
      `${JSON.stringify({ type: 'device', verificationUri: 'https://x.ai.evil.example/device', userCode: 'AAAA' })}\n`,
    ),
  ).toThrow('Invalid login response')

  expect(frames).toEqual([
    { type: 'device', ...device },
    { type: 'authorize', url: google },
  ])
})

test('only a runtime that signs in by steps may ask, and only within bounds', () => {
  const frames: unknown[] = []
  const choose = {
    type: 'choose',
    message: 'Choose a model provider',
    options: [{ value: 'openai', label: 'OpenAI', hint: 'Signed in', extra: 'dropped' }],
  }

  expect(() => loginFrameReader(() => {})(`${JSON.stringify(choose)}\n`)).toThrow()
  const read = loginFrameReader((frame) => frames.push(frame), undefined, true)

  read(`${JSON.stringify(choose)}\n`)
  read(`${JSON.stringify({ type: 'input', message: 'API key', secret: true })}\n`)
  read(
    `${JSON.stringify({ type: 'browser', url: 'https://github.com/login/device', instructions: 'Enter code: AB-12' })}\n`,
  )
  read(`${JSON.stringify({ type: 'browser', url: '', instructions: 'Run az login first.' })}\n`)
  expect(frames).toEqual([
    {
      type: 'step',
      step: {
        kind: 'choose',
        message: 'Choose a model provider',
        options: [{ value: 'openai', label: 'OpenAI', hint: 'Signed in' }],
      },
    },
    { type: 'step', step: { kind: 'input', message: 'API key', secret: true } },
    {
      type: 'step',
      step: {
        kind: 'browser',
        url: 'https://github.com/login/device',
        instructions: 'Enter code: AB-12',
      },
    },
    { type: 'step', step: { kind: 'browser', url: '', instructions: 'Run az login first.' } },
  ])
  for (const bad of [
    { type: 'browser', url: 'http://example.com/' },
    { type: 'browser', url: 'https://' },
    { type: 'browser', url: 'https://user:pass@example.com/' },
    { type: 'browser', url: 'https://example.com/', paste: 'anything' },
    { type: 'choose', message: 'x', options: [] },
    { type: 'choose', message: 'x', options: [{ value: '', label: 'x' }] },
    { type: 'input', message: 'x'.repeat(501) },
  ])
    expect(() => read(`${JSON.stringify(bad)}\n`)).toThrow()
})

test('a removed API key reaches the sign-in as a frame of its own, with nothing in it', () => {
  const frames: RuntimeLoginFrame[] = []
  const read = loginFrameReader((frame) => frames.push(frame))

  read(`${JSON.stringify({ type: 'signedOut', key: 'sk-should-not-pass' })}\n`)
  expect(frames).toEqual([{ type: 'signedOut' }])
})

test('Antigravity forwards the official CLI Google authorization URL', () => {
  const frames: RuntimeLoginFrame[] = []
  const read = loginFrameReader((frame) => frames.push(frame))
  const url =
    'https://accounts.google.com/o/oauth2/auth?redirect_uri=https%3A%2F%2Fantigravity.google%2Foauth-callback&state=s'

  read(`${JSON.stringify({ type: 'authorize', url })}\n`)
  expect(frames).toEqual([{ type: 'authorize', url }])
})
