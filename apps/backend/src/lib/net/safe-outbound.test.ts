import http from 'node:http'

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { config } from '@/config'

import {
  ERROR_BODY_LIMIT,
  blockedUrlReason,
  isBlockedAddress,
  pinnedFetch,
  pinnedRequest,
  resolvePublicTarget,
  safeLookup,
} from './safe-outbound'

import type { AddressInfo } from 'node:net'

describe('blockedUrlReason', () => {
  test.each([
    'http://127.0.0.1:3000',
    'http://10.0.0.1',
    'http://169.254.169.254/latest',
    'http://100.64.0.1',
    'http://[::1]:3000',
    'http://[::ffff:127.0.0.1]',
    'http://[::ffff:7f00:1]',
    'http://[64:ff9b::a9fe:a9fe]',
    'http://[2002:a9fe:a9fe::1]',
    'http://[fe80::1%25eth0]',
    'http://0.0.0.0',
    'http://2130706433',
    'http://0x7f.1',
    'http://198.18.0.1',
    'http://224.0.0.1',
    'http://[2001:0:4136:e378::1]',
    'http://[fd00::1]',
    'http://[ff02::1]',
    'http://localhost',
    'http://localhost.',
    'http://grafana.localhost',
    'http://printer.local',
    'http://grafana.monitoring.svc',
    'http://grafana.monitoring.svc.',
    'http://kubernetes.default.svc.cluster.local',
    'http://34.118.230.5',
    'http://user:secret@example.com',
    'file:///etc/passwd',
    'not a url',
  ])('refuses %s', (url) => {
    expect(blockedUrlReason(url)).not.toBeNull()
  })

  test.each([
    'https://grafana.example.com',
    'http://93.184.216.34:3000',
    'https://[2606:4700::1]',
    'http://34.118.208.1',
  ])('allows %s', (url) => {
    expect(blockedUrlReason(url)).toBeNull()
  })
})

describe('isBlockedAddress', () => {
  test('treats anything that is not an IP as blocked', () => {
    expect(isBlockedAddress('example.com')).toBe(true)
  })
})

describe('resolvePublicTarget', () => {
  test('refuses a public name that resolves to a private address', async () => {
    await expect(
      resolvePublicTarget('https://grafana.example.com', async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '10.0.0.5', family: 4 },
      ]),
    ).rejects.toMatchObject({ status: 400 })
  })

  test('refuses a name that resolves to the metadata server', async () => {
    await expect(
      resolvePublicTarget('http://metadata.google.internal', async () => [
        { address: '169.254.169.254', family: 4 },
      ]),
    ).rejects.toMatchObject({ status: 400 })
  })

  test('classifies every resolution afresh, so a rebound name is refused', async () => {
    const answers = ['93.184.216.34', '127.0.0.1']
    const rebinding = async () => [{ address: answers.shift()!, family: 4 }]

    await expect(
      resolvePublicTarget('https://grafana.example.com', rebinding),
    ).resolves.toMatchObject({ address: '93.184.216.34' })
    await expect(
      resolvePublicTarget('https://grafana.example.com', rebinding),
    ).rejects.toMatchObject({ status: 400 })
  })

  test('refuses a name that resolves into the cluster Service range', async () => {
    await expect(
      resolvePublicTarget('https://grafana.example.com', async () => [
        { address: '34.118.230.5', family: 4 },
      ]),
    ).rejects.toMatchObject({ status: 400 })
  })

  test('reports a name that does not resolve as unreachable', async () => {
    await expect(
      resolvePublicTarget('https://grafana.example.com', async () => []),
    ).rejects.toMatchObject({ status: 502 })
  })

  test('returns the checked address to pin, preferring IPv4', async () => {
    expect(
      await resolvePublicTarget('https://grafana.example.com', async () => [
        { address: '2606:4700::1', family: 6 },
        { address: '93.184.216.34', family: 4 },
      ]),
    ).toEqual({ hostname: 'grafana.example.com', address: '93.184.216.34', family: 4 })
  })
})

