import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  loopbackRedirect,
  pastedAddress,
  providerOptions,
  runOpenCodeLogin,
} from '../image/opencode-login.mjs'

const PROVIDERS = {
  all: [
    { id: 'zai', name: 'Z.AI' },
    { id: 'groq', name: 'Groq' },
    { id: 'openai', name: 'OpenAI' },
    { id: 'github-copilot', name: 'GitHub Copilot' },
  ],
  connected: ['groq'],
}
const METHODS = {
  openai: [
    { type: 'oauth', label: 'ChatGPT Pro/Plus (browser)' },
    { type: 'oauth', label: 'ChatGPT Pro/Plus (headless)' },
    { type: 'api', label: 'Manually enter API Key' },
  ],
  'github-copilot': [
    {
      type: 'oauth',
      label: 'Login with GitHub Copilot',
      prompts: [
        {
          type: 'select',
          key: 'deploymentType',
          message: 'Select GitHub deployment type',
          options: [
            { label: 'GitHub.com', value: 'github.com' },
            { label: 'GitHub Enterprise', value: 'enterprise' },
          ],
        },
        {
          type: 'text',
          key: 'enterpriseUrl',
          message: 'Enter your GitHub Enterprise URL or domain',
          when: { key: 'deploymentType', op: 'eq', value: 'enterprise' },
        },
      ],
    },
  ],
}
const BROWSER_URL =
  'https://auth.openai.com/oauth/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&state=s'

/** Drives the helper against a stand-in for OpenCode's server, answering in order. */
async function login(answers, authorization = {}) {
  const frames = []
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const { pathname } = new URL(url)
    calls.push({ url: String(url), method: init.method, body: init.body && JSON.parse(init.body) })
    const json = (body) => ({ ok: true, json: async () => body })
    if (pathname === '/provider') return json(PROVIDERS)
    if (pathname === '/provider/auth') return json(METHODS)
    if (pathname.endsWith('/oauth/authorize')) return json(authorization)
    if (pathname.startsWith('/auth/') || pathname.endsWith('/oauth/callback')) return json(true)
    return json(null)
  }
  async function* lines() {
    yield* answers
  }
  await runOpenCodeLogin({
    server: { base: 'http://127.0.0.1:1', authorization: 'Basic x' },
    lines: lines(),
    emit: (frame) => frames.push(frame),
    fetchImpl,
  })
  return { frames, calls }
}

test('providers are offered featured first, with the ones already signed in marked', () => {
  assert.deepEqual(providerOptions(PROVIDERS), [
    { value: 'openai', label: 'OpenAI' },
    { value: 'github-copilot', label: 'GitHub Copilot' },
    { value: 'groq', label: 'Groq', hint: 'Connected' },
    { value: 'zai', label: 'Z.AI' },
  ])
})

test('a provider without its own methods signs in with an API key', async () => {
  const { frames, calls } = await login(['zai', 'secret-key'])

  assert.equal(frames[0].type, 'choose')
  assert.deepEqual(frames.slice(1), [
    { type: 'input', message: 'Z.AI API key', secret: true },
    { type: 'authenticated' },
  ])
  assert.deepEqual(calls.at(-1), {
    url: 'http://127.0.0.1:1/auth/zai',
    method: 'PUT',
    body: { type: 'api', key: 'secret-key' },
  })
})

test('every method a provider offers is a choice', async () => {
  const { frames } = await login(['openai', '2', 'sk-test'])

  assert.deepEqual(frames[1], {
    type: 'choose',
    message: 'Sign in to OpenAI',
    options: [
      { value: '0', label: 'ChatGPT Pro/Plus (browser)' },
      { value: '1', label: 'ChatGPT Pro/Plus (headless)' },
      { value: '2', label: 'Manually enter API Key' },
    ],
  })
  assert.equal(frames.at(-1).type, 'authenticated')
})

test('a device page is shown with its code, and OpenCode waits for the approval', async () => {
  const { frames, calls } = await login(['openai', '1'], {
    url: 'https://auth.openai.com/codex/device',
    method: 'auto',
    instructions: 'Enter code: AB12-CD34',
  })

  assert.deepEqual(frames.slice(2), [
    {
      type: 'browser',
      url: 'https://auth.openai.com/codex/device',
      instructions: 'Enter code: AB12-CD34',
    },
    { type: 'authenticated' },
  ])
  assert.deepEqual(calls.at(-1).body, { method: 1 })
})

test('a page that hands back a code takes it from the user', async () => {
  const { frames, calls } = await login(['openai', '0', 'the-code'], {
    url: 'https://example.com/authorize',
    method: 'code',
    instructions: 'Paste the code',
  })

  assert.equal(frames[2].paste, 'code')
  assert.deepEqual(calls.at(-1).body, { method: 0, code: 'the-code' })
})

test('a browser that lands on a loopback address has it delivered to the listener', async () => {
  const address = 'http://localhost:1455/auth/callback?code=c&state=s'
  const { frames, calls } = await login(['openai', '0', address], {
    url: BROWSER_URL,
    method: 'auto',
    instructions: 'Complete authorization in your browser.',
  })

  assert.equal(frames[2].paste, 'address')
  assert.ok(calls.some((call) => call.url === address))
  assert.equal(frames.at(-1).type, 'authenticated')
})

test('an address for another listener is refused', async () => {
  await assert.rejects(
    login(['openai', '0', 'http://localhost:9999/auth/callback?code=c'], {
      url: BROWSER_URL,
      method: 'auto',
      instructions: '',
    }),
  )
  assert.equal(
    pastedAddress('https://localhost:1455/auth/callback', loopbackRedirect(BROWSER_URL)),
    undefined,
  )
  assert.equal(loopbackRedirect('https://github.com/login/device'), undefined)
})

test('a method’s own fields are asked for, and only when they apply', async () => {
  const device = { url: 'https://github.com/login/device', method: 'auto', instructions: 'x' }
  const github = await login(['github-copilot', 'github.com'], device)
  assert.deepEqual(github.calls.find((call) => call.url.endsWith('/authorize')).body, {
    method: 0,
    inputs: { deploymentType: 'github.com' },
  })

  const enterprise = await login(['github-copilot', 'enterprise', 'ghe.example.com'], device)
  assert.deepEqual(enterprise.frames[2], {
    type: 'input',
    message: 'Enter your GitHub Enterprise URL or domain',
  })
  assert.deepEqual(enterprise.calls.find((call) => call.url.endsWith('/authorize')).body.inputs, {
    deploymentType: 'enterprise',
    enterpriseUrl: 'ghe.example.com',
  })
})

test('an answer that is not one of the choices ends the sign-in', async () => {
  await assert.rejects(login(['not-a-provider']))
})
