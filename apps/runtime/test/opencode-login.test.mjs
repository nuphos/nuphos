import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  loopbackRedirect,
  pastedAddress,
  providerOptions,
  runOpenCodeLogin,
  writeBedrockOptions,
} from '../image/opencode-login.mjs'

const PROVIDERS = {
  all: [
    { id: 'zai', name: 'Z.AI' },
    { id: 'groq', name: 'Groq' },
    { id: 'openai', name: 'OpenAI' },
    { id: 'github-copilot', name: 'GitHub Copilot' },
    { id: 'amazon-bedrock', name: 'Amazon Bedrock' },
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
async function login(
  answers,
  authorization = {},
  configFile = '/nonexistent/opencode.json',
  { callback = async () => true, more = false } = {},
) {
  const frames = []
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    const { pathname } = new URL(url)
    calls.push({ url: String(url), method: init.method, body: init.body && JSON.parse(init.body) })
    const json = (body) => ({ ok: true, json: async () => body })
    if (pathname === '/provider') return json(PROVIDERS)
    if (pathname === '/provider/auth') return json(METHODS)
    if (pathname.endsWith('/oauth/authorize')) return json(authorization)
    if (pathname.endsWith('/oauth/callback')) return json(await callback())
    if (pathname.startsWith('/auth/')) return json(true)
    return json(null)
  }
  async function* lines() {
    yield* answers
    // A user who has not answered yet.
    if (more) await new Promise(() => {})
  }
  await runOpenCodeLogin({
    server: { base: 'http://127.0.0.1:1', authorization: 'Basic x' },
    lines: lines(),
    emit: (frame) => frames.push(frame),
    fetchImpl,
    configFile,
  })
  return { frames, calls }
}

test('providers are offered featured first, with the ones already signed in marked', () => {
  assert.deepEqual(providerOptions(PROVIDERS), [
    { value: 'openai', label: 'OpenAI' },
    { value: 'github-copilot', label: 'GitHub Copilot' },
    { value: 'amazon-bedrock', label: 'Amazon Bedrock' },
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

async function withConfig(run) {
  const dir = await mkdtemp(join(tmpdir(), 'opencode-config-'))
  try {
    await run(join(dir, 'opencode', 'opencode.json'))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('Bedrock signs in with an API key and keeps its region in OpenCode’s config', async () => {
  await withConfig(async (file) => {
    const { frames, calls } = await login(
      ['amazon-bedrock', 'api-key', 'eu-west-1', 'bedrock-api-key-x'],
      {},
      file,
    )

    assert.deepEqual(frames.slice(1, -1), [
      {
        type: 'choose',
        message: 'Sign in to Amazon Bedrock',
        options: [
          { value: 'api-key', label: 'Bedrock API key' },
          { value: 'access-key', label: 'AWS access key' },
        ],
      },
      { type: 'input', message: 'AWS region', placeholder: 'us-east-1' },
      { type: 'input', message: 'Amazon Bedrock API key', secret: true },
    ])
    assert.deepEqual(calls.at(-1), {
      url: 'http://127.0.0.1:1/auth/amazon-bedrock',
      method: 'PUT',
      body: { type: 'api', key: 'bedrock-api-key-x' },
    })
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {
      provider: { 'amazon-bedrock': { options: { region: 'eu-west-1' } } },
    })
    assert.equal((await stat(file)).mode & 0o777, 0o600)
  })
})

test('Bedrock signs in with AWS access keys, replacing a saved API key', async () => {
  await withConfig(async (file) => {
    const { frames, calls } = await login(
      ['amazon-bedrock', 'access-key', 'us-west-2', 'AKIAEXAMPLE', 'secret'],
      {},
      file,
    )

    assert.equal(frames.at(-1).type, 'authenticated')
    assert.equal(frames.at(-2).secret, true)
    // A saved Bedrock API key would take precedence over the keys.
    assert.equal(calls.at(-1).method, 'DELETE')
    assert.equal(calls.at(-1).url, 'http://127.0.0.1:1/auth/amazon-bedrock')
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).provider['amazon-bedrock'], {
      options: { region: 'us-west-2', accessKeyId: 'AKIAEXAMPLE', secretAccessKey: 'secret' },
    })
  })
})

test('Bedrock options replace saved credentials and keep the rest of the config', async () => {
  await withConfig(async (file) => {
    await writeBedrockOptions(file, { region: 'us-east-1', accessKeyId: 'A', secretAccessKey: 'S' })
    const config = JSON.parse(await readFile(file, 'utf8'))
    config.theme = 'dark'
    config.provider['amazon-bedrock'].options.endpoint = 'https://bedrock.example'
    await writeFile(file, JSON.stringify(config))

    await writeBedrockOptions(file, { region: 'ap-northeast-1' })
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {
      theme: 'dark',
      provider: {
        'amazon-bedrock': {
          options: { endpoint: 'https://bedrock.example', region: 'ap-northeast-1' },
        },
      },
    })
  })
})

test('a region that is not one is refused before anything is saved', async () => {
  await withConfig(async (file) => {
    await assert.rejects(login(['amazon-bedrock', 'api-key', 'virginia'], {}, file))
    await assert.rejects(stat(file))
  })
})

test('a config OpenCode’s user wrote with comments is left alone', async () => {
  await withConfig(async (file) => {
    await writeBedrockOptions(file, { region: 'us-east-1' })
    await writeFile(file, '{ // mine\n}')
    await assert.rejects(writeBedrockOptions(file, { region: 'us-east-1' }))
    assert.equal(await readFile(file, 'utf8'), '{ // mine\n}')
  })
})

test('a callback that fails while the address is awaited ends the sign-in at once', async () => {
  await assert.rejects(
    login(['openai', '0'], { url: BROWSER_URL, method: 'auto', instructions: '' }, undefined, {
      callback: () => Promise.reject(new Error('listener timed out')),
      more: true,
    }),
  )
})

test('a callback OpenCode answers with false is not a sign-in', async () => {
  const device = { url: 'https://github.com/login/device', method: 'auto', instructions: 'x' }
  await assert.rejects(
    login(['github-copilot', 'github.com'], device, undefined, { callback: async () => false }),
  )
})
