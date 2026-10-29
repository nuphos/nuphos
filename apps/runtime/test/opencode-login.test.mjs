import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  isOpenCodeV2,
  loopbackRedirect,
  pastedAddress,
  providerOptions,
  runOpenCodeLogin,
  runOpenCodeLoginV2,
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

const INTEGRATIONS = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    methods: [{ type: 'key' }, { type: 'env', names: ['ANTHROPIC_API_KEY'] }],
    connections: [],
  },
  {
    id: 'groq',
    name: 'Groq',
    methods: [{ type: 'key' }],
    connections: [{ type: 'credential', id: 'cred_1', label: 'Groq', method: 'key' }],
  },
  {
    id: 'only-env',
    name: 'Only Env',
    methods: [{ type: 'env', names: ['ONLY_ENV_KEY'] }],
    connections: [],
  },
  // An older 2.x build can list an integration without methods.
  { id: 'bare', name: 'Bare', connections: [] },
  {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    methods: [
      { type: 'env', names: ['GITHUB_TOKEN'] },
      {
        id: 'device',
        type: 'oauth',
        label: 'Login with GitHub Copilot',
        form: [
          {
            key: 'deploymentType',
            title: 'Select GitHub deployment type',
            type: 'string',
            options: [
              { value: 'github.com', label: 'GitHub.com', description: 'Public' },
              { value: 'enterprise', label: 'GitHub Enterprise' },
            ],
          },
          {
            key: 'enterpriseUrl',
            title: 'Enter your GitHub Enterprise URL or domain',
            type: 'string',
            placeholder: 'company.ghe.com',
            when: [{ key: 'deploymentType', op: 'eq', value: 'enterprise' }],
          },
        ],
      },
    ],
    connections: [],
  },
  {
    id: 'opencode',
    name: 'OpenCode Console',
    methods: [
      { type: 'key', label: 'API key (service account)' },
      {
        id: 'device',
        type: 'oauth',
        label: 'OpenCode Console account',
        form: [
          { key: 'server', hidden: true, type: 'string', default: 'https://opencode.ai/console' },
        ],
      },
    ],
    connections: [],
  },
]

/** Drives the 2.x helper against a stand-in for OpenCode's 2.x server, answering in order. */
async function loginV2(answers, { attempt = {}, statuses = ['complete'] } = {}) {
  const frames = []
  const calls = []
  const polls = [...statuses]
  const fetchImpl = async (url, init = {}) => {
    const { pathname } = new URL(url)
    calls.push({
      path: pathname,
      method: init.method ?? 'GET',
      body: init.body && JSON.parse(init.body),
    })
    const json = (data) => ({ ok: true, status: 200, json: async () => ({ data }) })
    if (pathname === '/api/integration') return json(INTEGRATIONS)
    if (/\/connect\/(oauth|command)$/u.test(pathname))
      return json({ attemptID: 'con_1', mode: 'auto', ...attempt })
    if (/\/connect\/(oauth|command)\/con_1$/u.test(pathname)) {
      const status = polls.length > 1 ? polls.shift() : polls[0]
      return json(status === 'failed' ? { status, message: 'Denied' } : { status })
    }
    return { ok: true, status: 204, json: async () => assert.fail('a 204 has no body') }
  }
  await runOpenCodeLoginV2({
    server: { base: 'http://127.0.0.1:1', authorization: 'Basic x' },
    lines: (async function* () {
      yield* answers
    })(),
    emit: (frame) => frames.push(frame),
    fetchImpl,
    pollMs: 0,
  })
  return { frames, calls }
}

test('OpenCode 2.x is told apart from 1.x by its integration list', async () => {
  const server = { base: 'http://127.0.0.1:1', authorization: 'Basic x' }
  const answering = (response) => async () => response

  assert.equal(
    await isOpenCodeV2(server, answering({ ok: true, json: async () => ({ data: [] }) })),
    true,
  )
  // 1.x serves its web app for any unknown path.
  const html = { ok: true, json: async () => JSON.parse('<!doctype html>') }
  assert.equal(await isOpenCodeV2(server, answering(html)), false)
  assert.equal(await isOpenCodeV2(server, answering({ ok: false, status: 404 })), false)
  assert.equal(
    await isOpenCodeV2(server, async () => {
      throw new Error('refused')
    }),
    false,
  )
})

