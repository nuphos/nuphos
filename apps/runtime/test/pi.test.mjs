import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { agentEnv } from '../image/acp-shim.mjs'
import { listedModels, runPiLogin } from '../image/pi-login.mjs'
import { literal, piTurnError, redactKeys, writePiMcpServers } from '../image/pi-session.mjs'

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))
const LOGIN = { deepseek: { type: 'api_key', key: 'sk-test' } }

test('each conversation and each teammate in it runs Pi from an agent directory of its own', () => {
  const home = mkdtempSync(join(tmpdir(), 'pi-runtime-'))
  try {
    const root = join(home, '.pi', 'agent')
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'auth.json'), JSON.stringify(LOGIN))
    writeFileSync(
      join(root, 'settings.json'),
      JSON.stringify({ defaultProvider: 'deepseek', defaultModel: 'deepseek-chat', theme: 'x' }),
    )
    const runtimeEnv = { HOME: home, PATH: '/bin', NUPHOS_AGENT_EXECUTABLE: '/opt/pi/bin/pi' }
    const env = (session) => agentEnv('pi', { env: session }, runtimeEnv)
    const owner = env({ NUPHOS_SESSION_ID: 'conversation-a', NUPHOS_TOKEN: 'a' })
    const other = env({ NUPHOS_SESSION_ID: 'conversation-b', NUPHOS_TOKEN: 'b' })
    const teammate = env({
      NUPHOS_SESSION_ID: 'conversation-a',
      NUPHOS_SESSION_ACTOR: 'teammate',
      NUPHOS_TOKEN: 't',
    })
    const dirs = [owner, other, teammate].map((e) => e.PI_CODING_AGENT_DIR)
    assert.equal(new Set(dirs).size, 3)
    for (const dir of dirs) {
      assert.notEqual(dir, root)
      // Signed in with the root's login, on the model the sign-in chose.
      assert.deepEqual(readJson(join(dir, 'auth.json')), LOGIN)
      const settings = readJson(join(dir, 'settings.json'))
      assert.equal(settings.defaultProvider, 'deepseek')
      assert.equal(settings.defaultModel, 'deepseek-chat')
      assert.equal(settings.theme, undefined)
      assert.equal(settings.quietStartup, true)
      assert.equal(settings.defaultProjectTrust, 'never')
    }
    // pi-acp runs the CLI the computer names.
    assert.equal(owner.PI_ACP_PI_COMMAND, '/opt/pi/bin/pi')
    assert.equal(agentEnv('pi', undefined, { HOME: home }).PI_ACP_PI_COMMAND, 'pi')
    // A conversation opened after a new sign-in uses the new key.
    const renewed = { deepseek: { type: 'api_key', key: 'sk-new' } }
    writeFileSync(join(root, 'auth.json'), JSON.stringify(renewed))
    const again = env({ NUPHOS_SESSION_ID: 'conversation-a', NUPHOS_TOKEN: 'a' })
    assert.deepEqual(readJson(join(again.PI_CODING_AGENT_DIR, 'auth.json')), renewed)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("a session's MCP servers become the mcp.json Pi reads", () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-mcp-'))
  try {
    writePiMcpServers(dir, [
      {
        name: 'nuphos',
        command: '/usr/bin/node',
        args: ['bridge.mjs'],
        env: [{ name: 'OPENAB_CREDENTIALS_DIR', value: '/run/creds' }],
      },
      {
        type: 'http',
        name: 'web',
        url: 'https://example.com/mcp',
        headers: [{ name: 'X-Key', value: 'v' }],
      },
    ])
    assert.deepEqual(readJson(join(dir, 'mcp.json')), {
      mcpServers: {
        nuphos: {
          command: '/usr/bin/node',
          args: ['bridge.mjs'],
          env: { OPENAB_CREDENTIALS_DIR: '/run/creds' },
          exposure: 'direct',
        },
        web: { url: 'https://example.com/mcp', headers: { 'X-Key': 'v' }, exposure: 'direct' },
      },
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the models a provider offers are read from pi --list-models', () => {
  const output =
    'provider   model              context  max-out\n' +
    'deepseek   deepseek-chat      128K     8K\n' +
    'deepseek   deepseek-reasoner  128K     64K\n' +
    'openai     gpt-5              400K     128K\n'
  assert.deepEqual(listedModels(output, 'deepseek'), ['deepseek-chat', 'deepseek-reasoner'])
  assert.deepEqual(listedModels(output, 'anthropic'), [])
})

const LISTING =
  'provider model\ndeepseek deepseek-chat\ndeepseek deepseek-v4-pro\nxai grok-3\nxai grok-code\n'

async function signIn(answers, { ready = true, home } = {}) {
  const frames = []
  const calls = []
  const lines = (async function* () {
    yield* answers
  })()
  const run = async (args, agentDir) => {
    calls.push({ args, agentDir, auth: readJson(join(agentDir, 'auth.json')) })
    return args[0] === 'auth' ? JSON.stringify({ status: ready ? 'ready' : 'missing' }) : LISTING
  }
  const result = runPiLogin({ lines, emit: (frame) => frames.push(frame), home, run })
  return { frames, calls, result }
}

test("Pi signs in with an API key and starts on Pi's default model for the provider", async () => {
  const home = mkdtempSync(join(tmpdir(), 'pi-login-'))
  try {
    const { frames, calls, result } = await signIn(['deepseek', 'sk-test'], { home })
    await result
    const dir = join(home, '.pi', 'agent')
    // No model to choose: it can be changed in any conversation.
    assert.deepEqual(
      frames.map((frame) => frame.type),
      ['choose', 'input', 'authenticated'],
    )
    assert.equal(frames[1].secret, true)
    // Pi is asked with the key in its file, never on its command line.
    assert.deepEqual(calls[0].args, ['auth', 'check', '--provider', 'deepseek', '--json'])
    assert.deepEqual(calls[0].auth, { deepseek: { type: 'api_key', key: 'sk-test' } })
    assert.ok(calls.every(({ args }) => !args.includes('sk-test')))
    assert.deepEqual(readJson(join(dir, 'auth.json')), {
      deepseek: { type: 'api_key', key: 'sk-test' },
    })
    assert.deepEqual(readJson(join(dir, 'settings.json')), {
      defaultProvider: 'deepseek',
      defaultModel: 'deepseek-v4-pro',
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('a provider whose default Pi no longer lists starts on the first model it lists', async () => {
  const home = mkdtempSync(join(tmpdir(), 'pi-login-'))
  try {
    const { result } = await signIn(['xai', 'xai-test'], { home })
    await result
    assert.deepEqual(readJson(join(home, '.pi', 'agent', 'settings.json')), {
      defaultProvider: 'xai',
      defaultModel: 'grok-3',
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('the sign-in a computer runs asks for a provider and a key, then is done', async () => {
  const home = mkdtempSync(join(tmpdir(), 'pi-login-'))
  try {
    // A stand-in for the pi CLI: it accepts the key and lists two DeepSeek models.
    const pi = join(home, 'pi')
    writeFileSync(
      pi,
      [
        '#!/bin/sh',
        'case "$1" in',
        `  auth) echo '{"status":"ready"}' ;;`,
        `  --list-models) printf 'provider model\\ndeepseek deepseek-chat\\ndeepseek deepseek-v4-pro\\n' ;;`,
        '  *) exit 1 ;;',
        'esac',
        '',
      ].join('\n'),
    )
    chmodSync(pi, 0o755)
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL('../image/pi-login.mjs', import.meta.url))],
      {
        env: { PATH: process.env.PATH, NUPHOS_AGENT_EXECUTABLE: pi, NUPHOS_AGENT_HOME: home },
        stdio: ['pipe', 'pipe', 'inherit'],
      },
    )
    const answers = { 'Choose a model provider': 'deepseek', 'DeepSeek API key': 'sk-test' }
    const frames = []
    let pending = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      pending += chunk
      for (let newline; (newline = pending.indexOf('\n')) >= 0;) {
        const frame = JSON.parse(pending.slice(0, newline))
        pending = pending.slice(newline + 1)
        frames.push(frame)
        // Any other question goes unanswered, which ends the sign-in.
        if (frame.message in answers) child.stdin.write(`${answers[frame.message]}\n`)
        else child.stdin.end()
      }
    })
    const code = await new Promise((resolve) => child.once('exit', resolve))
    assert.deepEqual(
      frames.map(({ type, message }) => (message ? `${type}: ${message}` : type)),
      ['choose: Choose a model provider', 'input: DeepSeek API key', 'authenticated'],
    )
    assert.equal(code, 0)
    assert.deepEqual(readJson(join(home, '.pi', 'agent', 'settings.json')), {
      defaultProvider: 'deepseek',
      defaultModel: 'deepseek-v4-pro',
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

const CUSTOM = 'nuphos-custom'

/** Signs in to a custom endpoint against a stand-in Pi that accepts it and lists its model. */
async function signInCustom(home, baseUrl, model = 'qwen2.5:1.5b') {
  const frames = []
  const calls = []
  const lines = (async function* () {
    yield* [CUSTOM, baseUrl, model, 'sk-local']
  })()
  const run = async (args, agentDir) => {
    calls.push({ args, models: readJson(join(agentDir, 'models.json')) })
    return args[0] === 'auth'
      ? JSON.stringify({ status: 'ready' })
      : `provider model\n${CUSTOM} ${model}\ncustom hand-written\n`
  }
  await runPiLogin({ lines, emit: (frame) => frames.push(frame), home, run })
  return { frames, calls }
}

test('Pi signs in to an OpenAI-compatible endpoint of the user’s own', async () => {
  const home = mkdtempSync(join(tmpdir(), 'pi-login-'))
  try {
    const dir = join(home, '.pi', 'agent')
    mkdirSync(dir, { recursive: true })
    // A provider the user added by hand, even one named `custom`, stays with its key.
    const mine = { baseUrl: 'https://mine.example/v1', api: 'openai-completions' }
    writeFileSync(join(dir, 'models.json'), JSON.stringify({ providers: { custom: mine } }))
    writeFileSync(join(dir, 'auth.json'), JSON.stringify({ custom: { type: 'api_key', key: 'k' } }))
    const { frames, calls } = await signInCustom(home, 'http://localhost:11434/v1')
    assert.deepEqual(
      frames.map(({ type, message }) => (message ? `${type}: ${message}` : type)),
      [
        'choose: Choose a model provider',
        'input: Base URL',
        'input: Model ID',
        'input: API key',
        'authenticated',
      ],
    )
    assert.equal(frames[3].secret, true)
    const provider = {
      name: 'Custom',
      baseUrl: 'http://localhost:11434/v1',
      api: 'openai-completions',
      models: [{ id: 'qwen2.5:1.5b' }],
    }
    // Pi checks the endpoint with it already in its models.json, the key in auth.json only.
    assert.deepEqual(calls[0].args, ['auth', 'check', '--provider', CUSTOM, '--json'])
    assert.deepEqual(calls[0].models.providers[CUSTOM], provider)
    assert.deepEqual(readJson(join(dir, 'models.json')), {
      providers: { custom: mine, [CUSTOM]: provider },
    })
    assert.deepEqual(readJson(join(dir, 'auth.json')), {
      custom: { type: 'api_key', key: 'k' },
      [CUSTOM]: { type: 'api_key', key: 'sk-local' },
    })
    assert.deepEqual(readJson(join(dir, 'settings.json')), {
      defaultProvider: CUSTOM,
      defaultModel: 'qwen2.5:1.5b',
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('the key prompt says when the key would cross the network unencrypted', async () => {
  const home = mkdtempSync(join(tmpdir(), 'pi-login-'))
  try {
    const prompt = async (baseUrl) => (await signInCustom(home, baseUrl)).frames[3].message
    // Another computer over plain http: the key is readable on the way.
    assert.equal(
      await prompt('http://192.168.1.20:8000/v1'),
      'API key (sent unencrypted over http)',
    )
    assert.equal(await prompt('http://models.example/v1'), 'API key (sent unencrypted over http)')
    // Encrypted, or never leaving this computer.
    assert.equal(await prompt('https://models.example/v1'), 'API key')
    assert.equal(await prompt('http://localhost:11434/v1'), 'API key')
    assert.equal(await prompt('http://127.0.0.1:8080/v1'), 'API key')
    assert.equal(await prompt('http://[::1]:8080/v1'), 'API key')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('an endpoint Pi does not accept leaves its models.json as it was', async () => {
  const home = mkdtempSync(join(tmpdir(), 'pi-login-'))
  try {
    const answers = [CUSTOM, 'http://localhost:1/v1', 'm', 'k']
    const { calls, result } = await signIn(answers, { ready: false, home })
    await assert.rejects(result)
    assert.deepEqual(calls[0].args, ['auth', 'check', '--provider', CUSTOM, '--json'])
    assert.equal(existsSync(join(home, '.pi', 'agent', 'models.json')), false)
    // Not a web address: refused before a key is asked for, and nothing is written.
    const other = await signIn([CUSTOM, 'localhost:11434', 'm', 'k'], { home })
    await assert.rejects(other.result)
    assert.deepEqual(
      other.frames.map(({ message }) => message),
      ['Choose a model provider', 'Base URL'],
    )
    assert.equal(existsSync(join(home, '.pi', 'agent', 'models.json')), false)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('a key Pi does not accept leaves the login as it was', async () => {
  const home = mkdtempSync(join(tmpdir(), 'pi-login-'))
  try {
    const { result } = await signIn(['openai', 'sk-bad'], { ready: false, home })
    await assert.rejects(result)
    assert.equal(existsSync(join(home, '.pi', 'agent', 'auth.json')), false)

    const dir = join(home, '.pi', 'agent')
    writeFileSync(
      join(dir, 'auth.json'),
      JSON.stringify({ anthropic: { type: 'api_key', key: 'k' } }),
    )
    const again = await signIn(['openai', 'sk-bad'], { ready: false, home })
    await assert.rejects(again.result)
    assert.deepEqual(readJson(join(dir, 'auth.json')), {
      anthropic: { type: 'api_key', key: 'k' },
    })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test("a turn's error is read from the session file Pi keeps", () => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-turn-'))
  try {
    const folder = join(dir, 'sessions', '--workspace--')
    mkdirSync(folder, { recursive: true })
    const file = join(folder, '2026-11-15T00-00-00-000Z_abc.jsonl')
    const line = (message) => `${JSON.stringify({ type: 'message', message })}\n`
    writeFileSync(file, line({ role: 'assistant', stopReason: 'error', errorMessage: '429 quota' }))
    assert.equal(piTurnError(dir, 'abc'), '429 quota')
    // A prompt over the model's context: Pi records the error, then edits it out of context.
    const overflow = '400: request (46055 tokens) exceeds the available context size (8192 tokens)'
    writeFileSync(
      file,
      line({ role: 'assistant', stopReason: 'error', errorMessage: overflow }) +
        `${JSON.stringify({ type: 'context_edit', targetId: 'm1', replacement: [] })}\n`,
    )
    assert.equal(piTurnError(dir, 'abc'), overflow)
    writeFileSync(file, line({ role: 'assistant', stopReason: 'stop', content: [] }))
    assert.equal(piTurnError(dir, 'abc'), undefined)
    assert.equal(piTurnError(dir, 'other'), undefined)
    assert.equal(piTurnError(join(dir, 'none'), 'abc'), undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('MCP values reach Pi as they are, never as a variable or a command', () => {
  assert.equal(literal('Bearer abc'), 'Bearer abc')
  assert.equal(literal('a$HOME${PATH}'), 'a$$HOME$${PATH}')
  assert.equal(literal('!rm -rf ~'), '$!rm -rf ~')
  assert.equal(literal('$!x'), '$$!x')
})

test('a provider error shown in the conversation carries no part of a key', () => {
  assert.equal(
    redactKeys('401 Incorrect API key provided: sk-proj-****abcd. You can find your API key'),
    '401 Incorrect API key provided: [redacted]. You can find your API key',
  )
  assert.equal(
    redactKeys('key AIzaSyA1234567890abc and Bearer xyz.123'),
    'key [redacted] and [redacted]',
  )
  assert.equal(
    redactKeys('401 {"type":"authentication_error","message":"invalid x-api-key"}'),
    '401 {"type":"authentication_error","message":"invalid x-api-key"}',
  )
})
