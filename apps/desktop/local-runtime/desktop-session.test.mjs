import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  MANUAL_IDLE_MS,
  claimDisplay,
  desktopRelay,
  listDesktops,
  lockFile,
  readLock,
  reap,
} from './desktop-session.mjs'

test('each session gets its own display, the lowest free one, and keeps it', () => {
  const pool = mkdtempSync(path.join(os.tmpdir(), 'desktops-'))

  assert.equal(claimDisplay(pool, 's1', 3), 2)
  assert.equal(claimDisplay(pool, 's2', 3), 3)
  assert.equal(claimDisplay(pool, 's1', 3), 2)
  assert.equal(claimDisplay(pool, 's3', 3), 4)
  assert.equal(claimDisplay(pool, 's4', 3), null)
  assert.deepEqual(
    listDesktops(pool).map((d) => [d.display, d.sessionId]),
    [
      [2, 's1'],
      [3, 's2'],
      [4, 's3'],
    ],
  )
  assert.equal(readLock(pool, 2)?.pid, process.pid)
})

test('a slot whose owner died is skipped until the reaper frees it', () => {
  const pool = mkdtempSync(path.join(os.tmpdir(), 'desktops-'))

  writeFileSync(
    lockFile(pool, 2),
    JSON.stringify({ sessionId: 'gone', pid: 2 ** 22 - 1, since: 'x' }),
  )
  assert.deepEqual(listDesktops(pool), [])
  assert.equal(claimDisplay(pool, 's1', 2), 3)
  reap(pool)
  assert.equal(readLock(pool, 2), null)
  assert.equal(claimDisplay(pool, 's2', 2), 2)
  // A session whose earlier run died gets its own slot back, under its new pid.
  writeFileSync(
    lockFile(pool, 3),
    JSON.stringify({ sessionId: 's3', pid: 2 ** 22 - 1, since: 'x' }),
  )
  assert.equal(claimDisplay(pool, 's3', 2), 3)
  assert.equal(readLock(pool, 3)?.pid, process.pid)
})

test('a desktop opened by hand is one slot, adopted by the session and freed when unwatched', () => {
  const pool = mkdtempSync(path.join(os.tmpdir(), 'desktops-'))

  // Opening twice claims one display, held by the host and marked manual.
  assert.equal(claimDisplay(pool, 's1', 3, process.pid, true), 2)
  assert.equal(claimDisplay(pool, 's1', 3, process.pid, true), 2)
  assert.deepEqual(readdirSync(pool), ['2.lock'])
  assert.equal(readLock(pool, 2)?.manual, true)
  // The session's own server takes it over; it is no longer manual.
  assert.equal(claimDisplay(pool, 's1', 3, process.ppid), 2)
  assert.equal(readLock(pool, 2)?.pid, process.ppid)
  assert.equal(readLock(pool, 2)?.manual, undefined)

  // A manual desktop nobody watched for MANUAL_IDLE_MS is freed; a watched one stays.
  assert.equal(claimDisplay(pool, 's2', 3, process.pid, true), 3)
  assert.equal(claimDisplay(pool, 's3', 3, process.pid, true), 4)
  const stale = (Date.now() - MANUAL_IDLE_MS - 1_000) / 1000

  utimesSync(lockFile(pool, 3), stale, stale)
  reap(pool)
  assert.deepEqual(
    listDesktops(pool).map((d) => d.sessionId),
    ['s1', 's3'],
  )
})

/** A stand-in computer-use server: answers the handshake and tool list, echoes calls with its display. */
function fakeServers() {
  const started = []
  const start = (env) => {
    let handle
    const server = {
      env,
      got: [],
      killed: false,
      send(message) {
        server.got.push(message)
        const display = env?.DISPLAY ?? 'none'

        if (message.method === 'initialize')
          handle({ id: message.id, result: { instructions: 'computer use' } })
        if (message.method === 'tools/list')
          handle({ id: message.id, result: { tools: [{ name: 'click' }] } })
        if (message.method === 'tools/call')
          handle({ id: message.id, result: { content: [{ type: 'text', text: display }] } })
      },
      onMessage(h) {
        handle = h
      },
      kill() {
        server.killed = true
      },
    }

    started.push(server)

    return server
  }

  return { started, start }
}

const handshake = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  { jsonrpc: '2.0', id: 2, method: 'tools/list' },
]

test('the desktop waits for the first tool call; listing tools needs none', async () => {
  const { started, start } = fakeServers()
  const sent = []
  let claims = 0
  const relay = desktopRelay({
    send: (message) => sent.push(message),
    start,
    desktop: () => {
      claims++

      return Promise.resolve({ display: 3, env: { DISPLAY: ':3' } })
    },
  })

  for (const message of handshake) await relay.receive(message)
  assert.equal(claims, 0)
  assert.equal(relay.display, null)
  assert.deepEqual(
    sent[1].result.tools.map((tool) => tool.name),
    ['click'],
  )

  await relay.receive({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'click' } })
  await relay.receive({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'click' } })
  assert.equal(claims, 1)
  assert.equal(relay.display, 3)
  // The display-less server is replaced by one on the desktop, told the handshake again.
  assert.equal(started.length, 2)
  assert.equal(started[0].killed, true)
  assert.deepEqual(
    started[1].got.map((message) => message.method),
    ['initialize', 'notifications/initialized', 'tools/call', 'tools/call'],
  )
  // Its reply to the replayed handshake stays here; the calls' replies reach the agent.
  assert.deepEqual(
    sent.slice(2).map((message) => [message.id, message.result.content[0].text]),
    [
      [3, ':3'],
      [4, ':3'],
    ],
  )
})

test('a full pool answers the call that needs a desktop, and the next call tries again', async () => {
  const { start } = fakeServers()
  const sent = []
  let free = false
  const relay = desktopRelay({
    send: (message) => sent.push(message),
    start,
    desktop: () =>
      free
        ? Promise.resolve({ display: 2, env: { DISPLAY: ':2' } })
        : Promise.reject(new Error('All 4 desktops on this computer are in use')),
  })

  await relay.receive({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'click' } })
  assert.equal(sent[0].result.isError, true)
  assert.match(sent[0].result.content[0].text, /All 4 desktops/u)
  free = true
  await relay.receive({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'click' } })
  assert.equal(sent[1].result.content[0].text, ':2')
})
