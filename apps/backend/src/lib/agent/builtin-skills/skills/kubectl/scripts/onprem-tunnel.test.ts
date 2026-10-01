// Behavioral tests for the sandbox-side on-prem tunnel. A real listener stands
// in for the relay's CONNECT proxy and a shim stands in for kubectl, so the
// whole path is exercised — resolve proxy-url, CONNECT, splice bytes — with no
// network and no backend.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import net from 'node:net'
import path from 'node:path'

const scriptsDir = path.dirname(new URL(import.meta.url).pathname)
const tunnel = path.join(scriptsDir, 'onprem-tunnel.py')

let home: string
let shim: string
let openedPorts: number[]

type FakeRelay = {
  port: number
  close: () => void
  /** CONNECT targets the proxy was asked for, in order. */
  targets: string[]
}

/**
 * A CONNECT proxy that echoes whatever the tunnelled stream sends, so a byte
 * arriving back at the local port proves the whole chain.
 */
function startFakeRelay(opts: { status?: number; expectCredential?: string } = {}): Promise<FakeRelay> {
  const targets: string[] = []
  const server = net.createServer((socket) => {
    let head = ''
    const onData = (chunk: Buffer) => {
      head += chunk.toString('latin1')
      if (!head.includes('\r\n\r\n')) return
      socket.off('data', onData)

      const [requestLine, ...headerLines] = head.split('\r\n')
      targets.push(requestLine!.split(' ')[1] ?? '')
      const credential = headerLines
        .find((line) => line.toLowerCase().startsWith('proxy-authorization:'))
        ?.split(' ')
        .pop()

      const status = opts.status ?? 200
      if (opts.expectCredential && credential !== opts.expectCredential) {
        socket.end('HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n')
        return
      }
      if (status !== 200) {
        socket.end(`HTTP/1.1 ${status} Nope\r\nContent-Length: 0\r\n\r\n`)
        return
      }
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      socket.on('data', (payload) => socket.write(payload))
    }
    socket.on('data', onData)
    socket.on('error', () => {})
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: (server.address() as net.AddressInfo).port,
        close: () => server.close(),
        targets,
      })
    })
  })
}

/** Stands in for `kubectl config view -o jsonpath=…`. */
function writeKubectlShim(proxyUrl: string): void {
  writeFileSync(
    path.join(shim, 'kubectl'),
    `#!/usr/bin/env bash\nprintf '%s' ${JSON.stringify(proxyUrl)}\n`,
    { mode: 0o755 },
  )
}

/**
 * Async on purpose: the fake relay is a listener inside this process, so a
 * synchronous spawn would block the event loop that has to accept its
 * connection — the script would wait for a CONNECT response that cannot be
 * written until the script exits. It also starves every test file running
 * alongside this one.
 */
async function run(args: string[]) {
  const proc = Bun.spawn(['python3', tunnel, ...args], {
    env: { HOME: home, PATH: `${shim}:/usr/bin:/bin` },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return { exitCode, stdout, stderr }
}

function localPortOf(stdout: string): number {
  const match = /127\.0\.0\.1:(\d+)/.exec(stdout)
  if (!match) throw new Error(`no local port in output: ${stdout}`)
  const port = Number(match[1])
  openedPorts.push(port)
  return port
}

function roundTrip(port: number, payload: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => socket.write(payload))
    let received = ''
    socket.setTimeout(5_000, () => {
      socket.destroy()
      reject(new Error('timed out waiting for the tunnel to echo'))
    })
    socket.on('data', (chunk) => {
      received += chunk.toString()
      if (received.length >= payload.length) {
        socket.end()
        resolve(received)
      }
    })
    socket.on('error', reject)
  })
}

beforeEach(() => {
  const root = mkdtempSync(path.join(tmpdir(), 'onprem-tunnel-'))
  home = path.join(root, 'home')
  shim = path.join(root, 'shim')
  Bun.spawnSync(['mkdir', '-p', home, shim])
  openedPorts = []
})

afterEach(async () => {
  if (openedPorts.length) await run(['close', 'all'])
})

describe('onprem-tunnel.py', () => {
  test('forwards a local port to an in-cluster address through the relay', async () => {
    const relay = await startFakeRelay()
    writeKubectlShim(`http://nr1_session-token:x@127.0.0.1:${relay.port}`)

    const opened = await run(['open', 'onprem/acme-dc1/cluster', '10.0.0.5:5432'])
    expect(opened.exitCode).toBe(0)
    expect(opened.stdout).toContain('-> 10.0.0.5:5432 via onprem/acme-dc1/cluster')

    const port = localPortOf(opened.stdout)
    expect(await roundTrip(port, 'select 1')).toBe('select 1')
    // The preflight CONNECT plus the real one — both naming the in-cluster target.
    expect(relay.targets).toEqual(['10.0.0.5:5432', '10.0.0.5:5432'])
    relay.close()
  })

  test('sends the kubeconfig credential as Basic proxy auth', async () => {
    const expected = Buffer.from('nr1_session-token:x').toString('base64')
    const relay = await startFakeRelay({ expectCredential: expected })
    writeKubectlShim(`http://nr1_session-token:x@127.0.0.1:${relay.port}`)

    const opened = await run(['open', 'onprem/acme-dc1/cluster', '10.0.0.5:6379'])
    expect(opened.exitCode).toBe(0)
    const port = localPortOf(opened.stdout)
    expect(await roundTrip(port, 'PING')).toBe('PING')
    relay.close()
  })

  test('honours an explicit local port and lists then closes the tunnel', async () => {
    const relay = await startFakeRelay()
    writeKubectlShim(`http://nr1_session-token:x@127.0.0.1:${relay.port}`)

    const chosen = 34567
    const opened = await run(['open', 'onprem/acme-dc1/cluster', '10.0.0.5:5432', String(chosen)])
    expect(opened.exitCode).toBe(0)
    expect(localPortOf(opened.stdout)).toBe(chosen)

    expect((await run(['list'])).stdout).toContain(`127.0.0.1:${chosen} -> 10.0.0.5:5432`)
    expect((await run(['close', String(chosen)])).stdout).toContain(`closed 127.0.0.1:${chosen}`)
    expect((await run(['list'])).stdout).not.toContain(String(chosen))
    relay.close()
  })

  test('reports a disconnected relay agent instead of leaving a dead listener', async () => {
    const relay = await startFakeRelay({ status: 503 })
    writeKubectlShim(`http://nr1_session-token:x@127.0.0.1:${relay.port}`)

    const opened = await run(['open', 'onprem/acme-dc1/cluster', '10.0.0.5:5432'])
    expect(opened.exitCode).toBe(1)
    expect(opened.stderr).toContain('relay agent is not connected')
    // Nothing was backgrounded, so there is no listener to mislead the next command.
    expect((await run(['list'])).stdout.trim()).toBe('')
    relay.close()
  })

  test('refuses a context that is not reached through the relay', async () => {
    writeKubectlShim('')
    const opened = await run(['open', 'aws/123456789012/prod', '10.0.0.5:5432'])
    expect(opened.exitCode).toBe(1)
    expect(opened.stderr).toContain('has no proxy-url')
  })

  test('rejects a target that is not host:port', async () => {
    writeKubectlShim('http://nr1_session-token:x@127.0.0.1:9')
    const opened = await run(['open', 'onprem/acme-dc1/cluster', '10.0.0.5'])
    expect(opened.exitCode).toBe(1)
    expect(opened.stderr).toContain('must be host:port')
  })
})