test('2.x: integrations with a sign-in are offered, the connected ones marked', async () => {
  const { frames } = await loginV2(['anthropic', 'sk-ant'])

  assert.deepEqual(frames[0], {
    type: 'choose',
    message: 'Choose a model provider',
    options: [
      { value: 'anthropic', label: 'Anthropic' },
      { value: 'github-copilot', label: 'GitHub Copilot' },
      { value: 'opencode', label: 'OpenCode Console' },
      { value: 'groq', label: 'Groq', hint: 'Connected' },
    ],
  })
})

test('2.x: an API key is asked for as a secret and saved through its integration', async () => {
  const { frames, calls } = await loginV2(['anthropic', 'sk-ant'])

  assert.deepEqual(frames.slice(1), [
    { type: 'input', message: 'Anthropic API key', secret: true },
    { type: 'authenticated' },
  ])
  assert.deepEqual(calls.at(-1), {
    path: '/api/integration/anthropic/connect/key',
    method: 'POST',
    body: { key: 'sk-ant' },
  })
})

test('2.x: a form field is asked only when it applies, and a device page waits for approval', async () => {
  const { frames, calls } = await loginV2(['github-copilot', 'github.com'], {
    attempt: { url: 'https://github.com/login/device', instructions: 'Enter code: AB12-CD34' },
    statuses: ['pending', 'pending', 'complete'],
  })

  assert.deepEqual(frames.slice(1), [
    {
      type: 'choose',
      message: 'Select GitHub deployment type',
      options: [
        { value: 'github.com', label: 'GitHub.com', hint: 'Public' },
        { value: 'enterprise', label: 'GitHub Enterprise' },
      ],
    },
    {
      type: 'browser',
      url: 'https://github.com/login/device',
      instructions: 'Enter code: AB12-CD34',
    },
    { type: 'authenticated' },
  ])
  assert.deepEqual(calls.find(({ path }) => path.endsWith('/connect/oauth')).body, {
    methodID: 'device',
    answer: { deploymentType: 'github.com' },
  })
  assert.equal(calls.filter(({ path }) => path.endsWith('/con_1')).length, 3)
})

test('2.x: a field that applies is asked for, and hidden fields keep their default', async () => {
  const enterprise = await loginV2(['github-copilot', 'enterprise', 'company.ghe.com'], {
    attempt: { url: 'https://company.ghe.com/login/device', instructions: '' },
  })
  assert.deepEqual(enterprise.frames[2], {
    type: 'input',
    message: 'Enter your GitHub Enterprise URL or domain',
    placeholder: 'company.ghe.com',
  })

  const { calls } = await loginV2(['opencode', '1'], {
    attempt: { url: 'https://opencode.ai/device' },
  })
  assert.deepEqual(calls.find(({ path }) => path.endsWith('/connect/oauth')).body, {
    methodID: 'device',
    answer: { server: 'https://opencode.ai/console' },
  })
})

test('2.x: a page that hands back a code completes the attempt with it', async () => {
  const { frames, calls } = await loginV2(['opencode', '1', 'the-code'], {
    attempt: { url: 'https://opencode.ai/auth', instructions: 'Paste the code', mode: 'code' },
  })

  assert.deepEqual(frames.at(-2), {
    type: 'browser',
    url: 'https://opencode.ai/auth',
    instructions: 'Paste the code',
    paste: 'code',
  })
  assert.deepEqual(calls.find(({ path }) => path.endsWith('/complete')).body, { code: 'the-code' })
  assert.equal(frames.at(-1).type, 'authenticated')
})

test('2.x: an attempt OpenCode reports failed is not a sign-in', async () => {
  await assert.rejects(
    loginV2(['github-copilot', 'github.com'], {
      attempt: { url: 'https://github.com/login/device' },
      statuses: ['failed'],
    }),
    /Denied/u,
  )
})

test('2.x: an attempt still pending when it expires ends the sign-in instead of polling on', async () => {
  await assert.rejects(
    loginV2(['github-copilot', 'github.com'], {
      attempt: {
        url: 'https://github.com/login/device',
        time: { created: 0, expires: Date.now() + 20 },
      },
      statuses: ['pending'],
    }),
    /Sign-in expired/u,
  )
})
