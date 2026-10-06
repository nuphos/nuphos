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

async function withShim(provider, run) {
  const home = await mkdtemp(join(tmpdir(), 'nuphos-shim-test-'))
  const input = new PassThrough()
  const output = new PassThrough()
  const children = []
  const replies = new Map()
  createInterface({ input: output }).on('line', (line) => {
    const message = JSON.parse(line)
    replies.get(message.id)?.(message)
  })
  runShim({
    provider,
    input,
    output,
    runtimeEnv: { HOME: home, PATH: process.env.PATH },
    spawnAgent: (command, env) => {
      const child = spawn(process.execPath, ['-e', FAKE_AGENT], {
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
    await run({ call, children, home })
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
    const init = await call('initialize', { protocolVersion: 1 })
    assert.equal(init.result.seen.method, 'initialize')
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
    assert.deepEqual(reply.result.seen.params._meta.agy, { disabledTools: ['schedule'] })

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
