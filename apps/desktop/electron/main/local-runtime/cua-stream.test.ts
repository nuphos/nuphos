import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { CUA_PLUGIN_CACHE } from './agent-home.ts'
import { CuaHost, cuaServerConfig } from './cua-host.ts'
import { CUA_RESULT_MAX_CHARS, LocalCuaStream, fitFrame } from './cua-stream.ts'

import type { CuaElicitation } from './cua-host.ts'

const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

/**
 * A stand-in `cua_repl`: each `js` call first pings the client, then asks one
 * approval, then echoes what it got. `turn_ended` is answered like the App does.
 */
const FAKE_SERVER = `
const rl = require('node:readline').createInterface({ input: process.stdin })
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n')
const calls = new Map()
const pings = new Map()
rl.on('line', (line) => {
  const m = JSON.parse(line)
  if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: {} })
  if (m.method === 'tools/call' && m.params.name === 'turn_ended') send({ jsonrpc: '2.0', id: m.id, result: {} })
  if (m.method === 'tools/call' && m.params.name === 'js') {
    calls.set('e' + m.id, m)
    send({ jsonrpc: '2.0', id: 'p' + m.id, method: 'ping' })
    send({ jsonrpc: '2.0', id: 'e' + m.id, method: 'elicitation/create', params: { message: 'Allow?', _meta: { tool_params: { app: 'finder' }, persist: ['session'] } } })
  }
  if (!m.method && String(m.id).startsWith('p')) pings.set('e' + String(m.id).slice(1), m.error?.code)
  if (!m.method && calls.has(m.id)) {
    const call = calls.get(m.id)
    calls.delete(m.id)
    const echo = { action: m.result.action, meta: call.params._meta, code: call.params.arguments.code, ping: pings.get(m.id) }
    send({ jsonrpc: '2.0', id: call.id, result: { content: [{ type: 'text', text: JSON.stringify(echo) }] } })
  }
})
`

function fakeServer() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cua-'))
  const script = path.join(dir, 'server.cjs')

  writeFileSync(script, FAKE_SERVER)

  return { command: process.execPath, args: [script], env: {} }
}

const host = () => new CuaHost('s1', fakeServer(), () => {}, { HOME: os.tmpdir() })
const signal = () => new AbortController().signal
const echo = (result: { content: unknown[] }) =>
  JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>

test('finds the newest enabled cua_repl the App installed', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'codex-'))
  const write = (version: string, server: Record<string, unknown>) => {
    const dir = path.join(home, CUA_PLUGIN_CACHE, version)

    mkdirSync(dir, { recursive: true })
    writeFileSync(path.join(dir, '.mcp.json'), JSON.stringify({ mcpServers: { cua_repl: server } }))
  }

  assert.equal(cuaServerConfig({ CODEX_HOME: home }), null)
  write('26.9.1', { command: process.execPath, args: ['old'] })
  write('26.10.1', { command: process.execPath, args: ['new'], env: { A: '1' } })
  assert.deepEqual(cuaServerConfig({ CODEX_HOME: home }), {
    command: process.execPath,
    args: ['new'],
    env: { A: '1' },
  })
  write('26.11.1', { command: '/missing/node', args: [] })
  assert.equal(cuaServerConfig({ CODEX_HOME: home }), null)
})

test('a call carries Codex turn metadata, and only approval requests get an approval answer', async () => {
  const cua = host()
  const asked: string[] = []
  const result = await cua.run({ session: 's1', turn: 't1', code: '1' }, signal(), (request) => {
    asked.push(request.message)

    return Promise.resolve(true)
  })

  await cua.close()
  assert.deepEqual(asked, ['Allow?'])
  assert.deepEqual(echo(result), {
    action: 'accept',
    meta: { 'x-codex-turn-metadata': { session_id: 's1', turn_id: 't1' } },
    code: '1',
    ping: -32601,
  })
})

