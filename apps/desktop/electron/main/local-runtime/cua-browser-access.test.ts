import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { CuaHost } from './cua-host.ts'

/**
 * A stand-in `cua_repl` that checks browser access the way the App's browser
 * service does: one framed `browser/access` request per call, verified against
 * the identity it was given. The `js` code names the turn it claims.
 */
const FAKE_SERVER = `
const crypto = require('node:crypto')
const net = require('node:net')
const os = require('node:os')
const le = os.endianness() === 'LE'
const send = (m) => process.stdout.write(JSON.stringify(m) + '\\n')
const env = process.env
const check = (request) => new Promise((resolve) => {
  if (!env.BROWSER_USE_ACCESS_PIPE_PATH || !env.BROWSER_USE_ACCESS_VERIFYING_IDENTITY)
    return resolve('The browser access host is unavailable')
  const key = crypto.createPublicKey({ key: Buffer.from(env.BROWSER_USE_ACCESS_VERIFYING_IDENTITY, 'base64'), type: 'spki', format: 'der' })
  const socket = net.createConnection(env.BROWSER_USE_ACCESS_PIPE_PATH)
  const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', method: 'browser/access', params: request, id: 1 }))
  const header = Buffer.alloc(4)
  le ? header.writeUInt32LE(body.length) : header.writeUInt32BE(body.length)
  socket.write(Buffer.concat([header, body]))
  let buffer = Buffer.alloc(0)
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    const size = le ? buffer.readUInt32LE(0) : buffer.readUInt32BE(0)
    if (buffer.length < 4 + size) return
    socket.end()
    const reply = JSON.parse(buffer.subarray(4, 4 + size).toString())
    if (reply.error) return resolve(reply.error.message)
    const { payload, signature } = reply.result
    if (!crypto.verify(null, Buffer.from(payload), key, Buffer.from(signature, 'base64')))
      return resolve('Cannot authenticate the browser access response')
    resolve(payload === JSON.stringify({ domain: 'codex.browserAccess.v1', request, allowed: true }) ? 'allowed' : 'disabled')
  })
})
require('node:readline').createInterface({ input: process.stdin }).on('line', async (line) => {
  const m = JSON.parse(line)
  if (m.method === 'initialize' || m.params?.name === 'turn_ended') send({ jsonrpc: '2.0', id: m.id, result: {} })
  if (m.params?.name !== 'js') return
  const turn = m.params._meta['x-codex-turn-metadata']
  const text = await check({ executorId: env.BROWSER_USE_ACCESS_EXECUTOR_ID, sessionId: turn.session_id, turnId: m.params.arguments.code || turn.turn_id, nonce: 'n' })
  send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text }] } })
})
`

function fakeServer() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cua-'))
  const script = path.join(dir, 'server.cjs')

  writeFileSync(script, FAKE_SERVER)

  return { command: process.execPath, args: [script], env: {} }
}

const signal = () => new AbortController().signal
const allow = () => Promise.resolve(true)
const text = (result: { content: unknown[] }) => (result.content[0] as { text: string }).text

test('the App may use browsers for the turn in flight, signed by this host', async () => {
  const cua = new CuaHost('s1', fakeServer(), () => {}, { HOME: os.tmpdir() })
  const first = await cua.run({ session: 's1', turn: 't1', code: '' }, signal(), allow)
  const next = await cua.run({ session: 's1', turn: 't2', code: '' }, signal(), allow)

  await cua.close()
  assert.equal(text(first), 'allowed')
  assert.equal(text(next), 'allowed')
})

test('browser access is refused for any turn but the one in flight', async () => {
  const cua = new CuaHost('s1', fakeServer(), () => {}, { HOME: os.tmpdir() })
  const result = await cua.run({ session: 's1', turn: 't2', code: 't1' }, signal(), allow)

  await cua.close()
  assert.equal(text(result), 'Browser access is not allowed for this turn')
})
