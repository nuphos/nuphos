import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { patchAdapter } from '../image/codex-acp/patch-adapter.mjs'

const source = fileURLToPath(
  new URL(
    '../image/codex-acp/node_modules/@agentclientprotocol/codex-acp/dist/index.js',
    import.meta.url,
  ),
)
const base = mkdtempSync(join(tmpdir(), 'nuphos-codex-steering-'))
const record = join(base, 'requests.jsonl')
const helper = readFileSync(
  new URL('../image/codex-acp/session-config.mjs', import.meta.url),
  'utf8',
)
let child
let stderr = ''
let next = 0
const pending = new Map()

const send = (method, params) => {
  const id = ++next
  const reply = new Promise((resolve) => pending.set(id, resolve))

  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)

  return Promise.race([
    reply,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout ${method}: ${stderr}`)), 10_000).unref(),
    ),
  ])
}
const rpc = async (method, params) => {
  const reply = await send(method, params)

  assert.equal(reply.error, undefined, JSON.stringify(reply.error))

  return reply.result
}
const appServerCalls = (method) =>
  readFileSync(record, 'utf8')
    .trim()
    .split('\n')
    .map(JSON.parse)
    .filter((call) => call.method === method)
// OpenAB's steering request, verbatim apart from the prompt.
const steer = (sessionId, text) =>
  send('_session/steering', {
    sessionId,
    prompt: [{ type: 'text', text }],
    _meta: { steering: { idleBehavior: 'promptRequired' } },
  })

let initialized
let sessionId

before(async () => {
  writeFileSync(join(base, 'patched.mjs'), patchAdapter(readFileSync(source, 'utf8'), helper))
  writeFileSync(record, '')
  child = spawn(process.execPath, [join(base, 'patched.mjs')], {
    env: {
      PATH: process.env.PATH,
      HOME: base,
      CODEX_PATH: fileURLToPath(new URL('./fixtures/codex-app-server.mjs', import.meta.url)),
      NUPHOS_SMOKE_RECORD: record,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  createInterface({ input: child.stdout }).on('line', (line) => {
    const message = JSON.parse(line)

    if (pending.has(message.id)) {
      pending.get(message.id)(message)
      pending.delete(message.id)
    }
  })
  initialized = await rpc('initialize', {
    protocolVersion: 1,
    clientInfo: { name: 'openab', version: '0.1.0' },
    clientCapabilities: {},
  })
  sessionId = (await rpc('session/new', { cwd: '/workspace/conv-smoke', mcpServers: [] })).sessionId
})

after(async () => {
  const exited = once(child, 'exit')

  child.stdin.end()
  child.kill()
  await exited
  rmSync(base, { recursive: true, force: true })
})

test('the pinned adapter advertises native steering to OpenAB', () => {
  assert.deepEqual(initialized._meta, { steering: { supported: true } })
})

test('an idle session requires a prompt and never starts a turn', async () => {
  const reply = await steer(sessionId, 'Too early')

  assert.deepEqual(reply.result, { outcome: 'promptRequired', reason: 'noRunningTurn' })
  assert.equal(appServerCalls('turn/start').length, 0)
  assert.equal(appServerCalls('turn/steer').length, 0)
})

test('mid-turn input joins the active native turn, which settles once', async () => {
  let settled = false
  const prompt = rpc('session/prompt', {
    sessionId,
    prompt: [{ type: 'text', text: 'Fixture held turn' }],
  }).finally(() => {
    settled = true
  })

  for (let n = 0; n < 200 && appServerCalls('turn/start').length === 0; n++)
    await new Promise((resolve) => setTimeout(resolve, 10))
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(settled, false, 'the held turn must still be running')

  assert.deepEqual((await steer(sessionId, 'Focus on tests')).result, { outcome: 'injected' })
  assert.deepEqual(appServerCalls('turn/steer').at(-1).params, {
    threadId: sessionId,
    expectedTurnId: 'smoke-turn',
    input: [{ type: 'text', text: 'Focus on tests', text_elements: [] }],
  })
  assert.equal((await prompt).stopReason, 'end_turn')
  assert.equal(appServerCalls('turn/start').length, 1, 'steering must not start another turn')
})

test('a steer after the turn settled requires a prompt instead of reporting delivery', async () => {
  const reply = await steer(sessionId, 'After the turn')

  assert.deepEqual(reply.result, { outcome: 'promptRequired', reason: 'noRunningTurn' })
  assert.equal(appServerCalls('turn/start').length, 1)
})
