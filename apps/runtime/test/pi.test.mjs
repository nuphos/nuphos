import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { agentEnv } from '../image/acp-shim.mjs'
import { listedModels, runPiLogin } from '../image/pi-login.mjs'
import { piTurnError, writePiMcpServers } from '../image/pi-session.mjs'

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))

test('each conversation and each teammate in it runs Pi from an agent directory of its own', () => {
  const home = mkdtempSync(join(tmpdir(), 'pi-runtime-'))
  try {
    const root = join(home, '.pi', 'agent')
    mkdirSync(root, { recursive: true })
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
      assert.equal(readlinkSync(join(dir, 'auth.json')), join(root, 'auth.json'))
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

const LISTING = 'provider model\ndeepseek deepseek-chat\ndeepseek deepseek-reasoner\n'

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

test('Pi signs in with an API key and the model conversations start on', async () => {
  const home = mkdtempSync(join(tmpdir(), 'pi-login-'))
  try {
    const { frames, calls, result } = await signIn(['deepseek', 'sk-test', 'deepseek-reasoner'], {
      home,
    })
    await result
    const dir = join(home, '.pi', 'agent')
    assert.deepEqual(
      frames.map((frame) => frame.type),
      ['choose', 'input', 'choose', 'authenticated'],
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
      defaultModel: 'deepseek-reasoner',
    })
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
    writeFileSync(file, line({ role: 'assistant', stopReason: 'stop', content: [] }))
    assert.equal(piTurnError(dir, 'abc'), undefined)
    assert.equal(piTurnError(dir, 'other'), undefined)
    assert.equal(piTurnError(join(dir, 'none'), 'abc'), undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
