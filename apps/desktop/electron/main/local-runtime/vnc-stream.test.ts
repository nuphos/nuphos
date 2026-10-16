import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { VncStream } from './vnc-stream.ts'

import type { AddressInfo, Socket } from 'node:net'

const tick = () => new Promise((resolve) => setTimeout(resolve, 20))

test('bridges base64 frames to the display’s VNC port and holds the lock while a human has the desktop', async () => {
  const pool = mkdtempSync(path.join(tmpdir(), 'pool-'))

  mkdirSync(path.join(pool, '2.xdg'))
  writeFileSync(path.join(pool, '2.lock'), JSON.stringify({ sessionId: 's1', pid: process.pid }))
  const received: Buffer[] = []
  let client: Socket | undefined
  const server = createServer((socket) => {
    client = socket
    socket.on('data', (chunk) => received.push(chunk))
    socket.write('RFB 003.008\n')
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const stream = new VncStream(pool, () => (server.address() as AddressInfo).port)
  const messages: string[] = []
  let closed = false

  stream.addEventListener('message', (event) => messages.push(String(event.data)))
  stream.addEventListener('close', () => {
    closed = true
  })
  await tick()
  assert.equal(stream.readyState, 1)
  stream.send(JSON.stringify({ t: 'open', sessionId: 's1', display: 2, viewer: 'u 1' }))
  await tick()
  assert.deepEqual(messages, [Buffer.from('RFB 003.008\n').toString('base64')])
  stream.send(Buffer.from('hello').toString('base64'))
  await tick()
  assert.equal(Buffer.concat(received).toString(), 'hello')
  const control = path.join(pool, '2.xdg', 'instabox-control')

  stream.send(JSON.stringify({ t: 'control', owner: 'human' }))
  assert.match(readFileSync(control, 'utf8'), /^human u1 \d+\n$/u)
  stream.send(JSON.stringify({ t: 'control', owner: 'agent' }))
  assert.equal(readFileSync(control, 'utf8'), 'agent\n')
  stream.send(JSON.stringify({ t: 'control', owner: 'human' }))
  stream.close()
  assert.equal(readFileSync(control, 'utf8'), 'agent\n')
  assert.equal(closed, true)
  await tick()
  assert.equal(client?.destroyed, true)
  server.close()
})

test('a display another session holds, or an unknown frame first, ends the stream', async () => {
  const pool = mkdtempSync(path.join(tmpdir(), 'pool-'))

  writeFileSync(path.join(pool, '2.lock'), JSON.stringify({ sessionId: 's2', pid: process.pid }))
  for (const first of [
    JSON.stringify({ t: 'open', sessionId: 's1', display: 2, viewer: 'u1' }),
    JSON.stringify({ t: 'open', sessionId: 's1', display: 3, viewer: 'u1' }),
    '{"t":"control","owner":"human"}',
  ]) {
    let connected = false
    const stream = new VncStream(pool, () => {
      connected = true

      return 1
    })
    let closed = false

    stream.addEventListener('close', () => {
      closed = true
    })
    await tick()
    stream.send(first)
    assert.equal(closed, true, first)
    assert.equal(connected, false, first)
  }
})