describe('pinnedRequest', () => {
  let server: http.Server
  let port: number
  const seen: { host?: string; path?: string }[] = []
  let streamOpen: (() => void) | undefined

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      seen.push({ host: req.headers.host, path: req.url })
      if (req.url === '/encoding') {
        res.end(req.headers['accept-encoding'] ?? '')

        return
      }
      if (req.url === '/stream') {
        res.write('first')
        streamOpen = () => res.end('last')

        return
      }
      if (req.url === '/huge-error') {
        res.writeHead(500)
        res.end('x'.repeat(ERROR_BODY_LIMIT * 4))

        return
      }
      if (req.url === '/redirect') {
        res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' })
        res.end()

        return
      }
      res.end('reached')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })

  afterAll(() => {
    server.close()
  })

  test('connects to the pinned address while keeping the original Host', async () => {
    const res = await pinnedRequest({
      url: new URL(`http://grafana.example.com:${String(port)}/api/health`),
      method: 'GET',
      headers: new Headers(),
      target: { hostname: 'grafana.example.com', address: '127.0.0.1', family: 4 },
    })

    expect(await res.text()).toBe('reached')
    expect(seen.at(-1)).toEqual({
      host: `grafana.example.com:${String(port)}`,
      path: '/api/health',
    })
  })

  test('returns a redirect instead of following it', async () => {
    const before = seen.length
    const res = await pinnedRequest({
      url: new URL(`http://grafana.example.com:${String(port)}/redirect`),
      method: 'GET',
      headers: new Headers(),
      target: { hostname: 'grafana.example.com', address: '127.0.0.1', family: 4 },
    })

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('http://169.254.169.254/latest/meta-data/')
    expect(seen).toHaveLength(before + 1)
  })

  test('reads no more than the limit of an error body', async () => {
    const res = await pinnedRequest({
      url: new URL(`http://grafana.example.com:${String(port)}/huge-error`),
      method: 'GET',
      headers: new Headers(),
      target: { hostname: 'grafana.example.com', address: '127.0.0.1', family: 4 },
    })

    expect(res.status).toBe(500)
    expect((await res.arrayBuffer()).byteLength).toBe(ERROR_BODY_LIMIT)
  })

  test('hands a successful body over while it is still arriving', async () => {
    const res = await pinnedRequest({
      url: new URL(`http://grafana.example.com:${String(port)}/stream`),
      method: 'GET',
      headers: new Headers(),
      target: { hostname: 'grafana.example.com', address: '127.0.0.1', family: 4 },
    })
    const reader = res.body!.getReader()

    expect(Buffer.from((await reader.read()).value!).toString()).toBe('first')
    expect(streamOpen).toBeDefined()
    streamOpen!()
    reader.releaseLock()
  })

  test('pinnedFetch refuses loopback before any request is sent', async () => {
    const before = seen.length

    await expect(pinnedFetch(`http://127.0.0.1:${String(port)}/`)).rejects.toMatchObject({
      status: 400,
    })
    expect(seen).toHaveLength(before)
  })

  test('pinnedFetch always asks for an unencoded body', async () => {
    config.byos.outbound.allowPrivateHosts = true
    try {
      const res = await pinnedFetch(`http://127.0.0.1:${String(port)}/encoding`, {
        headers: { 'accept-encoding': 'gzip, br' },
      })

      expect(await res.text()).toBe('identity')
    } finally {
      config.byos.outbound.allowPrivateHosts = false
    }
  })

  test('safeLookup refuses a connection that resolves to loopback', async () => {
    const outcome = await new Promise<string>((resolve) => {
      const req = http.request(
        `http://localhost:${String(port)}/`,
        { agent: new http.Agent({ lookup: safeLookup }) },
        (res) => {
          res.resume()
          resolve('connected')
        },
      )

      req.on('error', (err: NodeJS.ErrnoException) => {
        resolve(err.code ?? err.message)
      })
      req.end()
    })

    expect(outcome).toBe('EACCES')
  })
})

describe('IPv4-mapped addresses', () => {
  test('are classified by the embedded IPv4 address', () => {
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isBlockedAddress('::ffff:a9fe:a9fe')).toBe(true)
    expect(isBlockedAddress('::ffff:93.184.216.34')).toBe(false)
    expect(isBlockedAddress('93.184.216.34')).toBe(false)
  })
})
