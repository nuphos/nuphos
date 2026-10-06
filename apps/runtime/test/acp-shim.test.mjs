import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { createInterface } from 'node:readline'
import { test } from 'node:test'

import { SESSION_META, runShim } from '../image/acp-shim.mjs'

// A native ACP agent stand-in: answers every request with what it was asked and
// the env it runs under, so the test can see exactly what reached the agent.
const FAKE_AGENT = `
const rl = require('node:readline').createInterface({ input: process.stdin })
rl.on('line', (line) => {
  const m = JSON.parse(line)
  if (m.id === undefined) return
  const seen = { method: m.method, params: m.params, pid: process.pid, env: {
    HOME: process.env.HOME, NUPHOS_TOKEN: process.env.NUPHOS_TOKEN, EXTRA: process.env.EXTRA,
    GROK_HOME: process.env.GROK_HOME, GEMINI_HOME: process.env.GEMINI_HOME } }
  const result = m.method === 'session/new' ? { sessionId: 's1', configOptions: [], seen } : { seen }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\\n')
})
`

async function withShim(provider, run, agentScript = FAKE_AGENT) {
  const home = await mkdtemp(join(tmpdir(), 'nuphos-shim-test-'))
  const input = new PassThrough()
  const output = new PassThrough()
  const children = []
  const replies = new Map()
  const notifications = []
  const outputs = []
  createInterface({ input: output }).on('line', (line) => {
    const message = JSON.parse(line)
    outputs.push(message)
    if (message.method) notifications.push(message)
    replies.get(message.id)?.(message)
  })
  runShim({
    provider,
    input,
    output,
    runtimeEnv: { HOME: home, PATH: process.env.PATH },
    spawnAgent: (command, env) => {
      const child = spawn(process.execPath, ['-e', agentScript], {
        env,
        stdio: ['pipe', 'pipe', 'inherit'],
      })
      children.push({ command, child })
      return child
    },
    onExit: () => {},
  })
  let id = 0
  const call = (method, params) =>
    new Promise((resolve) => {
      replies.set(++id, resolve)
      input.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  try {
    await run({ call, children, home, notifications, outputs })
  } finally {
    for (const { child } of children) child.kill()
    await rm(home, { recursive: true, force: true })
  }
}

const session = (systemPrompt) => ({
  cwd: '/workspace',
  mcpServers: [],
  _meta: {
    [SESSION_META]: {
      systemPrompt,
      env: { NUPHOS_SESSION_ID: 'conversation-1', NUPHOS_TOKEN: 'token', EXTRA: 'dropped' },
    },
  },
})

test('grok opens the session under its own env and takes the instructions as rules', async () => {
  await withShim('grok', async ({ call, children, home }) => {
    const init = await call('initialize', {
      protocolVersion: 1,
      clientCapabilities: { terminal: true, fs: { readTextFile: true } },
    })
    assert.equal(init.result.seen.method, 'initialize')
    // Commands run in the agent's own process, never in the gateway's.
    assert.deepEqual(init.result.seen.params.clientCapabilities, {
      terminal: false,
      fs: { readTextFile: true },
    })
    const reply = await call('session/new', session('Be Nuphos.'))
    const { seen } = reply.result

    // Respawned once, and the replayed initialize never reached the client.
    assert.equal(children.length, 2)
    assert.deepEqual(children[1].command, ['grok', 'agent', '--no-leader', 'stdio'])
    assert.notEqual(seen.pid, init.result.seen.pid)
    assert.equal(seen.env.NUPHOS_TOKEN, 'token')
    assert.equal(seen.env.EXTRA, undefined)
    assert.match(seen.env.HOME, /\.nuphos\/session-homes\/[0-9a-f]{64}$/)
    assert.equal(seen.env.GROK_HOME, join(home, '.grok'))
    assert.equal(seen.params._meta.rules, 'Be Nuphos.')

    const prompt = await call('session/prompt', {
      sessionId: 's1',
      prompt: [{ type: 'text', text: 'hi' }],
    })
    assert.deepEqual(prompt.result.seen.params.prompt, [{ type: 'text', text: 'hi' }])
  })
})

test('antigravity takes the instructions on the first prompt only', async () => {
  await withShim('antigravity', async ({ call, children, home }) => {
    await call('initialize', { protocolVersion: 1 })
    const reply = await call('session/new', session('Be Nuphos.'))
    assert.deepEqual(children[1].command, ['agy-acp-server'])
    assert.equal(reply.result.seen.env.GEMINI_HOME, join(home, '.gemini'))
    assert.equal(reply.result.seen.params._meta.rules, undefined)

    const first = await call('session/prompt', {
      sessionId: 's1',
      prompt: [{ type: 'text', text: 'hi' }],
    })
    assert.deepEqual(first.result.seen.params.prompt, [
      { type: 'text', text: '<nuphos-instructions>\nBe Nuphos.\n</nuphos-instructions>' },
      { type: 'text', text: 'hi' },
    ])
    const second = await call('session/prompt', {
      sessionId: 's1',
      prompt: [{ type: 'text', text: 'again' }],
    })
    assert.deepEqual(second.result.seen.params.prompt, [{ type: 'text', text: 'again' }])
  })
})

test('antigravity takes refreshed instructions after a load or resume', async () => {
  const prompt = (call, text) =>
    call('session/prompt', { sessionId: 's1', prompt: [{ type: 'text', text }] })
  const block = (text) => ({
    type: 'text',
    text: `<nuphos-instructions>\n${text}\n</nuphos-instructions>`,
  })

  // Same process: new with A, then load with B.
  await withShim('antigravity', async ({ call }) => {
    await call('initialize', { protocolVersion: 1 })
    await call('session/new', session('A'))
    await prompt(call, 'hi')
    await call('session/load', { ...session('B'), sessionId: 's1' })
    const next = await prompt(call, 'again')
    assert.deepEqual(next.result.seen.params.prompt, [block('B'), { type: 'text', text: 'again' }])
  })

  // Fresh process restoring an existing session.
  await withShim('antigravity', async ({ call }) => {
    await call('initialize', { protocolVersion: 1 })
    await call('session/resume', { ...session('C'), sessionId: 's1' })
    const first = await prompt(call, 'back')
    assert.deepEqual(first.result.seen.params.prompt, [block('C'), { type: 'text', text: 'back' }])
  })
})

test('a session without Nuphos context keeps the first agent', async () => {
  await withShim('grok', async ({ call, children }) => {
    await call('initialize', { protocolVersion: 1 })
    await call('session/new', { cwd: '/workspace', mcpServers: [] })
    assert.equal(children.length, 1)
  })
})

// Grok: every turn ends with its own `turn_completed`; a scheduled wakeup runs a
// turn after the prompt has answered, opening with a user message of its own.
const GROK_TURNS = `
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n')
const update = (sessionUpdate, extra = {}) =>
  send({ jsonrpc: '2.0', method: sessionUpdate === 'turn_completed' ? '_x.ai/session/update' : 'session/update',
    params: { sessionId: 's1', update: { sessionUpdate, ...extra } } })
const text = { content: { type: 'text', text: 'x' } }
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line)
  if (m.method === 'session/prompt') {
    update('user_message_chunk', text)
    update('agent_message_chunk', text)
    update('turn_completed', { prompt_id: 'p1' })
    // As Grok does: the wakeup starts before the prompt's answer is written.
    update('user_message_chunk', text)
    update('agent_message_chunk', { content: { type: 'text', text: 'hi' } })
    send({ jsonrpc: '2.0', id: m.id, result: { stopReason: 'end_turn' } })
    setTimeout(() => update('turn_completed', { prompt_id: 'subagent-completed-1' }), 20)
  } else if (m.id !== undefined) {
    send({ jsonrpc: '2.0', id: m.id, result: m.method === 'session/new' ? { sessionId: 's1', configOptions: [] } : {} })
  }
})
`

test('a turn grok starts on its own ends with the marker the backend reads', async () => {
  await withShim(
    'grok',
    async ({ call, notifications, outputs }) => {
      await call('initialize', { protocolVersion: 1 })
      await call('session/new', session('Be Nuphos.'))
      const answerId = 3
      await call('session/prompt', { sessionId: 's1', prompt: [{ type: 'text', text: 'hi' }] })
      await new Promise((resolve) => setTimeout(resolve, 200))

      const states = (m) => m.params?.update?._meta?.['ai.nuphos/sessionState']?.state
      // The prompt's turn, then the wakeup's: each opens active and closes idle,
      // and the wakeup's message sits inside its own.
      const order = outputs
        .map((m) => (m.id === answerId ? 'answer' : (states(m) ?? m.params?.update?.content?.text)))
        .filter((step) => ['answer', 'active', 'idle', 'hi'].includes(step))
      assert.deepEqual(order, ['active', 'answer', 'idle', 'active', 'hi', 'idle'])
    },
    GROK_TURNS,
  )
})

// Like Google's ACP server, answers a prompt only after a delay, and reports
// whether another prompt reached it in the meantime.
const SLOW_AGENT = `
let busy = false
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line)
  if (m.id === undefined) return
  const reply = (result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\\n')
  if (m.method !== 'session/prompt')
    return reply(m.method === 'session/new' ? { sessionId: 's1', configOptions: [] } : {})
  const overlapped = busy
  busy = true
  setTimeout(() => { busy = false; reply({ stopReason: 'end_turn', overlapped, text: m.params.prompt.at(-1).text }) }, 50)
})
`

test('antigravity takes one prompt at a time per session', async () => {
  await withShim(
    'antigravity',
    async ({ call }) => {
      await call('initialize', { protocolVersion: 1 })
      await call('session/new', session(''))
      const prompt = (text) =>
        call('session/prompt', { sessionId: 's1', prompt: [{ type: 'text', text }] })
      const [first, second] = await Promise.all([prompt('one'), prompt('two')])
      assert.deepEqual(
        [first.result, second.result].map(({ overlapped, text }) => ({ overlapped, text })),
        [
          { overlapped: false, text: 'one' },
          { overlapped: false, text: 'two' },
        ],
      )
    },
    SLOW_AGENT,
  )
})
