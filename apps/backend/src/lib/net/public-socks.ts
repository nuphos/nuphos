import { randomBytes } from 'node:crypto'
import net from 'node:net'

import { resolvePublicTarget } from './safe-outbound'

import type { HostLookup } from './safe-outbound'
import type { AddressInfo } from 'node:net'

/**
 * A TCP connection to a team-configured host:port for drivers that take a
 * socket: resolved and classified now, dialled at the checked address. `host`
 * on the socket keeps the name for TLS.
 */
export async function connectPublic(
  host: string,
  port: number,
  lookup?: HostLookup,
): Promise<net.Socket> {
  const authority = net.isIPv6(host) ? `[${host}]` : host
  const target = await resolvePublicTarget(`http://${authority}/`, lookup)
  const socket = net.connect({ host: target.address, port })

  return Object.assign(socket, { host: target.hostname })
}

/**
 * A loopback SOCKS5 proxy that only dials through `connectPublic`. Drivers
 * that discover more hosts on their own (MongoDB replica sets, SRV seeds) go
 * through it, so every connection — named or literal, seed or discovered — is
 * classified and pinned, which a `lookup` hook cannot do for literal IPs.
 */
export type PublicSocksProxy = { host: string; port: number; username: string; password: string }

let started: Promise<PublicSocksProxy> | undefined

export async function publicSocksProxy(): Promise<PublicSocksProxy> {
  started ??= listen()

  return await started
}

async function listen(): Promise<PublicSocksProxy> {
  const username = 'public'
  const password = randomBytes(24).toString('hex')
  const server = net.createServer((client) => {
    acceptClient(client, username, password)
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  server.unref()

  return { host: '127.0.0.1', port: (server.address() as AddressInfo).port, username, password }
}

export function acceptClient(client: net.Socket, username: string, password: string) {
  // From acceptance on: a reset mid-handshake must not reach the process.
  client.on('error', () => client.destroy())
  relay(client, username, password).catch(() => client.destroy())
}

type Reader = { read: (length: number) => Promise<Buffer>; release: () => Buffer }

function reader(socket: net.Socket): Reader {
  let buffered = Buffer.alloc(0)
  let wake = () => undefined as void
  let closed = false
  const onData = (chunk: Buffer) => {
    buffered = Buffer.concat([buffered, chunk])
    wake()
  }

  socket.on('data', onData)
  socket.once('close', () => {
    closed = true
    wake()
  })

  return {
    read: async (length) => {
      while (buffered.length < length) {
        if (closed) throw new Error('client closed')
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      }
      const out = buffered.subarray(0, length)

      buffered = buffered.subarray(length)

      return out
    },
    // Stop reading; whatever arrived past the handshake is handed on.
    release: () => {
      socket.off('data', onData)
      socket.pause()

      return buffered
    },
  }
}

const reply = (code: number) => Buffer.from([5, code, 0, 1, 0, 0, 0, 0, 0, 0])

async function authenticate(io: Reader, client: net.Socket, username: string, password: string) {
  const [, methods] = await io.read(2)

  if (!(await io.read(methods!)).includes(2)) {
    client.end(Buffer.from([5, 0xff]))

    return false
  }
  client.write(Buffer.from([5, 2]))
  await io.read(1)
  const user = (await io.read((await io.read(1))[0]!)).toString()
  const pass = (await io.read((await io.read(1))[0]!)).toString()
  const ok = user === username && pass === password

  client.write(Buffer.from([1, ok ? 0 : 1]))

  return ok
}

async function destination(io: Reader): Promise<{ command: number; host: string; port: number }> {
  const [, command, , addressType] = await io.read(4)
  let host = ''

  if (addressType === 1) host = [...(await io.read(4))].join('.')
  if (addressType === 3) host = (await io.read((await io.read(1))[0]!)).toString()
  if (addressType === 4) {
    const bytes = await io.read(16)

    host = Array.from({ length: 8 }, (_, i) => bytes.readUInt16BE(i * 2).toString(16)).join(':')
  }

  return { command: command!, host, port: (await io.read(2)).readUInt16BE() }
}

async function relay(client: net.Socket, username: string, password: string) {
  const io = reader(client)

  if (!(await authenticate(io, client, username, password))) {
    client.end()

    return
  }
  const { command, host, port } = await destination(io)

  if (command !== 1 || !host) {
    client.end(reply(7))

    return
  }
  const upstream = await connectPublic(host, port).catch(() => undefined)

  if (!upstream) {
    client.end(reply(2))

    return
  }
  let connected = false

  // Either side going away ends the other, including while the dial is pending.
  upstream.on('error', () => (connected ? client.destroy() : client.end(reply(4))))
  upstream.once('close', () => connected && client.destroy())
  client.once('close', () => upstream.destroy())
  if (client.destroyed) upstream.destroy()
  upstream.once('connect', () => {
    connected = true
    client.write(reply(0))
    upstream.write(io.release())
    client.pipe(upstream).pipe(client)
  })
}
