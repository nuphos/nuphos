import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { CUA_PLUGIN_CACHE } from './agent-home.ts'
import { CuaHost, cuaServerConfig } from './cua-host.ts'
import { LocalCuaStream } from './cua-stream.ts'

const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

/** A stand-in `cua_repl`: asks one approval per `js` call, then echoes what it got. */
const FAKE_SERVER = `
const rl = require('node:readline').createInterface({ input: process.stdin })
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n')
const calls = new Map()
rl.on('line', (line) => {
  const m = JSON.parse(line)
  if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: {} })
  if (m.method === 'tools/call' && m.params.name === 'js') {
    calls.set(1, m)
    send({ jsonrpc: '2.0', id: 1, method: 'elicitation/create', params: { message: 'Allow?', _meta: { tool_name: 'get_app_state', tool_params: { app: 'finder' }, persist: ['session'] } } })
  }
  if (m.method === 'tools/call' && m.params.name === 'turn_ended')
    process.stderr.write('ended ' + m.params.arguments.turn_id)
  if (!m.method && calls.has(m.id)) {
    const call = calls.get(m.id)
    calls.delete(m.id)
    send({ jsonrpc: '2.0', id: call.id, result: { content: [{ type: 'text', text: JSON.stringify({ action: m.result.action, meta: call.params._meta, code: call.params.arguments.code }) }] } })
  }
})
`

function fakeServer() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cua-'))
  const script = path.join(dir, 'server.cjs')

  writeFileSync(script, FAKE_SERVER)

  return { command: process.execPath, args: [script], env: {} }
}

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

test('a call carries Codex turn metadata and the approval answer reaches the App', async () => {
  const host = new CuaHost('s1', fakeServer(), () => {}, { HOME: os.tmpdir() })
  const asked: string[] = []

  host.elicit = async (request) => {
    asked.push(request.message)

    return true
  }
  const result = await host.run(
    { session: 's1', turn: 't1', code: '1' },
    new AbortController().signal,
  )

  host.close()
  assert.deepEqual(asked, ['Allow?'])
  assert.deepEqual(JSON.parse((result.content[0] as { text: string }).text), {
    action: 'accept',
    meta: { 'x-codex-turn-metadata': { session_id: 's1', turn_id: 't1' } },
    code: '1',
  })
})

test('an app allowed once is not asked again in the same conversation', async () => {
  const host = new CuaHost('remember', fakeServer(), () => undefined, { HOME: os.tmpdir() })
  let asked = 0

  host.elicit = async () => {
    asked++

    return true
  }
  await host.run({ session: 'remember', turn: 't1', code: '1' }, new AbortController().signal)
  const second = await host.run(
    { session: 'remember', turn: 't1', code: '2' },
    new AbortController().signal,
  )

  host.close()
  assert.equal(asked, 1)
  assert.equal(JSON.parse((second.content[0] as { text: string }).text).action, 'accept')
})

test('without an answerer the App is told no', async () => {
  const host = new CuaHost('unanswered', fakeServer(), () => {}, { HOME: os.tmpdir() })
  const result = await host.run(
    { session: 'unanswered', turn: 't1', code: '1' },
    new AbortController().signal,
  )

  host.close()
  assert.equal(JSON.parse((result.content[0] as { text: string }).text).action, 'decline')
})

test('the stream forwards approval prompts and returns one result', async () => {
  let elicit:
    ((request: { message: string; meta: Record<string, unknown> }) => Promise<boolean>) | undefined
  const host = {
    set elicit(value: typeof elicit) {
      elicit = value
    },
    run: async () => ({
      content: [{ type: 'text', text: String(await elicit?.({ message: 'Allow?', meta: {} })) }],
    }),
  } as unknown as CuaHost
  const stream = new LocalCuaStream({ config: () => fakeServer(), host: () => host })
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