test('an app allowed for the session is not asked again while the process lives', async () => {
  const cua = host()
  let asked = 0
  const allow = () => {
    asked++

    return Promise.resolve(true)
  }

  await cua.run({ session: 's1', turn: 't1', code: '1' }, signal(), allow)
  const second = await cua.run({ session: 's1', turn: 't1', code: '2' }, signal(), allow)

  await cua.close()
  assert.equal(asked, 1)
  assert.equal(echo(second).action, 'accept')
  const fresh = host()
  const denied = await fresh.run({ session: 's1', turn: 't1', code: '3' }, signal(), () =>
    Promise.resolve(false),
  )

  await fresh.close()
  assert.equal(echo(denied).action, 'decline')
})

test('parallel calls run one at a time, each asking its own approver', async () => {
  const cua = host()
  const order: string[] = []
  const approver =
    (name: string) =>
    async (_request: CuaElicitation): Promise<boolean> => {
      order.push(name)
      await new Promise((resolve) => setTimeout(resolve, 20))

      return name === 'second'
    }
  const [first, second] = await Promise.all([
    cua.run({ session: 's1', turn: 't1', code: 'a' }, signal(), approver('first')),
    cua.run({ session: 's1', turn: 't1', code: 'b' }, signal(), approver('second')),
  ])

  await cua.close()
  assert.deepEqual(order, ['first', 'second'])
  assert.deepEqual(
    [first, second].map((result) => [echo(result).code, echo(result).action]),
    [
      ['a', 'decline'],
      ['b', 'accept'],
    ],
  )
})

test('the stream forwards approval prompts and returns one result', async () => {
  const fake = {
    run: async (
      _call: unknown,
      _signal: AbortSignal,
      elicit: (request: CuaElicitation) => Promise<boolean>,
    ) => ({
      content: [{ type: 'text', text: String(await elicit({ message: 'Allow?', meta: {} })) }],
    }),
  } as unknown as CuaHost
  const stream = new LocalCuaStream({ config: () => fakeServer(), host: () => fake })
  const sent: Record<string, unknown>[] = []

  stream.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as Record<string, unknown>

    sent.push(message)
    if (message.t === 'elicit')
      stream.send(JSON.stringify({ t: 'elicit-reply', id: message.id, accept: true }))
  })
  await tick()
  stream.send(JSON.stringify({ t: 'call', session: 'stream-s', turn: 't', code: '1' }))
  await tick()
  await tick()
  assert.equal(sent[0]?.t, 'elicit')
  assert.deepEqual(sent[1], { t: 'result', result: { content: [{ type: 'text', text: 'true' }] } })
  assert.equal(stream.readyState, 3)
})

test('without the App the call fails with an explanation', async () => {
  const stream = new LocalCuaStream({ config: () => null, host: () => assert.fail('no host') })
  const sent: { t: string; result: { isError: boolean } }[] = []

  stream.addEventListener('message', (event) => sent.push(JSON.parse(String(event.data))))
  await tick()
  stream.send(JSON.stringify({ t: 'call', session: 'none', turn: 't', code: '1' }))
  await tick()
  assert.equal(sent[0]?.result.isError, true)
})

test('a result too large for one tunnel frame keeps its text and drops the image', () => {
  const small = { content: [{ type: 'image', data: 'cG5n', mimeType: 'image/png' }] }
  const huge = {
    content: [
      { type: 'text', text: 'state' },
      { type: 'image', data: 'x'.repeat(CUA_RESULT_MAX_CHARS), mimeType: 'image/png' },
    ],
  }

  assert.equal(fitFrame(small), small)
  const fitted = fitFrame(huge)

  assert.equal((fitted.content[0] as { text: string }).text, 'state')
  assert.equal(
    fitted.content.some((part) => (part as { type: string }).type === 'image'),
    false,
  )
  assert.ok(JSON.stringify(fitted).length < CUA_RESULT_MAX_CHARS)
})
