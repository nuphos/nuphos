import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { decoder, encode, findHost, nativeMessaging } from './native-messaging.ts'

import type { Sender } from './native-messaging.ts'

const EXTENSION_ID = 'aeblfdkhhhdcdjpifhhbdiojplfjncoa'
const HOST = 'com.1password.1password'
const OTHER = 'nngceckbapebfimnlniiiahkandclblb'

async function hostDir(manifest: Record<string, unknown>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'native-host-'))

  await writeFile(path.join(dir, `${HOST}.json`), JSON.stringify(manifest))

  return dir
}

/** A host that answers each message with { echo, origin } (Chrome passes the origin as its argument). */
async function echoHost() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'native-host-'))
  const program = path.join(dir, 'echo-host')

  await writeFile(
    program,
    `#!${process.execPath}
let pending = Buffer.alloc(0)
process.stdin.on('data', (chunk) => {
  pending = Buffer.concat([pending, chunk])
  while (pending.length >= 4 && pending.length >= 4 + pending.readUInt32LE(0)) {
    const length = pending.readUInt32LE(0)
    const body = Buffer.from(JSON.stringify({ echo: JSON.parse(pending.subarray(4, 4 + length)), origin: process.argv[2] }))
    const head = Buffer.alloc(4)
    head.writeUInt32LE(body.length)
    process.stdout.write(Buffer.concat([head, body]))
    pending = pending.subarray(4 + length)
  }
})
`,
  )
  await chmod(program, 0o755)

  return hostDir({
    name: HOST,
    type: 'stdio',
    path: program,
    allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
  })
}

function worker(id: string) {
  const ipc = new EventEmitter()
  const sent = new EventEmitter()
  const sender: Sender = {
    scope: `chrome-extension://${id}/`,
    send: (channel, ...args) => sent.emit(channel, ...args),
    ipc: { on: (c, l) => ipc.on(c, l), off: (c, l) => ipc.off(c, l) },
  }

  return { sender, ipc, sent }
}

test('framing survives multi-byte text, split chunks and several messages per chunk', () => {
  const messages: unknown[] = []
  const read = decoder((message) => messages.push(message))
  const bytes = Buffer.concat([encode({ name: '密碼 🔑' }), encode([1, 2])])

  read(bytes.subarray(0, 7))
  read(bytes.subarray(7))
  assert.deepEqual(messages, [{ name: '密碼 🔑' }, [1, 2]])

  const huge = Buffer.alloc(4)

  huge.writeUInt32LE(1024 * 1024 + 1)
  assert.throws(() => decoder(() => null)(huge), /too large/)
})

test('only an allow-listed extension, listed in the manifest, finds its host', async () => {
  const listed = await hostDir({
    name: HOST,
    type: 'stdio',
    path: '/opt/1password/helper',
    allowed_origins: [`chrome-extension://${EXTENSION_ID}/`, `chrome-extension://${OTHER}/`],
  })
  const missing = path.join(os.tmpdir(), 'no-such-native-host-dir')

  assert.equal(await findHost(HOST, EXTENSION_ID, [missing, listed]), '/opt/1password/helper')
  // The manifest lists it, but Nuphos doesn't allow it.
  assert.equal(await findHost(HOST, OTHER, [listed]), null)
  assert.equal(await findHost('com.example.other', EXTENSION_ID, [listed]), null)

  const unlisted = await hostDir({
    name: HOST,
    type: 'stdio',
    path: '/opt/1password/helper',
    allowed_origins: [`chrome-extension://${OTHER}/`],
  })
  const relative = await hostDir({
    name: HOST,
    type: 'stdio',
    path: 'helper',
    allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
  })

  assert.equal(await findHost(HOST, EXTENSION_ID, [unlisted, listed]), null)
  assert.equal(await findHost(HOST, EXTENSION_ID, [relative]), null)
})

test('a port runs the host with the origin, relays both ways and stops it on disconnect', async () => {
  const native = nativeMessaging([await echoHost()])
  const { sender, ipc, sent } = worker(EXTENSION_ID)
  const event = { sender, extension: { id: EXTENSION_ID } }

  const reply = once(sent, 'crx-native-msg-c1')
  const connecting = native.connectNative(event, 'c1', HOST)

  // Posted at once, before the host has started.
  ipc.emit('crx-native-msg-c1', {}, { hello: '世界' })
  await connecting
  assert.deepEqual((await reply)[0], {
    echo: { hello: '世界' },
    origin: `chrome-extension://${EXTENSION_ID}/`,
  })

  const closed = once(sent, 'crx-native-msg-c1-disconnect')

  native.disconnectNative(event, 'c1')
  await closed
  assert.deepEqual(await native.sendNativeMessage(event, HOST, { once: true }), {
    echo: { once: true },
    origin: `chrome-extension://${EXTENSION_ID}/`,
  })
})

test('an extension cannot claim to be another one', async () => {
  const native = nativeMessaging([await echoHost()])
  const { sender } = worker(OTHER)

  await assert.rejects(
    native.connectNative({ sender, extension: { id: EXTENSION_ID } }, 'c2', HOST),
    /own pages/,
  )
  await assert.rejects(
    native.sendNativeMessage({ sender, extension: { id: EXTENSION_ID } }, HOST, {}),
    /own pages/,
  )
})

test('a host that is not allowed disconnects at once', async () => {
  const native = nativeMessaging([await echoHost()])
  const { sender, sent } = worker(OTHER)
  const closed = once(sent, 'crx-native-msg-c3-disconnect')

  await native.connectNative({ sender, extension: { id: OTHER } }, 'c3', HOST)
  await closed
  assert.equal(
    await native.sendNativeMessage({ sender, extension: { id: OTHER } }, HOST, {}),
    undefined,
  )
})
